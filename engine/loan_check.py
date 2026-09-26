"""Loan Check — did a floating-rate home loan pass on RBI rate cuts?

Since 1 Oct 2019 every new floating-rate retail loan from an Indian
scheduled commercial bank is linked to an external benchmark, almost
always the RBI repo rate, and must be reset at least once in three
months. So the loan's rate should move one-for-one with the repo rate
(the bank's spread stays fixed except in narrow cases). Loan Check
compares what the rate should be today with what the borrower pays.

Every figure here may end up in a letter to a bank, and a wrong figure
does the most damage there, so each estimate leans towards the smaller
claim:

- repo at the start: the *lowest* repo rate in force in the start month
  or the two months before it (the rate may have been fixed at sanction,
  before the loan was paid out);
- repo "now": the *highest* repo rate in force in the last three months,
  since the bank may not have reached its next reset yet;
- overcharge so far: counted at today's balance (smaller than the past
  balances), only for whole months, and only since the expected rate last
  changed unless the borrower says when their rate last changed.

Findings:
- missed_rate_cut: the rate is above what the repo rate says it should
  be. The only finding that counts towards a refund claim.
- pricing_gap: the lender charges new borrowers less. Information only;
  a bank has no duty to refund it.
- old_benchmark: the loan is (or may be) on MCLR / base rate, which does
  not follow the repo rate. The fix is a switch, not a refund.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date, timedelta
from decimal import Decimal, ROUND_DOWN, ROUND_HALF_UP
from enum import Enum
from typing import Optional

from engine import policy_rates
from engine.citations import EBLR_MANDATE, EBLR_RESET, EBLR_SPREAD, Citation
from engine.formulas import emi as emi_formula
from engine.models import Country
from engine.rate_cards import ALL_INSTITUTIONS, RateRange

D = Decimal

EBLR_MANDATORY_FROM = date(2019, 10, 1)
# A few banks (SBI first) offered repo-linked home loans from July 2019,
# ahead of the mandate. Earlier than this, a loan cannot be repo-linked
# from its start; the borrower must have switched later.
REPO_LINKED_EARLIEST = date(2019, 7, 1)
RESET_WINDOW_MONTHS = 3
SANCTION_LAG_MONTHS = 2
# Banks quote rates in steps of 0.05%; smaller gaps are rounding.
TOLERANCE = D("0.0005")
# Below this, "new borrowers pay less" is not worth a finding.
PRICING_GAP_MIN = D("0.0025")
# After this many days past policy_rates.LAST_VERIFIED, warn that a newer
# RBI decision may be missing.
STALE_AFTER_DAYS = 60


class Benchmark(str, Enum):
    REPO = "repo"
    MCLR = "mclr"
    BASE_RATE = "base_rate"
    UNKNOWN = "unknown"


@dataclass(frozen=True)
class OverchargeMonth:
    month: date                      # first day of the month
    expected_rate: Decimal
    charged_rate: Decimal
    amount: Decimal                  # whole rupees, rounded down


@dataclass
class LoanCheckInput:
    loan_start: date                 # any day; the month is what counts
    start_rate: Decimal              # annual, fraction (0.0855 = 8.55%)
    current_rate: Decimal
    outstanding: Decimal
    tenure_months_remaining: int
    as_of: date
    lender: Optional[str] = None
    emi: Optional[Decimal] = None
    benchmark: Benchmark = Benchmark.UNKNOWN
    # Month the rate last changed to `current_rate`. Lets the overcharge
    # estimate reach back further than the last expected-rate change.
    last_reset: Optional[date] = None
    country: Country = Country.IN


@dataclass
class Finding:
    kind: str                        # missed_rate_cut | pricing_gap | old_benchmark
    headline: str
    detail: str
    claimable: bool                  # counts towards the refund claim
    rate_gap: Decimal                # annual, fraction, >= 0
    amount_this_year: Decimal        # next 12 months, >= 0
    overcharged_so_far: Decimal      # >= 0; only missed_rate_cut sets it
    months_overcharged: int
    citations: list[Citation]
    next_step: str
    # missed_rate_cut only: the months behind overcharged_so_far, which is
    # their exact sum, so a letter's annexure adds up to the rupee.
    overcharge_months: list[OverchargeMonth] = field(default_factory=list)


@dataclass
class LoanCheckResult:
    status: str                      # issues_found | no_issue | not_applicable
    summary: str
    findings: list[Finding]
    expected_rate: Optional[Decimal]
    repo_at_start: Optional[Decimal]
    repo_reference_now: Optional[Decimal]
    repo_today: Decimal
    repo_changes_since_start: list[tuple[date, Decimal, Decimal]]
    claim_amount: Decimal            # sum of claimable overcharged_so_far
    amount_at_stake_this_year: Decimal  # sum of claimable amount_this_year
    assumptions: list[str] = field(default_factory=list)
    rates_as_of: date = policy_rates.LAST_VERIFIED
    stale_rates_warning: Optional[str] = None


class LoanCheckInputError(ValueError):
    """Input that cannot be checked. The message is shown to the user."""


# ─────────────────────────────────────────────────────────────────────────────
# helpers
# ─────────────────────────────────────────────────────────────────────────────

def _month_start(d: date) -> date:
    return d.replace(day=1)


def _add_months(d: date, n: int) -> date:
    y, m = divmod(d.month - 1 + n, 12)
    return date(d.year + y, m + 1, 1)


def _month_end(d: date) -> date:
    return _add_months(d, 1) - timedelta(days=1)


def _months_between(start: date, end: date) -> int:
    """Whole months from start's month to end's month (end exclusive)."""
    return (end.year - start.year) * 12 + (end.month - start.month)


def _pct(rate: Decimal) -> str:
    """0.0855 → '8.55%'."""
    return f"{(rate * 100).quantize(D('0.01'), rounding=ROUND_HALF_UP)}%"


def _inr(amount: Decimal) -> str:
    """Indian digit grouping: 1234567 → '₹12,34,567'."""
    n = int(amount.quantize(D("1"), rounding=ROUND_HALF_UP))
    sign = "-" if n < 0 else ""
    s = str(abs(n))
    if len(s) > 3:
        head, tail = s[:-3], s[-3:]
        groups = []
        while len(head) > 2:
            groups.insert(0, head[-2:])
            head = head[:-2]
        if head:
            groups.insert(0, head)
        s = ",".join(groups) + "," + tail
    return f"{sign}₹{s}"


def _round_money(x: Decimal) -> Decimal:
    return x.quantize(D("1"), rounding=ROUND_HALF_UP)


def _repo_at_start(loan_start: date) -> Decimal:
    window_start = _add_months(_month_start(loan_start), -SANCTION_LAG_MONTHS)
    rates = policy_rates.rates_between(Country.IN, window_start, _month_end(loan_start))
    return min(rates)


def _repo_reference(t: date) -> Decimal:
    """Highest repo rate in force during the reset window ending at `t`."""
    window_start = _add_months(_month_start(t), -RESET_WINDOW_MONTHS)
    return max(policy_rates.rates_between(Country.IN, window_start, t))


def _extra_interest(
    balance: Decimal, payment: Decimal, actual_rate: Decimal,
    fair_rate: Decimal, months: int,
) -> Decimal:
    """Interest paid at `actual_rate` minus interest at `fair_rate` over the
    next `months`, with the same monthly payment (Indian banks usually keep
    the EMI and move the tenure on a reset). Floored at zero."""
    if months <= 0 or actual_rate <= fair_rate:
        return D("0")
    b_actual, b_fair = balance, balance
    extra = D("0")
    for _ in range(months):
        if b_actual <= 0 and b_fair <= 0:
            break
        i_actual = max(b_actual, D("0")) * actual_rate / D("12")
        i_fair = max(b_fair, D("0")) * fair_rate / D("12")
        extra += i_actual - i_fair
        b_actual = b_actual + i_actual - payment
        b_fair = b_fair + i_fair - payment
    return max(D("0"), extra)


def find_lender(name: Optional[str]):
    """Rate card for `name`, matched case- and space-insensitively."""
    if not name:
        return None
    key = " ".join(name.split()).lower()
    for card_name, card in ALL_INSTITUTIONS.items():
        if card_name.lower() == key and card.country == Country.IN:
            return card
    return None


def validate(inp: LoanCheckInput) -> None:
    if inp.country != Country.IN:
        raise LoanCheckInputError(
            "Loan Check covers Indian floating-rate home loans for now. "
            "US adjustable-rate mortgages are planned."
        )
    for label, rate in (("Starting rate", inp.start_rate), ("Current rate", inp.current_rate)):
        if rate > 1:
            raise LoanCheckInputError(
                f"{label} {rate} looks like a percentage. Send it as a fraction "
                f"(8.55% is 0.0855)."
            )
        if not (D("0.01") <= rate <= D("0.30")):
            raise LoanCheckInputError(
                f"{label} {_pct(rate)} is outside 1% to 30%, which no Indian "
                f"home loan has had. Check the number."
            )
    if not (D("0") < inp.outstanding <= D("10000000000")):
        raise LoanCheckInputError("Outstanding balance must be above ₹0 and at most ₹1,000 crore.")
    if not (1 <= inp.tenure_months_remaining <= 480):
        raise LoanCheckInputError("Months left must be between 1 and 480.")
    if inp.emi is not None and not (D("0") < inp.emi <= inp.outstanding):
        raise LoanCheckInputError("EMI must be above ₹0 and not more than the outstanding balance.")
    if _month_start(inp.loan_start) > _month_start(inp.as_of):
        raise LoanCheckInputError("The loan start month is in the future.")
    if inp.last_reset is not None:
        if _month_start(inp.last_reset) > _month_start(inp.as_of):
            raise LoanCheckInputError("The month the rate last changed is in the future.")
        if _month_start(inp.last_reset) < _month_start(inp.loan_start):
            raise LoanCheckInputError("The month the rate last changed is before the loan started.")
    if inp.benchmark == Benchmark.REPO and _month_start(inp.loan_start) < REPO_LINKED_EARLIEST:
        raise LoanCheckInputError(
            "Repo-linked home loans started in July 2019. For an older loan "
            "that was switched to the repo-linked rate, enter the month of "
            "the switch and the rate right after it."
        )


# ─────────────────────────────────────────────────────────────────────────────
# findings
# ─────────────────────────────────────────────────────────────────────────────

def _old_benchmark_finding(inp: LoanCheckInput, card) -> Finding:
    lender = card.name if card else "your lender"
    detail = (
        "Loans taken before October 2019, or still marked MCLR or base rate, "
        "do not follow the RBI repo rate. They reset on the bank's own "
        "schedule, often once a year, and have typically been slower to "
        "pass on cuts."
    )
    gap = D("0")
    amount = D("0")
    if card and card.home_loan:
        ref = card.home_loan.high
        detail += (
            f" {lender} quotes new repo-linked home loans at "
            f"{_pct(card.home_loan.low)} to {_pct(card.home_loan.high)} "
            f"(rate card checked {card.last_verified})."
        )
        if inp.current_rate > ref + TOLERANCE:
            gap = inp.current_rate - ref
            payment = inp.emi or emi_formula(inp.outstanding, inp.current_rate, inp.tenure_months_remaining)
            amount = _round_money(_extra_interest(
                inp.outstanding, payment, inp.current_rate, ref,
                min(12, inp.tenure_months_remaining),
            ))
            detail += (
                f" You pay {_pct(inp.current_rate)}, {_pct(gap)} above even the "
                f"top of that range: about {_inr(amount)} over the next 12 months."
            )
    return Finding(
        kind="old_benchmark",
        headline="Your loan may still be on the old MCLR / base-rate system",
        detail=detail,
        claimable=False,
        rate_gap=gap,
        amount_this_year=amount,
        overcharged_so_far=D("0"),
        months_overcharged=0,
        citations=[EBLR_MANDATE],
        next_step=(
            f"Ask {lender} in writing to switch the loan to its repo-linked "
            "rate, and ask what the switch fee is. Compare the fee with the "
            "saving before you agree. If the loan is already repo-linked, "
            "choose 'Repo rate' and run the check again."
        ),
    )


def _pricing_gap_finding(inp: LoanCheckInput, card, base_rate: Decimal) -> Optional[Finding]:
    if card is None or card.home_loan is None:
        return None
    rng: RateRange = card.home_loan
    payment = inp.emi or emi_formula(inp.outstanding, inp.current_rate, inp.tenure_months_remaining)
    months = min(12, inp.tenure_months_remaining)
    as_of = f"rate card checked {card.last_verified}"
    fixed_note = (
        " This is measured after the missed rate cut is fixed, so it does not "
        "double-count it." if base_rate < inp.current_rate else ""
    )
    if base_rate > rng.high + TOLERANCE:
        gap = base_rate - rng.high
        amount = _round_money(_extra_interest(inp.outstanding, payment, base_rate, rng.high, months))
        return Finding(
            kind="pricing_gap",
            headline=f"{card.name} charges new borrowers less than you",
            detail=(
                f"New home-loan borrowers at {card.name} are quoted "
                f"{_pct(rng.low)} to {_pct(rng.high)} ({as_of}). At "
                f"{_pct(base_rate)} you pay {_pct(gap)} more than even the top "
                f"of that range: about {_inr(amount)} over the next 12 months."
                f"{fixed_note} Banks are allowed to charge existing borrowers "
                f"more, so this is not a refund claim; it is a reason to ask "
                f"for a lower spread or to move the loan."
            ),
            claimable=False,
            rate_gap=gap,
            amount_this_year=amount,
            overcharged_so_far=D("0"),
            months_overcharged=0,
            citations=[],
            next_step=(
                f"Ask {card.name} to reduce your spread to the rate new "
                f"borrowers get. Banks often agree for a one-time fee; the "
                f"offer comparison tells you whether the fee is worth paying."
            ),
        )
    if base_rate - rng.low >= PRICING_GAP_MIN:
        gap = base_rate - rng.low
        amount = _round_money(_extra_interest(inp.outstanding, payment, base_rate, rng.low, months))
        return Finding(
            kind="pricing_gap",
            headline=f"Borrowers with strong credit get up to {_pct(gap)} less at {card.name}",
            detail=(
                f"New home-loan borrowers at {card.name} are quoted "
                f"{_pct(rng.low)} to {_pct(rng.high)} ({as_of}); the lowest "
                f"rates go to the strongest credit scores. If you qualify for "
                f"the lowest, you would pay up to {_inr(amount)} less over the "
                f"next 12 months.{fixed_note} This is not a refund claim."
            ),
            claimable=False,
            rate_gap=gap,
            amount_this_year=amount,
            overcharged_so_far=D("0"),
            months_overcharged=0,
            citations=[],
            next_step=(
                f"If your credit score is strong, ask {card.name} what spread "
                f"it offers new borrowers with your profile, and whether it "
                f"will reset yours."
            ),
        )
    return None


def check_loan(inp: LoanCheckInput) -> LoanCheckResult:
    validate(inp)
    card = find_lender(inp.lender)
    start = _month_start(inp.loan_start)
    repo_today = policy_rates.rate_on(Country.IN, inp.as_of)
    assumptions: list[str] = []

    stale = None
    if (inp.as_of - policy_rates.LAST_VERIFIED).days > STALE_AFTER_DAYS:
        stale = (
            f"RBI rates were last checked on {policy_rates.LAST_VERIFIED:%d %b %Y}. "
            f"A later RBI decision may not be included."
        )

    benchmark = inp.benchmark
    if benchmark == Benchmark.UNKNOWN:
        if start < EBLR_MANDATORY_FROM:
            benchmark = Benchmark.MCLR
            assumptions.append(
                "The loan started before October 2019 and the benchmark was "
                "not given, so it is treated as MCLR / base-rate linked."
            )
        else:
            benchmark = Benchmark.REPO
            assumptions.append(
                "The benchmark was not given. Loans from October 2019 on must "
                "be linked to an external benchmark, almost always the RBI "
                "repo rate, so repo is assumed."
            )

    if benchmark in (Benchmark.MCLR, Benchmark.BASE_RATE):
        finding = _old_benchmark_finding(inp, card)
        return LoanCheckResult(
            status="not_applicable",
            summary=(
                "The repo-rate check does not apply to MCLR or base-rate "
                "loans. Switching to the repo-linked rate may lower your rate."
            ),
            findings=[finding],
            expected_rate=None,
            repo_at_start=None,
            repo_reference_now=None,
            repo_today=repo_today,
            repo_changes_since_start=policy_rates.changes_between(Country.IN, start, inp.as_of),
            claim_amount=D("0"),
            amount_at_stake_this_year=D("0"),
            assumptions=assumptions,
            stale_rates_warning=stale,
        )

    repo_start = _repo_at_start(start)
    repo_ref = _repo_reference(inp.as_of)
    # A home loan priced below the repo rate has never existed; this is
    # almost always a typo, and checking it would produce a bogus claim.
    if inp.start_rate < repo_start:
        raise LoanCheckInputError(
            f"The starting rate {_pct(inp.start_rate)} is below the RBI repo "
            f"rate at the time ({_pct(repo_start)}). Check the number and the start month."
        )
    if inp.current_rate < repo_today:
        raise LoanCheckInputError(
            f"The current rate {_pct(inp.current_rate)} is below today's RBI "
            f"repo rate ({_pct(repo_today)}). Check the number."
        )
    expected = inp.start_rate + (repo_ref - repo_start)
    changes = policy_rates.changes_between(Country.IN, start, inp.as_of)
    assumptions.append(
        f"Repo rate at the start taken as {_pct(repo_start)}: the lowest in "
        f"force from {_add_months(start, -SANCTION_LAG_MONTHS):%b %Y} to "
        f"{start:%b %Y}, in case the rate was fixed at sanction."
    )
    assumptions.append(
        f"Repo rate for today's reset taken as {_pct(repo_ref)}: the highest in "
        f"force in the last {RESET_WINDOW_MONTHS} months, because a bank may "
        f"take up to {RESET_WINDOW_MONTHS} months to reset."
    )
    assumptions.append(
        "Your spread is assumed unchanged since the start. A bank may raise "
        "it only if your credit assessment changed substantially, or the "
        "operating-cost part once in three years; if your bank told you in "
        "writing that it did, the gap may be smaller."
    )

    findings: list[Finding] = []
    payment = inp.emi or emi_formula(inp.outstanding, inp.current_rate, inp.tenure_months_remaining)
    gap = inp.current_rate - expected

    if gap > TOLERANCE:
        # Overcharge so far: whole months only, at today's balance.
        as_of_month = _month_start(inp.as_of)
        if inp.last_reset is not None:
            window_start = max(_month_start(inp.last_reset), start)
        else:
            window_start = start
            m = start
            prev = None
            while m <= as_of_month:
                e = inp.start_rate + (_repo_reference(_month_end(m)) - repo_start)
                if prev is not None and e != prev:
                    window_start = m
                prev = e
                m = _add_months(m, 1)
            assumptions.append(
                f"Overcharge counted from {window_start:%b %Y}, when the "
                f"expected rate last changed. Tell us the month your rate "
                f"last changed to count further back."
            )
        # Each month is rounded down to the rupee, so the claim is never
        # more than the working behind it.
        monthly: list[OverchargeMonth] = []
        m = window_start
        while m < as_of_month:
            e_m = inp.start_rate + (_repo_reference(_month_end(m)) - repo_start)
            g_m = inp.current_rate - e_m
            if g_m > TOLERANCE:
                monthly.append(OverchargeMonth(
                    month=m, expected_rate=e_m, charged_rate=inp.current_rate,
                    amount=(inp.outstanding * g_m / D("12")).quantize(D("1"), rounding=ROUND_DOWN),
                ))
            m = _add_months(m, 1)
        overcharged = sum((x.amount for x in monthly), D("0"))
        months = len(monthly)
        this_year = _round_money(_extra_interest(
            inp.outstanding, payment, inp.current_rate, expected,
            min(12, inp.tenure_months_remaining),
        ))
        repo_fell = repo_ref < repo_start
        named = card.name if card else (inp.lender.strip() if inp.lender else None)
        lender = named or "your lender"
        if repo_fell:
            headline = (
                f"{named or 'Your lender'} has not passed on {_pct(gap)} of RBI rate cuts"
            )
        else:
            headline = (
                f"Your rate has risen {_pct(gap)} more than the RBI repo rate"
            )
        detail = (
            f"The loan started at {_pct(inp.start_rate)} when the repo rate "
            f"was {_pct(repo_start)}. The repo rate is now {_pct(repo_ref)} "
            f"(allowing for the three-month reset window), so the rate should "
            f"be about {_pct(expected)}. You pay {_pct(inp.current_rate)}. "
            f"That costs about {_inr(this_year)} over the next 12 months"
        )
        if overcharged > 0:
            detail += (
                f", and about {_inr(overcharged)} has been overcharged over "
                f"the last {months} month{'s' if months != 1 else ''}."
            )
        else:
            detail += "."
        findings.append(Finding(
            kind="missed_rate_cut",
            headline=headline,
            detail=detail,
            claimable=True,
            rate_gap=gap,
            amount_this_year=this_year,
            overcharged_so_far=overcharged,
            months_overcharged=months,
            overcharge_months=monthly,
            citations=[EBLR_RESET, EBLR_SPREAD],
            next_step=(
                f"Send {lender} a written complaint through its grievance "
                f"channel asking it to reset the rate to {_pct(expected)} and "
                f"refund the excess interest. If it refuses, or does not reply "
                f"within 30 days, you can go to the RBI Ombudsman for free."
            ),
        ))

    base_rate = min(inp.current_rate, expected)
    pg = _pricing_gap_finding(inp, card, base_rate)
    if pg:
        findings.append(pg)
    elif inp.lender and card is None:
        assumptions.append(
            f"No rate card for '{inp.lender}', so new-borrower rates were not compared."
        )

    claimable = [f for f in findings if f.claimable]
    claim_amount = sum((f.overcharged_so_far for f in claimable), D("0"))
    at_stake = sum((f.amount_this_year for f in claimable), D("0"))

    if claimable:
        status = "issues_found"
        summary = (
            f"Your rate should be about {_pct(expected)}, not "
            f"{_pct(inp.current_rate)}. {_inr(at_stake)} is at stake over the "
            f"next 12 months."
        )
    elif findings:
        status = "issues_found"
        summary = (
            "Your lender has passed on RBI rate changes, but you pay more than "
            "its new borrowers."
        )
    else:
        status = "no_issue"
        summary = (
            f"Your rate of {_pct(inp.current_rate)} matches the RBI repo rate "
            f"moves since the loan started. Nothing to claim."
        )

    return LoanCheckResult(
        status=status,
        summary=summary,
        findings=findings,
        expected_rate=expected,
        repo_at_start=repo_start,
        repo_reference_now=repo_ref,
        repo_today=repo_today,
        repo_changes_since_start=changes,
        claim_amount=claim_amount,
        amount_at_stake_this_year=at_stake,
        assumptions=assumptions,
        stale_rates_warning=stale,
    )
