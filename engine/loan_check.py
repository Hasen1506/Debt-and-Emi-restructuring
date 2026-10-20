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
- below_expected: the rate is *below* what the repo moves imply. Good news
  for the borrower, never a claim (live test L#7: a negative gap once read
  as "worth a conversation").
- rate_rise (audit 80+ A11a): the repo rate rose recently. The new EMI
  (same end date) or the new tenure (same EMI), what each costs, and the
  choice the lender must offer. Information, never a claim.
- choice_not_offered (A11 letter): the borrower says the lender raised the
  EMI or the tenure after a rise without offering the choice. A rights
  issue with a letter (engine/complaints_in.reset_choice_letter), not a
  money claim.
- asymmetric_pass_through (A11c): from the borrower's own rate history,
  rises reached the loan faster than cuts, or a cut took longer than the
  three-month reset window. The late-cut interest is an estimate worth
  asking about, not a claim (the bank may hold reset dates in the contract).
- rule_not_binding: the lender is a housing finance company, NBFC,
  regional rural bank or co-operative bank. The external-benchmark rule
  binds commercial and small finance banks only (engine/lenders.py), so
  the repo comparison is information, and the finding says which rules do
  apply and where a complaint goes.

The verdict comes from the rate gap and the stated lender type only, never
from whether a rate card exists for the lender name (live test L#8). The
new-borrower comparison is a separate, labelled note.

The spread question is always asked (L#9): the borrower says whether the
bank changed the spread, and by how much when it did.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date, timedelta
from decimal import Decimal, ROUND_DOWN, ROUND_HALF_UP
from enum import Enum
from typing import Optional

from engine import lenders, policy_rates
from engine.citations import (
    EBLR_MANDATE, EBLR_RESET, EBLR_SCOPE, EBLR_SPREAD, EBLR_SWITCH, HFC_PREPAY_FREE,
    HFC_RATE_POLICY, NHB_COMPLAINT, PROSPECTIVE_HFC, RBIOS_SCOPE, RESET_CHOICES_BANK,
    RESET_CHOICES_NBFC, RESET_RISE_OPTIONS_BANK, RESET_RISE_OPTIONS_NBFC, Citation,
)
from engine.rate_reset import (
    PassThrough, RateMoveImpact, SwitchSaving, pass_through, rate_move_impact, switch_saving,
)
from engine.formulas import emi as emi_formula
from engine.lenders import EBLR_BOUND, TYPE_LABEL, LenderType
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
# After this many days past policy_rates.rates_as_of, warn that a newer
# RBI decision may be missing.
STALE_AFTER_DAYS = 60


class Benchmark(str, Enum):
    REPO = "repo"
    MCLR = "mclr"
    BASE_RATE = "base_rate"
    UNKNOWN = "unknown"


class BankAction(str, Enum):
    """What the lender did to the loan after the last repo rise."""
    UNKNOWN = "unknown"
    NONE_YET = "none_yet"
    EMI_RAISED = "emi_raised"
    TENURE_EXTENDED = "tenure_extended"
    BOTH = "both"


class ChoiceOffered(str, Enum):
    """Did the lender offer EMI / tenure / prepay before changing the loan?"""
    UNSURE = "unsure"
    YES = "yes"
    NO = "no"


# A rise is "the current one" for this long after the decision: the
# three-month reset window plus a quarter for the statement to show it.
RATE_RISE_RECENT_DAYS = 183


class SpreadChange(str, Enum):
    """Has the bank told the borrower in writing that the spread changed?"""
    NO = "no"
    YES = "yes"
    UNSURE = "unsure"


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
    # What kind of lender (the screen always asks; a known name fills it in).
    lender_type: LenderType = LenderType.UNKNOWN
    # Did the spread change? With YES, `spread_change` is the change in
    # annual fraction (+0.0025 = raised by 0.25 points).
    spread_changed: SpreadChange = SpreadChange.UNSURE
    spread_change: Optional[Decimal] = None
    # Next scheduled policy meeting, for the reset watch (the API reads the
    # central-bank calendar; the engine does not read files).
    next_policy_meeting: Optional[date] = None
    # Hike cycle (A11). What the lender did after the last rise, and
    # whether it offered the choice the rules require.
    bank_action: BankAction = BankAction.UNKNOWN
    choice_offered: ChoiceOffered = ChoiceOffered.UNSURE
    # The borrower's own rate history from statements or rate-change
    # letters: (month the rate took effect, rate). Feeds the asymmetry check.
    rate_history: list[tuple[date, Decimal]] = field(default_factory=list)
    # MCLR / base rate: the repo-linked rate the bank quotes for the switch,
    # and its one-time cost, when the borrower has them.
    switch_rate: Optional[Decimal] = None
    switch_cost: Optional[Decimal] = None


@dataclass(frozen=True)
class RateRise:
    """The last repo rise and what it does to this loan (A11a)."""
    decided: date
    repo_from: Decimal
    repo_to: Decimal
    # applied: the rate already carries it; pending: not yet, it should by
    # `reach_by`; if_passed_on: the loan does not follow the repo rate
    # (MCLR, NBFC, HFC...), so this is what a rise of the same size does.
    status: str
    reach_by: Optional[date]
    impact: RateMoveImpact
    citations: list[Citation] = field(default_factory=list)


@dataclass(frozen=True)
class ResetWatch:
    """When to look at the rate again (critique #5)."""
    headline: str
    detail: str
    check_by: Optional[date]          # the date by which the rate should reflect the last move
    last_change: Optional[date]       # the last repo decision
    last_change_from: Optional[Decimal]
    last_change_to: Optional[Decimal]
    next_meeting: Optional[date]
    citations: list[Citation] = field(default_factory=list)


@dataclass
class Finding:
    kind: str                        # missed_rate_cut | pricing_gap | old_benchmark | below_expected | rule_not_binding
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
    # missed_rate_cut | matches | below_expected | old_benchmark | rule_not_binding
    verdict: str = "matches"
    # current − expected, signed (negative: the borrower pays less than the
    # repo moves imply). None when there is no expected rate.
    gap: Optional[Decimal] = None
    lender_name: Optional[str] = None
    lender_type: LenderType = LenderType.COMMERCIAL_BANK
    lender_type_source: str = "assumed"     # stated | from_name | assumed
    rule_applies: bool = True               # the external-benchmark rule binds this lender
    # Says plainly whether new-borrower rates were compared, and why not.
    new_borrower_note: str = ""
    reset_watch: Optional[ResetWatch] = None
    rate_rise: Optional[RateRise] = None
    switch: Optional[SwitchSaving] = None
    pass_through: Optional[PassThrough] = None


class LoanCheckInputError(ValueError):
    """Input that cannot be checked. The message is shown to the user.

    `field` names the input at fault, as the API calls it, so the screen
    can show the message under it ("input" when no one field is).
    """

    def __init__(self, message: str, field: str = "input"):
        super().__init__(message)
        self.field = field


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


def _delta_words(amount: Decimal, more: str, less: str, same: str) -> str:
    """A signed rupee gap in words: '₹779 more a month', never '-₹779'."""
    n = int(amount.quantize(D("1"), rounding=ROUND_HALF_UP))
    if n > 0:
        return f"{_inr(D(n))} {more}"
    if n < 0:
        return f"{_inr(D(-n))} {less}"
    return same


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
    """Rate card for `name`, matched case- and space-insensitively.

    Only a card read off the lender's own page counts (audit 80+ A21): an
    extrapolated Tier-B/C card is "typical, unverified" and is never quoted
    to a borrower as what their lender charges new borrowers."""
    if not name:
        return None
    key = " ".join(name.split()).lower()
    for card_name, card in ALL_INSTITUTIONS.items():
        if card_name.lower() == key and card.country == Country.IN and not card.is_indicative:
            return card
    return None


def validate(inp: LoanCheckInput) -> None:
    if inp.country != Country.IN:
        raise LoanCheckInputError(
            "Loan Check covers Indian floating-rate home loans for now. "
            "US adjustable-rate mortgages are planned."
        )
    for name, label, rate in (("start_rate", "Starting rate", inp.start_rate),
                              ("current_rate", "Current rate", inp.current_rate)):
        if rate > 1:
            raise LoanCheckInputError(
                f"{label} {rate} looks like a percentage. Send it as a fraction "
                f"(8.55% is 0.0855).", name,
            )
        if not (D("0.01") <= rate <= D("0.30")):
            raise LoanCheckInputError(
                f"{label} {_pct(rate)} is outside 1% to 30%, which no Indian "
                f"home loan has had. Check the number.", name,
            )
    if not (D("0") < inp.outstanding <= D("10000000000")):
        raise LoanCheckInputError("Outstanding balance must be above ₹0 and at most ₹1,000 crore.", "outstanding")
    if not (1 <= inp.tenure_months_remaining <= 480):
        raise LoanCheckInputError("Months left must be between 1 and 480.", "tenure_months_remaining")
    if inp.emi is not None and not (D("0") < inp.emi <= inp.outstanding):
        raise LoanCheckInputError("EMI must be above ₹0 and not more than the outstanding balance.", "emi")
    if _month_start(inp.loan_start) > _month_start(inp.as_of):
        raise LoanCheckInputError("The loan start month is in the future.", "loan_start")
    if inp.last_reset is not None:
        if _month_start(inp.last_reset) > _month_start(inp.as_of):
            raise LoanCheckInputError("The month the rate last changed is in the future.", "last_reset")
        if _month_start(inp.last_reset) < _month_start(inp.loan_start):
            raise LoanCheckInputError("The month the rate last changed is before the loan started.", "last_reset")
    if inp.spread_changed == SpreadChange.YES:
        if inp.spread_change is None:
            raise LoanCheckInputError(
                "Still needed: how much your spread changed, in percentage points "
                "(+0.25 if it was raised, -0.10 if it was cut). Your bank's "
                "rate-change letter or statement shows it.", "spread_change",
            )
        if abs(inp.spread_change) > D("0.05"):
            raise LoanCheckInputError(
                f"A spread change of {_pct(inp.spread_change)} is outside ±5 points. "
                f"Send it as a fraction (0.25 points is 0.0025).", "spread_change",
            )
    elif inp.spread_change is not None and inp.spread_change != 0:
        raise LoanCheckInputError(
            "A spread change was given, but the answer to 'did your spread change?' "
            "is not 'yes'. Choose 'yes' or clear the amount.", "spread_change",
        )
    if len(inp.rate_history) > 60:
        raise LoanCheckInputError("At most 60 rate changes can be checked.", "rate_history")
    for m, r in inp.rate_history:
        if _month_start(m) > _month_start(inp.as_of):
            raise LoanCheckInputError(f"A rate change in {m:%b %Y} is in the future.", "rate_history")
        if _month_start(m) < _month_start(inp.loan_start):
            raise LoanCheckInputError(
                f"A rate change in {m:%b %Y} is before the loan started.", "rate_history")
        if not (D("0.01") <= r <= D("0.30")):
            raise LoanCheckInputError(
                f"A rate of {_pct(r)} in the rate history is outside 1% to 30%. "
                f"Send rates as fractions (8.55% is 0.0855).", "rate_history")
    if inp.switch_rate is not None and not (D("0.01") <= inp.switch_rate <= D("0.30")):
        raise LoanCheckInputError("The repo-linked rate offered must be between 1% and 30%.", "switch_rate")
    if inp.switch_cost is not None and not (D("0") <= inp.switch_cost <= inp.outstanding):
        raise LoanCheckInputError("The switch cost must be ₹0 or more and not above the balance.", "switch_cost")
    if inp.benchmark == Benchmark.REPO and _month_start(inp.loan_start) < REPO_LINKED_EARLIEST:
        raise LoanCheckInputError(
            "Repo-linked home loans started in July 2019. For an older loan "
            "that was switched to the repo-linked rate, enter the month of "
            "the switch and the rate right after it.", "loan_start",
        )


# ─────────────────────────────────────────────────────────────────────────────
# findings
# ─────────────────────────────────────────────────────────────────────────────

def _old_benchmark_finding(inp: LoanCheckInput, card, sw: Optional[SwitchSaving] = None) -> Finding:
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
            f"(rate card checked {date.fromisoformat(card.last_verified):%d %b %Y})."
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
                f"top of that range. As an estimate for your own conversation "
                f"with the bank, that is about {_inr(amount)} over the next 12 "
                f"months (not money the bank owes you)."
            )
    if sw is not None and sw.interest_saved_rest > 0:
        # A11b: what the switch saves, at the rate the borrower was quoted (or
        # the top of the bank's published range), keeping the EMI.
        quoted = "the rate you entered" if inp.switch_rate is not None else "the top of that range"
        gap = inp.current_rate - sw.switch_rate
        amount = sw.interest_saved_12m
        cost = (
            f", less the {_inr(sw.switch_cost)} switch cost you entered: {_inr(sw.net_saving_rest)} net"
            f"{f', earned back in about {sw.payback_months} months' if sw.payback_months else ''}"
            if sw.switch_cost > 0 else
            " (ask the bank for its administrative or legal charge and take it off)"
        )
        detail += (
            f" Switching from {_pct(inp.current_rate)} to {_pct(sw.switch_rate)} ({quoted}) "
            f"and keeping your EMI saves about {_inr(sw.interest_saved_12m)} in the next 12 "
            f"months and {_inr(sw.interest_saved_rest)} over the rest of the loan, which "
            f"ends about {sw.months_saved} months sooner{cost}. One thing to weigh while "
            f"rates are rising: a repo-linked rate picks up each RBI rise within three "
            f"months, while an MCLR rate moves only on its reset date, so the switch "
            f"saves the difference in level but future rises reach you sooner."
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
        citations=[EBLR_MANDATE, EBLR_SWITCH],
        next_step=(
            f"Ask {lender} in writing to switch the loan to its repo-linked "
            "rate. For a home loan taken by an individual (not for a "
            "business), RBI allows no charge for the switch except reasonable "
            "administrative or legal costs; ask what those are and what the "
            "new rate will be before you agree. If the loan is already "
            "repo-linked, choose 'Repo rate' and run the check again."
        ),
    )


def _pricing_gap_finding(inp: LoanCheckInput, card, base_rate: Decimal) -> Optional[Finding]:
    if card is None or card.home_loan is None:
        return None
    rng: RateRange = card.home_loan
    payment = inp.emi or emi_formula(inp.outstanding, inp.current_rate, inp.tenure_months_remaining)
    months = min(12, inp.tenure_months_remaining)
    as_of = f"rate card checked {date.fromisoformat(card.last_verified):%d %b %Y}"
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
                f"of that range. As an estimate for your own conversation with the "
                f"bank, that is about {_inr(amount)} over the next 12 months "
                f"(not money the bank owes you).{fixed_note} Banks are allowed "
                f"to charge existing borrowers more, so this is not a refund "
                f"claim; it is a reason to ask for a lower spread or to move "
                f"the loan."
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
                f"next 12 months: an estimate for your own conversation with the "
                f"bank, not money it owes you.{fixed_note} This is not a refund claim."
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


# ─────────────────────────────────────────────────────────────────────────────
# the hike cycle (audit 80+ A11)
# ─────────────────────────────────────────────────────────────────────────────

_NBFC_LIKE = (LenderType.NBFC, LenderType.HFC)


def _rise_citations(kind_of: LenderType) -> list[Citation]:
    if kind_of in EBLR_BOUND:
        return [RESET_CHOICES_BANK, RESET_RISE_OPTIONS_BANK]
    if kind_of in _NBFC_LIKE:
        return [RESET_CHOICES_NBFC, RESET_RISE_OPTIONS_NBFC]
    return []


def rate_rise(
    inp: LoanCheckInput, kind_of: LenderType, benchmark: Benchmark,
    expected: Optional[Decimal],
) -> Optional[RateRise]:
    """The last repo move, when it was a rise in the last six months and
    after the loan started, and what it does to this loan."""
    hist = [(d, r) for d, r in policy_rates.history(Country.IN) if d <= inp.as_of]
    if len(hist) < 2:
        return None
    (last_day, last_rate), prev_rate = hist[-1], hist[-2][1]
    if last_rate <= prev_rate or (inp.as_of - last_day).days > RATE_RISE_RECENT_DAYS:
        return None
    if _month_start(inp.loan_start) > _month_start(last_day):
        return None   # priced after the rise
    delta = last_rate - prev_rate
    reach_by = last_day + timedelta(days=91)
    if kind_of in EBLR_BOUND and benchmark == Benchmark.REPO and expected is not None:
        g = inp.current_rate - expected
        if abs(g) <= TOLERANCE:
            status = "applied"
        elif abs(g + delta) <= TOLERANCE:
            status = "pending"
        else:
            status = "pending" if inp.as_of <= reach_by else "applied"
    else:
        status, reach_by = "if_passed_on", None
    if status == "applied":
        before, after, emi = inp.current_rate - delta, inp.current_rate, None
        if inp.bank_action == BankAction.TENURE_EXTENDED:
            # The months entered are after the extension and the EMI is the
            # old one: run that EMI at the old rate to find the old end date.
            emi = inp.emi or emi_formula(inp.outstanding, after, inp.tenure_months_remaining)
    else:
        before, after, emi = inp.current_rate, inp.current_rate + delta, inp.emi
    if before <= 0:
        return None
    impact = rate_move_impact(inp.outstanding, before, after, inp.tenure_months_remaining, emi)
    return RateRise(
        decided=last_day, repo_from=prev_rate, repo_to=last_rate, status=status,
        reach_by=reach_by if status == "pending" else None, impact=impact,
        citations=_rise_citations(kind_of),
    )


def _emi_option_sentence(im: RateMoveImpact) -> str:
    """Keep-the-end-date sentence. A rate rise raises a level EMI. When the
    EMI entered is already above the level payment for the months it takes
    (the last instalment is smaller), the new level EMI can be lower than
    what is paid today and total interest higher. That gap is real; it is
    not the rise itself cutting the EMI, and it is never written as '-₹'."""
    interest = _delta_words(
        im.interest_emi_option - im.interest_before,
        "more interest over the loan", "less interest over the loan",
        "the same interest over the loan",
    )
    if im.emi_change < 0:
        return (
            f"Keep the same end date and a level EMI is {_inr(im.emi_after)}, "
            f"{_inr(-im.emi_change)} less than the {_inr(im.emi_before)} you pay now. "
            f"Today's EMI is already above a level payment for these {im.months_before} months, "
            f"so this rise does not push the EMI up. Paying that level EMI means {interest}."
        )
    change = _delta_words(im.emi_change, "more a month", "less a month", "unchanged a month")
    return (
        f"Keep the same end date and your EMI goes from {_inr(im.emi_before)} to "
        f"{_inr(im.emi_after)} ({change}), with {interest}."
    )


def _tenure_option_sentence(im: RateMoveImpact) -> str:
    n = im.months_change or 0
    if n > 1:
        span = f"the loan runs {n} months longer"
    elif n == 1:
        span = "the loan runs 1 month longer"
    elif n == 0:
        span = "the loan still ends in the same month"
    elif n == -1:
        span = "the loan runs 1 month shorter"
    else:
        span = f"the loan runs {-n} months shorter"
    interest = _delta_words(
        (im.interest_tenure_option or D("0")) - im.interest_before,
        "more interest", "less interest", "the same interest",
    )
    premium = im.tenure_premium or D("0")
    if premium > 0:
        return f" Keep the same EMI and {span}, with {interest}: {_inr(premium)} more than raising the EMI."
    if premium < 0:
        gap = (im.interest_tenure_option or D("0")) - im.interest_before
        if gap > 0:
            lead = f"with {_inr(gap)} more interest than at today's rate"
        elif gap < 0:
            lead = f"with {_inr(-gap)} less interest than at today's rate"
        else:
            lead = "with the same interest as today"
        return (
            f" Keep the same EMI and {span}, {lead}. "
            f"That is {_inr(-premium)} less than dropping to the level EMI."
        )
    return f" Keep the same EMI and {span}, with {interest}: the same interest as the level EMI."


def _choice_alternative(action: BankAction, im: RateMoveImpact) -> str:
    if action == BankAction.EMI_RAISED and im.tenure_option_possible:
        n = im.months_change or 0
        if n > 0:
            return f" Had it asked, the other choice was: keep the EMI and run {n} months longer"
        if n < 0:
            return f" Had it asked, the other choice was: keep the EMI and finish {-n} months sooner"
        return " Had it asked, the other choice was: keep the EMI and the same end date"
    if action == BankAction.TENURE_EXTENDED and im.tenure_premium:
        if im.tenure_premium > 0:
            saving = f"saving {_inr(im.tenure_premium)} of interest"
        else:
            saving = f"which costs {_inr(-im.tenure_premium)} more interest than keeping the EMI"
        return (
            f" Had it asked, the other choice was: keep the end date and pay "
            f"{_inr(im.emi_after)} a month, {saving}"
        )
    return ""


def _rate_rise_finding(rr: RateRise, name: Optional[str], kind_of: LenderType, benchmark: Benchmark) -> Finding:
    im = rr.impact
    delta = rr.repo_to - rr.repo_from
    who = "bank" if kind_of in EBLR_BOUND else "lender"
    must = kind_of in EBLR_BOUND or kind_of in _NBFC_LIKE
    if rr.status == "applied":
        when = (
            f"Your rate already carries it ({_pct(im.rate_before)} before, "
            f"{_pct(im.rate_after)} now)."
        )
    elif rr.status == "pending":
        when = (
            f"It should reach your rate by about {rr.reach_by:%d %b %Y} (a repo-linked rate is "
            f"reset at least once in three months): {_pct(im.rate_before)} to {_pct(im.rate_after)}."
        )
    elif benchmark in (Benchmark.MCLR, Benchmark.BASE_RATE):
        when = (
            f"An MCLR or base-rate loan picks up rises only on its reset date, and by however "
            f"much the bank's MCLR moves. If the full {_pct(delta)} is passed on: "
            f"{_pct(im.rate_before)} to {_pct(im.rate_after)}."
        )
    else:
        when = (
            f"Your {who} does not have to follow the repo rate, but most move with it. If it "
            f"passes on the full {_pct(delta)}: {_pct(im.rate_before)} to {_pct(im.rate_after)}."
        )
    emi_txt = _emi_option_sentence(im)
    if im.tenure_option_possible:
        ten_txt = _tenure_option_sentence(im)
        best = (
            f" If you can afford the extra {_inr(im.emi_change)} a month, raising the EMI is "
            f"the cheaper choice by {_inr(im.tenure_premium)}; if cash is tight, the longer "
            f"tenure keeps your monthly outgo the same. Many banks extend the tenure unless "
            f"you ask, and cap it at an age limit in your loan terms, after which the EMI "
            f"has to rise."
        ) if im.tenure_premium and im.tenure_premium > 0 and im.emi_change > 0 else ""
    else:
        ten_txt = (
            f" Keeping the same EMI is not possible: at {_pct(im.rate_after)} it would not "
            f"cover the month's interest, and the rules say a longer tenure must not make the "
            f"balance grow, so the EMI has to rise."
        )
        best = ""
    pre = (
        f" Or prepay about {_inr(im.prepay_to_keep_both)} to keep both the EMI and the end "
        f"date." if im.prepay_to_keep_both > 0 else ""
    )
    rule = (
        f" Your {who} must tell you of any rise in EMI or tenure immediately and let you "
        f"choose: a higher EMI, a longer tenure, a mix, a fixed rate where it offers one, or "
        f"prepaying." if must else
        f" RBI's reset circular of 18 Aug 2023 (RBI/2023-24/55) also covers regional rural "
        f"and co-operative banks: ask for the choice of a higher EMI, a longer tenure or "
        f"prepaying before your EMI or tenure is changed."
    )
    return Finding(
        kind="rate_rise",
        headline=(
            f"Rate up {_pct(delta)}: your new EMI or tenure, and the choice your {who} "
            f"{'must offer you' if must else 'should offer you'}"
        ),
        detail=(
            f"The RBI raised the repo rate from {_pct(rr.repo_from)} to {_pct(rr.repo_to)} on "
            f"{rr.decided:%d %b %Y}. {when} {emi_txt}{ten_txt}{pre}{best}{rule} Worked on "
            f"today's balance of {_inr(im.outstanding)} and {im.months_before} months left."
        ),
        claimable=False,
        rate_gap=D("0"),
        amount_this_year=D("0"),
        overcharged_so_far=D("0"),
        months_overcharged=0,
        citations=list(rr.citations),
        next_step=(
            f"Decide which you prefer before the reset reaches your loan, and tell "
            f"{name or f'your {who}'} in writing (a branch letter or the grievance e-mail). "
            f"Check the next statement or rate-change SMS: it must show the new rate, EMI "
            f"and EMIs left."
        ),
    )


_ACTION_WORDS = {
    BankAction.EMI_RAISED: "raised your EMI",
    BankAction.TENURE_EXTENDED: "extended your tenure",
    BankAction.BOTH: "raised your EMI and extended your tenure",
}


def _choice_finding(
    inp: LoanCheckInput, rr: Optional[RateRise], name: Optional[str], kind_of: LenderType,
) -> Optional[Finding]:
    """The lender changed EMI or tenure after a rise without offering the
    choice (A11 letter). Only on the borrower's own word; never money."""
    if inp.bank_action not in _ACTION_WORDS or inp.choice_offered != ChoiceOffered.NO:
        return None
    who = name or ("Your bank" if kind_of in EBLR_BOUND else "Your lender")
    cites = _rise_citations(kind_of)
    numbers = ""
    if rr is not None:
        im = rr.impact
        alt = _choice_alternative(inp.bank_action, im)
        numbers = (
            f" This follows the RBI's {rr.decided:%d %b %Y} rise ({_pct(rr.repo_from)} to {_pct(rr.repo_to)})."
            f"{alt + '.' if alt else ''}"
        )
    rule = (
        "The rules for banks, NBFCs and housing finance companies say any rise in EMI or "
        "tenure must be told to you immediately, and that you must be given the choice of a "
        "higher EMI, a longer tenure or both, and of prepaying; when a whole class of loans "
        "is reset because the benchmark rose, a switch to a fixed rate where the lender "
        "offers one as well."
        if cites else
        "RBI's reset circular of 18 Aug 2023 (RBI/2023-24/55), addressed to regional rural "
        "and co-operative banks as well, asks for the same choice."
    )
    return Finding(
        kind="choice_not_offered",
        headline=f"{who} {_ACTION_WORDS[inp.bank_action]} without offering you the choice",
        detail=f"You said {who.lower() if not name else name} {_ACTION_WORDS[inp.bank_action]} and did not offer a choice.{numbers} {rule}",
        claimable=False,
        rate_gap=D("0"),
        amount_this_year=D("0"),
        overcharged_so_far=D("0"),
        months_overcharged=0,
        citations=cites,
        next_step=(
            "Send the letter below: it asks for the options in writing, for your choice to "
            "be applied from the next instalment, and for the new rate, EMI and EMIs left. "
            "No refund is claimed, so the bank can fix it quickly."
        ),
    )


def _pass_through_finding(pt: PassThrough, name: Optional[str]) -> Optional[Finding]:
    if not pt.asymmetric:
        return None
    who = name or "your bank"
    lags = []
    if pt.avg_rise_lag is not None:
        lags.append(f"rises reached your loan in about {pt.avg_rise_lag} months on average")
    if pt.avg_cut_lag is not None:
        lags.append(f"cuts took about {pt.avg_cut_lag}")
    late = [m for m in pt.moves if m.is_cut and m.reached and m.late_months > 0]
    late_txt = ""
    if late:
        parts = "; ".join(
            f"the {m.decided:%b %Y} cut reached it in {m.reached:%b %Y}, {m.late_months} month"
            f"{'s' if m.late_months != 1 else ''} after the three-month window" for m in late
        )
        late_txt = (
            f" A repo-linked rate must be reset at least once in three months: {parts}. At "
            f"today's balance (lower than then, so a cautious figure) that is about "
            f"{_inr(pt.late_cut_interest)} of extra interest. Worth asking {who} about; it is "
            f"not a refund claim until the bank shows its reset dates."
        )
    return Finding(
        kind="asymmetric_pass_through",
        headline=(
            "A rate cut took longer than three months to reach your loan" if late
            else "Rate rises reached your loan faster than cuts"
        ),
        detail=(
            f"From the rate changes you entered, {' and '.join(lags) or 'the moves did not match'}."
            f"{late_txt}"
        ),
        claimable=False,
        rate_gap=D("0"),
        amount_this_year=D("0"),
        overcharged_so_far=D("0"),
        months_overcharged=0,
        citations=[EBLR_RESET],
        next_step=(
            f"Ask {who} in writing for the reset dates in your loan contract and the date "
            f"each repo move was applied. If a cut was applied after a reset date it should "
            f"have used, ask for the excess interest to be credited."
        ),
    )


# ─────────────────────────────────────────────────────────────────────────────
# who is the lender, and does the repo-rate rule bind it?
# ─────────────────────────────────────────────────────────────────────────────

def resolve_lender(inp: LoanCheckInput) -> tuple[Optional[str], LenderType, str]:
    """(name to show, lender type, how the type was known).

    A known name fixes the type; a stated type that contradicts it is an
    input error, so a typo can never quietly change the verdict."""
    known = lenders.resolve(inp.lender)
    name = known.name if known else (inp.lender.strip() if inp.lender and inp.lender.strip() else None)
    if known is not None:
        if inp.lender_type not in (LenderType.UNKNOWN, known.type):
            raise LoanCheckInputError(
                f"{known.name} is {TYPE_LABEL[known.type]}, but the lender type chosen is "
                f"{TYPE_LABEL[inp.lender_type]}. Pick the type that matches, or another lender.",
                "lender_type",
            )
        return name, known.type, "from_name"
    if inp.lender_type != LenderType.UNKNOWN:
        return name, inp.lender_type, "stated"
    return name, LenderType.COMMERCIAL_BANK, "assumed"


def _new_borrower_note(card, name: Optional[str], compared: bool) -> str:
    if card is not None and card.home_loan is not None:
        when = f"{date.fromisoformat(card.last_verified):%d %b %Y}"
        return (
            f"Compared with the home-loan rates {card.name} publishes for new borrowers "
            f"({_pct(card.home_loan.low)} to {_pct(card.home_loan.high)}, checked {when}). "
            f"This comparison never changes the verdict above."
            if compared else
            f"{card.name}'s published rates for new borrowers ({_pct(card.home_loan.low)} "
            f"to {_pct(card.home_loan.high)}, checked {when}) are not below yours."
        )
    who = name or "this lender"
    return (
        f"We don't have a published new-borrower rate card for {who}, so new-borrower "
        f"rates were not compared. The verdict above does not depend on it."
    )


# ─────────────────────────────────────────────────────────────────────────────
# reset watch (critique #5)
# ─────────────────────────────────────────────────────────────────────────────

def reset_watch(inp: LoanCheckInput, benchmark: Benchmark, lender_type: LenderType) -> ResetWatch:
    """When the borrower should look at the rate again, and why.

    - Repo-linked bank loans: the rate must be reset at least once in three
      months (EBLR_RESET), so after a repo move the new rate should show by
      three months after the decision.
    - MCLR / base rate: resets fall on dates in the contract, at most a year
      apart (Interest Rates on Advances Directions, para 36).
    - Other lenders: their own schedule; any rise in EMI or tenor must be
      told to the borrower immediately (RESET_CHOICES_NBFC).
    """
    meeting = inp.next_policy_meeting
    nxt = (
        f" The next RBI policy meeting ends on {meeting:%d %b %Y}; run the check again after it."
        if meeting else ""
    )
    hist = [(d, r) for d, r in policy_rates.history(Country.IN) if d <= inp.as_of]
    last_day, last_rate = hist[-1]
    prev_rate = hist[-2][1] if len(hist) > 1 else last_rate
    move = "rose" if last_rate > prev_rate else "fell"
    if lender_type not in EBLR_BOUND:
        return ResetWatch(
            headline="Your lender resets on its own schedule",
            detail=(
                f"The RBI repo rate {move} from {_pct(prev_rate)} to {_pct(last_rate)} on "
                f"{last_day:%d %b %Y}. {TYPE_LABEL[lender_type].capitalize()} is not bound to "
                f"follow it, but must tell you immediately of any rise in your EMI or tenure "
                f"and offer the choices of a higher EMI, a longer tenure, or prepaying.{nxt}"
            ),
            check_by=None, last_change=last_day, last_change_from=prev_rate,
            last_change_to=last_rate, next_meeting=meeting, citations=[RESET_CHOICES_NBFC],
        )
    if benchmark in (Benchmark.MCLR, Benchmark.BASE_RATE):
        if inp.last_reset is not None:
            due = _add_months(_month_start(inp.last_reset), 12)
            detail = (
                f"MCLR loans reset on dates set in the loan contract, at most a year apart. "
                f"Your rate last changed in {inp.last_reset:%b %Y}, so the next reset is due by "
                f"about {due:%b %Y} if your reset period is a year (your sanction letter says)."
            )
        else:
            due = None
            detail = (
                "MCLR loans reset on dates set in the loan contract, at most a year apart. "
                "Add the month your rate last changed to get a reminder date."
            )
        return ResetWatch(
            headline="When your MCLR loan resets", detail=detail + nxt, check_by=due,
            last_change=last_day, last_change_from=prev_rate, last_change_to=last_rate,
            next_meeting=meeting, citations=[],
        )
    due = last_day + timedelta(days=91)
    if due >= inp.as_of:
        detail = (
            f"The RBI repo rate {move} from {_pct(prev_rate)} to {_pct(last_rate)} on "
            f"{last_day:%d %b %Y}. A repo-linked rate must be reset at least once in three "
            f"months, so your rate should reflect this by about {due:%d %b %Y}. Look at your "
            f"statement or the bank's rate-change message then, and run this check again."
        )
        headline = f"Check your rate by {due:%d %b %Y}"
    else:
        detail = (
            f"The last RBI repo move was on {last_day:%d %b %Y} ({_pct(prev_rate)} to "
            f"{_pct(last_rate)}); the three-month reset window has passed, so your rate "
            f"should already reflect it."
        )
        headline = "Your rate should already reflect the last repo move"
        due = None
    return ResetWatch(
        headline=headline, detail=detail + nxt, check_by=due, last_change=last_day,
        last_change_from=prev_rate, last_change_to=last_rate, next_meeting=meeting,
        citations=[EBLR_RESET, RESET_CHOICES_BANK],
    )


# ─────────────────────────────────────────────────────────────────────────────
# the check
# ─────────────────────────────────────────────────────────────────────────────

def _stale_warning(inp: LoanCheckInput) -> tuple[date, Optional[str]]:
    rates_as_of = policy_rates.rates_as_of(Country.IN)
    stale = None
    if (inp.as_of - rates_as_of).days > STALE_AFTER_DAYS:
        stale = (
            f"RBI rates were last checked on {rates_as_of:%d %b %Y}. "
            f"A later RBI decision may not be included."
        )
    return rates_as_of, stale


def _repo_math(inp: LoanCheckInput, start: date, spread_delta: Decimal) -> tuple[Decimal, Decimal, Decimal]:
    """(repo at start, repo reference now, expected rate). Raises on a typo."""
    repo_start = _repo_at_start(start)
    repo_ref = _repo_reference(inp.as_of)
    repo_today = policy_rates.rate_on(Country.IN, inp.as_of)
    # A home loan priced below the repo rate has never existed; this is
    # almost always a typo, and checking it would produce a bogus claim.
    if inp.start_rate < repo_start:
        raise LoanCheckInputError(
            f"The starting rate {_pct(inp.start_rate)} is below the RBI repo "
            f"rate at the time ({_pct(repo_start)}). Check the number and the start month.",
            "start_rate",
        )
    if inp.current_rate < repo_today:
        raise LoanCheckInputError(
            f"The current rate {_pct(inp.current_rate)} is below today's RBI "
            f"repo rate ({_pct(repo_today)}). Check the number.", "current_rate",
        )
    return repo_start, repo_ref, inp.start_rate + (repo_ref - repo_start) + spread_delta


def _spread_assumption(inp: LoanCheckInput) -> str:
    if inp.spread_changed == SpreadChange.YES:
        assert inp.spread_change is not None
        way = "raised" if inp.spread_change > 0 else "cut"
        return (
            f"You said your bank {way} your spread by {_pct(abs(inp.spread_change))}; the "
            f"expected rate allows for it. A bank may raise the credit risk premium only "
            f"when your credit assessment changes substantially, as your loan contract "
            f"says, and other parts of the spread once in three years. If you were not "
            f"told which ground was used, ask."
        ) if inp.spread_change != 0 else "You said your spread changed by 0.00%."
    if inp.spread_changed == SpreadChange.NO:
        return "You said your bank has not changed your spread since the loan started."
    return (
        "You were not sure whether your spread changed, so it is taken as unchanged. "
        "A bank may raise it only if your credit assessment changed substantially, or "
        "the operating-cost part once in three years; if your bank told you in writing "
        "that it did, enter the change: the gap may be smaller. A complaint letter asks "
        "the bank to say when and why."
    )


def _not_binding_finding(
    inp: LoanCheckInput, name: Optional[str], kind_of: LenderType,
    expected: Optional[Decimal],
) -> Finding:
    who = name or "Your lender"
    label = TYPE_LABEL[kind_of]
    compare = ""
    if expected is not None:
        g = inp.current_rate - expected
        if g > TOLERANCE:
            rel = f"{_pct(g)} above"
        elif g < -TOLERANCE:
            rel = f"{_pct(-g)} below"
        else:
            rel = "about level with"
        compare = (
            f" For information only: had your rate followed the RBI repo rate since "
            f"{inp.loan_start:%b %Y}, it would be about {_pct(expected)}; you pay "
            f"{_pct(inp.current_rate)}, {rel} that."
        )
    if kind_of == LenderType.HFC:
        applies = (
            " What does apply: the company sets rates under a Board-approved interest "
            "rate model and must state your rate in the sanction letter; rate changes "
            "take effect only from then on, with notice; if a change is to your "
            "disadvantage you may close or switch the loan within 60 days without extra "
            "charges or interest; and a floating-rate housing loan can be pre-closed "
            "from any source with no pre-payment charge."
        )
        cites = [EBLR_SCOPE, HFC_RATE_POLICY, PROSPECTIVE_HFC, RESET_CHOICES_NBFC, HFC_PREPAY_FREE, NHB_COMPLAINT]
        where = (
            "Complaints go to the company first, then, after a month with no answer or "
            "an answer that does not resolve it, to the National Housing Bank through "
            "GRIDS (grids.nhbonline.org.in). The RBI Ombudsman does not cover housing "
            "finance companies."
        )
    elif kind_of == LenderType.NBFC:
        applies = (
            " What does apply: the lender sets rates under a Board-approved interest "
            "rate model and must state your rate in the sanction letter, and must tell "
            "you immediately of any rise in EMI or tenure and offer you a higher EMI, a "
            "longer tenure or prepaying."
        )
        cites = [EBLR_SCOPE, HFC_RATE_POLICY, RESET_CHOICES_NBFC, RBIOS_SCOPE]
        where = (
            "Complaints go to the lender first; the RBI Ombudsman covers NBFCs above "
            "its size limits."
        )
    else:
        applies = ""
        cites = [EBLR_SCOPE, RBIOS_SCOPE]
        where = (
            "Complaints go to the bank first, then to the RBI Ombudsman, which covers "
            "regional rural banks and state, central and scheduled urban co-operative banks."
        )
    return Finding(
        kind="rule_not_binding",
        headline=f"The RBI repo-rate rule does not bind {label}",
        detail=(
            f"RBI's rule that floating-rate home loans must follow an external benchmark "
            f"such as the repo rate binds commercial banks and small finance banks. "
            f"{who} is {label}, so a gap to the repo rate is not something it must "
            f"refund.{compare}{applies}"
        ),
        claimable=False,
        rate_gap=D("0"),
        amount_this_year=D("0"),
        overcharged_so_far=D("0"),
        months_overcharged=0,
        citations=cites,
        next_step=(
            f"Ask {name or 'your lender'} in writing which benchmark your loan follows "
            f"(often its own prime lending rate), its value at each reset, and your "
            f"spread. Compare its rate for new borrowers and other lenders' offers before "
            f"deciding to stay or move. {where}"
        ),
    )


def _below_finding(
    inp: LoanCheckInput, start: date, repo_start: Decimal, repo_ref: Decimal,
    expected: Decimal, gap: Decimal,
) -> Finding:
    """Paying less than the repo moves imply: good news, never a claim (L#7)."""
    hist = [(d, r) for d, r in policy_rates.history(Country.IN) if d <= inp.as_of]
    last_day, last_rate = hist[-1]
    prev = hist[-2][1] if len(hist) > 1 else last_rate
    reasons = [
        "your bank lowered your spread (banks may cut it early to keep customers)",
        "the starting rate entered is not the rate on your sanction letter (for "
        "example, today's rate typed as the starting rate)",
    ]
    if last_rate > prev and (inp.as_of - last_day).days <= 92:
        reasons.insert(0, (
            f"the repo rise of {last_day:%d %b %Y} ({_pct(prev)} to {_pct(last_rate)}) "
            f"has not reached your loan yet: a repo-linked rate must be reset at least "
            f"once in three months, so your rate may still rise by about "
            f"{last_day + timedelta(days=91):%d %b %Y}"
        ))
    return Finding(
        kind="below_expected",
        headline=f"You pay {_pct(-gap)} less than the repo moves imply",
        detail=(
            f"The loan started at {_pct(inp.start_rate)} in {start:%B %Y}, when the repo "
            f"rate was {_pct(repo_start)}. It is now {_pct(repo_ref)}, so a rate that "
            f"followed it exactly would be about {_pct(expected)}. You pay "
            f"{_pct(inp.current_rate)}, {_pct(-gap)} below that. That is in your favour: "
            f"there is nothing to claim. Common reasons: " + "; or ".join(reasons) + "."
        ),
        claimable=False,
        rate_gap=D("0"),
        amount_this_year=D("0"),
        overcharged_so_far=D("0"),
        months_overcharged=0,
        citations=[],
        next_step=(
            "Check the starting rate on your sanction letter. If it is right, nothing "
            "needs doing now; look again after your next reset."
        ),
    )


def check_loan(inp: LoanCheckInput) -> LoanCheckResult:
    validate(inp)
    name, kind_of, type_source = resolve_lender(inp)
    card = find_lender(inp.lender)
    start = _month_start(inp.loan_start)
    repo_today = policy_rates.rate_on(Country.IN, inp.as_of)
    assumptions: list[str] = []
    rates_as_of, stale = _stale_warning(inp)
    bound = kind_of in EBLR_BOUND
    changes = policy_rates.changes_between(Country.IN, start, inp.as_of)
    spread_delta = inp.spread_change if inp.spread_changed == SpreadChange.YES and inp.spread_change else D("0")

    if type_source == "assumed":
        assumptions.append(
            "The lender type was not given, so the loan is checked as a bank loan. "
            "If it is from a housing finance company, an NBFC, a regional rural bank or "
            "a co-operative bank, choose that type: the repo-rate rule does not bind them."
        )
    common = dict(
        repo_today=repo_today, rates_as_of=rates_as_of, stale_rates_warning=stale,
        lender_name=name, lender_type=kind_of, lender_type_source=type_source,
        rule_applies=bound,
    )

    benchmark = inp.benchmark
    if not bound:
        # Information only. Compare with the repo rate when the inputs allow,
        # without ever raising a claim.
        expected = None
        repo_start = repo_ref = None
        if start >= REPO_LINKED_EARLIEST:
            try:
                repo_start, repo_ref, expected = _repo_math(inp, start, spread_delta)
            except LoanCheckInputError:
                expected = repo_start = repo_ref = None
        f = _not_binding_finding(inp, name, kind_of, expected)
        rr = rate_rise(inp, kind_of, benchmark, expected)
        extra_f = [x for x in (
            _rate_rise_finding(rr, name, kind_of, benchmark) if rr else None,
            _choice_finding(inp, rr, name, kind_of),
        ) if x is not None]
        return LoanCheckResult(
            status="not_applicable",
            summary=(
                f"{name or 'This lender'} is {TYPE_LABEL[kind_of]}. The RBI rule that a "
                f"floating-rate home loan must follow the repo rate binds banks only, so "
                f"there is no rate-cut refund to claim. See what does apply below."
            ),
            findings=[f, *extra_f],
            expected_rate=expected,
            repo_at_start=repo_start,
            repo_reference_now=repo_ref,
            repo_changes_since_start=changes,
            claim_amount=D("0"),
            amount_at_stake_this_year=D("0"),
            assumptions=assumptions,
            verdict="rule_not_binding",
            gap=(inp.current_rate - expected) if expected is not None else None,
            new_borrower_note=_new_borrower_note(card, name, False) if card is None else "",
            reset_watch=reset_watch(inp, benchmark, kind_of),
            rate_rise=rr,
            **common,
        )

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
        sw_rate = inp.switch_rate
        if sw_rate is None and card is not None and card.home_loan is not None:
            sw_rate = card.home_loan.high
        sw = (
            switch_saving(inp.outstanding, inp.current_rate, sw_rate, inp.tenure_months_remaining,
                          inp.emi, inp.switch_cost or D("0"))
            if sw_rate is not None and sw_rate < inp.current_rate - TOLERANCE else None
        )
        finding = _old_benchmark_finding(inp, card, sw)
        rr = rate_rise(inp, kind_of, benchmark, None)
        extra_f = [x for x in (
            _rate_rise_finding(rr, name, kind_of, benchmark) if rr else None,
            _choice_finding(inp, rr, name, kind_of),
        ) if x is not None]
        return LoanCheckResult(
            status="not_applicable",
            summary=(
                "The repo-rate check does not apply to MCLR or base-rate "
                "loans. Switching to the repo-linked rate may lower your rate."
            ),
            findings=[finding, *extra_f],
            expected_rate=None,
            repo_at_start=None,
            repo_reference_now=None,
            repo_changes_since_start=changes,
            claim_amount=D("0"),
            amount_at_stake_this_year=D("0"),
            assumptions=assumptions,
            verdict="old_benchmark",
            new_borrower_note=_new_borrower_note(card, name, card is not None),
            reset_watch=reset_watch(inp, benchmark, kind_of),
            rate_rise=rr,
            switch=sw,
            **common,
        )

    repo_start, repo_ref, expected = _repo_math(inp, start, spread_delta)
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
    assumptions.append(_spread_assumption(inp))

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
                e = inp.start_rate + (_repo_reference(min(_month_end(m), inp.as_of)) - repo_start) + spread_delta
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
            e_m = inp.start_rate + (_repo_reference(min(_month_end(m), inp.as_of)) - repo_start) + spread_delta
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
        lender = name or "your lender"
        if repo_fell:
            headline = f"{name or 'Your lender'} has not passed on {_pct(gap)} of RBI rate cuts"
        else:
            headline = f"Your rate has risen {_pct(gap)} more than the RBI repo rate"
        window = policy_rates.rates_between(
            Country.IN, _add_months(_month_start(start), -SANCTION_LAG_MONTHS), _month_end(start)
        )
        then = (
            f"when the repo rate was {_pct(repo_start)}"
            if len(set(window)) == 1
            else f"when the repo rate was {_pct(repo_start)} at its lowest "
            f"(counting the {SANCTION_LAG_MONTHS} months before, in case the "
            f"rate was fixed at sanction)"
        )
        spread_note = (
            f" (including the {_pct(spread_delta)} spread change you entered)"
            if spread_delta else ""
        )
        detail = (
            f"The loan started at {_pct(inp.start_rate)} in {start:%B %Y}, "
            f"{then}. The repo rate is now {_pct(repo_ref)} "
            f"(allowing for the three-month reset window), so the rate should "
            f"be about {_pct(expected)}{spread_note}. You pay {_pct(inp.current_rate)}. "
            f"As an estimate for your own conversation with the bank, that "
            f"costs about {_inr(this_year)} over the next 12 months"
        )
        if overcharged > 0:
            detail += (
                f", and about {_inr(overcharged)} may have been overcharged over "
                f"the last {months} month{'s' if months != 1 else ''} (a cautious "
                f"figure the bank can check; not a confirmed refund)."
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
        verdict = "missed_rate_cut"
    elif gap < -TOLERANCE:
        findings.append(_below_finding(inp, start, repo_start, repo_ref, expected, gap))
        verdict = "below_expected"
    else:
        verdict = "matches"

    base_rate = min(inp.current_rate, expected)
    pg = _pricing_gap_finding(inp, card, base_rate)
    if pg:
        findings.append(pg)
    elif inp.lender and card is None:
        assumptions.append(
            f"No rate card for '{inp.lender}', so new-borrower rates were not compared."
        )

    # The hike cycle (A11): what the last rise does, whether the choice was
    # offered, and whether rises travelled faster than cuts.
    rr = rate_rise(inp, kind_of, benchmark, expected)
    if rr is not None:
        findings.append(_rate_rise_finding(rr, name, kind_of, benchmark))
    cf = _choice_finding(inp, rr, name, kind_of)
    if cf is not None:
        findings.append(cf)
    pt = None
    if inp.rate_history:
        pt = pass_through(inp.loan_start, inp.start_rate, inp.rate_history, changes,
                          inp.as_of, inp.outstanding)
        ptf = _pass_through_finding(pt, name)
        if ptf is not None:
            findings.append(ptf)

    claimable = [f for f in findings if f.claimable]
    claim_amount = sum((f.overcharged_so_far for f in claimable), D("0"))
    at_stake = sum((f.amount_this_year for f in claimable), D("0"))
    extra = f" Separately, {card.name} quotes new borrowers less: see below." if pg else ""

    if verdict == "missed_rate_cut":
        status = "issues_found"
        summary = (
            f"Your rate should be about {_pct(expected)}, not "
            f"{_pct(inp.current_rate)}. An estimated {_inr(at_stake)} is at stake over "
            f"the next 12 months."
        )
    elif verdict == "below_expected":
        status = "no_issue"
        summary = (
            f"You pay {_pct(inp.current_rate)}, about {_pct(-gap)} below what the "
            f"repo moves since your loan started imply ({_pct(expected)}). That is in "
            f"your favour: nothing to claim.{extra}"
        )
    else:
        status = "no_issue"
        summary = (
            f"Your rate of {_pct(inp.current_rate)} matches the RBI repo rate "
            f"moves since the loan started. Nothing to claim.{extra}"
        )
    if rr is not None and verdict != "missed_rate_cut":
        summary += (
            f" The {rr.decided:%d %b %Y} rise: see your new EMI or tenure, and the choice "
            f"your bank must offer, below."
        )

    return LoanCheckResult(
        status=status,
        summary=summary,
        findings=findings,
        expected_rate=expected,
        repo_at_start=repo_start,
        repo_reference_now=repo_ref,
        repo_changes_since_start=changes,
        claim_amount=claim_amount,
        amount_at_stake_this_year=at_stake,
        assumptions=assumptions,
        verdict=verdict,
        gap=gap,
        new_borrower_note=_new_borrower_note(card, name, pg is not None),
        reset_watch=reset_watch(inp, benchmark, kind_of),
        rate_rise=rr,
        pass_through=pt,
        **common,
    )
