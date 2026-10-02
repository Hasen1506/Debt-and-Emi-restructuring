"""Layer 1 restructuring scanner — composes scan_balance_transfer /
scan_consolidation / scan_refinance from engine.restructuring against the
institution rate cards in engine.rate_cards, so the caller only has to pass
a User + marginal rate.

Returns a flat list of opportunities, each with a one-line rationale ready
to render in the UI and three figures measured the same way for every kind:

  • one_time_cost           the fee or switching cost paid up front
  • breakeven_months        months of lower interest it takes to earn that back
  • estimated_annual_saving interest saved in the first 12 months, minus the
                            one-time cost (a balance-transfer promo shorter
                            than a year saves only during the promo)

Refinance also carries `lifetime_net_saving` (the rest of the loan, less
costs), which is what its headline leads with.
"""
from __future__ import annotations

import math
from dataclasses import dataclass, field
from decimal import Decimal
from typing import Literal, Optional

from engine.formulas import effective_rate, emi
from engine.lenders import resolve as resolve_lender
from engine.models import Country, IncomeType, Loan, LoanType, User
from engine.surplus import loan_currency_or_default, to_user_currency
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
    # Fee or switching cost paid up front, in the user's currency.
    one_time_cost: Decimal = D("0")
    # Months of lower interest needed to earn back `one_time_cost`.
    breakeven_months: Optional[int] = None
    # Refinance only: interest saved over the rest of the loan, less costs.
    lifetime_net_saving: Optional[Decimal] = None


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


def _same_bank(a: Optional[str], b: Optional[str], country: Country) -> bool:
    """True when two typed names are the same bank ("HDFC" = "HDFC Bank Ltd.")."""
    if not a or not b:
        return False
    la, lb = resolve_lender(a, country), resolve_lender(b, country)
    if la is not None and lb is not None:
        return la.id == lb.id
    def key(x: str) -> str:
        return x.strip().lower().removesuffix(" ltd.").removesuffix(" ltd").removesuffix(" bank")
    return key(a) == key(b)


def _best_bt_offer(
    country: Country,
    known: Optional[set[str]] = None,
    income_type: Optional[IncomeType] = None,
    exclude_bank: Optional[str] = None,
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

    `exclude_bank` is the card's own issuer: banks don't take a balance
    transfer from their own card, so it is never the target.
    """
    best = None
    best_eff = None
    for card in _country_pool(country):
        cc = card.credit_card
        if cc is None or cc.bt_promo_rate is None or not cc.bt_promo_months:
            continue
        if known is not None and card.name.strip().lower() not in known:
            continue
        if _same_bank(card.name, exclude_bank, country):
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


def _breakeven_months(one_time_cost: Decimal, yearly_gross_saving: Decimal) -> Optional[int]:
    """Whole months of the lower rate needed to earn back the up-front cost."""
    if yearly_gross_saving <= 0:
        return None
    if one_time_cost <= 0:
        return 0
    return max(1, math.ceil(one_time_cost * D("12") / yearly_gross_saving))


def _first_year_saving(yearly_gross_saving: Decimal, one_time_cost: Decimal) -> Decimal:
    return yearly_gross_saving - one_time_cost


def _bt_saving_annualised(
    card: Loan, card_effective: Decimal, effective_bt_apr: Decimal, promo_months: int,
) -> Decimal:
    """Saving in the first 12 months, net of the transfer fee.

    `effective_bt_apr` already spreads the fee over the promo, so
    (current − bt_effective) × outstanding × promo/12 equals the interest
    saved during the promo minus the fee. After the promo the rate goes
    back to roughly today's, so nothing more is saved in that year."""
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
    rel_offer = _best_bt_offer(country, known, income_type, card.bank) if known else None
    overall = _best_bt_offer(country, known=None, income_type=income_type, exclude_bank=card.bank)
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
    bt_cost = fee_pct * card.outstanding
    bt_breakeven = _breakeven_months(bt_cost, (card_effective - promo_rate) * card.outstanding)
    headline = (
        f"Save ~{ccy}{saving_annualised:,.0f} in the first year by moving the "
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
        f"promo months. This rate-comparison estimate holds today's balance constant; "
        f"paying the card down during the promo reduces the saving."
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
        one_time_cost=bt_cost,
        breakeven_months=bt_breakeven,
    )


def _scan_consolidation_opportunity(
    user: User,
    effective_rates: dict[int, Decimal],
    known: set[str],
    currency: Optional[str] = None,
) -> Optional[RestructuringOpportunity]:
    """Look at unsecured high-rate loans (personal + credit card) and see if
    a single consolidated personal loan at market rate would beat the blended
    average by ≥3pp. Only loans in one currency (`currency`, default the
    user's) are merged, with a lender from that currency's market: a rupee
    card and a dollar loan can't become one loan."""
    currency = currency or _residence_currency(user)
    market = _market_for(currency)
    unsecured_with_idx = [
        (i, l) for i, l in enumerate(user.loans)
        if l.loan_type in (LoanType.PERSONAL, LoanType.CREDIT_CARD)
        and loan_currency_or_default(l, user) == currency
    ]
    unsecured = [l for _, l in unsecured_with_idx]
    if len(unsecured) < 2:
        return None
    rel_market = (
        _best_market_rate(market, LoanType.PERSONAL, known, user.income_type)
        if known else None
    )
    overall_market = _best_market_rate(
        market, LoanType.PERSONAL, known=None, income_type=user.income_type,
    )
    chosen = rel_market or overall_market
    if chosen is None:
        return None
    target_bank, market_low = chosen
    # Assume a 1% processing fee. The scan's hurdle spreads it over a 3-year
    # loan (0.33 points added to the rate); the saving and pay-back charge
    # the whole fee up front.
    fee_pct = D("0.01")
    fee_amortised = D("0.0033")
    cand = scan_consolidation(unsecured, effective_rates, market_low, fee_amortised)
    if cand is None:
        return None
    total = sum((l.outstanding for l in cand.loans), D("0"))
    consol_cost = fee_pct * total
    gross = (cand.blended_avg_rate - market_low) * total
    saving = _first_year_saving(gross, consol_cost)
    ccy = "₹" if market == Country.IN else "$"
    headline = (
        f"Save ~{ccy}{saving:,.0f} in the first year by combining your {len(cand.loans)} "
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
        alt_rate_consolidated = alt_displayed + fee_amortised
        if alt_rate_consolidated < cand.consolidated_rate:
            alt_bank = alt_bank_raw
            alt_rate = alt_rate_consolidated
            alt_saving = _first_year_saving(
                (cand.blended_avg_rate - alt_displayed) * total, consol_cost,
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
        alternative_target_bank=alt_bank,
        alternative_target_rate=alt_rate,
        alternative_annual_saving=alt_saving,
        target_is_existing_relationship=rel_market is not None,
        target_rate_as_of=_latest_verified(market),
        one_time_cost=consol_cost,
        breakeven_months=_breakeven_months(consol_cost, gross),
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
    gross = (loan.nominal_rate - new_rate) * loan.outstanding
    annual_saving = _first_year_saving(gross, refi_costs)
    ccy = "₹" if country == Country.IN else "$"
    net_savings = max(D("0"), interest_saved - refi_costs)
    kind_label = loan.loan_type.value.replace('_', ' ')
    if _same_bank(target_bank, loan.bank, country):
        # Moving to the same bank is a rate reset, not a switch: ask the
        # bank to move the loan to the rate it offers new borrowers.
        action = (
            f"asking {loan.bank} to move your {kind_label} to the rate it "
            f"offers new borrowers (~{_fmt_pct(new_rate)})"
        )
    else:
        action = (
            f"replacing your {loan.bank} {kind_label} with a cheaper one "
            f"from {target_bank or 'another lender'} (~{_fmt_pct(new_rate)})"
        )
    headline = (
        f"Save ~{ccy}{net_savings:,.0f} over the rest of the loan "
        f"(~{ccy}{annual_saving:,.0f} in the first year) by {action}"
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
    if (
        country == Country.IN
        and loan.loan_type == LoanType.HOME
        and loan.rate_type == "floating"
    ):
        rationale += (
            " Run Loan Check first: part of this gap may be repo-rate cuts "
            "the bank should already have passed on, which cost nothing to claim."
        )
    alt_bank = alt_rate = alt_saving = None
    if (
        rel_market is not None
        and overall_market is not None
        and overall_market[0] != target_bank
        and overall_market[1] < new_rate
    ):
        alt_bank, alt_rate = overall_market
        alt_saving = _first_year_saving(
            (loan.nominal_rate - alt_rate) * loan.outstanding, refi_costs,
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
        alternative_target_bank=alt_bank,
        alternative_target_rate=alt_rate,
        alternative_annual_saving=alt_saving,
        target_is_existing_relationship=rel_market is not None,
        target_rate_as_of=_latest_verified(country),
        affected_loan_indices=[loan_index],
        one_time_cost=refi_costs,
        breakeven_months=_breakeven_months(refi_costs, gross),
        lifetime_net_saving=net_savings,
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


def _residence_currency(user: User) -> str:
    return "INR" if user.country == Country.IN else "USD"


def _market_for(currency: str) -> Country:
    """Where a loan in this currency can be moved: an NRI's rupee home loan
    goes to an Indian lender, never to a US one."""
    return Country.IN if currency == "INR" else Country.US


def _in_user_currency(
    opp: RestructuringOpportunity, loan: Loan, user: User,
) -> RestructuringOpportunity:
    """Money fields in the user's currency, so savings sort and add up
    across loans. The headline keeps the loan's own currency (it names the
    loan)."""
    if loan_currency_or_default(loan, user) == _residence_currency(user):
        return opp
    fx = lambda v: None if v is None else to_user_currency(v, loan, user)  # noqa: E731
    opp.estimated_annual_saving = fx(opp.estimated_annual_saving)
    opp.alternative_annual_saving = fx(opp.alternative_annual_saving)
    opp.one_time_cost = fx(opp.one_time_cost)
    opp.lifetime_net_saving = fx(opp.lifetime_net_saving)
    return opp


def scan_all(user: User, marginal_rate: Decimal = D("0")) -> list[RestructuringOpportunity]:
    """Run every Layer 1 scan on the user's loan book. Returns opportunities
    sorted by estimated annual saving, descending."""
    rates = {
        id(l): effective_rate(l, marginal_rate, user.country, user.tax_regime, user.itemises, user.itemised_share)
        for l in user.loans
    }
    known = _known_banks(user)
    out: list[RestructuringOpportunity] = []

    # Each loan is matched with lenders in its own currency's market.
    def market(l: Loan) -> Country:
        return _market_for(loan_currency_or_default(l, user))

    for i, l in enumerate(user.loans):
        if l.loan_type == LoanType.CREDIT_CARD:
            opp = _scan_card_balance_transfer(
                l, i, rates[id(l)], market(l), known, user.income_type,
            )
            if opp is not None:
                out.append(_in_user_currency(opp, l, user))

    for ccy in sorted({loan_currency_or_default(l, user) for l in user.loans}):
        consol = _scan_consolidation_opportunity(user, rates, known, ccy)
        if consol is not None:
            first = user.loans[consol.affected_loan_indices[0]]
            out.append(_in_user_currency(consol, first, user))

    # Refi candidates: home and auto loans (`scan_refinance` accepts only
    # those). Personal loans are covered by consolidation above; cards by
    # the balance transfer. Estimated saving sorts the list so the bigger
    # win lands on top.
    for i, l in enumerate(user.loans):
        if l.loan_type in (LoanType.HOME, LoanType.AUTO):
            opp = _scan_refi_opportunity(l, i, market(l), known, user.income_type)
            if opp is not None:
                out.append(_in_user_currency(opp, l, user))

    out.sort(key=lambda o: o.estimated_annual_saving, reverse=True)
    return out
