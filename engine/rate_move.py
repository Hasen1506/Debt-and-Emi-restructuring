"""After an RBI policy move: what a repo-linked loan should do, both ways (A13).

When the RBI changes the repo rate, a bank loan linked to it (EBLR / RLLR)
must be re-priced at least once in three months (Interest Rates on Advances
Directions 2025, para 38: citations.EBLR_RESET), and the borrower must be
told of any rise in EMI or tenure and offered the choice of a higher EMI, a
longer tenure, or both, and of prepaying (para 349: citations.RESET_CHOICES_BANK).

This module works out, for one loan and one repo move, the two numbers a
borrower should check on the next statement:

  keep the tenure -> the EMI changes to X
  keep the EMI    -> the tenure changes by N months (and costs Y more/less interest)

and which of the two is worth more to them. It assumes the spread over repo
is unchanged, so the loan rate moves by exactly the repo move (that is what
"linked" means; a bank may change the spread only as para 33 allows).

Pure functions, Decimal money, months simulated one by one so the totals
match a real amortisation (the last EMI is the smaller balance it clears).
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import date, timedelta
from decimal import ROUND_HALF_UP, Decimal
from typing import Optional

from engine.citations import EBLR_RESET, RESET_CHOICES_BANK, PREPAYMENT_NO_CHARGE, Citation
from engine.formulas import emi as emi_of

D = Decimal
# Same window as loan_check.reset_watch: "at least once in three months".
RESET_WINDOW_DAYS = 91
# Past this many months, "keep the EMI" is not a real option (the loan would
# outlive any borrower's working life); banks cap tenure by age as well.
MAX_MONTHS = 480
ROUNDING_SLACK = D("0.01")


class RateMoveError(ValueError):
    pass


@dataclass(frozen=True)
class Schedule:
    months: Optional[int]          # None = never clears (EMI below the month's interest)
    interest: Optional[Decimal]


@dataclass(frozen=True)
class RateMove:
    name: str
    decision_day: date
    check_by: date
    repo_from: Decimal
    repo_to: Decimal
    rate_from: Decimal
    rate_to: Decimal
    outstanding: Decimal
    emi_now: Decimal
    months_now: int
    interest_now: Decimal
    # Option 1: keep the tenure, the EMI changes.
    emi_new: Decimal
    emi_change: Decimal
    interest_keep_tenure: Decimal
    # Option 2: keep the EMI, the tenure changes.
    months_keep_emi: Optional[int]        # None: the EMI no longer covers the interest
    months_change: Optional[int]
    interest_keep_emi: Optional[Decimal]
    # Interest the "keep the EMI" route costs over "keep the tenure" (positive on a hike).
    tenure_route_extra_interest: Optional[Decimal]
    best: str                              # "raise_emi" | "keep_emi" | "either"
    best_why: str
    citations: tuple[Citation, ...]

    @property
    def is_hike(self) -> bool:
        return self.repo_to > self.repo_from


def _r2(x: Decimal) -> Decimal:
    return x.quantize(D("0.01"), rounding=ROUND_HALF_UP)


def amortise(principal: Decimal, annual_rate: Decimal, payment: Decimal, *, cap: int = MAX_MONTHS) -> Schedule:
    """Months and total interest to clear `principal` paying `payment` a month."""
    if principal <= 0:
        return Schedule(0, D("0"))
    r = annual_rate / D(12)
    bal = principal
    interest = D("0")
    for m in range(1, cap + 1):
        i = _r2(bal * r)
        if payment <= i:
            return Schedule(None, None)
        interest += i
        bal = bal + i - payment
        # A leftover under 1% of an EMI is paisa rounding piled up over the
        # years; lenders fold it into the last EMI, not another month.
        if bal < payment * ROUNDING_SLACK:
            return Schedule(m, interest)
    return Schedule(None, None)


def check_by(decision_day: date) -> date:
    return decision_day + timedelta(days=RESET_WINDOW_DAYS)


def rate_move(
    *,
    name: str,
    outstanding: Decimal,
    rate: Decimal,
    decision_day: date,
    repo_from: Decimal,
    repo_to: Decimal,
    emi_now: Optional[Decimal] = None,
    months_left: Optional[int] = None,
    rate_already_moved: bool = False,
) -> RateMove:
    """Both options for one repo-linked loan after one repo move.

    `rate` is the loan's rate as the user entered it. With
    `rate_already_moved` it is taken as the post-move rate (the user updated
    it after the statement changed); otherwise as the pre-move rate.
    Either `emi_now` or `months_left` is needed; with both, the EMI wins
    (it is what the bank actually collects) and months are derived from it.
    """
    outstanding = D(outstanding)
    rate = D(rate)
    if outstanding <= 0:
        raise RateMoveError("This loan has nothing left to pay.")
    if not (D("0") <= rate < D("0.5")):
        raise RateMoveError("The rate looks wrong (enter 8.5% as 0.085).")
    delta = D(repo_to) - D(repo_from)
    rate_from = rate - delta if rate_already_moved else rate
    rate_to = rate if rate_already_moved else rate + delta
    if rate_from < 0 or rate_to < 0:
        raise RateMoveError("The rate can't go below zero.")

    if emi_now is not None and D(emi_now) > 0:
        e = D(emi_now)
    elif months_left and months_left > 0:
        e = _r2(emi_of(outstanding, rate_from, months_left))
    else:
        raise RateMoveError("Need the EMI or the months left.")
    now = amortise(outstanding, rate_from, e)
    if now.months is None:
        raise RateMoveError("At the old rate this EMI doesn't cover the interest; check the numbers.")
    n = now.months

    # Option 1: same tenure, new EMI.
    e_new = _r2(emi_of(outstanding, rate_to, n))
    keep_t = amortise(outstanding, rate_to, e_new, cap=n + 1)
    # Option 2: same EMI, new tenure.
    keep_e = amortise(outstanding, rate_to, e)

    extra: Optional[Decimal] = None
    if keep_e.interest is not None and keep_t.interest is not None:
        extra = _r2(keep_e.interest - keep_t.interest)
    hike = delta > 0
    if delta == 0:
        best, why = "either", "The repo rate didn't change, so your loan shouldn't either."
    elif hike and keep_e.months is None:
        best, why = ("raise_emi",
                     f"At {_pct(rate_to)} your current EMI no longer covers the month's interest, so the "
                     f"tenure can't absorb this: the EMI has to go up (or prepay part of the loan).")
    elif hike:
        best, why = ("raise_emi",
                     f"Paying {_money(e_new - e)} more a month keeps your end date and costs "
                     f"{_money(extra or D(0))} less interest than stretching the loan by "
                     f"{(keep_e.months or n) - n} months. If that's too tight, take the longer tenure and "
                     f"prepay when you can: there is no prepayment charge on an individual's floating-rate loan.")
    else:
        best, why = ("keep_emi",
                     f"Keep paying {_money(e)} and let the loan end {n - (keep_e.months or n)} months sooner: "
                     f"that saves {_money(-(extra or D(0)))} more interest than taking the lower EMI. Ask the "
                     f"bank to keep the EMI and cut the tenure if it lowers the EMI by default.")

    return RateMove(
        name=name, decision_day=decision_day, check_by=check_by(decision_day),
        repo_from=D(repo_from), repo_to=D(repo_to), rate_from=rate_from, rate_to=rate_to,
        outstanding=outstanding, emi_now=e, months_now=n, interest_now=_r2(now.interest or D(0)),
        emi_new=e_new, emi_change=_r2(e_new - e),
        interest_keep_tenure=_r2(keep_t.interest or D(0)),
        months_keep_emi=keep_e.months,
        months_change=(keep_e.months - n) if keep_e.months is not None else None,
        interest_keep_emi=_r2(keep_e.interest) if keep_e.interest is not None else None,
        tenure_route_extra_interest=extra,
        best=best, best_why=why,
        citations=(EBLR_RESET, RESET_CHOICES_BANK, PREPAYMENT_NO_CHARGE),
    )


def _pct(x: Decimal) -> str:
    return f"{(D(x) * 100).quantize(D('0.01'))}%"


def _money(x: Decimal) -> str:
    v = int(_r2(D(x)).to_integral_value(rounding=ROUND_HALF_UP))
    s = str(abs(v))
    if len(s) > 3:                               # Indian grouping: 12,34,567
        head, tail = s[:-3], s[-3:]
        parts = []
        while len(head) > 2:
            parts.insert(0, head[-2:])
            head = head[:-2]
        if head:
            parts.insert(0, head)
        s = ",".join(parts) + "," + tail
    return ("-" if v < 0 else "") + "₹" + s


def email_lines(m: RateMove) -> list[str]:
    """Plain lines for the rate-move email (the HTML is built from these)."""
    verb = "raised" if m.is_hike else "cut"
    lines = [
        f"{m.name}: the RBI {verb} the repo rate from {_pct(m.repo_from)} to {_pct(m.repo_to)} on "
        f"{m.decision_day:%d %b %Y}. A repo-linked loan must be re-priced at least once in three months, "
        f"so by {m.check_by:%d %b %Y} your rate should read {_pct(m.rate_to)} (was {_pct(m.rate_from)}).",
        f"Numbers to check on your statement: either the EMI goes from {_money(m.emi_now)} to "
        f"{_money(m.emi_new)} with the same end date",
    ]
    if m.months_keep_emi is None:
        lines[-1] += (", or, if the bank keeps your EMI, the loan would barely reduce (it would run past "
                      f"{MAX_MONTHS // 12} years): ask the bank to raise the EMI or prepay part of it.")
    else:
        lines[-1] += (f", or the EMI stays {_money(m.emi_now)} and the loan runs "
                      f"{abs(m.months_change or 0)} months {'longer' if (m.months_change or 0) > 0 else 'shorter'}.")
    lines.append(f"Best for you: {m.best_why}")
    if m.is_hike:
        lines.append("Your bank must tell you of any rise in EMI or tenure and let you choose a higher EMI, "
                     "a longer tenure, or both. If it raised your EMI without asking, you can ask it to switch.")
    return lines
