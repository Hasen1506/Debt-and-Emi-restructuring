"""POST /api/windfall · /api/new-debt · /api/quick-recompute · /api/cash-yield · /api/right-time-to-borrow · /api/asset-liquidation"""
from copy import deepcopy
from dataclasses import replace
from datetime import date
from decimal import Decimal
from fastapi import APIRouter, HTTPException

from engine.asset_liquidation import (
    GATE_0_WEALTH_EDGE_RATIO, india_ltcg_tax, true_net_benefit, gate_check,
    compute_liquidation_proceeds,
)
from engine.country_data import india_selling_cost_pct
from engine.decisions import (
    DecisionInputError, allocate_windfall, evaluate_new_debt, quick_recompute,
    cash_yield_check, right_time_to_borrow, right_time_from_odds, MeetingMoves, money, prepay_block,
)
from engine.formulas import effective_rate
from engine.models import Country, FilingStatusUS, TaxRegimeIN
from engine.tax.india import marginal_rate as india_marginal_rate
from engine.simulation import simulate_plan
from engine.surplus import from_user_currency, to_user_currency, loan_currency_or_default

from api import market_odds
from api.schemas import (
    WindfallRequest, WindfallResponse,
    NewDebtRequest, NewDebtResponse,
    QuickRecomputeRequest, QuickRecomputeResponse,
    CashYieldRequest, CashYieldResponse,
    BorrowTimingRequest, BorrowTimingResponse,
    AssetLiquidationRequest, AssetLiquidationResponse,
)

D = Decimal
router = APIRouter(tags=["decisions"])


def _bad(e: DecisionInputError) -> HTTPException:
    """422 in the same shape as Loan Check: {"detail": {"field", "message"}}."""
    return HTTPException(status_code=422, detail={"field": e.field, "message": str(e)})


@router.post("/windfall", response_model=WindfallResponse)
def windfall(req: WindfallRequest) -> WindfallResponse:
    user = req.user.to_engine()
    marg = req.marginal_rate if req.marginal_rate is not None else D("0")
    rates = {
        id(l): effective_rate(l, marg, user.country, user.tax_regime, user.itemises, user.itemised_share)
        for l in user.loans
    }
    # Cash recommendations and fees are in residence currency. Normalize the
    # ranking balances/payment maths before comparing a cash amount with a
    # foreign loan; return the original loan's index for Activity.
    originals = user.loans
    own = "INR" if user.country == Country.IN else "USD"
    normalized = []
    normalized_rates = {}
    for loan in originals:
        currency = loan_currency_or_default(loan, user)
        if loan.outstanding > 0 and currency != own and user.fx_to_user_currency.get(currency, D("0")) <= 0:
            raise HTTPException(status_code=422, detail={"field":"user.fx_to_user_currency", "message":"Save an exchange rate for each foreign loan before allocating cash."})
        copy = deepcopy(loan)
        copy.outstanding = to_user_currency(loan.outstanding, loan, user)
        copy.scheduled_emi = to_user_currency(loan.scheduled_emi, loan, user)
        if loan.min_payment_override is not None:
            copy.min_payment_override = to_user_currency(loan.min_payment_override, loan, user)
        copy.expected_monthly_spend = to_user_currency(loan.expected_monthly_spend, loan, user)
        copy.currency = own
        normalized.append(copy)
        normalized_rates[id(copy)] = rates[id(loan)]
    try:
        allocation = allocate_windfall(
            req.amount, normalized, normalized_rates,
            user.investment_options, user.inflation_rate, strategy=req.strategy,
            country=user.country, marginal_tax_rate=marg, rules=user.payoff_rules,
            prepay_hurdle=user.prepay_hurdle,
        )
    except DecisionInputError as e:
        raise _bad(e)
    index_by_id = {id(l): i for i, l in enumerate(normalized)}
    return WindfallResponse(
        loan_label=allocation.loan_label,
        loan_index=(
            index_by_id.get(allocation.to_loan_id)
            if not allocation.invest_instead and allocation.to_loan_id is not None
            else None
        ),
        amount=allocation.amount,
        rationale=allocation.rationale,
        interest_avoided=allocation.interest_avoided,
        invest_instead=allocation.invest_instead,
        investment_name=allocation.investment_name,
        investment_return=allocation.investment_return,
        leftover=allocation.leftover,
        interest_basis=allocation.interest_basis,
        fee=allocation.fee,
        net_benefit=allocation.net_benefit,
        blocked=allocation.blocked,
    )


@router.post("/new-debt", response_model=NewDebtResponse)
def new_debt(req: NewDebtRequest) -> NewDebtResponse:
    try:
        verdict = evaluate_new_debt(
            list_price=req.list_price,
            cash_price_elsewhere=req.cash_price_elsewhere,
            emi_offer_months=req.emi_offer_months,
            emi_offer_monthly_payment=req.emi_offer_monthly_payment,
            processing_fee=req.processing_fee,
            user_savings_after_efund=req.user_savings_after_efund,
            country=req.country,
            monthly_room=req.monthly_room,
        )
    except DecisionInputError as e:
        raise _bad(e)
    return NewDebtResponse(**verdict.__dict__)


@router.post("/quick-recompute", response_model=QuickRecomputeResponse)
def recompute(req: QuickRecomputeRequest) -> QuickRecomputeResponse:
    user = req.user.to_engine()
    # Validate the target before running anything (an index past the last
    # loan used to "save nothing" instead of saying so).
    if not 0 <= req.target_loan_index < len(user.loans):
        raise HTTPException(status_code=422, detail={
            "field": "target_loan_index",
            "message": "Pick one of your loans.",
        })
    target = user.loans[req.target_loan_index]
    blocked = prepay_block(target)
    if blocked:
        raise HTTPException(status_code=422, detail={
            "field": "target_loan_index",
            "message": f"This loan {blocked}, so it can't take an extra payment now.",
        })
    own = "INR" if user.country == Country.IN else "USD"
    if (loan_currency_or_default(target, user) != own
            and user.fx_to_user_currency.get(loan_currency_or_default(target, user), D("0")) <= 0):
        raise HTTPException(status_code=422, detail={
            "field": "user.fx_to_user_currency",
            "message": "Save an exchange rate for this foreign loan first.",
        })
    old = simulate_plan(
        user, strategy=req.strategy, horizon_months=req.horizon_months,
        marginal_rate=req.marginal_rate,
    )
    scratch = deepcopy(user)
    l = scratch.loans[req.target_loan_index]
    # extra_payment is in the user's currency (P2-07); the bank's
    # prepayment fee comes out of it before it reaches principal.
    in_loan_ccy = from_user_currency(req.extra_payment, l, scratch)
    to_principal = in_loan_ccy * (D("1") - (l.prepayment_penalty_pct or D("0")))
    l.outstanding = max(D("0"), l.outstanding - to_principal)
    new = simulate_plan(
        scratch, strategy=req.strategy, horizon_months=req.horizon_months,
        marginal_rate=req.marginal_rate,
    )
    diff = quick_recompute(
        old.total_interest_paid, new.total_interest_paid,
        old.debt_free_month, new.debt_free_month,
    )
    return QuickRecomputeResponse(
        old_debt_free_month=diff.old_debt_free_month,
        new_debt_free_month=diff.new_debt_free_month,
        months_pulled_forward=diff.months_pulled_forward,
        interest_saved=diff.interest_saved,
    )


@router.post("/cash-yield", response_model=CashYieldResponse)
def cash_yield(req: CashYieldRequest) -> CashYieldResponse:
    alert = cash_yield_check(
        idle_balance=req.idle_balance,
        current_yield=req.current_yield,
        country=req.country,
        top_loan_effective_rate=req.top_loan_effective_rate,
        best_alt_yield=req.best_alt_yield,
        alt_name=req.alt_name,
        minimum_idle_threshold=req.minimum_idle_threshold,
    )
    if alert is None:
        return CashYieldResponse(alert=False)
    return CashYieldResponse(
        alert=True,
        idle_balance=alert.idle_balance, current_yield=alert.current_yield,
        best_alt_yield=alert.best_alt_yield, alt_name=alert.alt_name,
        annual_uplift=alert.annual_uplift, beats_top_loan=alert.beats_top_loan,
        rationale=alert.rationale,
    )


@router.post("/right-time-to-borrow", response_model=BorrowTimingResponse)
def borrow_timing(req: BorrowTimingRequest) -> BorrowTimingResponse:
    if req.consensus_change_bps is not None:
        if req.months_to_decision is None:
            raise HTTPException(422, detail={
                "field": "months_to_decision",
                "message": "months_to_decision: needed with consensus_change_bps.",
            })
        verdict = right_time_to_borrow(
            current_rate=req.current_rate,
            six_month_avg=req.six_month_avg if req.six_month_avg is not None else req.current_rate,
            consensus_change_bps=req.consensus_change_bps,
            months_to_decision=req.months_to_decision,
            urgency=req.urgency, principal=req.principal,
            tenure_months=req.tenure_months,
            country=req.country,
            monthly_room=req.monthly_room,
        )
        return BorrowTimingResponse(**verdict.__dict__)

    # The market's odds for the coming decisions (Polymarket).
    country = req.country.value
    cal = market_odds.calendar(country)
    reading = market_odds.CACHE.odds(country, cal)
    today = date.today()
    verdict = right_time_from_odds(
        current_rate=req.current_rate, principal=req.principal,
        tenure_months=req.tenure_months, urgency=req.urgency,
        meetings=None if reading is None else [
            MeetingMoves(m.day, tuple((o.bps, o.chance) for o in m.outcomes)) for m in reading.meetings
        ],
        today=today, country=req.country, monthly_room=req.monthly_room,
        rate_floats=req.rate_type == "floating",
        next_meeting=next((d for d in cal if d >= today), None),
    )
    out = {**verdict.__dict__, "wait_until": verdict.wait_until.isoformat() if verdict.wait_until else None}
    return BorrowTimingResponse(**out, odds=market_odds.reading_out(country, reading))


@router.post("/asset-liquidation", response_model=AssetLiquidationResponse)
def asset_liquidation(req: AssetLiquidationRequest) -> AssetLiquidationResponse:
    """§8c / §4.18 — should this asset be sold to clear high-rate debt?

    Runs Gates 1–3 (Gate 4 is the user's emotional/strategic call, surfaced in UI).
    """
    asset = req.asset.to_engine()
    tax_notes: list[str] = []
    if req.country == Country.US:
        # US rules: federal capital-gains tax (0/15/20% long-term, ordinary
        # rates short-term), NIIT and the state rate, after the §121
        # main-home exclusion when the seller says it applies. India's
        # indexation and surcharge bands don't apply to a US sale.
        sold = compute_liquidation_proceeds(
            replace(asset, current_market_value=req.sale_price),
            today=date.today(),
            country=Country.US,
            taxable_income=req.taxable_income,
            filing_status=req.filing_status or FilingStatusUS.SINGLE,
            state_marginal_rate=req.state_marginal_rate or D("0"),
        )
        if sold.is_blocked:
            raise HTTPException(status_code=400, detail=sold.block_reason or sold.explanation)
        net_proceeds, ltcg_tax = sold.net_proceeds, sold.tax_owed
        selling_cost_pct = (
            sold.transaction_costs / req.sale_price if req.sale_price > 0 else D("0")
        )
        tax_notes = [sold.explanation, *sold.caveats]
        if not req.state_marginal_rate:
            tax_notes.append("No state income tax included: add your state rate in Setup if you pay one.")
    elif asset.asset_type != "real_estate":
        # Shares, funds, gold, deposits: each has its own holding period,
        # exemption and rate (the ones the ranker uses). The property rules
        # below (24 months, indexation, stamp-duty selling costs) taxed a
        # share sale opened from the ranker as if it were a flat.
        marginal = (
            req.marginal_rate
            if req.marginal_rate is not None
            else india_marginal_rate(req.taxable_income, TaxRegimeIN.NEW)
        )
        sold = compute_liquidation_proceeds(
            replace(asset, current_market_value=req.sale_price),
            today=date.today(),
            country=Country.IN,
            taxable_income=req.taxable_income,
            marginal_rate=marginal,
            state=asset.state,
        )
        if sold.is_blocked:
            raise HTTPException(status_code=400, detail=sold.block_reason or sold.explanation)
        net_proceeds, ltcg_tax = sold.net_proceeds, sold.tax_owed
        selling_cost_pct = (
            sold.transaction_costs / req.sale_price if req.sale_price > 0 else D("0")
        )
        tax_notes = [sold.explanation, *sold.caveats]
    else:
        state = asset.state or "Maharashtra"        # default for selling-cost lookup
        try:
            net_proceeds, ltcg_tax = india_ltcg_tax(
                asset=asset,
                sale_price=req.sale_price,
                state=state,
                taxable_income=req.taxable_income,
                purchase_fy=req.purchase_fy,
                current_fy=req.current_fy,
                brokerage_rate=req.brokerage_rate,
                marginal_rate=req.marginal_rate,
            )
        except (KeyError, ValueError) as e:
            raise HTTPException(status_code=400, detail=str(e))
        selling_cost_pct = india_selling_cost_pct(state, req.brokerage_rate)

    benefit = true_net_benefit(
        net_proceeds=net_proceeds,
        debt_balance=req.debt_balance,
        debt_effective_rate=req.debt_effective_rate,
        selling_period_months=req.selling_period_months,
    )

    ltcg_effective_rate = (
        ltcg_tax / req.sale_price if req.sale_price > 0 else D("0")
    )

    gates = gate_check(
        asset_value=req.sale_price,
        net_benefit=benefit,
        debt_effective_rate=req.debt_effective_rate,
        asset_nominal_return=req.asset_nominal_return,
        inflation=req.inflation,
        selling_cost_pct=selling_cost_pct,
        ltcg_effective_rate=ltcg_effective_rate,
        holding_cost_rate=req.holding_cost_rate,
        expected_hold_years_post_sale=req.expected_hold_years_post_sale,
        high_rate_threshold=req.high_rate_threshold,
        net_proceeds=net_proceeds,
        debt_balance=req.debt_balance,
        surplus_reinvestment_yield=req.surplus_reinvestment_yield,
        debt_monthly_payment=req.debt_monthly_payment,
    )

    # Plain words, in the seller's currency: the page lists each test
    # beside this line, so it names only what decided the answer.
    failed = []
    hold = req.expected_hold_years_post_sale.normalize()
    years = f"{hold:f} year{'' if hold == 1 else 's'}"
    m = lambda v: money(v, req.country)
    edge_needed = req.sale_price * GATE_0_WEALTH_EDGE_RATIO
    if gates.get("gate_0_wealth_edge") is False:
        edge = gates["wealth_edge"]
        # A positive edge can still fail: it has to clear 10% of the asset.
        # Calling that "worse off" contradicted the +edge shown beside it.
        if edge >= 0:
            failed.append(
                f"selling leaves you only {m(edge)} better off over {years}, "
                f"short of the {m(edge_needed)} (10% of its value) a sale should gain"
            )
        else:
            failed.append(f"selling leaves you {m(-edge)} worse off over {years}")
    if not gates["gate_1_net_benefit"]: failed.append("the gain is under 10% of its value")
    if not gates["gate_2_high_rate"]:   failed.append(f"the loan costs under {req.high_rate_threshold * 100:.0f}% a year")
    if not gates["gate_3_spread"]:      failed.append("the asset earns about as much as the loan costs")

    if gates["recommend_liquidation"]:
        if gates.get("gate_0_wealth_edge") is True:
            rationale = (
                f"Selling clears the loan, and the {m(gates['surplus'])} left over "
                f"earns more over {years} than the asset would."
            )
        else:
            rationale = "Selling clears a dear loan, and the asset earns less than it costs."
    else:
        # The verdict above it already says "Keep it": this says why.
        why = "; ".join(failed)
        rationale = why[:1].upper() + why[1:] + "."

    return AssetLiquidationResponse(
        net_proceeds=net_proceeds,
        ltcg_tax=ltcg_tax,
        net_benefit=benefit,
        asset_real_return_net=gates["asset_real_return_net"],
        gate_1_net_benefit=gates["gate_1_net_benefit"],
        gate_2_high_rate=gates["gate_2_high_rate"],
        gate_3_spread=gates["gate_3_spread"],
        gate_0_wealth_edge=gates.get("gate_0_wealth_edge"),
        surplus=gates.get("surplus"),
        wealth_hold=gates.get("wealth_hold"),
        wealth_sell=gates.get("wealth_sell"),
        wealth_edge=gates.get("wealth_edge"),
        wealth_edge_needed=edge_needed if gates.get("gate_0_wealth_edge") is not None else None,
        wealth_basis=gates.get("wealth_basis"),
        horizon_years=req.expected_hold_years_post_sale if gates.get("gate_0_wealth_edge") is not None else None,
        recommend_liquidation=gates["recommend_liquidation"],
        rationale=rationale,
        tax_notes=tax_notes,
    )
