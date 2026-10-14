"""What a repo-rate move does to one floating-rate loan, for the hike cycle.

Audit 80+ item A11 (14 Oct 2026). RBI raised the repo rate 25 bps to 5.50%
on 7 Oct 2026 and moved to "calibrated tightening" (MPC resolution,
https://www.rbi.org.in/Scripts/BS_PressReleaseDisplay.aspx?prid=63742, read
14 Oct 2026). From here on most well-run repo-linked loans show "nothing to
claim"; what borrowers ask is "how much will my EMI go up, can I choose the
tenure instead, and did my bank play fair?". This module answers the three
questions Loan Check now leads with:

(a) rate_move_impact: the new EMI (same end date) or the new tenure (same
    EMI) after a move, and what each costs in interest. The choice is the
    borrower's: RBI's reset circular of 18 Aug 2023 (RBI/2023-24/55,
    https://www.rbi.org.in/Scripts/NotificationUser.aspx?Id=12529), carried
    into para 349 of the Commercial Banks Responsible Business Conduct
    Directions 2025 and para 31 of the NBFC ones (engine/citations.py,
    RESET_CHOICES_BANK / RESET_CHOICES_NBFC), says the borrower "shall also
    be given the choice to opt for (i) enhancement in EMI or elongation of
    tenor or for a combination of both options; and, (ii) to prepay", and
    para 349(5) that elongation must not cause negative amortisation.
(b) switch_saving: an MCLR or base-rate loan moved to the bank's repo-linked
    rate (para 41 of the Interest Rates on Advances Directions 2025,
    EBLR_SWITCH).
(c) pass_through: from the borrower's own rate history, how fast each repo
    rise and each cut reached the loan. A repo-linked rate must be reset at
    least once in three months (para 38, EBLR_RESET); a cut that took longer
    is worth asking about, a rise passed on within the window is allowed.

Everything here is arithmetic on what the borrower enters. Amounts are
estimates for a conversation with the lender and are never a refund claim
(only loan_check's missed_rate_cut is claimable).
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date
from decimal import ROUND_CEILING, ROUND_HALF_UP, Decimal
from typing import Optional

from engine.formulas import emi as emi_formula

D = Decimal
# Banks quote rates in steps of 0.05%; smaller differences are rounding.
TOL = D("0.0005")
RESET_WINDOW_MONTHS = 3
MAX_MONTHS = 1200   # a loop guard: 100 years


def _money(x: Decimal) -> Decimal:
    return x.quantize(D("1"), rounding=ROUND_HALF_UP)


def _month_start(d: date) -> date:
    return d.replace(day=1)


def _months_between(a: date, b: date) -> int:
    """Whole months from a's month to b's month."""
    return (b.year - a.year) * 12 + (b.month - a.month)


def _add_months(d: date, n: int) -> date:
    y, m = divmod(d.month - 1 + n, 12)
    return date(d.year + y, m + 1, 1)


# ─────────────────────────────────────────────────────────────────────────────
# (a) EMI or tenure after a rate move
# ─────────────────────────────────────────────────────────────────────────────

def _run(balance: Decimal, rate: Decimal, payment: Decimal, limit: int = MAX_MONTHS) -> tuple[int, Decimal]:
    """(months to clear, total interest) paying `payment` a month at `rate`.
    The last month pays only what is left. (MAX_MONTHS, interest so far)
    when the payment never clears it."""
    interest_total = D("0")
    b = balance
    for m in range(1, limit + 1):
        i = b * rate / D("12")
        interest_total += i
        b = b + i - payment
        if b <= D("0.5"):
            return m, interest_total
    return limit, interest_total


def _pv(payment: Decimal, rate: Decimal, months: int) -> Decimal:
    """Balance that `payment` a month clears in exactly `months` at `rate`."""
    if rate == 0:
        return payment * months
    r = rate / D("12")
    return payment * (1 - (1 + r) ** (-months)) / r


@dataclass(frozen=True)
class RateMoveImpact:
    """One loan before and after a rate move. Money in whole rupees."""
    rate_before: Decimal
    rate_after: Decimal
    outstanding: Decimal
    emi_before: Decimal
    months_before: int
    interest_before: Decimal
    # Option 1: raise the EMI, keep the end date.
    emi_after: Decimal
    emi_change: Decimal               # signed; > 0 on a rise
    interest_emi_option: Decimal      # total interest from now, option 1
    # Option 2: keep the EMI, change the tenure. None when the old EMI no
    # longer covers the month's interest (negative amortisation, which the
    # rules forbid: the lender must raise the EMI).
    months_after: Optional[int]
    months_change: Optional[int]      # signed; > 0 on a rise
    interest_tenure_option: Optional[Decimal]
    tenure_option_possible: bool
    # Option 3: a part-prepayment that keeps both the EMI and the end date.
    prepay_to_keep_both: Decimal      # >= 0 (0 on a cut)
    # Interest option 2 costs over option 1 (> 0 on a rise; the price of a
    # lower EMI), None when option 2 is not possible.
    tenure_premium: Optional[Decimal]


def rate_move_impact(
    outstanding: Decimal, rate_before: Decimal, rate_after: Decimal,
    months_left: int, emi: Optional[Decimal] = None,
) -> RateMoveImpact:
    """EMI-or-tenure arithmetic for a move from `rate_before` to `rate_after`.

    `emi` is the EMI paid before the move (worked out from the balance, rate
    and months left when not given). With a given EMI the "months before" is
    what that EMI really takes, so a loan whose EMI and tenure disagree is
    measured on its own terms."""
    if outstanding <= 0 or months_left < 1:
        raise ValueError("outstanding must be > 0 and months_left >= 1")
    e0 = emi if emi is not None and emi > 0 else emi_formula(outstanding, rate_before, months_left)
    n0, int0 = _run(outstanding, rate_before, e0)
    if emi is None:
        n0 = months_left  # the formula EMI clears it in months_left by construction
    # Option 1: same end date at the new rate.
    e1 = emi_formula(outstanding, rate_after, n0)
    _, int1 = _run(outstanding, rate_after, e1, n0 + 1)
    # Option 2: same EMI at the new rate.
    possible = e0 > outstanding * rate_after / D("12")
    if possible:
        n2, int2 = _run(outstanding, rate_after, e0)
        possible = n2 < MAX_MONTHS
    if possible:
        months_after: Optional[int] = n2
        months_change: Optional[int] = n2 - n0
        int_t: Optional[Decimal] = _money(int2)
        premium: Optional[Decimal] = _money(int2 - int1)
    else:
        months_after = months_change = None
        int_t = premium = None
    # Option 3: prepay so the old EMI clears the rest in n0 months.
    keep = outstanding - _pv(e0, rate_after, n0)
    prepay = max(D("0"), keep).quantize(D("1"), rounding=ROUND_CEILING)
    return RateMoveImpact(
        rate_before=rate_before, rate_after=rate_after, outstanding=outstanding,
        emi_before=_money(e0), months_before=n0, interest_before=_money(int0),
        emi_after=_money(e1), emi_change=_money(e1) - _money(e0),
        interest_emi_option=_money(int1),
        months_after=months_after, months_change=months_change,
        interest_tenure_option=int_t, tenure_option_possible=possible,
        prepay_to_keep_both=prepay, tenure_premium=premium,
    )


# ─────────────────────────────────────────────────────────────────────────────
# (b) MCLR / base rate → repo-linked
# ─────────────────────────────────────────────────────────────────────────────

@dataclass(frozen=True)
class SwitchSaving:
    current_rate: Decimal
    switch_rate: Decimal
    switch_cost: Decimal
    interest_saved_12m: Decimal      # before the cost
    interest_saved_rest: Decimal     # over the rest of the loan, same EMI, before the cost
    net_saving_rest: Decimal         # interest_saved_rest − switch_cost (may be < 0)
    months_saved: int                # tenure shortened at the same EMI
    payback_months: Optional[int]    # months of saving to earn back the cost


def switch_saving(
    outstanding: Decimal, current_rate: Decimal, switch_rate: Decimal,
    months_left: int, emi: Optional[Decimal] = None, switch_cost: Decimal = D("0"),
) -> SwitchSaving:
    """Interest saved by moving to `switch_rate`, keeping the EMI (Indian
    banks usually keep the EMI and move the tenure). Saving is 0 when the
    switch rate is not lower."""
    e0 = emi if emi is not None and emi > 0 else emi_formula(outstanding, current_rate, months_left)
    n_now, int_now = _run(outstanding, current_rate, e0)
    if switch_rate >= current_rate:
        n_new, int_new = n_now, int_now
    else:
        n_new, int_new = _run(outstanding, switch_rate, e0)
    # First 12 months: interest on the running balance, both paths.
    b_a = b_b = outstanding
    saved12 = D("0")
    for _ in range(min(12, n_now)):
        ia, ib = b_a * current_rate / 12, b_b * min(switch_rate, current_rate) / 12
        saved12 += ia - ib
        b_a, b_b = b_a + ia - e0, b_b + ib - e0
    saved_rest = _money(max(D("0"), int_now - int_new))
    saved12 = _money(max(D("0"), saved12))
    payback = None
    if switch_cost > 0 and saved12 > 0:
        payback = int((switch_cost * 12 / saved12).to_integral_value(rounding=ROUND_CEILING))
    return SwitchSaving(
        current_rate=current_rate, switch_rate=switch_rate, switch_cost=_money(switch_cost),
        interest_saved_12m=saved12, interest_saved_rest=saved_rest,
        net_saving_rest=saved_rest - _money(switch_cost),
        months_saved=max(0, n_now - n_new), payback_months=payback,
    )


# ─────────────────────────────────────────────────────────────────────────────
# (c) did rises reach the loan faster than cuts?
# ─────────────────────────────────────────────────────────────────────────────

@dataclass(frozen=True)
class MoveReached:
    """One repo move and when the loan followed it."""
    decided: date                    # RBI decision day
    repo_from: Decimal
    repo_to: Decimal
    reached: Optional[date]          # first month the loan rate moved for it; None: not yet
    lag_months: Optional[int]        # months from the decision month to `reached`
    late_months: int                 # months past the 3-month reset window (cuts and rises)

    @property
    def is_cut(self) -> bool:
        return self.repo_to < self.repo_from


@dataclass(frozen=True)
class PassThrough:
    moves: list[MoveReached]
    avg_rise_lag: Optional[Decimal]
    avg_cut_lag: Optional[Decimal]
    late_cuts: int
    # Extra interest from cuts that reached the loan after the window, at
    # today's balance (lower than the balance then, so a cautious figure).
    late_cut_interest: Decimal
    asymmetric: bool
    notes: list[str] = field(default_factory=list)


def _loan_changes(start: date, start_rate: Decimal, history: list[tuple[date, Decimal]]) -> list[tuple[date, Decimal]]:
    """(month, signed change) from the borrower's rate history, oldest first.
    `history` is (month the rate took effect, rate) in any order; entries
    that repeat the rate in force are dropped."""
    out: list[tuple[date, Decimal]] = []
    prev = start_rate
    for m, r in sorted((_month_start(d), r) for d, r in history):
        if m < _month_start(start):
            continue
        if abs(r - prev) > TOL / 2:
            out.append((m, r - prev))
            prev = r
    return out


def pass_through(
    loan_start: date, start_rate: Decimal, history: list[tuple[date, Decimal]],
    repo_changes: list[tuple[date, Decimal, Decimal]], as_of: date, outstanding: Decimal,
) -> PassThrough:
    """Match each repo change after the loan started to the loan-rate change
    that carried it.

    A loan change carries one repo move, or several consecutive same-way
    moves at once (2022's rises came a month apart and were often passed
    on together); a loan change in the other direction, or one that does
    not add up, matches nothing. A move with no matching change is "not
    reached": that is the missed-cut finding's job when the gap is still
    open today, so it adds no money here."""
    loan = _loan_changes(loan_start, start_rate, history)
    moves = [c for c in repo_changes if _month_start(c[0]) >= _add_months(_month_start(loan_start), -2)]
    used = [False] * len(loan)
    matched: dict[int, date] = {}
    i = 0
    while i < len(moves):
        d, old, new = moves[i]
        sign = 1 if new > old else -1
        hit = None
        for j, (m, ch) in enumerate(loan):
            if used[j] or m < _month_start(d) or (ch > 0) != (sign > 0):
                continue
            hit = j
            break
        if hit is None:
            i += 1
            continue
        # Absorb consecutive same-way moves decided on or before the change
        # month while their sum still fits the loan change.
        m, ch = loan[hit]
        total = new - old
        k = i
        while (
            k + 1 < len(moves)
            and _month_start(moves[k + 1][0]) <= m
            and ((moves[k + 1][2] - moves[k + 1][1]) > 0) == (sign > 0)
            and abs(total + moves[k + 1][2] - moves[k + 1][1]) <= abs(ch) + TOL
        ):
            k += 1
            total += moves[k][2] - moves[k][1]
        used[hit] = True
        for x in range(i, k + 1):
            matched[x] = m
        i = k + 1

    out: list[MoveReached] = []
    rise_lags: list[int] = []
    cut_lags: list[int] = []
    late_interest = D("0")
    late_cuts = 0
    for x, (d, old, new) in enumerate(moves):
        reached = matched.get(x)
        lag = _months_between(_month_start(d), reached) if reached else None
        if reached is not None:
            late = max(0, lag - RESET_WINDOW_MONTHS)
        else:
            # Not reached: late only once the window has run out, counted to now.
            late = max(0, _months_between(_month_start(d), _month_start(as_of)) - RESET_WINDOW_MONTHS)
        mr = MoveReached(decided=d, repo_from=old, repo_to=new, reached=reached, lag_months=lag, late_months=late)
        out.append(mr)
        if lag is not None:
            (cut_lags if mr.is_cut else rise_lags).append(lag)
        if mr.is_cut and reached is not None and late > 0:
            late_cuts += 1
            late_interest += outstanding * (old - new) / D("12") * late
    avg = lambda xs: (D(sum(xs)) / len(xs)).quantize(D("0.1")) if xs else None  # noqa: E731
    ar, ac = avg(rise_lags), avg(cut_lags)
    asymmetric = late_cuts > 0 or (ar is not None and ac is not None and ac - ar >= 1)
    notes = []
    if any(m.reached is None and m.late_months > 0 for m in out):
        notes.append(
            "Some repo moves never show in the rate history entered. If the history is "
            "complete, the rate check above measures what is still owed."
        )
    return PassThrough(
        moves=out, avg_rise_lag=ar, avg_cut_lag=ac, late_cuts=late_cuts,
        late_cut_interest=_money(late_interest) if late_cuts else D("0"),
        asymmetric=asymmetric, notes=notes,
    )
