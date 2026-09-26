"""Sensitivity / what-if engine — drives the Plan-screen sliders (§3.4).

Five scenarios from the spec:
  • surplus_delta — "What if surplus +₹5k?" (or any signed delta)
  • income_shock  — "What if I lose my job for N months?" (income=0 those months)
  • rate_shock    — "What if RBI cuts 50bps?" (apply Δr to all floating-rate loans)
  • strategy      — re-run with a different Layer 2 strategy
  • lump_sum      — "What if I drop a one-time ₹X today?"

Each returns a SimulationResult so the UI can diff debt_free_month and total_interest.
"""
from decimal import Decimal
from copy import deepcopy
from engine.models import LifecycleEvent, LifecycleEventKind, User
from engine.simulation import simulate_plan, SimulationResult
from engine.ordering import Strategy

D = Decimal


def with_surplus_delta(
    user: User,
    delta: Decimal,
    strategy: Strategy = Strategy.AVALANCHE,
    horizon_months: int = 360,
    marginal_rate: Decimal | None = None,
    start_month: int = 1,
    simulation_start_month: int = 1,
) -> SimulationResult:
    """`delta` adds to monthly_income (positive or negative).

    If `start_month > 1`, the delta is deferred — useful for "I'll cut my
    fixed expenses by ₹5k from month 6 onwards" what-if scenarios. Defaults
    to month 1 (apply from start) so existing callers behave unchanged.
    """
    return simulate_plan(
        user,
        strategy,
        horizon_months,
        marginal_rate=marginal_rate,
        income_delta=delta,
        income_delta_from_month=max(1, start_month),
        simulation_start_month=simulation_start_month,
    )


def with_income_shock(
    user: User,
    shock_months: int,
    strategy: Strategy = Strategy.AVALANCHE,
    horizon_months: int = 360,
    marginal_rate: Decimal | None = None,
    simulation_start_month: int = 1,
) -> SimulationResult:
    """No take-home pay for the first `shock_months`, then back to today's.

    Minimums are still paid in those months (from savings); nothing extra
    goes to the debt. The old version took the lost pay out of
    `savings_balance`, which the simulation never reads, so a six-month
    job loss came out identical to no job loss.
    """
    events: list[LifecycleEvent] = []
    if shock_months > 0:
        events.append(LifecycleEvent(
            kind=LifecycleEventKind.SALARY_RESET, effective_month=1,
            new_monthly_take_home=D("0"),
        ))
        events.append(LifecycleEvent(
            kind=LifecycleEventKind.SALARY_RESET, effective_month=shock_months + 1,
            new_monthly_take_home=user.monthly_income,
        ))
    # Push horizon out by the shock window
    return simulate_plan(
        user, strategy, horizon_months + shock_months,
        marginal_rate=marginal_rate,
        simulation_start_month=simulation_start_month,
        lifecycle_events=events or None,
    )


def with_rate_shock(
    user: User,
    delta_decimal: Decimal,
    strategy: Strategy = Strategy.AVALANCHE,
    horizon_months: int = 360,
    marginal_rate: Decimal | None = None,
    floating_only: bool = True,
    simulation_start_month: int = 1,
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
    return simulate_plan(
        user, strategy, horizon_months,
        marginal_rate=marginal_rate,
        simulation_start_month=simulation_start_month,
        lifecycle_events=events or None,
    )


def with_strategy(
    user: User,
    strategy: Strategy,
    horizon_months: int = 360,
    marginal_rate: Decimal | None = None,
    simulation_start_month: int = 1,
) -> SimulationResult:
    """Re-run with a different Layer 2 strategy."""
    return simulate_plan(
        user, strategy, horizon_months,
        marginal_rate=marginal_rate,
        simulation_start_month=simulation_start_month,
    )


def with_lump_sum(
    user: User,
    amount: Decimal,
    target_loan_index: int,
    strategy: Strategy = Strategy.AVALANCHE,
    horizon_months: int = 360,
    marginal_rate: Decimal | None = None,
    simulation_start_month: int = 1,
) -> SimulationResult:
    """Apply `amount` upfront to `user.loans[target_loan_index]` before simulating."""
    u = deepcopy(user)
    if 0 <= target_loan_index < len(u.loans):
        l = u.loans[target_loan_index]
        l.outstanding = max(D("0"), l.outstanding - amount)
    return simulate_plan(
        u, strategy, horizon_months,
        marginal_rate=marginal_rate,
        simulation_start_month=simulation_start_month,
    )


def compare(
    baseline: SimulationResult,
    scenario: SimulationResult,
) -> dict:
    """Diff two simulation runs into a small dict the UI can render directly."""
    months_delta = D("0")
    if baseline.debt_free_month and scenario.debt_free_month:
        months_delta = D(baseline.debt_free_month - scenario.debt_free_month)
    return {
        "debt_free_month_baseline": baseline.debt_free_month,
        "debt_free_month_scenario": scenario.debt_free_month,
        "months_pulled_forward": months_delta,
        "interest_saved": baseline.total_interest_paid - scenario.total_interest_paid,
        "extra_invested": scenario.total_invested - baseline.total_invested,
    }
