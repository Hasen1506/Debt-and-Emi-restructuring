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
from copy import deepcopy
from dataclasses import dataclass, field
from decimal import Decimal
from typing import Callable, Literal, Optional

from engine.marginal_cost import compounded, user_forward_rates
from engine.formulas import emi
from engine.lenders import resolve as resolve_lender
from engine.loan_check import _inr
from engine.models import Country, IncomeType, Loan, LoanType, User
from engine.surplus import from_user_currency, loan_currency_or_default, to_user_currency
from engine.rate_cards import (
    ALL_INSTITUTIONS, INDIA_TIER_A, USA_TIER_A,
    InstitutionRateCard, RateRange, market_median,
)


# Loan types where collateral drives pricing — banks don't widen the band much
# for self-employed because the asset itself anchors underwriting. Personal
# loan / credit-card / BT promo rates, by contrast, key off income-proof and
# CIBIL/FICO, so the realistic SE offer sits near the middle of the band.
_COLLATERAL_BACKED = {LoanType.HOME, LoanType.AUTO}


def _displayed_rate_for(
    r: RateRange, loan_type: LoanType, income_type: Optional[IncomeType],
    fit: Optional[str] = None,
) -> Decimal:
    """The rate a move is costed at: the middle of the bank's published
    range, for everyone.

    Audit 80+ E1 (14 Oct 2026): this used to return the floor (`r.low`) for
    salaried users, so Home's "Cheaper rates" offered a three-card revolver
    with ₹400 a month spare HDFC's 9.99% (the floor of 9.99–24.00%) and a
    US user Wells Fargo's 6.74% (floor of 6.74–23.99%) as if they were
    theirs. The floor goes to the strongest applicants; New Debt Check
    already ranks "at the middle of each range". The range itself is
    carried in each opportunity's detail (range_low / range_high, and the
    first-year saving at each end) so the screen shows where the user
    could land instead of promising the best case. `income_type` and `fit`
    are kept for callers; neither moves the rate below the middle."""
    return r.median


# The credit score a lender looks for, by the bureaus' own bands (see
# engine.credit_score): CIBIL and FICO both start "very good" at 740-750,
# where lenders keep their advertised best rates. Below the floor an
# unsecured application (a card transfer, a personal loan) is often
# declined; a loan against a house or car is judged on the asset as well,
# so its floor is lower.
_SCORE_BEST = {Country.IN: 750, Country.US: 740}
_SCORE_FLOOR = {
    (Country.IN, False): 700, (Country.IN, True): 650,
    (Country.US, False): 670, (Country.US, True): 620,
}

CreditFit = Literal["best", "higher", "unlikely", "unknown"]


def credit_fit(score: Optional[int], country: Country, secured: bool) -> CreditFit:
    """Where the user's score (from Profile; None when not given) sits
    against what a lender wants for this kind of credit."""
    if not score:
        return "unknown"
    if score >= _SCORE_BEST[country]:
        return "best"
    if score >= _SCORE_FLOOR[(country, secured)]:
        return "higher"
    return "unlikely"
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
    # Where the user's credit score sits against what the lender wants
    # (credit_fit), and the score its best rate usually goes to.
    credit_fit: str = "unknown"
    score_needed: Optional[int] = None
    # "plan": the saving is worked out on the balances the user's plan
    # leaves each month; "today": on today's balances held for the year.
    saving_basis: str = "today"
    # Months until the plan clears every loan this move is about, when it
    # does so within the year.
    plan_clears_in_months: Optional[int] = None
    # Yearly rate saved before fees, and the months it is saved for (a
    # transfer promo shorter than a year saves only during the promo).
    rate_gap: Decimal = D("0")
    saving_window: int = 12
    # Rebuilds the headline after the saving changes (see fit_to_plan).
    retitle: Optional[Callable[["RestructuringOpportunity"], str]] = field(
        default=None, repr=False, compare=False,
    )
    # Rebuild detailed money claims after fitting the opportunity to a plan.
    explain: Optional[Callable[["RestructuringOpportunity"], str]] = field(
        default=None, repr=False, compare=False,
    )


@dataclass
class HeldBack:
    """A move the scan found but doesn't recommend, and why: the user's
    credit score is below what lenders take, or the plan clears the debt
    before the move would pay for itself."""
    kind: RecommendationKind
    affected_loan_indices: list[int]
    target_bank: Optional[str]
    reason: Literal["credit_score", "plan_clears", "costs_more", "federal_protections"]
    note: str


@dataclass
class ScanResult:
    opportunities: list[RestructuringOpportunity]
    held_back: list[HeldBack]


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


def _range_of(bank: Optional[str], loan_type: LoanType, country: Country) -> Optional[RateRange]:
    """The published range of `bank`'s `loan_type` among the Tier-A cards."""
    for card in _country_pool(country):
        if card.name == bank:
            return {
                LoanType.HOME: card.home_loan, LoanType.AUTO: card.auto_loan,
                LoanType.PERSONAL: card.personal_loan, LoanType.EDUCATION: card.education_loan,
            }.get(loan_type)
    return None


def _best_market_rate(
    country: Country,
    loan_type: LoanType,
    known: Optional[set[str]] = None,
    income_type: Optional[IncomeType] = None,
    fit: Optional[str] = None,
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
        displayed = _displayed_rate_for(r, loan_type, income_type, fit)
        if best_rate is None or displayed < best_rate:
            best_rate = displayed
            best_bank = card.name
    if best_rate is None:
        return None
    return best_bank, best_rate


def _fmt_pct(d: Decimal) -> str:
    return f"{(d * D('100')):.2f}%"


def _pct_short(d: Decimal) -> str:
    """'0%', '1.5%': a rate as a bank prints it."""
    return _fmt_pct(d).rstrip("%").rstrip("0").rstrip(".") + "%"


def _money(amount: Decimal, ccy: str) -> str:
    """'₹5,00,000' in Indian grouping, '$12,000' otherwise."""
    if ccy == "₹":
        return _inr(amount)
    return f"{ccy}{amount:,.0f}"


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
    fit: CreditFit = "unknown",
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
    card_name = f"{card.bank} card" if card.bank else "card"
    # The card's rate as its row on Home shows it: what it costs a year,
    # compounded monthly (with GST on an Indian card). The saving above is
    # worked on the monthly charge, the balance held constant.
    card_cost = compounded(card_effective)

    def title(o: RestructuringOpportunity) -> str:
        return (
            f"Save ~{_money(o.estimated_annual_saving, ccy)} in the first year by moving the "
            f"{_money(card.outstanding, ccy)} on your {card_name} to "
            f"{target_card.name} ({_pct_short(promo_rate)} for {promo_months} months"
            f"{f' plus a {_pct_short(fee_pct)} fee' if fee_pct > 0 else ''})"
        )
    rationale = (
        f"Card-to-card transfer. You'd pay roughly {_fmt_pct(cand.effective_bt_apr)} "
        f"on the new card during the {promo_months}-month promo period vs. "
        f"{_fmt_pct(card_cost)} a year on your current card. Clear it before the "
        f"promo ends — after that the rate snaps back to roughly "
        f"{_fmt_pct(card_cost)} again. The new-card rate already accounts "
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
    rationale += _score_note(fit, country, secured=False, transfer=True)
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
    opp = RestructuringOpportunity(
        kind="balance_transfer",
        headline="",
        rationale=rationale,
        estimated_annual_saving=saving_annualised,
        affected_loan_banks=[card.bank],
        target_bank=target_card.name,
        target_rate=cand.effective_bt_apr,
        current_rate=card_cost,  # as the card's Home row shows it
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
        credit_fit=fit,
        score_needed=_SCORE_BEST[country],
        rate_gap=card_effective - promo_rate,
        saving_window=min(promo_months, 12),
        retitle=title,
    )
    opp.headline = title(opp)
    return opp


def _scan_consolidation_opportunity(
    user: User,
    effective_rates: dict[int, Decimal],
    known: set[str],
    currency: Optional[str] = None,
    fit: CreditFit = "unknown",
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
        and l.outstanding > 0
        and loan_currency_or_default(l, user) == currency
    ]
    unsecured = [l for _, l in unsecured_with_idx]
    if len(unsecured) < 2:
        return None
    rel_market = (
        _best_market_rate(market, LoanType.PERSONAL, known, user.income_type, fit)
        if known else None
    )
    overall_market = _best_market_rate(
        market, LoanType.PERSONAL, known=None, income_type=user.income_type, fit=fit,
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
    def title(o: RestructuringOpportunity) -> str:
        return (
            f"Save ~{_money(o.estimated_annual_saving, ccy)} in the first year by combining your {len(cand.loans)} "
            f"unsecured loans into one personal loan with {target_bank} at "
            f"~{_fmt_pct(market_low)}"
        )
    def explain(o: RestructuringOpportunity) -> str:
        basis = "Using your plan's payments" if o.saving_basis == "plan" else "Holding today's balances constant"
        return (
            f"{basis}, combining these loans at {_fmt_pct(market_low)} saves about "
            f"{_money(o.estimated_annual_saving, ccy)} in the first year, after "
            f"the {_money(o.one_time_cost, ccy)} up-front fee. "
            "This assumes a 36-month fixed-rate loan; the quoted rate and fee are counted separately."
            + _score_note(fit, market, secured=False)
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
            alt_rate = alt_displayed
            alt_saving = _first_year_saving(
                (cand.blended_avg_rate - alt_displayed) * total, consol_cost,
            )
    opp = RestructuringOpportunity(
        kind="consolidation",
        headline="",
        rationale="",
        estimated_annual_saving=saving,
        affected_loan_banks=[l.bank for l in cand.loans],
        target_bank=target_bank,
        target_rate=market_low,
        current_rate=cand.blended_avg_rate,
        detail={
            "total_balance": str(total),
            "blended_avg_rate": str(cand.blended_avg_rate),
            "consolidated_rate": str(market_low),
            "tenure_months": "36",
            "nominal_rate": str(market_low),
            "loan_count": str(len(cand.loans)),
            **_range_detail(
                _range_of(target_bank, LoanType.PERSONAL, market),
                lambda r: _first_year_saving((cand.blended_avg_rate - r) * total, consol_cost),
            ),
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
        credit_fit=fit,
        score_needed=_SCORE_BEST[market],
        rate_gap=cand.blended_avg_rate - market_low,
        retitle=title,
        explain=explain,
    )
    opp.headline = title(opp)
    opp.rationale = explain(opp)
    return opp


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
    fit: CreditFit = "unknown",
) -> Optional[RestructuringOpportunity]:
    median = market_median(country, loan.loan_type)
    if median is None:
        return None
    # Assume refi costs = 1% of outstanding (processing fee + legal).
    refi_costs = loan.outstanding * D("0.01")
    rel_market = (
        _best_market_rate(country, loan.loan_type, known, income_type, fit)
        if known else None
    )
    overall_market = _best_market_rate(
        country, loan.loan_type, known=None, income_type=income_type, fit=fit,
    )
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
    def title(o: RestructuringOpportunity) -> str:
        if o.lifetime_net_saving is None:
            return f"Save ~{_money(o.estimated_annual_saving, ccy)} in the first year by {action}"
        return (
            f"Save ~{_money((o.lifetime_net_saving or D('0')), ccy)} over the rest of the loan "
            f"(~{_money(o.estimated_annual_saving, ccy)} in the first year) by {action}"
        )
    def explain(o: RestructuringOpportunity) -> str:
        saving = o.lifetime_net_saving
        period = "over your plan's remaining payments" if o.saving_basis == "plan" else "across the remaining tenure"
        amount = (
            f"a net saving of about {_money(saving, ccy)} {period}"
            if saving is not None else
            f"about {_money(o.estimated_annual_saving, ccy)} net in the first year"
        )
        return (
            f"Moving from {_fmt_pct(loan.nominal_rate)} to {_fmt_pct(new_rate)} gives {amount}, "
            f"after {_money(o.one_time_cost, ccy)} in up-front fees. "
            f"The first-year net saving is {_money(o.estimated_annual_saving, ccy)}."
            + (" Run Loan Check first: rate cuts the bank should already have passed on may cost nothing to claim."
               if country == Country.IN and loan.loan_type == LoanType.HOME and loan.rate_type == "floating" else "")
            + _score_note(fit, country, secured=True)
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
    opp = RestructuringOpportunity(
        kind="refinance",
        headline="",
        rationale="",
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
            **_range_detail(
                _range_of(target_bank, loan.loan_type, country),
                lambda r: _first_year_saving((loan.nominal_rate - r) * loan.outstanding, refi_costs),
            ),
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
        credit_fit=fit,
        score_needed=_SCORE_BEST[country],
        rate_gap=loan.nominal_rate - new_rate,
        retitle=title,
        explain=explain,
    )
    opp.headline = title(opp)
    opp.rationale = explain(opp)
    return opp


def _range_detail(r: Optional[RateRange], first_year: Callable[[Decimal], Decimal]) -> dict[str, str]:
    """E1: the bank's published range and the first-year saving at each end,
    for the "₹22k–₹62k depending on your score" line. Empty when the bank
    has no range on record."""
    if r is None:
        return {}
    return {
        "range_low": str(r.low),
        "range_high": str(r.high),
        "saving_at_range_low": str(first_year(r.low)),
        "saving_at_range_high": str(first_year(r.high)),
    }


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


_MOVE = {
    "balance_transfer": "balance transfer",
    "consolidation": "consolidation loan",
    "refinance": "refinance",
}

# The balance-transfer rationale's closing line when the saving is worked
# out on today's balance; fit_to_plan swaps it for the plan's.
_TODAY_LINE = (
    "This rate-comparison estimate holds today's balance constant; "
    "paying the card down during the promo reduces the saving."
)
_PLAN_LINE = "This uses the balance your plan leaves on the card each month."


def _score_note(fit: CreditFit, country: Country, secured: bool, transfer: bool = False) -> str:
    """One sentence on what the user's credit score means for the offer."""
    best = _SCORE_BEST[country]
    if fit == "best":
        return (
            " Your credit score is in the range lenders keep their best rates for, so you "
            "may be quoted below the middle of the bank's range used here."
        )
    if fit == "higher":
        if transfer:
            return (
                " At your credit score the bank may approve a smaller limit or "
                "decline; ask before you apply."
            )
        return (
            " At your credit score lenders usually quote above their best rate, "
            "so this uses the middle of the bank's range."
        )
    if fit == "unknown":
        return (
            f" This uses the middle of the bank's range: lenders keep their best rates for "
            f"credit scores of {best} and up; add yours in Profile to see whether it fits."
        )
    return ""


def _ccy_symbol(country: Country) -> str:
    return "₹" if country == Country.IN else "$"


def fit_to_plan(
    opp: RestructuringOpportunity,
    user: User,
    plan_balances: dict[int, list[Decimal]],
    country: Country,
) -> Optional[HeldBack]:
    """Work the saving out on the balances the user's plan leaves each
    month (`plan_balances[i]` is loan i's balance at the end of months
    1, 2, …), not on today's balance held for a year.

    A plan that clears a ₹80,000 card next month leaves almost nothing for
    a transfer to save, so the move is held back when the plan clears the
    debt within two months (a transfer or a new loan takes a week or more
    to go through) or when the fee costs more than it saves. Otherwise the
    saving, pay-back and headline are rewritten in place. Returns the
    HeldBack, or None when the opportunity stands."""
    idx = opp.affected_loan_indices
    if not idx or any(not plan_balances.get(i) for i in idx):
        return None
    paths = [plan_balances[i] for i in idx]
    start = [user.loans[i].outstanding for i in idx]

    def closing(m: int) -> Decimal:
        # After the path ends (debt-free, or the horizon) the last value holds.
        return sum((p[min(m, len(p)) - 1] for p in paths), D("0"))

    def opening(m: int) -> Decimal:
        return sum(start, D("0")) if m == 1 else closing(m - 1)

    horizon = max(len(p) for p in paths)
    clears = next((m for m in range(1, horizon + 1) if closing(m) <= D("1")), None)
    monthly = opp.rate_gap / D("12")

    _fwd0 = user_forward_rates(user.loans, user, D("0"))

    def month_saving(m: int, target: Decimal = opp.target_rate) -> Decimal:
        if opp.kind != "consolidation":
            return monthly * opening(m)
        # A card can clear before a cheaper personal loan. Its opening
        # share of the blended rate must not survive against that loan.
        return sum((
            (_fwd0[id(user.loans[i])] - target)
            * (user.loans[i].outstanding if m == 1 else
               plan_balances[i][min(m - 1, len(plan_balances[i])) - 1]) / D("12")
            for i in idx
        ), D("0"))

    gross = sum((month_saving(m) for m in range(1, opp.saving_window + 1)), D("0"))
    cost = opp.one_time_cost
    saving = gross - cost
    ccy = _ccy_symbol(country)
    move = _MOVE[opp.kind]
    if clears is not None and clears <= 2:
        # Month 1 of the plan is the current month.
        when = "this month" if clears == 1 else "by next month"
        return HeldBack(
            kind=opp.kind, affected_loan_indices=idx, target_bank=opp.target_bank,
            reason="plan_clears",
            note=(
                f"Your plan pays this off {when}, before a {move} would go "
                f"through and earn back its {_money(cost, ccy)} fee."
            ),
        )
    if saving <= 0:
        return HeldBack(
            kind=opp.kind, affected_loan_indices=idx, target_bank=opp.target_bank,
            reason="costs_more",
            note=(
                f"With your plan's payments a {move} saves about {_money(gross, ccy)} "
                f"in interest, less than its {_money(cost, ccy)} fee."
            ),
        )

    today_gross = monthly * sum(start, D("0")) * D(opp.saving_window)
    if opp.kind == "consolidation" and opp.alternative_target_rate is not None:
        alternative = sum((month_saving(m, opp.alternative_target_rate)
                           for m in range(1, opp.saving_window + 1)), D("0")) - cost
        opp.alternative_annual_saving = alternative if alternative > saving else None
        if opp.alternative_annual_saving is None:
            opp.alternative_target_bank = None
            opp.alternative_target_rate = None
    elif opp.alternative_annual_saving is not None and today_gross > 0:
        # The alternative's extra saving shrinks with the balance the same way.
        extra = (opp.alternative_annual_saving - opp.estimated_annual_saving) * gross / today_gross
        if extra > 0:
            opp.alternative_annual_saving = saving + extra
        else:
            opp.alternative_target_bank = None
            opp.alternative_target_rate = None
            opp.alternative_annual_saving = None
    opp.estimated_annual_saving = saving
    opp.saving_basis = "plan"
    opp.plan_clears_in_months = clears if clears is not None and clears <= 12 else None
    if cost > 0:
        earned = D("0")
        opp.breakeven_months = None
        for m in range(1, horizon + 1):
            earned += month_saving(m)
            if earned >= cost:
                opp.breakeven_months = m
                break
    if opp.kind == "refinance" and clears is not None:
        whole = sum((monthly * opening(m) for m in range(1, clears + 1)), D("0"))
        opp.lifetime_net_saving = max(D("0"), whole - cost)
    opp.rationale = opp.rationale.replace(_TODAY_LINE, _PLAN_LINE)
    if opp.explain is not None:
        opp.rationale = opp.explain(opp)
    if opp.retitle is not None:
        opp.headline = opp.retitle(opp)
    return None


def _fit_repayment_comparison(opp, user, baseline, options, country) -> Optional[HeldBack]:
    """Compare replacement loans with the same plan, not a frozen rate mix.

    Fees are paid up front, separately from the quoted nominal APR. Loan
    positions stay stable so goals, reinvestments and unrelated rate events
    keep referring to the same debts.
    """
    from engine.simulation import simulate_plan
    from engine.models import LifecycleEventKind

    idx = opp.affected_loan_indices
    original = user.loans[idx[0]]
    cost = opp.one_time_cost

    def replacement(rate, bank):
        changed = deepcopy(user)
        kwargs = deepcopy(options)
        loan = changed.loans[idx[0]]
        if opp.kind == "consolidation":
            total = sum((user.loans[i].outstanding for i in idx), D("0"))
            changed.loans[idx[0]] = Loan(
                loan_type=LoanType.PERSONAL, bank=bank or "", outstanding=total,
                nominal_rate=rate, rate_type="fixed", tenure_months_remaining=36,
                scheduled_emi=emi(total, rate, 36), currency=original.currency,
            )
            for i in idx[1:]:
                changed.loans[i].outstanding = D("0")
                changed.loans[i].scheduled_emi = D("0")
        else:
            loan.nominal_rate = rate
            loan.bank = bank or loan.bank
            loan.processing_fee_amortised = D("0")
            loan.scheduled_emi = emi(loan.outstanding, rate, max(1, loan.tenure_months_remaining))

        events = []
        for event in kwargs.get("lifecycle_events") or []:
            if event.kind == LifecycleEventKind.FLOATING_RATE_RESET and event.loan_index in idx:
                if opp.kind == "consolidation":
                    continue
                # Keep the projected benchmark change, with the new spread.
                event.new_rate = max(D("0"), event.new_rate + rate - original.nominal_rate)
            events.append(event)
        kwargs["lifecycle_events"] = events or None
        return simulate_plan(changed, **kwargs)

    moved = replacement(opp.target_rate, opp.target_bank)

    def monthly_differences(other):
        old = [m.interest_paid_month for m in baseline.months]
        new = [m.interest_paid_month for m in other.months]
        return [from_user_currency(
            (old[m] if m < len(old) else D("0")) - (new[m] if m < len(new) else D("0")),
            original, user,
        ) for m in range(max(len(old), len(new)))]

    differences = monthly_differences(moved)
    gross = sum(differences[:12], D("0"))
    saving = gross - cost
    ccy = _ccy_symbol(country)
    lifetime = (sum(differences, D("0")) - cost
                if baseline.debt_free_month and moved.debt_free_month else None)
    if saving <= 0 or (lifetime is not None and lifetime <= 0):
        loss = -saving if saving <= 0 else -lifetime
        period = "in the first year" if saving <= 0 else "over repayment"
        return HeldBack(
            kind=opp.kind, affected_loan_indices=idx, target_bank=opp.target_bank,
            reason="costs_more",
            note=f"With your plan's payments, a {_MOVE[opp.kind]} costs about "
                 f"{_money(loss, ccy)} more {period}, including its "
                 f"{_money(cost, ccy)} up-front fee.",
        )
    if any(new.shortfall > (baseline.months[m].shortfall if m < len(baseline.months) else D("0"))
           for m, new in enumerate(moved.months)):
        return HeldBack(
            kind=opp.kind, affected_loan_indices=idx, target_bank=opp.target_bank,
            reason="costs_more", note="The replacement EMI leaves a larger cash shortfall than your current plan.",
        )
    opp.estimated_annual_saving = saving
    opp.saving_basis = "plan"
    opp.detail["comparison"] = "repayment"
    opp.detail["first_year_interest_saved"] = str(gross)
    if opp.kind == "refinance":
        # Do not promise a lifetime amount for a truncated simulation.
        opp.lifetime_net_saving = lifetime
        if opp.lifetime_net_saving is not None:
            opp.detail["interest_saved_total"] = str(opp.lifetime_net_saving + cost)
        else:
            opp.detail.pop("interest_saved_total", None)
    earned = D("0")
    opp.breakeven_months = None
    for m, difference in enumerate(differences, 1):
        earned += difference
        if earned >= cost:
            opp.breakeven_months = m
            break
    if opp.alternative_target_rate is not None:
        alternative = replacement(opp.alternative_target_rate, opp.alternative_target_bank)
        alt_closing = D("0") if opp.kind == "refinance" and _same_bank(
            opp.alternative_target_bank, original.bank, country,
        ) else sum((user.loans[i].outstanding * user.loans[i].prepayment_penalty_pct for i in idx), D("0"))
        alt_cost = cost - D(opp.detail.get("closing_fee", "0")) + alt_closing
        alt_saving = sum(monthly_differences(alternative)[:12], D("0")) - alt_cost
        if alt_saving > saving:
            opp.alternative_annual_saving = alt_saving
        else:
            opp.alternative_target_bank = None
            opp.alternative_target_rate = None
            opp.alternative_annual_saving = None
    if opp.explain:
        opp.rationale = opp.explain(opp)
    if opp.retitle:
        opp.headline = opp.retitle(opp)
    return None


def scan(
    user: User,
    marginal_rate: Decimal = D("0"),
    plan_balances: Optional[dict[int, list[Decimal]]] = None,
    plan_options: Optional[dict] = None,
) -> ScanResult:
    """Run every Layer 1 scan on the user's loan book.

    Opportunities come back sorted by estimated first-year saving. A move
    the user's credit score makes unlikely, or that the plan (when
    `plan_balances` is given) makes pointless, is listed in `held_back`
    with the reason instead."""
    # C8: refinance / balance-transfer ranking is a forward decision: the
    # forward rate (marginal shield, no sunk fee), not effective_rate.
    rates = user_forward_rates(user.loans, user, marginal_rate)
    known = _known_banks(user)
    baseline = None
    if plan_options is not None:
        from engine.simulation import simulate_plan
        baseline = simulate_plan(user, **deepcopy(plan_options))
        # Server-authoritative paths when the full plan is available.
        plan_balances = {i: [m.balances_by_loan_index.get(i, D("0")) for m in baseline.months]
                         for i in range(len(user.loans))}
    score = user.credit_score
    found: list[tuple[RestructuringOpportunity, Loan, Country]] = []

    # Each loan is matched with lenders in its own currency's market.
    def market(l: Loan) -> Country:
        return _market_for(loan_currency_or_default(l, user))

    for i, l in enumerate(user.loans):
        if l.outstanding <= 0:
            continue
        if l.loan_type == LoanType.CREDIT_CARD:
            m = market(l)
            opp = _scan_card_balance_transfer(
                l, i, rates[id(l)], m, known, user.income_type,
                credit_fit(score, m, secured=False),
            )
            if opp is not None:
                found.append((opp, l, m))

    for ccy in sorted({loan_currency_or_default(l, user) for l in user.loans}):
        m = _market_for(ccy)
        consol = _scan_consolidation_opportunity(
            user, rates, known, ccy, credit_fit(score, m, secured=False),
        )
        if consol is not None:
            found.append((consol, user.loans[consol.affected_loan_indices[0]], m))

    # Refi candidates: home and auto loans (`scan_refinance` accepts only
    # those). Personal loans are covered by consolidation above; cards by
    # the balance transfer. Estimated saving sorts the list so the bigger
    # win lands on top.
    for i, l in enumerate(user.loans):
        if l.outstanding > 0 and l.loan_type in (LoanType.HOME, LoanType.AUTO):
            m = market(l)
            opp = _scan_refi_opportunity(
                l, i, m, known, user.income_type, credit_fit(score, m, secured=True),
            )
            if opp is not None:
                found.append((opp, l, m))

    kept: list[RestructuringOpportunity] = []
    held: list[HeldBack] = []
    # US student loans (grill #33): a federal loan, or one not marked
    # private, is never offered a private refinance or a consolidation into
    # a private loan. When a private lender's rate is lower, say why not.
    from engine.us_loans import is_federal_or_unknown_student_loan, refinance_note
    for i, l in enumerate(user.loans):
        if l.outstanding <= 0 or not is_federal_or_unknown_student_loan(l, user.country):
            continue
        best = _best_market_rate(Country.US, LoanType.EDUCATION, None, user.income_type)
        if best is not None and best[1] < l.nominal_rate:
            held.append(HeldBack(
                kind="refinance", affected_loan_indices=[i], target_bank=None,
                reason="federal_protections", note=refinance_note(l),
            ))
    found = [
        (opp, loan, m) for opp, loan, m in found
        if not any(is_federal_or_unknown_student_loan(user.loans[i], user.country)
                   for i in opp.affected_loan_indices)
    ]
    for opp, loan, m in found:
        if opp.credit_fit == "unlikely":
            floor = _SCORE_FLOOR[(m, opp.kind == "refinance")]
            held.append(HeldBack(
                kind=opp.kind, affected_loan_indices=opp.affected_loan_indices,
                target_bank=opp.target_bank, reason="credit_score",
                note=(
                    f"Lenders seldom approve a {_MOVE[opp.kind]} below a credit "
                    f"score of about {floor}; yours is {score}. Paying on time and "
                    f"keeping card use low raises it."
                ),
            ))
            continue
        if opp.kind != "balance_transfer":
            # Combining/refinancing closes the original principal, so a
            # recorded early-repayment charge is another up-front cost.
            repricing = opp.kind == "refinance" and _same_bank(opp.target_bank, loan.bank, m)
            closing_fee = D("0") if repricing else sum((
                user.loans[i].outstanding * user.loans[i].prepayment_penalty_pct
                for i in opp.affected_loan_indices
            ), D("0"))
            if closing_fee > 0:
                opp.one_time_cost += closing_fee
                opp.estimated_annual_saving -= closing_fee
                if opp.lifetime_net_saving is not None:
                    opp.lifetime_net_saving -= closing_fee
                opp.detail["closing_fee"] = str(closing_fee)
                if opp.kind == "refinance":
                    opp.detail["refi_costs"] = str(opp.one_time_cost)
                if opp.alternative_annual_saving is not None:
                    opp.alternative_annual_saving -= closing_fee
                opp.breakeven_months = _breakeven_months(
                    opp.one_time_cost, opp.estimated_annual_saving + opp.one_time_cost,
                )
                if opp.explain:
                    opp.rationale = opp.explain(opp)
                if opp.retitle:
                    opp.headline = opp.retitle(opp)
        if plan_balances is not None:
            # Fast paths handle transfers and moves the plan clears before
            # they could take effect. Replacement loans use a full rerun.
            paths = [plan_balances.get(i, []) for i in opp.affected_loan_indices]
            clears_soon = bool(paths) and all(p and p[min(1, len(p) - 1)] <= D("1") for p in paths)
            if baseline is not None and opp.kind != "balance_transfer" and not clears_soon:
                hb = _fit_repayment_comparison(opp, user, baseline, plan_options, m)
            else:
                hb = fit_to_plan(opp, user, plan_balances, m)
            if hb is not None:
                held.append(hb)
                continue
        if opp.estimated_annual_saving <= 0:
            held.append(HeldBack(
                kind=opp.kind, affected_loan_indices=opp.affected_loan_indices,
                target_bank=opp.target_bank, reason="costs_more",
                note="The up-front costs exceed the estimated first-year interest saving.",
            ))
            continue
        kept.append(_in_user_currency(opp, loan, user))
    kept.sort(key=lambda o: o.estimated_annual_saving, reverse=True)
    return ScanResult(opportunities=kept, held_back=held)


def scan_all(
    user: User,
    marginal_rate: Decimal = D("0"),
    plan_balances: Optional[dict[int, list[Decimal]]] = None,
) -> list[RestructuringOpportunity]:
    """The opportunities `scan` recommends, biggest first-year saving first."""
    return scan(user, marginal_rate, plan_balances).opportunities
