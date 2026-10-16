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
from engine.plan_end import shown_debt_free_month
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
    """Diff two simulation runs into a small dict the UI can render directly.
    A capped run (C11) has no date to diff (UX walkthrough fix 2)."""
    b_dfm, s_dfm = shown_debt_free_month(baseline), shown_debt_free_month(scenario)
    months_delta = D("0")
    if b_dfm and s_dfm:
        months_delta = D(b_dfm - s_dfm)
    elif baseline.debt_free_month is None and s_dfm:
        # The baseline never finishes inside its horizon: the what-if pulls
        # the date forward by at least horizon - scenario (was reported as 0).
        months_delta = D(max(0, len(baseline.months) - s_dfm))
    return {
        "debt_free_month_baseline": b_dfm,
        "debt_free_month_scenario": s_dfm,
        "months_pulled_forward": months_delta,
        "interest_saved": baseline.total_interest_paid - scenario.total_interest_paid,
        "extra_invested": scenario.total_invested - baseline.total_invested,
    }


# ─── Payoff-date range (grill #24) ──────────────────────────────────────────
#
# The headline debt-free month is one deterministic path: today's rates,
# today's pay. Home shows that exact month AND a range, with the reason for
# each edge, built from the few things that most often move a payoff date:
#   • floating rates 1 point lower / higher from the next month
#     (floating loans only, applied as a rate reset; see with_rate_shock);
#   • one month with no take-home pay (a job gap, a medical month);
#   • one extra month of take-home pay arriving now (a bonus or refund),
#     paid to the dearest loan as an extra payment.
# Named scenarios rather than Monte Carlo: loan rates move in steps that
# central-bank decisions drive, not as random noise, and each scenario is a
# sentence a person can check. Five simulator runs, not five thousand.
#
# On a rate rise an Indian loan now holds its EMI and extends its tenure
# (Audit 80+ C1, engine/contract.py; US loans and loans set to "raise_emi"
# keep the end date), so the later edge reflects the longer tenure.

RANGE_RATE_BAND = D("0.01")      # ±1 percentage point on floating loans
RANGE_INCOME_MONTHS = 1          # ±1 month of take-home pay


def debt_free_range(
    user: User,
    strategy: Strategy = Strategy.AVALANCHE,
    horizon_months: int = 360,
    marginal_rate: Decimal | None = None,
    simulation_start_month: int = 1,
    plan: dict | None = None,
    rate_band: Decimal = RANGE_RATE_BAND,
    income_months: int = RANGE_INCOME_MONTHS,
    baseline: SimulationResult | None = None,
) -> dict:
    """The exact debt-free month plus an earliest–latest range.

    Returns {exact, earliest, latest, scenarios: [...], has_floating,
    open_ended}. Each scenario is {id, label, why, debt_free_month,
    shift_months} (shift > 0 = later than exact). `None` months mean "not
    paid off inside the horizon"; `open_ended` is then True and the UI says
    "after <horizon>" for that edge rather than inventing a date.
    """
    base = baseline or _run(user, strategy, horizon_months, marginal_rate,
                            simulation_start_month, plan)
    exact = shown_debt_free_month(base)
    has_floating = any(l.rate_type == "floating" and l.outstanding > 0 for l in user.loans)
    scenarios: list[tuple[str, str, str, SimulationResult]] = []

    if has_floating and rate_band > 0:
        pts = f"{rate_band * 100:.0f}"
        scenarios.append((
            "rate_down", f"Floating rates {pts} point lower",
            "Your bank's benchmark (repo or SOFR) is cut and the cut is passed on.",
            with_rate_shock(user, -rate_band, strategy, horizon_months, marginal_rate,
                            simulation_start_month=simulation_start_month, plan=plan)))
        scenarios.append((
            "rate_up", f"Floating rates {pts} point higher",
            "Your bank's benchmark rises. The plan assumes the EMI goes up to keep "
            "the end date; if your bank extends the tenure instead, it ends later still.",
            with_rate_shock(user, rate_band, strategy, horizon_months, marginal_rate,
                            simulation_start_month=simulation_start_month, plan=plan)))

    if income_months > 0 and user.monthly_income > 0:
        word = "month" if income_months == 1 else "months"
        scenarios.append((
            "income_gap", f"{income_months} {word} with no pay",
            "A gap between jobs or a month off work. Minimums are still paid, from savings.",
            with_income_shock(user, income_months, strategy, horizon_months, marginal_rate,
                              simulation_start_month=simulation_start_month, plan=plan)))
        kw = dict(plan or {})
        bonus = [(1, user.monthly_income * D(income_months))]
        kw["reinvest_events"] = list(kw.get("reinvest_events") or []) + bonus
        scenarios.append((
            "income_bonus", f"{income_months} extra {word} of pay",
            "A bonus, refund or gift, paid now to your dearest loan.",
            _run(user, strategy, horizon_months, marginal_rate, simulation_start_month, kw)))

    def shift(m: int | None) -> int | None:
        if exact is None or m is None:
            return None
        return m - exact

    rows = [
        {"id": sid, "label": label, "why": why, "debt_free_month": shown_debt_free_month(r),
         "shift_months": shift(shown_debt_free_month(r))}
        for sid, label, why, r in scenarios
    ]
    months = [exact] + [r["debt_free_month"] for r in rows]
    known = [m for m in months if m is not None]
    open_ended = any(m is None for m in months)
    return {
        "exact": exact,
        "earliest": min(known) if known else None,
        # An edge that never pays off inside the horizon is open-ended (None).
        "latest": None if open_ended else (max(known) if known else None),
        "scenarios": rows,
        "has_floating": has_floating,
        "open_ended": open_ended,
        "rate_band": rate_band,
        "income_months": income_months,
    }
