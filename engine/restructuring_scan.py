"""Layer 1 restructuring scanner — composes scan_balance_transfer /
scan_consolidation / scan_refinance from engine.restructuring against the
institution rate cards in engine.rate_cards, so the caller only has to pass
a User + marginal rate.

Returns a flat list of opportunities, each with an estimated annual saving
and a one-line rationale ready to render in the UI.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from decimal import Decimal
from typing import Literal, Optional

from engine.formulas import effective_rate, emi
from engine.models import Country, IncomeType, Loan, LoanType, User
from engine.rate_cards import (
    ALL_INSTITUTIONS, INDIA_TIER_A, USA_TIER_A,
    InstitutionRateCard, RateRange, market_median,
)


# Loan types where collateral drives pricing — banks don't widen the band much
# for self-employed because the asset itself anchors underwriting. Personal
# loan / credit-card / BT promo rates, by contrast, key off income-proof and
# CIBIL/FICO, so the realistic SE offer sits near the middle of the band.
_COLLATERAL_BACKED = {LoanType.HOME, LoanType.AUTO}


def _displayed_rate_for(r: RateRange, loan_type: LoanType, income_type: Optional[IncomeType]) -> Decimal:
    """Pick the realistic indicative rate for `income_type` on `loan_type`:
    salaried → best end; business_owner → mid-of-band on unsecured products,
    best end on collateral-backed products."""
    if income_type == IncomeType.BUSINESS_OWNER and loan_type not in _COLLATERAL_BACKED:
        return r.median
    return r.low
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
    # Set when the all-banks rate-card winner is *different* from the
    # relationship-preferred target — i.e. the user could save a bit more by
    # opening an account at a bank they don't currently use. UI shows this as
    # a dismissable "also worth knowing" hint, not the primary recommendation,
    # because opening a new account has its own friction (KYC, time, fees).
    alternative_target_bank: Optional[str] = None
    alternative_target_rate: Optional[Decimal] = None
    alternative_annual_saving: Optional[Decimal] = None
    # True iff target_bank was chosen because it's in user.primary_bank ∪
    # user.other_banks ∪ {loan.bank}. Lets the UI add a "you already use this
    # bank" badge without recomputing the set.
    target_is_existing_relationship: bool = False
    # ISO date of the rate-card entry the target_rate was sourced from.
    # Populated when target_bank is a Tier-A bank in the registry; None
    # for Tier-B/C indicative entries or non-card-derived rates. UI uses
    # this to surface a "rate as of {date}" tag so users know how fresh
    # the recommendation is.
    target_rate_as_of: Optional[str] = None
    # 0-based positions into user.loans of the loans this opportunity
    # operates on. Populated for every opp:
    #   • balance_transfer → [card_index]
    #   • refinance       → [loan_index]
    #   • consolidation   → list of unsecured-loan indices being merged
    # The UI uses this to wire up the "I took this — update terms"
    # modal: refi/BT mutate the indexed loan in place, consolidation
    # zeroes the listed loans and appends a new consolidated personal
    # loan.
    affected_loan_indices: list[int] = field(default_factory=list)


def _country_pool(country: Country) -> list[InstitutionRateCard]:
    """Recommendations only pull from Tier-A (authoritative). Tier-B/C carry
    `is_indicative=True` and are used for context (e.g. coverage in lookups,
    not as steered targets) until data ops verifies them."""
    return INDIA_TIER_A if country == Country.IN else USA_TIER_A


def _known_banks(user: User) -> set[str]:
    """Banks the user already has a relationship with — primary_bank,
    other_banks, and any loan.bank. Normalised lowercase so case differences
    (\"HDFC Bank\" vs \"hdfc bank\") don't cause false misses."""
    s: set[str] = set()
    if user.primary_bank:
        s.add(user.primary_bank.strip().lower())
    for b in user.other_banks:
        if b:
            s.add(b.strip().lower())
    for l in user.loans:
        if l.bank:
            s.add(l.bank.strip().lower())
    return s


def _best_bt_offer(
    country: Country,
    known: Optional[set[str]] = None,
    income_type: Optional[IncomeType] = None,
) -> Optional[tuple[InstitutionRateCard, Decimal, int, Decimal]]:
    """Pick the bank with the lowest effective BT-APR (promo rate + amortised fee).
    Returns (card, promo_rate, promo_months, fee_pct) or None if no offers exist.

    When `known` is provided, restricts candidates to banks in that set. Callers
    that want the overall-cheapest pass known=None; callers that want the
    relationship-preferred winner pass the user's known-bank set.

    `income_type` doesn't change which bank wins (BT promo rates are headline
    offers all banks publish identically) but business-owners are routinely
    declined or repriced at full APR — callers should surface the eligibility
    caveat in their rationale.
    """
    best = None
    best_eff = None
    for card in _country_pool(country):
        cc = card.credit_card
        if cc is None or cc.bt_promo_rate is None or not cc.bt_promo_months:
            continue
        if known is not None and card.name.strip().lower() not in known:
            continue
        fee = cc.bt_fee_pct or D("0")
        eff = cc.bt_promo_rate + fee / D(cc.bt_promo_months) * D("12")
        if best_eff is None or eff < best_eff:
            best = (card, cc.bt_promo_rate, cc.bt_promo_months, fee)
            best_eff = eff
    return best


def _best_market_rate(
    country: Country,
    loan_type: LoanType,
    known: Optional[set[str]] = None,
    income_type: Optional[IncomeType] = None,
) -> Optional[tuple[str, Decimal]]:
    """Return (bank_name, displayed_rate) for the cheapest populated Tier-A
    offer of `loan_type`. Used to surface the refi/consolidation target.

    When `known` is provided, restricts candidates to banks in that set so
    callers can pick the relationship-preferred winner.

    `income_type` shifts which rate within each bank's band gets compared:
    salaried users see the best end; self-employed users see the mid-of-band
    on unsecured products (their realistic offer post-ITR-review).
    """
    best_bank = None
    best_rate = None
    for card in _country_pool(country):
        if known is not None and card.name.strip().lower() not in known:
            continue
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
        displayed = _displayed_rate_for(r, loan_type, income_type)
        if best_rate is None or displayed < best_rate:
            best_rate = displayed
            best_bank = card.name
    if best_rate is None:
        return None
    return best_bank, best_rate


def _fmt_pct(d: Decimal) -> str:
    return f"{(d * D('100')):.2f}%"


def _bt_saving_annualised(
    card: Loan, card_effective: Decimal, effective_bt_apr: Decimal, promo_months: int,
) -> Decimal:
    """(current_effective − bt_effective) × outstanding, bounded to one year."""
    saving = (card_effective - effective_bt_apr) * card.outstanding
    return saving * D(min(promo_months, 12)) / D("12")


def _scan_card_balance_transfer(
    card: Loan,
    card_index: int,
    card_effective: Decimal,
    country: Country,
    known: set[str],
    income_type: Optional[IncomeType] = None,
) -> Optional[RestructuringOpportunity]:
    # Pick the relationship-preferred BT target first; fall back to the
    # overall winner if the user doesn't already have a card with any of
    # the BT-offering banks.
    rel_offer = _best_bt_offer(country, known, income_type) if known else None
    overall = _best_bt_offer(country, known=None, income_type=income_type)
    if rel_offer is None and overall is None:
        return None
    chosen = rel_offer or overall  # type: ignore[assignment]
    target_card, promo_rate, promo_months, fee_pct = chosen
    cand = scan_balance_transfer(card, card_effective, promo_rate, fee_pct, promo_months)
    if cand is None:
        return None
    saving_annualised = _bt_saving_annualised(
        card, card_effective, cand.effective_bt_apr, promo_months,
    )
    ccy = "₹" if country == Country.IN else "$"
    headline = (
        f"Save ~{ccy}{saving_annualised:,.0f}/yr by moving the "
        f"{ccy}{card.outstanding:,.0f} on your {card.bank} card to "
        f"{target_card.name} (cheaper card, {promo_months}-month promo at "
        f"~{_fmt_pct(cand.effective_bt_apr)})"
    )
    rationale = (
        f"Card-to-card transfer. You'd pay roughly {_fmt_pct(cand.effective_bt_apr)} "
        f"on the new card during the {promo_months}-month promo period vs. "
        f"{_fmt_pct(card_effective)} on your current card. Clear it before the "
        f"promo ends — after that the rate snaps back to roughly "
        f"{_fmt_pct(card_effective)} again. The new-card rate already accounts "
        f"for the {_fmt_pct(fee_pct)} one-time transfer fee spread over the "
        f"promo months."
    )
    if income_type == IncomeType.BUSINESS_OWNER:
        rationale += (
            " Self-employed underwriting: most issuers ask for 2-3 years of "
            "ITR + business proof before approving these card-to-card "
            "transfers; expect a manual review and a higher chance of decline "
            "or partial-limit approval."
        )
    # If the relationship pick differs from the overall winner, surface the
    # alternative so the UI can show a dismissable "even cheaper elsewhere".
    alt_bank = alt_rate = alt_saving = None
    if rel_offer is not None and overall is not None and overall[0].name != target_card.name:
        alt_card, alt_promo, alt_months, alt_fee = overall
        alt_eff = alt_promo + alt_fee / D(alt_months) * D("12") if alt_months else alt_promo
        # Only surface the alternative if it actually beats the chosen target
        # — otherwise the relationship pick is the right answer everywhere.
        if alt_eff < cand.effective_bt_apr:
            alt_bank = alt_card.name
            alt_rate = alt_eff
            alt_saving = _bt_saving_annualised(card, card_effective, alt_eff, alt_months)
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
        alternative_target_bank=alt_bank,
        alternative_target_rate=alt_rate,
        alternative_annual_saving=alt_saving,
        target_is_existing_relationship=rel_offer is not None,
        target_rate_as_of=getattr(target_card, "last_verified", None),
        affected_loan_indices=[card_index],
    )


def _scan_consolidation_opportunity(
    user: User,
    effective_rates: dict[int, Decimal],
    known: set[str],
) -> Optional[RestructuringOpportunity]:
    """Look at unsecured high-rate loans (personal + credit card) and see if
    a single consolidated personal loan at market rate would beat the blended
    average by ≥3pp."""
    unsecured_with_idx = [
        (i, l) for i, l in enumerate(user.loans)
        if l.loan_type in (LoanType.PERSONAL, LoanType.CREDIT_CARD)
    ]
    unsecured = [l for _, l in unsecured_with_idx]
    if len(unsecured) < 2:
        return None
    rel_market = (
        _best_market_rate(user.country, LoanType.PERSONAL, known, user.income_type)
        if known else None
    )
    overall_market = _best_market_rate(
        user.country, LoanType.PERSONAL, known=None, income_type=user.income_type,
    )
    chosen = rel_market or overall_market
    if chosen is None:
        return None
    target_bank, market_low = chosen
    # Assume a 1% processing fee amortised over 3y → 0.0033 added to rate.
    fee_amortised = D("0.0033")
    cand = scan_consolidation(unsecured, effective_rates, market_low, fee_amortised)
    if cand is None:
        return None
    total = sum((l.outstanding for l in cand.loans), D("0"))
    saving = (cand.blended_avg_rate - cand.consolidated_rate) * total
    ccy = "₹" if user.country == Country.IN else "$"
    headline = (
        f"Save ~{ccy}{saving:,.0f}/yr by combining your {len(cand.loans)} "
        f"unsecured loans into one personal loan with {target_bank} at "
        f"~{_fmt_pct(cand.consolidated_rate)}"
    )
    rationale = (
        f"Right now your {len(cand.loans)} unsecured loans cost a blended "
        f"{_fmt_pct(cand.blended_avg_rate)} per year on average. Rolling them "
        f"into a single personal loan at {_fmt_pct(cand.consolidated_rate)} "
        f"cuts that to one rate, one EMI, one due date — and saves about "
        f"{_fmt_pct(cand.blended_avg_rate - cand.consolidated_rate)} per year "
        f"on the combined balance."
    )
    if user.income_type == IncomeType.BUSINESS_OWNER:
        rationale += (
            " As a business owner the quoted rate is the mid-of-band — your "
            "actual offer depends on 3 years of ITR + GST returns + bank-"
            "statement review. Bring documentation up front to avoid re-pricing."
        )
    alt_bank = alt_rate = alt_saving = None
    if (
        rel_market is not None
        and overall_market is not None
        and overall_market[0] != target_bank
        and overall_market[1] < market_low
    ):
        alt_bank_raw, alt_displayed = overall_market
        alt_rate_consolidated = alt_displayed * (D("1") + fee_amortised)
        if alt_rate_consolidated < cand.consolidated_rate:
            alt_bank = alt_bank_raw
            alt_rate = alt_rate_consolidated
            alt_saving = (cand.blended_avg_rate - alt_rate_consolidated) * total
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
        alternative_target_bank=alt_bank,
        alternative_target_rate=alt_rate,
        alternative_annual_saving=alt_saving,
        target_is_existing_relationship=rel_market is not None,
        target_rate_as_of=_latest_verified(user.country),
        affected_loan_indices=[
            # Identity check, not value-equality: two unsecured loans with the
            # same bank / type / outstanding would compare equal under the
            # default dataclass __eq__, and we'd flag the wrong index for the
            # update-restructure modal. scan_consolidation returns the same
            # Loan object references it received, so `is` is the safe match.
            i for i, l in unsecured_with_idx
            if any(l is cl for cl in cand.loans)
        ],
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


def _scan_refi_opportunity(
    loan: Loan,
    loan_index: int,
    country: Country,
    known: set[str],
    income_type: Optional[IncomeType] = None,
) -> Optional[RestructuringOpportunity]:
    median = market_median(country, loan.loan_type)
    if median is None:
        return None
    # Assume refi costs = 1% of outstanding (processing fee + legal).
    refi_costs = loan.outstanding * D("0.01")
    rel_market = (
        _best_market_rate(country, loan.loan_type, known, income_type)
        if known else None
    )
    overall_market = _best_market_rate(country, loan.loan_type, known=None, income_type=income_type)
    chosen = rel_market or overall_market
    target_bank = chosen[0] if chosen else None
    new_rate = chosen[1] if chosen else median
    interest_saved = _refi_interest_saved(loan, new_rate)
    cand = scan_refinance(loan, median, interest_saved, refi_costs)
    if cand is None:
        return None
    annual_saving = (loan.nominal_rate - new_rate) * loan.outstanding
    ccy = "₹" if country == Country.IN else "$"
    net_savings = max(D("0"), interest_saved - refi_costs)
    headline = (
        f"Save ~{ccy}{net_savings:,.0f} over the life of the loan by replacing "
        f"your {loan.bank} {loan.loan_type.value.replace('_', ' ')} with a "
        f"cheaper one from {target_bank or 'market median'} "
        f"(~{_fmt_pct(new_rate)})"
    )
    rationale = (
        f"You're paying {_fmt_pct(loan.nominal_rate)}, which is "
        f"{_fmt_pct(loan.nominal_rate - median)} above what most banks now "
        f"quote ({_fmt_pct(median)}). Switching the loan over saves roughly "
        f"{ccy}{interest_saved:,.0f} in interest across the remaining tenure, "
        f"minus about {ccy}{refi_costs:,.0f} in processing and switching fees "
        f"— a net win of about {ccy}{net_savings:,.0f}."
    )
    if income_type == IncomeType.BUSINESS_OWNER and loan.loan_type not in _COLLATERAL_BACKED:
        rationale += (
            " Self-employed underwriting widens the range — bring 3 years of "
            "ITR + business proof to argue for the lower end."
        )
    alt_bank = alt_rate = alt_saving = None
    if (
        rel_market is not None
        and overall_market is not None
        and overall_market[0] != target_bank
        and overall_market[1] < new_rate
    ):
        alt_bank, alt_rate = overall_market
        alt_saving = (loan.nominal_rate - alt_rate) * loan.outstanding
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
        alternative_target_bank=alt_bank,
        alternative_target_rate=alt_rate,
        alternative_annual_saving=alt_saving,
        target_is_existing_relationship=rel_market is not None,
        target_rate_as_of=_latest_verified(country),
        affected_loan_indices=[loan_index],
    )


def _latest_verified(country: Country) -> Optional[str]:
    """Most-recent `last_verified` across the country's rate cards. Used
    by every opportunity that draws from rate-card data so the UI can
    surface a single 'rates as of {date}' tag without per-bank lookups."""
    from engine.rate_cards import _country_cards  # local to avoid cycle
    latest = ""
    for card in _country_cards(country):
        if card.last_verified and card.last_verified > latest:
            latest = card.last_verified
    return latest or None


def scan_all(user: User, marginal_rate: Decimal = D("0")) -> list[RestructuringOpportunity]:
    """Run every Layer 1 scan on the user's loan book. Returns opportunities
    sorted by estimated annual saving, descending."""
    rates = {
        id(l): effective_rate(l, marginal_rate, user.country, user.tax_regime)
        for l in user.loans
    }
    known = _known_banks(user)
    out: list[RestructuringOpportunity] = []

    for i, l in enumerate(user.loans):
        if l.loan_type == LoanType.CREDIT_CARD:
            opp = _scan_card_balance_transfer(
                l, i, rates[id(l)], user.country, known, user.income_type,
            )
            if opp is not None:
                out.append(opp)

    consol = _scan_consolidation_opportunity(user, rates, known)
    if consol is not None:
        out.append(consol)

    # Refi candidates: collateral-backed (home/auto) plus unsecured personal
    # and education loans. Credit cards use the BT pathway above; gold/BNPL
    # don't have refi markets worth modelling.
    #
    # Personal loans also flow through consolidation when there are ≥2 of
    # them. We let both opportunities surface — they're different actions
    # (one cheaper bank vs. merge into one EMI). Estimated saving sorts the
    # list so the bigger win lands on top.
    for i, l in enumerate(user.loans):
        if l.loan_type in (
            LoanType.HOME,
            LoanType.AUTO,
            LoanType.PERSONAL,
            LoanType.EDUCATION,
        ):
            opp = _scan_refi_opportunity(l, i, user.country, known, user.income_type)
            if opp is not None:
                out.append(opp)

    out.sort(key=lambda o: o.estimated_annual_saving, reverse=True)
    return out
