"""POST /api/simulate · /api/baseline · /api/sensitivity/compare"""
from copy import deepcopy
from decimal import ROUND_HALF_UP, Decimal, localcontext
from fastapi import APIRouter, HTTPException

from engine.simulation import simulate_plan, baseline_minimums_only, goal_tradeoff, non_amortising_loans
from engine.models import LifecycleEvent, LifecycleEventKind, User
from engine.goals import GoalState, debt_gate, serial_fill_allocation
from engine.sensitivity import (
    with_surplus_delta, with_income_shock, with_rate_shock,
    with_strategy, with_lump_sum, compare,
)
from engine.surplus import allocate_surplus, compute_available_surplus
from engine.tenure_whatif import stretch_tenure

from api.schemas import (
    GoalContributionOut, GoalFinalOut, GoalIn, GoalTradeoffOut, GoalTradeoffRequest,
    GoalTradeoffResponse, SimulateRequest,
    SimulateResponse, SurplusAllocationOut, TrajectoryPoint,
    BaselineRequest, CompareRequest, CompareResponse, LifecycleEventIn,
    GapClosedOut, NonAmortisingOut,
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
            funding_rule=g.funding_rule,
            funding_amount=g.funding_amount,
            funding_pct=g.funding_pct,
            after_loan_index=g.after_loan_index,
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
    ef_split: Decimal | None,
    ef_preempted: bool,
    goal_states: list[GoalState] | None = None,
    simple_mode: bool = False,
    surplus_override: Decimal | None = None,
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
    # Same rule as simulate_plan: a given split is the only EF top-up, so
    # no fixed gap / 12 is held back first.
    surplus = surplus_override if surplus_override is not None else compute_available_surplus(
        user, user.loans,
        matched_contribution=matched_contribution,
        simple_mode=simple_mode,
        efund_monthly=D("0") if ef_split is not None else None,
    )
    if ef_split is None:
        ef_split = D("0")
    ef_gap = max(D("0"), user.efund_target - user.efund_balance)

    goal_contributions_out: list[GoalContributionOut] = []
    any_goal_short = False
    effective_outflow = D("0")

    if goal_states is not None:
        from copy import deepcopy
        snapshot_goals = deepcopy(goal_states)
        alloc = serial_fill_allocation(
            snapshot_goals, surplus, current_sim_month=0,
            debt_cleared=debt_gate(user.loans, user.country),
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
    """Translate validated planned events, including future loan drafts."""
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
                loan_draft=e.loan_draft.to_engine() if e.loan_draft else None,
            )
        )
    return out

D = Decimal
router = APIRouter(tags=["simulation"])


_CENT = Decimal("0.01")


def _cents(x: Decimal) -> Decimal:
    """Round to paise/cents. A short month borrowed at card rate that never
    closes compounds past 28 digits over a 100-year horizon (₹1e26+), where
    a plain quantize raises InvalidOperation and the plan 500s; round in a
    wider context instead."""
    with localcontext() as ctx:
        ctx.prec = max(ctx.prec, 80)
        return x.quantize(_CENT, rounding=ROUND_HALF_UP)


def _to_trajectory(result, loans, user) -> list[TrajectoryPoint]:
    """Flatten SimulationResult.months → trajectory points. Balance is the sum
    across all loans at each month — that's what the chart wants.

    Per-loan payment dict is already position-keyed by the engine, so we
    pass it through unchanged. `balances_by_currency` is sourced directly
    from the engine — its id(loan) bookkeeping doesn't survive the
    deepcopy boundary, so re-computing from `row.balances` here would
    silently lose the currency tag and bucket everything under INR.
    """
    # Money is rounded to paise/cents here (BUG_REPORT Low): values used to
    # come back as '958583.3333333333333333333333' and every client rounded.
    def q(v):
        return _cents(v) if v is not None else None

    def qd(d):
        return {k: q(v) for k, v in d.items()}

    points: list[TrajectoryPoint] = []
    for row in result.months:
        # In the user's currency: a plain sum added ₹ and $ balances.
        total_balance = row.balance_in_user_currency
        points.append(TrajectoryPoint(
            month=row.month_index,
            balance=q(total_balance),
            interest_paid=q(row.interest_paid_month),
            invested=q(row.invested_this_month),
            payments_by_loan_index=qd(row.payments_by_loan_index),
            balances_by_currency=qd(row.balances_by_currency),
            balances_by_loan_index=qd(row.balances_by_loan_index),
            available_surplus=q(row.available_surplus),
            goal_contributions=qd(row.goal_contributions),
            total_paid=q(row.total_payment_nominal),
            extra_paid=q(row.extra_paid),
            shortfall=q(row.shortfall),
            gap_debt=q(row.gap_debt),
            gap_interest=q(row.gap_interest),
            gap_borrowed=q(row.gap_borrowed),
            gap_repaid=q(row.gap_repaid),
            gap_from_savings=q(row.gap_from_savings),
        ))
    return points


def _gap_fields(result) -> dict:
    """Gap borrowing summary for a SimulateResponse (grill #38)."""
    g = result.gap_rate
    return dict(
        gap_rate=g.annual_rate if g else None,
        gap_rate_basis=g.basis if g else None,
        gap_rate_source=g.source if g else None,
        total_gap_interest=_cents(result.total_gap_interest),
    )


def _gap_closed(user, req, kwargs, result) -> GapClosedOut | None:
    """Live test #16: the plan with this month's gap closed (spending cut
    by the month-1 shortfall), for "<date> if the ₹X gap closes"."""
    if not result.months or result.months[0].shortfall <= 0:
        return None
    cut = result.months[0].shortfall
    kw = dict(kwargs)
    if kw.get("goals") is not None:
        kw["goals"] = deepcopy(kw["goals"])
    closed = simulate_plan(
        user, strategy=req.strategy, horizon_months=req.horizon_months,
        marginal_rate=req.marginal_rate, expense_delta=cut, **kw,
    )
    return GapClosedOut(
        cut=cut.quantize(_CENT, rounding=ROUND_HALF_UP),
        debt_free_month=closed.debt_free_month,
        total_interest_paid=closed.total_interest_paid.quantize(_CENT, rounding=ROUND_HALF_UP),
    )


def _plan_kwargs(req: SimulateRequest | CompareRequest) -> dict:
    """The plan's own settings as simulate_plan keyword arguments, shared
    by /simulate and the what-if compare so both run the same plan.
    Goal states are fresh (the engine fills them in place)."""
    return dict(
        matched_contribution=req.matched_contribution,
        simple_mode=req.simple_mode,
        simulation_start_month=req.simulation_start_month,
        # Empty list → None → no reinvest logic runs.
        reinvest_events=(
            [(e.month, e.amount) for e in req.reinvest_events]
            if req.reinvest_events else None
        ),
        inflate_expenses=req.inflate_expenses,
        lifecycle_events=(
            _to_engine_lifecycle(req.lifecycle_events) if req.lifecycle_events else None
        ),
        ef_top_up_rate=req.ef_top_up_rate,
        goals=_build_goal_states(req.goals) if req.goals else None,
        debt_budget=req.debt_budget,
        gap_as_debt=req.gap_as_debt,
    )


def _never_clears(result, user) -> bool:
    """Not cleared within the horizon while something is owed."""
    owed = any(l.outstanding > 0 for l in user.loans)
    return owed and result.debt_free_month is None


def _non_amortising_response(user, result) -> SimulateResponse | None:
    """Live re-test NEW-3: a loan whose EMI doesn't cover its interest, in a
    plan that never clears (no extra payment rescues it). Say so explicitly
    and return no schedule, instead of a 1,200-month run whose compounded
    totals the UI printed as 25-digit figures. A plan whose extra payments
    do clear it is returned as normal."""
    bad = non_amortising_loans(user)
    if not bad or result.debt_free_month is not None:
        return None
    return SimulateResponse(
        debt_free_month=None,
        total_interest_paid=D("0"),
        total_invested=D("0"),
        trajectory=[],
        months_in_horizon=0,
        never_clears=True,
        non_amortising=[
            NonAmortisingOut(
                loan_index=b.loan_index,
                monthly_interest=b.monthly_interest,
                scheduled_emi=b.scheduled_emi,
            )
            for b in bad
        ],
    )


@router.post("/simulate", response_model=SimulateResponse)
def simulate(req: SimulateRequest) -> SimulateResponse:
    user = req.user.to_engine()
    # simulate_plan mutates these goal states (saved_so_far, saved_at_target);
    # afterwards they carry the end-of-trajectory state for the fill rates.
    # The snapshot builder below gets its own fresh copy.
    kwargs = _plan_kwargs(req)
    goal_states = kwargs["goals"]
    # A fresh copy for the gap-closed run (simulate_plan fills goal states).
    closed_kwargs = {**kwargs, "goals": deepcopy(goal_states)}
    result = simulate_plan(
        user, strategy=req.strategy, horizon_months=req.horizon_months,
        marginal_rate=req.marginal_rate, **kwargs,
    )
    stop = _non_amortising_response(user, result)
    if stop is not None:
        return stop
    return SimulateResponse(
        **_gap_fields(result),
        gap_closed=_gap_closed(user, req, closed_kwargs, result),
        debt_free_month=result.debt_free_month,
        total_interest_paid=result.total_interest_paid,
        total_invested=result.total_invested,
        trajectory=_to_trajectory(result, user.loans, user),
        months_in_horizon=len(result.months),
        shortfall=result.months[0].shortfall if result.months else D("0"),
        surplus_allocation=_build_surplus_allocation(
            user,
            matched_contribution=req.matched_contribution,
            ef_split=req.ef_top_up_rate,
            ef_preempted=req.ef_preempted,
            goal_states=_build_goal_states(req.goals) if req.goals else None,
            simple_mode=req.simple_mode,
            surplus_override=result.months[0].available_surplus if result.months else None,
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
        payoff_order_method=result.payoff_order_method,
        payoff_order_note=result.payoff_order_note,
        pmi_events=_pmi_events(result, user),
        never_clears=_never_clears(result, user),
    )


def _pmi_events(result, user) -> list:
    """When the plan's PMI / FHA MIP ends (grill #34): a lifecycle event."""
    from api.schemas import PmiEventOut
    from engine.us_loans import mortgage_insurance_kind
    out = []
    for idx, m in sorted(result.pmi_end_months.items()):
        kind = mortgage_insurance_kind(user.loans[idx]) or "pmi"
        note = (
            f"PMI ends after month {m}: the balance reaches 80% of the home's original value, so you can "
            "ask your servicer in writing to cancel it (CFPB)."
            if kind == "pmi" else
            f"FHA mortgage insurance ends after month {m}, the months of MIP you entered."
        )
        out.append(PmiEventOut(loan_index=idx, last_paid_month=m, kind=kind, note=note))
    return out


@router.post("/goals/tradeoff", response_model=GoalTradeoffResponse)
def goals_tradeoff(req: GoalTradeoffRequest) -> GoalTradeoffResponse:
    """Roadmap PR F: per goal, the interest cost of funding it now (before
    high-interest debt) against debt first. Two plan runs per goal."""
    user = req.user.to_engine()
    kwargs = _plan_kwargs(req)
    goals = kwargs.pop("goals") or []
    ids = [g.id for g in goals if not req.goal_ids or g.id in req.goal_ids][:10]
    out = []
    for gid in ids:
        t = goal_tradeoff(user, goals, gid, strategy=req.strategy, horizon_months=req.horizon_months,
                          marginal_rate=req.marginal_rate, **kwargs)
        out.append(GoalTradeoffOut(**t.__dict__))
    return GoalTradeoffResponse(tradeoffs=out)


@router.post("/baseline", response_model=SimulateResponse)
def baseline(req: BaselineRequest) -> SimulateResponse:
    user = req.user.to_engine()
    result = baseline_minimums_only(
        user, horizon_months=req.horizon_months, simple_mode=req.simple_mode,
        lifecycle_events=(
            _to_engine_lifecycle(req.lifecycle_events) if req.lifecycle_events else None
        ),
        gap_as_debt=req.gap_as_debt,
    )
    stop = _non_amortising_response(user, result)
    if stop is not None:
        return stop
    return SimulateResponse(
        **_gap_fields(result),
        debt_free_month=result.debt_free_month,
        total_interest_paid=result.total_interest_paid,
        total_invested=result.total_invested,
        trajectory=_to_trajectory(result, user.loans, user),
        months_in_horizon=len(result.months),
        shortfall=result.months[0].shortfall if result.months else D("0"),
        # Baseline endpoint runs minimums-only — the engine doesn't route
        # any surplus, so no allocation breakdown to return.
        surplus_allocation=None,
        never_clears=_never_clears(result, user),
    )


@router.post("/sensitivity/compare", response_model=CompareResponse)
def sensitivity_compare(req: CompareRequest) -> CompareResponse:
    """Runs baseline vs scenario and diffs them. Exactly one what-if knob
    should be set per request — if multiple are set, they stack."""
    user = req.user.to_engine()
    plan = _plan_kwargs(req)
    sm = plan.pop("simulation_start_month")
    base = simulate_plan(
        user, strategy=req.strategy, horizon_months=req.horizon_months,
        marginal_rate=req.marginal_rate, simulation_start_month=sm,
        **{**plan, "goals": deepcopy(plan["goals"])},
    )

    scenario_user = deepcopy(user)
    scenario_result = base
    tenure = None
    if req.surplus_delta is not None:
        scenario_result = with_surplus_delta(
            scenario_user, req.surplus_delta, strategy=req.strategy,
            horizon_months=req.horizon_months, marginal_rate=req.marginal_rate,
            start_month=req.surplus_delta_start_month,
            spending_cut=req.spending_cut,
            simulation_start_month=sm, plan=plan,
        )
    elif req.income_shock_months is not None:
        scenario_result = with_income_shock(
            scenario_user, req.income_shock_months, strategy=req.strategy,
            horizon_months=req.horizon_months, marginal_rate=req.marginal_rate,
            simulation_start_month=sm, plan=plan,
        )
    elif req.rate_shock_delta is not None:
        scenario_result = with_rate_shock(
            scenario_user, req.rate_shock_delta, strategy=req.strategy,
            horizon_months=req.horizon_months, marginal_rate=req.marginal_rate,
            floating_only=req.rate_shock_floating_only,
            simulation_start_month=sm, plan=plan,
        )
    elif req.alt_strategy is not None:
        scenario_result = with_strategy(
            scenario_user, req.alt_strategy, horizon_months=req.horizon_months,
            marginal_rate=req.marginal_rate,
            simulation_start_month=sm, plan=plan,
        )
    elif req.tenure_extension_loan_index is not None and req.tenure_extension_months is not None:
        # Live test #26: the same plan with one loan over a longer tenure.
        try:
            stretched, tenure = stretch_tenure(
                scenario_user, req.tenure_extension_loan_index, req.tenure_extension_months,
            )
        except ValueError as e:
            raise HTTPException(status_code=422, detail=str(e))
        kw = {**plan, "goals": deepcopy(plan["goals"])}
        scenario_result = simulate_plan(
            stretched, strategy=req.strategy, horizon_months=req.horizon_months,
            marginal_rate=req.marginal_rate, simulation_start_month=sm, **kw,
        )
    elif req.lump_sum_amount is not None and req.lump_sum_target_loan_index is not None:
        scenario_result = with_lump_sum(
            scenario_user, req.lump_sum_amount, req.lump_sum_target_loan_index,
            strategy=req.strategy, horizon_months=req.horizon_months,
            marginal_rate=req.marginal_rate,
            simulation_start_month=sm, plan=plan,
        )

    if non_amortising_loans(user) and base.debt_free_month is None:
        # Live re-test NEW-3: a loan that never clears; no unbounded totals.
        return CompareResponse(
            baseline_debt_free_month=None, scenario_debt_free_month=scenario_result.debt_free_month,
            months_pulled_forward=D("0"), interest_saved=D("0"), extra_invested=D("0"),
            baseline_total_interest=D("0"), scenario_total_interest=D("0"),
            baseline_never_clears=True,
            scenario_never_clears=_never_clears(scenario_result, user),
        )
    diff = compare(base, scenario_result)
    t = tenure
    return CompareResponse(
        baseline_shortfall=base.months[0].shortfall if base.months else D("0"),
        scenario_shortfall=scenario_result.months[0].shortfall if scenario_result.months else D("0"),
        tenure_old_emi=t.old_emi.quantize(_CENT, rounding=ROUND_HALF_UP) if t else None,
        tenure_new_emi=t.new_emi.quantize(_CENT, rounding=ROUND_HALF_UP) if t else None,
        tenure_old_months=t.old_tenure if t else None,
        tenure_new_months=t.new_tenure if t else None,
        baseline_debt_free_month=diff["debt_free_month_baseline"],
        scenario_debt_free_month=diff["debt_free_month_scenario"],
        months_pulled_forward=diff["months_pulled_forward"],
        interest_saved=diff["interest_saved"],
        extra_invested=diff["extra_invested"],
        baseline_total_interest=base.total_interest_paid,
        scenario_total_interest=scenario_result.total_interest_paid,
        baseline_never_clears=_never_clears(base, user),
        scenario_never_clears=_never_clears(scenario_result, user),
    )
