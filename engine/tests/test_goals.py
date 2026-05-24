"""Tests for engine.goals.serial_fill_allocation."""
from decimal import Decimal

from engine.goals import (
    GoalState,
    serial_fill_allocation,
)

D = Decimal


def _g(
    gid: str,
    target: int,
    required: str,
    *,
    saved: str = "0",
    bump: bool = False,
    order_index: int | None = None,
    funding_start: int | None = None,
) -> GoalState:
    return GoalState(
        id=gid,
        target_month_index=target,
        required_amount=D(required),
        saved_so_far=D(saved),
        priority_bump=bump,
        order_index=order_index,
        funding_start_month_index=funding_start,
    )


def test_zero_surplus_emits_surplus_exhausted_for_active_goals():
    # Even with no surplus, the allocator still emits a row per goal
    # so the UI can render "this goal got nothing because surplus was
    # 0". Saved_so_far is not mutated.
    goals = [_g("g1", 12, "12000")]
    out = serial_fill_allocation(goals, D("0"), current_sim_month=0)
    assert len(out.contributions) == 1
    assert out.contributions[0].amount == D("0")
    assert out.contributions[0].queued_reason == "surplus_exhausted"
    assert out.total_outflow == D("0")
    assert out.any_goal_short is True
    assert goals[0].saved_so_far == D("0")


def test_zero_surplus_still_emits_past_date_and_over_funded():
    # The honest-status guarantee: past_date and over_funded rows
    # surface even when surplus is 0, so the UI doesn't lose signal
    # in a lean month.
    goals = [
        _g("expired", target=2, required="10000"),
        _g("done", target=12, required="5000", saved="5000"),
        _g("active", target=12, required="10000"),
    ]
    out = serial_fill_allocation(goals, D("0"), current_sim_month=5)
    by_id = {c.goal_id: c for c in out.contributions}
    assert by_id["expired"].queued_reason == "past_date"
    assert by_id["done"].queued_reason == "over_funded"
    assert by_id["active"].queued_reason == "surplus_exhausted"


def test_single_goal_fully_funded():
    # ₹12k needed in 12 months → ₹1k/mo run-rate. Surplus ₹5k easily covers.
    goals = [_g("g1", 12, "12000")]
    out = serial_fill_allocation(goals, D("5000"), current_sim_month=0)
    assert len(out.contributions) == 1
    assert out.contributions[0].amount == D("1000")
    assert out.contributions[0].queued_reason is None
    assert out.total_outflow == D("1000")
    assert goals[0].saved_so_far == D("1000")
    assert out.any_goal_short is False


def test_serial_fill_in_date_order():
    # ₹15k surplus. A needs 10k (run-rate), B needs 10k, C needs 10k.
    # → A 10k, B 5k, C 0. C surplus_exhausted.
    goals = [
        _g("a", 6, "60000"),    # run-rate 10k
        _g("b", 12, "120000"),  # run-rate 10k
        _g("c", 18, "180000"),  # run-rate 10k
    ]
    out = serial_fill_allocation(goals, D("15000"), current_sim_month=0)
    by_id = {c.goal_id: c for c in out.contributions}
    assert by_id["a"].amount == D("10000")
    assert by_id["a"].queued_reason is None
    assert by_id["b"].amount == D("5000")
    assert by_id["b"].queued_reason == "partial_fill"
    assert by_id["c"].amount == D("0")
    assert by_id["c"].queued_reason == "surplus_exhausted"
    assert out.any_goal_short is True


def test_priority_bump_jumps_ahead_of_earlier_date():
    # B is bumped — it gets surplus first even though A's date is earlier.
    # ₹10k surplus. Both have ₹10k run-rate → B fully funded, A nothing.
    goals = [
        _g("a", 6, "60000"),
        _g("b", 12, "120000", bump=True),
    ]
    out = serial_fill_allocation(goals, D("10000"), current_sim_month=0)
    by_id = {c.goal_id: c for c in out.contributions}
    assert by_id["b"].amount == D("10000")
    assert by_id["b"].queued_reason is None
    assert by_id["a"].amount == D("0")
    assert by_id["a"].queued_reason == "surplus_exhausted"


def test_order_index_overrides_target_date_within_group():
    # Both bumped — order_index controls sequence. B's order_index=0 wins.
    goals = [
        _g("a", 6, "60000", bump=True, order_index=1),
        _g("b", 12, "120000", bump=True, order_index=0),
    ]
    out = serial_fill_allocation(goals, D("10000"), current_sim_month=0)
    # B should be processed first → B gets 10k, A gets 0.
    by_id = {c.goal_id: c for c in out.contributions}
    assert by_id["b"].amount == D("10000")
    assert by_id["a"].amount == D("0")


def test_past_date_goal_queued():
    # current_sim_month=5, target_month_index=3 → expired.
    goals = [_g("g1", 3, "10000")]
    out = serial_fill_allocation(goals, D("5000"), current_sim_month=5)
    assert len(out.contributions) == 1
    assert out.contributions[0].amount == D("0")
    assert out.contributions[0].queued_reason == "past_date"


def test_over_funded_goal_queued():
    # required=10k, already saved 10k → over_funded.
    goals = [_g("g1", 12, "10000", saved="10000")]
    out = serial_fill_allocation(goals, D("5000"), current_sim_month=0)
    assert out.contributions[0].queued_reason == "over_funded"
    assert out.contributions[0].amount == D("0")


def test_saved_so_far_accumulates_across_months():
    goals = [_g("g1", 12, "12000")]
    for m in range(3):
        out = serial_fill_allocation(goals, D("5000"), current_sim_month=m)
        # Each month: remaining ÷ months_remaining → constant 1000/mo run-rate
        # because we always have exactly enough months left.
        assert out.contributions[0].amount == D("1000")
    assert goals[0].saved_so_far == D("3000")


def test_saved_at_target_snapshots_on_target_month():
    # Goal hits target at month 6 — saved_at_target should snapshot
    # at the first month current_sim_month >= 6.
    goals = [_g("g1", 6, "6000")]
    for m in range(6):
        serial_fill_allocation(goals, D("5000"), current_sim_month=m)
    # After 6 months of 1k contributions, saved is 6000 (run-rate × 6).
    assert goals[0].saved_so_far == D("6000")
    assert goals[0].saved_at_target is None  # target month not yet reached
    # Month 6 (current_sim_month == target_month_index) → snapshot fires.
    serial_fill_allocation(goals, D("5000"), current_sim_month=6)
    assert goals[0].saved_at_target == D("6000")


def test_saved_at_target_snapshots_even_with_zero_surplus():
    # Surplus=0 short-circuits returns, but the snapshot pre-step
    # should still run so fill-rate badges work after the goal expires.
    goals = [_g("g1", 6, "6000", saved="3000")]
    serial_fill_allocation(goals, D("0"), current_sim_month=6)
    assert goals[0].saved_at_target == D("3000")


def test_remaining_caps_contribution_in_last_month():
    # 1-month goal needing ₹500. Surplus ₹5000. Run-rate ₹500/1=500.
    # Contribution should be capped at remaining_required (500), not the
    # full surplus.
    goals = [_g("g1", 1, "500")]
    out = serial_fill_allocation(goals, D("5000"), current_sim_month=0)
    assert out.contributions[0].amount == D("500")


def test_bumped_goals_processed_before_unbumped():
    # Bumped goal B, unbumped A with earlier date. B goes first.
    # ₹3k surplus, both have 2k run-rate.
    goals = [
        _g("a", 6, "12000"),                # run-rate 2000
        _g("b", 12, "24000", bump=True),    # run-rate 2000
    ]
    out = serial_fill_allocation(goals, D("3000"), current_sim_month=0)
    by_id = {c.goal_id: c for c in out.contributions}
    # B gets full 2k, A gets remaining 1k (partial).
    assert by_id["b"].amount == D("2000")
    assert by_id["b"].queued_reason is None
    assert by_id["a"].amount == D("1000")
    assert by_id["a"].queued_reason == "partial_fill"


def test_pool_exhaustion_yields_zero_for_later_goals():
    # Surplus exactly covers A; B + C get nothing.
    goals = [
        _g("a", 6, "30000"),    # run-rate 5000
        _g("b", 9, "45000"),    # run-rate 5000
        _g("c", 12, "60000"),   # run-rate 5000
    ]
    out = serial_fill_allocation(goals, D("5000"), current_sim_month=0)
    by_id = {c.goal_id: c for c in out.contributions}
    assert by_id["a"].amount == D("5000")
    assert by_id["a"].queued_reason is None
    assert by_id["b"].amount == D("0")
    assert by_id["b"].queued_reason == "surplus_exhausted"
    assert by_id["c"].amount == D("0")
    assert by_id["c"].queued_reason == "surplus_exhausted"
    assert out.any_goal_short is True


def test_any_goal_short_false_when_everyone_fully_funded():
    goals = [
        _g("a", 6, "30000"),    # run-rate 5000
        _g("b", 9, "45000"),    # run-rate 5000
    ]
    # Plenty of surplus → both fully funded.
    out = serial_fill_allocation(goals, D("20000"), current_sim_month=0)
    assert out.any_goal_short is False
    by_id = {c.goal_id: c for c in out.contributions}
    assert all(c.queued_reason is None for c in by_id.values())


def test_total_outflow_matches_sum_of_contributions():
    # Aggregate field must equal the per-goal sum, even in mixed states
    # (partial fill + surplus exhausted + funded).
    goals = [
        _g("a", 6, "30000"),
        _g("b", 9, "45000"),
        _g("c", 12, "60000"),
    ]
    out = serial_fill_allocation(goals, D("7500"), current_sim_month=0)
    assert out.total_outflow == sum(
        (c.amount for c in out.contributions), D("0")
    )


def test_over_funded_at_sim_start():
    # User edited target down (or reconciled actuals) so saved_so_far
    # exceeds required at sim start. Should emit over_funded, no
    # contribution, no mutation of saved_so_far.
    goals = [_g("g1", 12, "10000", saved="15000")]
    before = goals[0].saved_so_far
    out = serial_fill_allocation(goals, D("5000"), current_sim_month=0)
    assert out.contributions[0].queued_reason == "over_funded"
    assert out.contributions[0].amount == D("0")
    assert goals[0].saved_so_far == before


def test_mixed_order_index_sorts_none_last():
    # Goal a has order_index=None, goal b has order_index=0. Both
    # share priority_bump=False, so the sort key falls through to
    # order_index — None must rank AFTER 0 (handled via 10**9 sentinel).
    goals = [
        _g("a", 6, "60000"),                # order_index=None
        _g("b", 12, "120000", order_index=0),
    ]
    out = serial_fill_allocation(goals, D("10000"), current_sim_month=0)
    # b processed first → b gets 10k, a gets 0.
    by_id = {c.goal_id: c for c in out.contributions}
    assert by_id["b"].amount == D("10000")
    assert by_id["a"].amount == D("0")
    assert by_id["a"].queued_reason == "surplus_exhausted"


def test_simulate_plan_integration_threads_state_across_months():
    """End-to-end: simulate_plan should advance saved_so_far on the
    passed GoalState list across the trajectory and snapshot
    saved_at_target when the target month is reached. Uses a small
    loan so the trajectory loop actually iterates (no-loans branch
    exits at m=1 before the goal block runs)."""
    from engine.models import Country, IncomeType, Loan, LoanType, TaxRegimeIN, User
    from engine.simulation import simulate_plan

    big_loan = Loan(
        loan_type=LoanType.HOME,
        bank="HDFC Bank",
        outstanding=D("5000000"),
        nominal_rate=D("0.085"),
        rate_type="floating",
        tenure_months_remaining=240,
        scheduled_emi=D("43391"),
    )
    user = User(
        country=Country.IN, income_type=IncomeType.SALARIED,
        annual_income=D("1200000"), monthly_income=D("100000"),
        fixed_expenses=D("40000"), variable_expenses=D("0"),
        savings_balance=D("0"), primary_bank="HDFC Bank",
        tax_regime=TaxRegimeIN.NEW,
        efund_balance=D("0"), efund_target=D("0"),  # EF satisfied
        loans=[big_loan],
    )
    goals = [GoalState(
        id="g1",
        target_month_index=5,
        required_amount=D("25000"),
    )]
    result = simulate_plan(
        user,
        horizon_months=10,
        goals=goals,
    )
    # Run-rate 25000 / 5 = 5000/mo. After 5 funding months
    # (current_sim_month = 0..4), saved_so_far == 25000 and the
    # snapshot fires the first time current_sim_month >= 5.
    assert goals[0].saved_so_far == D("25000")
    assert goals[0].saved_at_target == D("25000")
    # The first-month snapshot is the engine's authoritative read of
    # what /plan should render.
    assert result.first_month_goal_allocation is not None
    assert result.first_month_goal_allocation.contributions[0].amount == D("5000")


def test_deferred_start_skips_funding_until_start_month():
    """Goal with funding_start=7 emits `deferred` rows for months 0..6
    and starts contributing at month 7. Run-rate concentrates into
    the active window (target - start = 2 months for a 9-month goal)."""
    goals = [_g("g1", target=9, required="50000", funding_start=7)]

    # Months 0..6 — every month should be deferred, no funding.
    for m in range(7):
        out = serial_fill_allocation(goals, D("30000"), current_sim_month=m)
        assert out.contributions[0].queued_reason == "deferred"
        assert out.contributions[0].amount == D("0")
        # `deferred` is NOT short — the goal is intentionally idle.
        assert out.any_goal_short is False
    assert goals[0].saved_so_far == D("0")

    # Month 7 — funding kicks in. Run-rate = 50000 / (9-7) = 25000.
    out = serial_fill_allocation(goals, D("30000"), current_sim_month=7)
    assert out.contributions[0].queued_reason is None
    assert out.contributions[0].amount == D("25000")
    assert out.any_goal_short is False
    # Month 8 — final funding month, contribution caps at remaining.
    out = serial_fill_allocation(goals, D("30000"), current_sim_month=8)
    assert out.contributions[0].amount == D("25000")
    # Goal fully funded by the deadline.
    assert goals[0].saved_so_far == D("50000")


def test_deferred_goal_does_not_consume_surplus_so_others_get_full_pool():
    """Surplus saved during the defer period is fully available to
    other goals + the EF/debt cascade. This is the whole point of
    deferring: more debt prepay until funding kicks in."""
    goals = [
        _g("deferred", target=9, required="50000", funding_start=7),
        _g("active", target=12, required="120000"),  # run-rate 10000
    ]
    # At m=0 the deferred goal is idle; active gets its full run-rate
    # (10000), leaving 20000 still in the pool for EF/debt.
    out = serial_fill_allocation(goals, D("30000"), current_sim_month=0)
    by_id = {c.goal_id: c for c in out.contributions}
    assert by_id["deferred"].queued_reason == "deferred"
    assert by_id["deferred"].amount == D("0")
    assert by_id["active"].amount == D("10000")
    # total_outflow reflects only the active goal's draw.
    assert out.total_outflow == D("10000")


