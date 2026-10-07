"""Sensitivity / what-if engine — drives the Plan-screen sliders (§3.4).

Five scenarios from the spec:
  • surplus_delta — "What if surplus +₹5k?" (or any signed delta)
  • income_shock  — "What if I lose my job for N months?" (income=0 those months)
  • rate_shock    — "What if RBI cuts 50bps?" (apply Δr to all floating-rate loans)
  • strategy      — re-run with a different Layer 2 strategy
  • lump_sum      — "What if I drop a one-time ₹X today?"

Each returns a SimulationResult so the UI can diff debt_free_month and total_interest.

`plan` carries the rest of the plan's own settings (goals, emergency-fund
split, planned events, rising costs, reinvested refunds...) as
simulate_plan keyword arguments, so a what-if changes one thing against
the plan the user sees. Without it the sliders ran a plainer plan and
their "before" date could differ from /plan's.
"""
from decimal import Decimal
from copy import deepcopy
from engine.models import LifecycleEvent, LifecycleEventKind, User
from engine.simulation import simulate_plan, SimulationResult
from engine.ordering import Strategy
from engine.surplus import from_user_currency

D = Decimal


def _run(
    user: User,
    strategy: Strategy,
    horizon_months: int,
    marginal_rate: Decimal | None,
    simulation_start_month: int,
    plan: dict | None,
    extra_events: list[LifecycleEvent] | None = None,
    **overrides,
) -> SimulationResult:
    """simulate_plan with the plan's settings, plus this scenario's own.
    Goal states are copied per run (the engine fills them in place)."""
    kw = dict(plan or {})
    if kw.get("goals") is not None:
        kw["goals"] = deepcopy(kw["goals"])
    events = list(kw.pop("lifecycle_events", None) or []) + list(extra_events or [])
    kw.update(overrides)
    return simulate_plan(
        user, strategy, horizon_months,
        marginal_rate=marginal_rate,
        simulation_start_month=simulation_start_month,
        lifecycle_events=events or None,
        **kw,
    )


def with_surplus_delta(
    user: User,
    delta: Decimal,
    strategy: Strategy = Strategy.AVALANCHE,
    horizon_months: int = 360,
    marginal_rate: Decimal | None = None,
    start_month: int = 1,
    simulation_start_month: int = 1,
    plan: dict | None = None,
    spending_cut: bool = False,
) -> SimulationResult:
    """`delta` adds to monthly_income (positive or negative), or reduces
    expenses when `spending_cut=True`. A cut then follows the saved
    expense bucket through inflation and leaves future salary resets intact.

    If `start_month > 1`, the delta is deferred — useful for "I'll cut my
    fixed expenses by ₹5k from month 6 onwards" what-if scenarios. Defaults
    to month 1 (apply from start) so existing callers behave unchanged.
    """
    delta_args = (
        dict(expense_delta=delta, expense_delta_from_month=max(1, start_month))
        if spending_cut else dict(income_delta=delta, income_delta_from_month=max(1, start_month))
    )
    return _run(
        user, strategy, horizon_months, marginal_rate, simulation_start_month, plan,
        **delta_args,
    )


def with_income_shock(
    user: User,
    shock_months: int,
    strategy: Strategy = Strategy.AVALANCHE,
    horizon_months: int = 360,
    marginal_rate: Decimal | None = None,
    simulation_start_month: int = 1,
    plan: dict | None = None,
) -> SimulationResult:
    """No take-home pay for the first `shock_months`, then back to today's.

    Minimums are still paid in those months (from savings); nothing extra
    goes to the debt. The old version took the lost pay out of
    `savings_balance`, which the simulation never reads, so a six-month
    job loss came out identical to no job loss.
    """
    # The engine zeroes take-home for the window itself (P2-09 / income
    # restore): planned salary resets and hikes still move the underlying
    # pay, so a reset planned inside the window applies once it ends and the
    # pay after the shock is whatever the plan says by then, not today's.
    return _run(
        user, strategy, horizon_months + shock_months, marginal_rate,
        simulation_start_month, plan, income_shock_months=max(0, shock_months),
    )


def with_rate_shock(
    user: User,
    delta_decimal: Decimal,
    strategy: Strategy = Strategy.AVALANCHE,
    horizon_months: int = 360,
    marginal_rate: Decimal | None = None,
    floating_only: bool = True,
    simulation_start_month: int = 1,
    plan: dict | None = None,
) -> SimulationResult:
    """`delta_decimal` is signed (e.g. D('-0.005') for a 50bps cut).
    By default applies only to floating-rate loans.

    Applied as a rate reset in month 1, so a rise raises the EMI the way
    a bank must (no negative amortisation). Changing the rate alone kept
    the EMI, and a +4 point shock grew a ₹30L loan to ₹7.5 crore.
    """
    events = [
        LifecycleEvent(
            kind=LifecycleEventKind.FLOATING_RATE_RESET, effective_month=1,
            loan_index=i, new_rate=max(D("0"), l.nominal_rate + delta_decimal),
        )
        for i, l in enumerate(user.loans)
        if not (floating_only and l.rate_type != "floating")
    ]
    return _run(
        user, strategy, horizon_months, marginal_rate,
        simulation_start_month, plan, extra_events=events,
    )


def with_strategy(
    user: User,
    strategy: Strategy,
    horizon_months: int = 360,
    marginal_rate: Decimal | None = None,
    simulation_start_month: int = 1,
    plan: dict | None = None,
) -> SimulationResult:
    """Re-run with a different Layer 2 strategy."""
    return _run(user, strategy, horizon_months, marginal_rate, simulation_start_month, plan)


def with_lump_sum(
    user: User,
    amount: Decimal,
    target_loan_index: int,
    strategy: Strategy = Strategy.AVALANCHE,
    horizon_months: int = 360,
    marginal_rate: Decimal | None = None,
    simulation_start_month: int = 1,
    plan: dict | None = None,
) -> SimulationResult:
    """Apply `amount` (in the user's currency) upfront to
    `user.loans[target_loan_index]` before simulating.

    The amount is converted to the loan's currency (P2-07), the bank's
    prepayment fee comes out of it, and a loan that can't take an extra
    payment yet (lock-in / pre-EMI) is left as it is.
    """
    u = deepcopy(user)
    if 0 <= target_loan_index < len(u.loans):
        l = u.loans[target_loan_index]
        if l.pre_emi_months_remaining <= 0 and l.prepay_lock_in_months <= 0:
            in_loan_ccy = from_user_currency(amount, l, u)
            to_principal = in_loan_ccy * (D("1") - (l.prepayment_penalty_pct or D("0")))
            l.outstanding = max(D("0"), l.outstanding - to_principal)
    return _run(u, strategy, horizon_months, marginal_rate, simulation_start_month, plan)


def compare(
    baseline: SimulationResult,
    scenario: SimulationResult,
) -> dict:
    """Diff two simulation runs into a small dict the UI can render directly."""
    months_delta = D("0")
    if baseline.debt_free_month and scenario.debt_free_month:
        months_delta = D(baseline.debt_free_month - scenario.debt_free_month)
    elif baseline.debt_free_month is None and scenario.debt_free_month:
        # The baseline never finishes inside its horizon: the what-if pulls
        # the date forward by at least horizon - scenario (was reported as 0).
        months_delta = D(max(0, len(baseline.months) - scenario.debt_free_month))
    return {
        "debt_free_month_baseline": baseline.debt_free_month,
        "debt_free_month_scenario": scenario.debt_free_month,
        "months_pulled_forward": months_delta,
        "interest_saved": baseline.total_interest_paid - scenario.total_interest_paid,
        "extra_invested": scenario.total_invested - baseline.total_invested,
    }
