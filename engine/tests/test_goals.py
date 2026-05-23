"""Tests for engine.goals.serial_fill_allocation."""
from decimal import Decimal

from engine.goals import GoalState, serial_fill_allocation

D = Decimal


def _g(
    gid: str,
    target: int,
    required: str,
    *,
    saved: str = "0",
    bump: bool = False,
    order_index: int | None = None,
) -> GoalState:
    return GoalState(
        id=gid,
        target_month_index=target,
        required_amount=D(required),
        saved_so_far=D(saved),
        priority_bump=bump,
        order_index=order_index,
    )


def test_zero_surplus_returns_empty():
    goals = [_g("g1", 12, "12000")]
    out = serial_fill_allocation(goals, D("0"), current_sim_month=0)
    assert out.contributions == []
    assert out.total_outflow == D("0")
    assert goals[0].saved_so_far == D("0")


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
