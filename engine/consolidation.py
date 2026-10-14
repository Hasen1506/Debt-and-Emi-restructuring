"""A cheaper way to carry a revolving card (audit 80+ A6).

The question a stretched borrower with a card at 40%+ can't answer alone:
"if I moved this balance to a personal loan, what would I pay each month,
how much of my gap would that close, and is it really cheaper once the
fee and GST are counted?". This module answers it on the user's own plan.

How a card-to-loan move works in India (what the numbers model)
---------------------------------------------------------------
* There is no product that "moves" a card balance. The borrower takes a new
  loan (a personal loan, a "loan on card" from the same issuer, or a
  top-up on a home loan) and uses the money to pay the card in full. The
  card stays open; its balance is now owed to the loan instead.
* The loan is a fixed EMI over a fixed tenure on a reducing balance, so the
  monthly payment is known and the debt has an end date. A card minimum is
  mostly interest (plus 18% GST on it in India) and never ends on its own.
* Costs at the start: a processing fee, plus 18% GST on the fee (CBIC
  Notification 11/2017-CT(Rate), heading 9971: engine/tax/gst.py). Interest
  on the loan itself carries no GST; card interest does. The loan here is
  sized so the card is cleared in full after the fee and its GST.
* Costs at the end: a fixed-rate personal loan may carry a foreclosure /
  part-payment charge set in its Key Facts Statement (KFS). RBI's
  Pre-payment Charges Directions (2 July 2025) bar such charges only on
  floating-rate loans to individuals for non-business purposes
  (engine/citations.PREPAYMENT_NO_CHARGE). The charge is an input here
  (`foreclosure_pct`), never assumed away for a fixed-rate loan.
* The KFS must state the APR, which "includes interest rate and all other
  charges", and stay valid for at least three working days so the borrower
  can compare (RBI/2024-25/18, 15 Apr 2024, paras 3(c) and 5:
  https://www.rbi.org.in/Scripts/NotificationUser.aspx?Id=12663, read
  14 Oct 2026).
* Credit score: the application is a hard enquiry ("Each time you apply for
  a loan, the lender makes a hard inquiry on your CIBIL Report. Multiple
  inquiries in a short period may impact your score."), while paying the
  card down lowers card utilisation, which CIBIL counts the other way
  (CIBIL score brochure, 15 Oct 2025:
  https://www.cibil.com/content/dam/cibil/consumer/cibil-score-and-report-brochure-15-10-25.pdf).
* The rate a lender offers depends on the borrower. Banks publish the range
  and mean of what they actually charged last quarter (RBI/2014-15/422,
  para 2(a); engine/rate_disclosures.py). A bank's floor ("from 9.99%") is
  never used as the user's rate (audit 80+ E1). Without a quote of their
  own, the card is priced at the middle of the banks' means ("typical") and
  at the middle of their published maximums ("high"), side by side.

RightDue doesn't arrange loans and no lender pays it. The card names no
lender.
"""
from __future__ import annotations

from copy import deepcopy
from dataclasses import dataclass, field
from decimal import ROUND_CEILING, ROUND_HALF_UP, Decimal
from statistics import median
from typing import Optional

from engine.formulas import emi
from engine.marginal_cost import user_marginal_costs
from engine.models import Country, Loan, LoanType, User
from engine.surplus import compute_total_minimums
from engine.tax.gst import GST_RATE_IN

D = Decimal

# A revolving card qualifies when what it costs a year from here (interest
# compounded monthly, plus GST in India, less any tax break) is above this.
CARD_COST_TRIGGER = D("0.30")
DEFAULT_TENURE_MONTHS = 36
TENURE_CHOICES = (12, 24, 36, 48, 60)
MIN_RATE, MAX_RATE = D("0.05"), D("0.40")
MAX_FEE_PCT = D("0.05")
NEUTRALITY = "We don't arrange loans and no lender pays us."


class ConsolidationInputError(ValueError):
    def __init__(self, field_name: str, message: str):
        super().__init__(message)
        self.field = field_name


@dataclass(frozen=True)
class PublishedRange:
    """What banks charged on personal loans last quarter (their own pages)."""
    typical: Decimal            # middle of the banks' means
    high: Optional[Decimal]     # middle of the banks' published maximums
    banks: int
    period: str                 # e.g. "Apr-Jun 2026 to Jul-Sep 2026"
    as_of: str
    sources: list[tuple[str, str]] = field(default_factory=list)   # (bank, url)


def published_range(disclosures: dict, category: str = "personal_loan") -> Optional[PublishedRange]:
    """From the committed rate-disclosure file (api/data/rate_disclosures):
    each bank's latest row for `category`; the middle of their means and the
    middle of their maximums. None when no bank published one."""
    latest: dict[str, dict] = {}
    urls: dict[str, str] = {}
    for lender in disclosures.get("lenders", []):
        for row in lender.get("rows", []):
            if row.get("category") != category or row.get("mean") is None:
                continue
            name = lender.get("name", "?")
            if name not in latest or row["period_end"] > latest[name]["period_end"]:
                latest[name] = row
                urls[name] = lender.get("source_url", "")
    if not latest:
        return None
    means = [D(r["mean"]) for r in latest.values()]
    maxes = [D(r["max"]) for r in latest.values() if r.get("max")]
    labels = sorted({r["period_label"] for r in latest.values()})
    return PublishedRange(
        typical=D(str(median(means))).quantize(D("0.0001")),
        high=D(str(median(maxes))).quantize(D("0.0001")) if maxes else None,
        banks=len(latest),
        period=" to ".join([labels[0], labels[-1]]) if len(labels) > 1 else labels[0],
        as_of=str(disclosures.get("as_of", "")),
        sources=sorted((n, urls[n]) for n in latest),
    )


def revolving_cards(user: User, marginal_rate: Decimal) -> list[int]:
    """Positions of the cards with a balance whose yearly cost is above
    CARD_COST_TRIGGER, dearest first."""
    costs = user_marginal_costs(user.loans, user, marginal_rate)
    found = [
        (costs[id(l)].annual_cost, i) for i, l in enumerate(user.loans)
        if l.loan_type == LoanType.CREDIT_CARD and l.outstanding > 0 and id(l) in costs
        and costs[id(l)].annual_cost > CARD_COST_TRIGGER
    ]
    return [i for _, i in sorted(found, key=lambda t: (-t[0], t[1]))]


def card_yearly_cost(user: User, idx: int, marginal_rate: Decimal) -> Decimal:
    l = user.loans[idx]
    return user_marginal_costs([l], user, marginal_rate)[id(l)].annual_cost


def loan_amount(card_total: Decimal, fee_pct: Decimal, fee_flat: Decimal, india: bool) -> tuple[Decimal, Decimal, Decimal]:
    """(principal, fee, GST on the fee) for a loan that clears `card_total`
    after its fee and GST: P - fee(P) * (1 + GST) = card_total. Whole rupees,
    rounded up so the card is always cleared."""
    gst = GST_RATE_IN if india else D("0")
    if fee_pct >= D("1") / (D("1") + gst):
        raise ConsolidationInputError("fee_pct", "That fee is more than the loan.")
    p = (card_total + fee_flat * (D("1") + gst)) / (D("1") - fee_pct * (D("1") + gst))
    p = p.quantize(D("1"), rounding=ROUND_CEILING)
    fee = (p * fee_pct + fee_flat).quantize(D("0.01"), rounding=ROUND_HALF_UP)
    return p, fee, (fee * gst).quantize(D("0.01"), rounding=ROUND_HALF_UP)


@dataclass
class Scenario:
    rate: Decimal
    rate_basis: str                     # "yours" | "typical" | "high"
    tenure_months: int
    card_indices: list[int]
    card_total: Decimal
    principal: Decimal
    fee: Decimal
    fee_gst: Decimal
    emi: Decimal
    card_minimum_now: Decimal           # the cards' minimum this month
    cash_freed: Decimal                 # card minimums - new EMI (negative: costs more a month)
    gap_before: Decimal
    gap_after: Decimal
    debt_free_before: Optional[int]
    debt_free_after: Optional[int]
    cost_before: Decimal                # what the plan pays beyond principal, net of tax
    cost_after: Decimal                 # the same, plus the fee and its GST
    saving: Decimal                     # cost_before - cost_after (negative: costs more)
    payments_share_after: Optional[Decimal]   # all loan payments / take-home with the new EMI
    verdict: str                        # "saves" | "frees_cash_costs_more" | "costs_more"
    break_even_fee_pct: Optional[Decimal] = None   # the fee % at which the saving reaches 0
    # When either plan never clears (a short month borrowed at card rates
    # compounds without end), costs are compared over the loan's own tenure
    # instead of the whole plan: this many months. None = whole plans.
    cost_window_months: Optional[int] = None


def _plan_cost(user: User, res, marginal_rate: Decimal) -> Decimal:
    from engine.fee_order import plan_net_cost
    return plan_net_cost(user, res, marginal_rate)


def _window_cost(res, months: int) -> Decimal:
    """Interest (GST and fees included) and gap-borrowing interest paid in
    the plan's first `months` months."""
    return sum((r.interest_paid_month + r.gap_interest for r in res.months[:months]), D("0"))


def consolidate(
    user: User,
    run,                                 # run(user) -> SimulationResult, the caller's own plan settings
    marginal_rate: Decimal,
    card_indices: list[int],
    rate: Decimal,
    tenure_months: int = DEFAULT_TENURE_MONTHS,
    fee_pct: Decimal = D("0"),
    fee_flat: Decimal = D("0"),
    foreclosure_pct: Decimal = D("0"),
    rate_basis: str = "yours",
    base=None,
    with_break_even: bool = True,
) -> Scenario:
    """The user's plan with the cards at `card_indices` paid off by one new
    fixed-rate loan, against the plan as it stands."""
    if not card_indices:
        raise ConsolidationInputError("card_indices", "No card to move.")
    if not (MIN_RATE <= rate <= MAX_RATE):
        raise ConsolidationInputError("rate", "Enter a loan rate between 5% and 40% a year.")
    if not (6 <= tenure_months <= 84):
        raise ConsolidationInputError("tenure_months", "Pick a tenure between 6 and 84 months.")
    if not (D("0") <= fee_pct <= MAX_FEE_PCT):
        raise ConsolidationInputError("fee_pct", "A processing fee between 0% and 5%.")
    if fee_flat < 0:
        raise ConsolidationInputError("fee_flat", "The fee can't be negative.")
    if not (D("0") <= foreclosure_pct <= MAX_FEE_PCT):
        raise ConsolidationInputError("foreclosure_pct", "A foreclosure charge between 0% and 5%.")
    india = user.country == Country.IN
    cards = [user.loans[i] for i in card_indices]
    if any(c.loan_type != LoanType.CREDIT_CARD or c.outstanding <= 0 for c in cards):
        raise ConsolidationInputError("card_indices", "Only cards with a balance can be moved.")
    card_total = sum((c.outstanding for c in cards), D("0"))
    principal, fee, fee_gst = loan_amount(card_total, fee_pct, fee_flat, india)
    new_emi = emi(principal, rate, tenure_months).quantize(D("1"), rounding=ROUND_CEILING)

    base = base if base is not None else run(user)
    after_user = deepcopy(user)
    for i in card_indices:
        # The card stays open (new spend on it, if any, carries on as entered);
        # its balance is paid off by the loan.
        after_user.loans[i].outstanding = D("0")
    after_user.loans.append(Loan(
        LoanType.PERSONAL, "New loan (your choice of lender)", principal, rate, "fixed",
        tenure_months, new_emi, prepayment_penalty_pct=foreclosure_pct,
    ))
    after = run(after_user)

    card_min = compute_total_minimums(user, cards)
    gap_b = base.months[0].shortfall if base.months else D("0")
    gap_a = after.months[0].shortfall if after.months else D("0")
    window = None if (base.debt_free_month is not None and after.debt_free_month is not None) else min(tenure_months, 36)
    if window is None:
        cost_b = _plan_cost(user, base, marginal_rate)
        cost_a = _plan_cost(after_user, after, marginal_rate)
    else:
        cost_b = _window_cost(base, window)
        cost_a = _window_cost(after, window)
    # The fee and its GST are carried inside the new loan's principal; they
    # are a cost on top of the card balance it clears.
    cost_a += principal - card_total
    saving = (cost_b - cost_a).quantize(D("1"), rounding=ROUND_HALF_UP)
    freed = (card_min - new_emi).quantize(D("1"), rounding=ROUND_HALF_UP)

    share = None
    take_home = user.monthly_income
    if take_home and take_home > 0:
        payments = sum((l.scheduled_emi for l in user.loans if l.loan_type != LoanType.CREDIT_CARD and l.outstanding > 0), D("0"))
        share = ((payments + new_emi) / take_home).quantize(D("0.0001"))

    verdict = "saves" if saving > 0 else ("frees_cash_costs_more" if freed > 0 else "costs_more")
    sc = Scenario(
        rate=rate, rate_basis=rate_basis, tenure_months=tenure_months, card_indices=list(card_indices),
        card_total=card_total, principal=principal, fee=fee, fee_gst=fee_gst, emi=new_emi,
        card_minimum_now=card_min.quantize(D("1"), rounding=ROUND_HALF_UP), cash_freed=freed,
        gap_before=gap_b.quantize(D("1"), rounding=ROUND_HALF_UP), gap_after=gap_a.quantize(D("1"), rounding=ROUND_HALF_UP),
        debt_free_before=base.debt_free_month, debt_free_after=after.debt_free_month,
        cost_before=cost_b.quantize(D("1"), rounding=ROUND_HALF_UP), cost_after=cost_a.quantize(D("1"), rounding=ROUND_HALF_UP),
        saving=saving, payments_share_after=share, verdict=verdict, cost_window_months=window,
    )
    if with_break_even and fee_flat == 0 and saving > 0:
        sc.break_even_fee_pct = _break_even_fee(user, run, marginal_rate, card_indices, rate, tenure_months,
                                                foreclosure_pct, base, fee_pct)
    return sc


def _break_even_fee(user, run, marginal_rate, card_indices, rate, tenure, foreclosure_pct, base, known) -> Optional[Decimal]:
    """The processing fee (as a share of the loan, 0.1% steps) at which the
    move stops saving money; None if it still saves at MAX_FEE_PCT."""
    def saves(f: Decimal) -> bool:
        return consolidate(user, run, marginal_rate, card_indices, rate, tenure, f, D("0"), foreclosure_pct,
                           base=base, with_break_even=False).saving > 0
    if saves(MAX_FEE_PCT):
        return None
    lo, hi = known, MAX_FEE_PCT
    for _ in range(6):
        mid = ((lo + hi) / 2).quantize(D("0.001"))
        if mid in (lo, hi):
            break
        if saves(mid):
            lo = mid
        else:
            hi = mid
    return lo


@dataclass
class ConsolidationCard:
    cards: list[int]
    card_cost: dict[int, Decimal]        # position -> yearly cost (compounded, GST, tax)
    scenarios: list[Scenario]
    published: Optional[PublishedRange]
    neutrality: str = NEUTRALITY


def consolidation_card(
    user: User,
    run,
    marginal_rate: Decimal,
    published: Optional[PublishedRange],
    user_rate: Optional[Decimal] = None,
    tenure_months: int = DEFAULT_TENURE_MONTHS,
    fee_pct: Decimal = D("0"),
    foreclosure_pct: Decimal = D("0"),
    base=None,
) -> Optional[ConsolidationCard]:
    """The "Cheaper way to carry this" card, or None when no card costs
    more than CARD_COST_TRIGGER. Priced at the user's own quote when given;
    otherwise at the published typical and high rates (India), never at a
    bank's floor. The US has no published table here, so a US card needs
    the user's quote."""
    idx = revolving_cards(user, marginal_rate)
    if not idx:
        return None
    base = base if base is not None else run(user)
    rates: list[tuple[Decimal, str]] = []
    if user_rate is not None:
        rates.append((user_rate, "yours"))
    elif published is not None and user.country == Country.IN:
        rates.append((published.typical, "typical"))
        if published.high is not None and published.high > published.typical:
            rates.append((min(published.high, MAX_RATE), "high"))
    scenarios = [
        consolidate(user, run, marginal_rate, idx, r, tenure_months, fee_pct, D("0"), foreclosure_pct,
                    rate_basis=basis, base=base)
        for r, basis in rates
    ]
    return ConsolidationCard(
        cards=idx, card_cost={i: card_yearly_cost(user, i, marginal_rate) for i in idx},
        scenarios=scenarios, published=published,
    )
