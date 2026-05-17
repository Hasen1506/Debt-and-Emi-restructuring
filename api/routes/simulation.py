"""POST /api/simulate · /api/baseline · /api/sensitivity/compare"""
from copy import deepcopy
from decimal import Decimal
from fastapi import APIRouter

from engine.simulation import simulate_plan, baseline_minimums_only
from engine.sensitivity import (
    with_surplus_delta, with_income_shock, with_rate_shock,
    with_strategy, with_lump_sum, compare,
)

from api.schemas import (
    SimulateRequest, SimulateResponse, TrajectoryPoint,
    BaselineRequest, CompareRequest, CompareResponse,
)

D = Decimal
router = APIRouter(tags=["simulation"])


def _to_trajectory(result, loans, user) -> list[TrajectoryPoint]:
    """Flatten SimulationResult.months → trajectory points. Balance is the sum
    across all loans at each month — that's what the chart wants.

    Per-loan payment dict is already position-keyed by the engine, so we
    pass it through unchanged. `balances_by_currency` is sourced directly
    from the engine — its id(loan) bookkeeping doesn't survive the
    deepcopy boundary, so re-computing from `row.balances` here would
    silently lose the currency tag and bucket everything under INR.
    """
    points: list[TrajectoryPoint] = []
    for row in result.months:
        total_balance = sum(row.balances.values(), D("0"))
        points.append(TrajectoryPoint(
            month=row.month_index,
            balance=total_balance,
            interest_paid=row.interest_paid_month,
            invested=row.invested_this_month,
            payments_by_loan_index=row.payments_by_loan_index,
            balances_by_currency=dict(row.balances_by_currency),
        ))
    return points


@router.post("/simulate", response_model=SimulateResponse)
def simulate(req: SimulateRequest) -> SimulateResponse:
    user = req.user.to_engine()
    # Flatten the reinvest-events list to the tuple shape the engine takes.
    # Empty list → engine sees None → no reinvest logic runs (preserves
    # baseline behaviour for callers that don't set the toggle).
    reinvest_tuples = (
        [(e.month, e.amount) for e in req.reinvest_events]
        if req.reinvest_events
        else None
    )
    result = simulate_plan(
        user, strategy=req.strategy, horizon_months=req.horizon_months,
        matched_contribution=req.matched_contribution,
        marginal_rate=req.marginal_rate, simple_mode=req.simple_mode,
        simulation_start_month=req.simulation_start_month,
        reinvest_events=reinvest_tuples,
        inflate_expenses=req.inflate_expenses,
    )
    return SimulateResponse(
        debt_free_month=result.debt_free_month,
        total_interest_paid=result.total_interest_paid,
        total_invested=result.total_invested,
        trajectory=_to_trajectory(result, user.loans, user),
        months_in_horizon=len(result.months),
    )


@router.post("/baseline", response_model=SimulateResponse)
def baseline(req: BaselineRequest) -> SimulateResponse:
    user = req.user.to_engine()
    result = baseline_minimums_only(
        user, horizon_months=req.horizon_months, simple_mode=req.simple_mode,
    )
    return SimulateResponse(
        debt_free_month=result.debt_free_month,
        total_interest_paid=result.total_interest_paid,
        total_invested=result.total_invested,
        trajectory=_to_trajectory(result, user.loans, user),
        months_in_horizon=len(result.months),
    )


@router.post("/sensitivity/compare", response_model=CompareResponse)
def sensitivity_compare(req: CompareRequest) -> CompareResponse:
    """Runs baseline vs scenario and diffs them. Exactly one what-if knob
    should be set per request — if multiple are set, they stack."""
    user = req.user.to_engine()
    sm = req.simulation_start_month
    base = simulate_plan(
        user, strategy=req.strategy, horizon_months=req.horizon_months,
        marginal_rate=req.marginal_rate,
        simulation_start_month=sm,
    )

    scenario_user = deepcopy(user)
    scenario_result = base
    if req.surplus_delta is not None:
        scenario_result = with_surplus_delta(
            scenario_user, req.surplus_delta, strategy=req.strategy,
            horizon_months=req.horizon_months, marginal_rate=req.marginal_rate,
            start_month=req.surplus_delta_start_month,
            simulation_start_month=sm,
        )
    elif req.income_shock_months is not None:
        scenario_result = with_income_shock(
            scenario_user, req.income_shock_months, strategy=req.strategy,
            horizon_months=req.horizon_months, marginal_rate=req.marginal_rate,
            simulation_start_month=sm,
        )
    elif req.rate_shock_delta is not None:
        scenario_result = with_rate_shock(
            scenario_user, req.rate_shock_delta, strategy=req.strategy,
            horizon_months=req.horizon_months, marginal_rate=req.marginal_rate,
            floating_only=req.rate_shock_floating_only,
            simulation_start_month=sm,
        )
    elif req.alt_strategy is not None:
        scenario_result = with_strategy(
            scenario_user, req.alt_strategy, horizon_months=req.horizon_months,
            marginal_rate=req.marginal_rate,
            simulation_start_month=sm,
        )
    elif req.lump_sum_amount is not None and req.lump_sum_target_loan_index is not None:
        scenario_result = with_lump_sum(
            scenario_user, req.lump_sum_amount, req.lump_sum_target_loan_index,
            strategy=req.strategy, horizon_months=req.horizon_months,
            marginal_rate=req.marginal_rate,
            simulation_start_month=sm,
        )

    diff = compare(base, scenario_result)
    return CompareResponse(
        baseline_debt_free_month=diff["debt_free_month_baseline"],
        scenario_debt_free_month=diff["debt_free_month_scenario"],
        months_pulled_forward=diff["months_pulled_forward"],
        interest_saved=diff["interest_saved"],
        extra_invested=diff["extra_invested"],
    )
