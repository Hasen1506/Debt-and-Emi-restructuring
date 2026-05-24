"""POST /api/simulate · /api/baseline · /api/sensitivity/compare"""
from copy import deepcopy
from decimal import Decimal
from fastapi import APIRouter

from engine.simulation import simulate_plan, baseline_minimums_only
from engine.models import LifecycleEvent, LifecycleEventKind, User
from engine.goals import GoalState, serial_fill_allocation
from engine.sensitivity import (
    with_surplus_delta, with_income_shock, with_rate_shock,
    with_strategy, with_lump_sum, compare,
)
from engine.surplus import allocate_surplus, compute_available_surplus

from api.schemas import (
    GoalContributionOut, GoalFinalOut, GoalIn, SimulateRequest,
    SimulateResponse, SurplusAllocationOut, TrajectoryPoint,
    BaselineRequest, CompareRequest, CompareResponse, LifecycleEventIn,
)


def _build_goal_states(goals: list[GoalIn]) -> list[GoalState]:
    """Translate Pydantic GoalIn → engine GoalState. Each engine state
    is mutable across the trajectory loop (saved_so_far accumulates)."""
    return [
        GoalState(
            id=g.id,
            target_month_index=g.target_month_index,
            required_amount=g.required_amount,
            saved_so_far=g.saved_so_far,
            priority_bump=g.priority_bump,
            order_index=g.order_index,
            funding_start_month_index=g.funding_start_month_index,
        )
        for g in goals
    ]


def _build_goal_finals(
    goal_states: list[GoalState] | None,
    horizon_months: int,
    effective_last_month: int | None = None,
) -> list[GoalFinalOut]:
    """Build per-goal end-of-trajectory fill rates from the mutated
    GoalState list. `saved_at_target` is set by the engine only when
    the sim actually iterates through the goal's target month; that's
    the authoritative signal for `target_reached`. Comparing
    `target_month_index <= horizon_months` would lie when the sim
    breaks out early (debt-free before horizon) — the goal's target
    month would look "reachable" but the engine never reached it.
    Falls back to `saved_so_far` (state at sim end) only when the
    target wasn't actually visited.

    `effective_last_month` is the last sim month the engine actually
    iterated through (= debt_free_month when the sim broke out, else
    horizon_months). When a goal's target sits past that point, we
    emit `target_past_horizon=True` so the UI can render an honest
    "deadline is past your debt-free month" message instead of the
    misleading "not reached"."""
    if not goal_states:
        return []
    last_month = effective_last_month if effective_last_month is not None else horizon_months
    out: list[GoalFinalOut] = []
    for g in goal_states:
        target_reached = g.saved_at_target is not None
        saved = (
            g.saved_at_target
            if target_reached
            else g.saved_so_far
        )
        # Clamp to [0, 1] so over-funded goals don't surface a 110%
        # fill — confusing for the user.
        fill_rate = Decimal("0")
        if g.required_amount > 0:
            fill_rate = min(Decimal("1"), saved / g.required_amount)
        past_horizon = (
            not target_reached and g.target_month_index > last_month
        )
        out.append(
            GoalFinalOut(
                goal_id=g.id,
                required=g.required_amount,
                saved_at_target=saved,
                fill_rate=fill_rate,
                target_reached=target_reached,
                target_past_horizon=past_horizon,
                funded=g.required_amount > 0 and saved >= g.required_amount,
            )
        )
    return out


def _build_surplus_allocation(
    user: User,
    matched_contribution: Decimal,
    ef_split: Decimal,
    ef_preempted: bool,
    goal_states: list[GoalState] | None = None,
    simple_mode: bool = False,
) -> SurplusAllocationOut:
    """Compute the first-month surplus + allocation the engine will apply.
    This is the snapshot the /plan SurplusWaterfall card renders — engine
    truth, not a client-side mirror.

    When `goal_states` is supplied, we run serial-fill once for sim
    month 0 to produce per-goal contributions and the any-short flag.
    A deep copy is used so the snapshot's mutation doesn't pollute
    simulate_plan's own pass (the route handler gives that function
    a fresh list).
    """
    surplus = compute_available_surplus(
        user, user.loans,
        matched_contribution=matched_contribution,
        simple_mode=simple_mode,
    )
    ef_gap = max(D("0"), user.efund_target - user.efund_balance)

    goal_contributions_out: list[GoalContributionOut] = []
    any_goal_short = False
    effective_outflow = D("0")

    if goal_states is not None:
        from copy import deepcopy
        snapshot_goals = deepcopy(goal_states)
        alloc = serial_fill_allocation(
            snapshot_goals, surplus, current_sim_month=0,
        )
        effective_outflow = alloc.total_outflow
        any_goal_short = alloc.any_goal_short
        goal_contributions_out = [
            GoalContributionOut(
                goal_id=c.goal_id,
                amount=c.amount,
                run_rate=c.run_rate,
                queued_reason=c.queued_reason,
                funding_start_month_index=_lookup_funding_start(
                    snapshot_goals, c.goal_id,
                ),
            )
            for c in alloc.contributions
        ]

    # Pre-subtract goal outflow before calling the cascade — same shape
    # the engine loop uses, so there's only one way to compose the
    # final allocation. `goal_slice` in the response is composed here
    # from the multi-goal serial-fill output (`effective_outflow`),
    # not pulled from `allocation.goal_slice` (which now only carries
    # the legacy `ef_preempted` single-goal path).
    post_goal_surplus = surplus - effective_outflow
    allocation = allocate_surplus(
        surplus=post_goal_surplus,
        ef_split=ef_split,
        ef_gap=ef_gap,
        ef_preempted=ef_preempted,
    )
    composed_goal_slice = effective_outflow + allocation.goal_slice
    return SurplusAllocationOut(
        surplus=surplus,
        goal_slice=composed_goal_slice,
        ef_slice=allocation.ef_slice,
        debt_slice=allocation.debt_slice,
        ef_preempted=ef_preempted,
        ef_split=ef_split,
        goal_contributions=goal_contributions_out,
        any_goal_short=any_goal_short,
    )


def _lookup_funding_start(
    goals: list[GoalState], goal_id: str
) -> int | None:
    """Pick the funding_start_month_index off the engine GoalState by id
    so the snapshot can tell /plan when a deferred goal actually starts
    funding (rather than just showing "₹0 — deferred" with no horizon)."""
    for g in goals:
        if g.id == goal_id:
            return g.funding_start_month_index
    return None


def _to_engine_lifecycle(events: list[LifecycleEventIn]) -> list[LifecycleEvent]:
    """Translate the wire-format lifecycle events to the engine dataclass.
    Unknown kinds (e.g. property_buy, which is L1-only) are silently
    dropped so the frontend can send the full set without filtering."""
    out: list[LifecycleEvent] = []
    for e in events:
        try:
            kind = LifecycleEventKind(e.kind)
        except ValueError:
            continue
        out.append(
            LifecycleEvent(
                kind=kind,
                effective_month=e.effective_month,
                new_annual_gross=e.new_annual_gross,
                new_monthly_take_home=e.new_monthly_take_home,
                loan_index=e.loan_index,
                new_rate=e.new_rate,
            )
        )
    return out

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
            balances_by_loan_index=dict(row.balances_by_loan_index),
            available_surplus=row.available_surplus,
            goal_contributions=dict(row.goal_contributions),
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
    events = _to_engine_lifecycle(req.lifecycle_events) if req.lifecycle_events else None
    # Build engine goal states from the request, if any. The handler
    # owns two independent copies — one for simulate_plan (which mutates
    # saved_so_far + saved_at_target across the trajectory) and one for
    # the snapshot builder. Both start from the same request payload so
    # the snapshot reflects the same starting state. After simulate_plan
    # returns, the first list carries end-of-trajectory state used for
    # per-goal fill rates.
    goal_states = _build_goal_states(req.goals) if req.goals else None
    result = simulate_plan(
        user, strategy=req.strategy, horizon_months=req.horizon_months,
        matched_contribution=req.matched_contribution,
        marginal_rate=req.marginal_rate, simple_mode=req.simple_mode,
        simulation_start_month=req.simulation_start_month,
        reinvest_events=reinvest_tuples,
        inflate_expenses=req.inflate_expenses,
        lifecycle_events=events,
        ef_top_up_rate=req.ef_top_up_rate,
        goals=goal_states,
    )
    return SimulateResponse(
        debt_free_month=result.debt_free_month,
        total_interest_paid=result.total_interest_paid,
        total_invested=result.total_invested,
        trajectory=_to_trajectory(result, user.loans, user),
        months_in_horizon=len(result.months),
        surplus_allocation=_build_surplus_allocation(
            user,
            matched_contribution=req.matched_contribution,
            ef_split=req.ef_top_up_rate,
            ef_preempted=req.ef_preempted,
            goal_states=_build_goal_states(req.goals) if req.goals else None,
            simple_mode=req.simple_mode,
        ),
        goal_finals=_build_goal_finals(
            goal_states,
            req.horizon_months,
            effective_last_month=(
                result.debt_free_month
                if result.debt_free_month is not None
                else req.horizon_months
            ),
        ),
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
        # Baseline endpoint runs minimums-only — the engine doesn't route
        # any surplus, so no allocation breakdown to return.
        surplus_allocation=None,
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
