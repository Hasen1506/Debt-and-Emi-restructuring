"""Layer 1 restructuring scanner — composes scan_balance_transfer /
scan_consolidation / scan_refinance from engine.restructuring against the
institution rate cards in engine.rate_cards, so the caller only has to pass
a User + marginal rate.

Returns a flat list of opportunities, each with an estimated annual saving
and a one-line rationale ready to render in the UI.
"""
from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal
from typing import Literal, Optional

from engine.formulas import effective_rate, emi
from engine.models import Country, Loan, LoanType, User
from engine.rate_cards import (
    ALL_INSTITUTIONS, INDIA_TIER_A, USA_TIER_A,
    InstitutionRateCard, RateRange, market_median,
)
from engine.restructuring import (
    BT_NET_SAVING_HURDLE, BT_RATE_THRESHOLD,
    CONSOLIDATION_RATE_THRESHOLD, REFI_RATE_GAP,
    scan_balance_transfer, scan_consolidation, scan_refinance,
)

D = Decimal


RecommendationKind = Literal["balance_transfer", "consolidation", "refinance"]


@dataclass
class RestructuringOpportunity:
    kind: RecommendationKind
    headline: str                 # one-line action, ready for UI
    rationale: str                # why this beats holding
    estimated_annual_saving: Decimal
    affected_loan_banks: list[str]
    target_bank: Optional[str]
    target_rate: Decimal          # effective rate after the move
    current_rate: Decimal         # blended/effective rate today
    # raw details for the UI's "show math" section
    detail: dict[str, str]


def _country_pool(country: Country) -> list[InstitutionRateCard]:
    """Recommendations only pull from Tier-A (authoritative). Tier-B/C carry
    `is_indicative=True` and are used for context (e.g. coverage in lookups,
    not as steered targets) until data ops verifies them."""
    return INDIA_TIER_A if country == Country.IN else USA_TIER_A


def _best_bt_offer(country: Country) -> Optional[tuple[InstitutionRateCard, Decimal, int, Decimal]]:
    """Pick the bank with the lowest effective BT-APR (promo rate + amortised fee).
    Returns (card, promo_rate, promo_months, fee_pct) or None if no offers exist.
    """
    best = None
    best_eff = None
    for card in _country_pool(country):
        cc = card.credit_card
        if cc is None or cc.bt_promo_rate is None or not cc.bt_promo_months:
            continue
        fee = cc.bt_fee_pct or D("0")
        eff = cc.bt_promo_rate + fee / D(cc.bt_promo_months) * D("12")
        if best_eff is None or eff < best_eff:
            best = (card, cc.bt_promo_rate, cc.bt_promo_months, fee)
            best_eff = eff
    return best


def _best_market_rate(country: Country, loan_type: LoanType) -> Optional[tuple[str, Decimal]]:
    """Return (bank_name, low_end_rate) for the cheapest populated Tier-A
    offer of `loan_type`. Used to surface the refi/consolidation target."""
    best_bank = None
    best_low = None
    for card in _country_pool(country):
        if loan_type == LoanType.HOME:
            r = card.home_loan
        elif loan_type == LoanType.AUTO:
            r = card.auto_loan
        elif loan_type == LoanType.PERSONAL:
            r = card.personal_loan
        elif loan_type == LoanType.EDUCATION:
            r = card.education_loan
        else:
            r = None
        if r is None:
            continue
        if best_low is None or r.low < best_low:
            best_low = r.low
            best_bank = card.name
    if best_low is None:
        return None
    return best_bank, best_low


def _fmt_pct(d: Decimal) -> str:
    return f"{(d * D('100')):.2f}%"


def _scan_card_balance_transfer(
    card: Loan,
    card_effective: Decimal,
    country: Country,
) -> Optional[RestructuringOpportunity]:
    offer = _best_bt_offer(country)
    if offer is None:
        return None
    target_card, promo_rate, promo_months, fee_pct = offer
    cand = scan_balance_transfer(card, card_effective, promo_rate, fee_pct, promo_months)
    if cand is None:
        return None
    # Annual saving = (current effective − BT effective) × outstanding, for the promo window
    saving = (card_effective - cand.effective_bt_apr) * card.outstanding
    # Bound to one year; longer promos still save more but UI keeps annualised number.
    saving_annualised = saving * D(min(promo_months, 12)) / D("12")
    ccy = "₹" if country == Country.IN else "$"
    headline = (
        f"{promo_months}-month promo: move {ccy}{card.outstanding:,.0f} from "
        f"{card.bank} card to {target_card.name} at ~{_fmt_pct(cand.effective_bt_apr)}"
    )
    rationale = (
        f"Promotional rate only — clear the balance before month {promo_months} "
        f"or the rate snaps back to ~{_fmt_pct(card_effective)}. "
        f"Effective during promo: {_fmt_pct(promo_rate)} + amortised fee "
        f"{_fmt_pct(fee_pct)} = {_fmt_pct(cand.effective_bt_apr)} vs the "
        f"{_fmt_pct(card_effective)} you pay today."
    )
    return RestructuringOpportunity(
        kind="balance_transfer",
        headline=headline,
        rationale=rationale,
        estimated_annual_saving=saving_annualised,
        affected_loan_banks=[card.bank],
        target_bank=target_card.name,
        target_rate=cand.effective_bt_apr,
        current_rate=card_effective,
        detail={
            "outstanding": str(card.outstanding),
            "promo_rate": str(promo_rate),
            "promo_months": str(promo_months),
            "fee_pct": str(fee_pct),
            "effective_bt_apr": str(cand.effective_bt_apr),
        },
    )


def _scan_consolidation_opportunity(
    user: User,
    effective_rates: dict[int, Decimal],
) -> Optional[RestructuringOpportunity]:
    """Look at unsecured high-rate loans (personal + credit card) and see if
    a single consolidated personal loan at market rate would beat the blended
    average by ≥3pp."""
    unsecured = [
        l for l in user.loans
        if l.loan_type in (LoanType.PERSONAL, LoanType.CREDIT_CARD)
    ]
    if len(unsecured) < 2:
        return None
    market = _best_market_rate(user.country, LoanType.PERSONAL)
    if market is None:
        return None
    target_bank, market_low = market
    # Assume a 1% processing fee amortised over 3y → 0.0033 added to rate.
    fee_amortised = D("0.0033")
    cand = scan_consolidation(unsecured, effective_rates, market_low, fee_amortised)
    if cand is None:
        return None
    total = sum((l.outstanding for l in cand.loans), D("0"))
    saving = (cand.blended_avg_rate - cand.consolidated_rate) * total
    headline = (
        f"Consolidate {len(cand.loans)} unsecured loans into one "
        f"{target_bank} personal loan at ~{_fmt_pct(cand.consolidated_rate)}"
    )
    rationale = (
        f"Blended effective rate today is {_fmt_pct(cand.blended_avg_rate)}; "
        f"one personal loan at {_fmt_pct(cand.consolidated_rate)} saves "
        f"{_fmt_pct(cand.blended_avg_rate - cand.consolidated_rate)} per year."
    )
    return RestructuringOpportunity(
        kind="consolidation",
        headline=headline,
        rationale=rationale,
        estimated_annual_saving=saving,
        affected_loan_banks=[l.bank for l in cand.loans],
        target_bank=target_bank,
        target_rate=cand.consolidated_rate,
        current_rate=cand.blended_avg_rate,
        detail={
            "total_balance": str(total),
            "blended_avg_rate": str(cand.blended_avg_rate),
            "consolidated_rate": str(cand.consolidated_rate),
            "loan_count": str(len(cand.loans)),
        },
    )


def _refi_interest_saved(loan: Loan, new_rate: Decimal) -> Decimal:
    """Diff in total interest between staying at loan.nominal_rate and
    moving to new_rate for the remaining tenure. Both compute fresh EMIs on
    the outstanding balance."""
    n = loan.tenure_months_remaining
    if n <= 0:
        return D("0")
    old_emi = emi(loan.outstanding, loan.nominal_rate, n)
    new_emi = emi(loan.outstanding, new_rate, n)
    return (old_emi - new_emi) * D(n)


def _scan_refi_opportunity(loan: Loan, country: Country) -> Optional[RestructuringOpportunity]:
    median = market_median(country, loan.loan_type)
    if median is None:
        return None
    # Assume refi costs = 1% of outstanding (processing fee + legal).
    refi_costs = loan.outstanding * D("0.01")
    market = _best_market_rate(country, loan.loan_type)
    target_bank = market[0] if market else None
    new_rate = market[1] if market else median
    interest_saved = _refi_interest_saved(loan, new_rate)
    cand = scan_refinance(loan, median, interest_saved, refi_costs)
    if cand is None:
        return None
    annual_saving = (loan.nominal_rate - new_rate) * loan.outstanding
    headline = (
        f"Refinance {loan.bank} {loan.loan_type.value.replace('_', ' ')} "
        f"to {target_bank or 'market median'} at ~{_fmt_pct(new_rate)}"
    )
    rationale = (
        f"Current rate {_fmt_pct(loan.nominal_rate)} is "
        f"{_fmt_pct(loan.nominal_rate - median)} above market median "
        f"{_fmt_pct(median)}; lifetime interest saved "
        f"{interest_saved:,.0f} vs ~{refi_costs:,.0f} in costs."
    )
    return RestructuringOpportunity(
        kind="refinance",
        headline=headline,
        rationale=rationale,
        estimated_annual_saving=annual_saving,
        affected_loan_banks=[loan.bank],
        target_bank=target_bank,
        target_rate=new_rate,
        current_rate=loan.nominal_rate,
        detail={
            "outstanding": str(loan.outstanding),
            "current_rate": str(loan.nominal_rate),
            "new_rate": str(new_rate),
            "market_median": str(median),
            "interest_saved_total": str(interest_saved),
            "refi_costs": str(refi_costs),
        },
    )


def scan_all(user: User, marginal_rate: Decimal = D("0")) -> list[RestructuringOpportunity]:
    """Run every Layer 1 scan on the user's loan book. Returns opportunities
    sorted by estimated annual saving, descending."""
    rates = {
        id(l): effective_rate(l, marginal_rate, user.country, user.tax_regime)
        for l in user.loans
    }
    out: list[RestructuringOpportunity] = []

    for l in user.loans:
        if l.loan_type == LoanType.CREDIT_CARD:
            opp = _scan_card_balance_transfer(l, rates[id(l)], user.country)
            if opp is not None:
                out.append(opp)

    consol = _scan_consolidation_opportunity(user, rates)
    if consol is not None:
        out.append(consol)

    for l in user.loans:
        if l.loan_type in (LoanType.HOME, LoanType.AUTO):
            opp = _scan_refi_opportunity(l, user.country)
            if opp is not None:
                out.append(opp)

    out.sort(key=lambda o: o.estimated_annual_saving, reverse=True)
    return out
