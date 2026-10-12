"""Sprint G4 (grill #24): the exact debt-free month plus a range."""
from decimal import Decimal
from engine.sensitivity import debt_free_range, with_rate_shock
from engine.simulation import simulate_plan
from engine.tests.test_sensitivity import _user
from engine.ordering import Strategy

D = Decimal


def test_range_brackets_the_exact_month():
    u = _user()
    r = debt_free_range(u)
    exact = simulate_plan(u, Strategy.AVALANCHE, 360).debt_free_month
    assert r["exact"] == exact
    assert r["earliest"] <= exact <= r["latest"]
    ids = [s["id"] for s in r["scenarios"]]
    assert ids == ["rate_down", "rate_up", "income_gap", "income_bonus"]


def test_each_scenario_moves_the_right_way():
    r = debt_free_range(_user())
    by = {s["id"]: s for s in r["scenarios"]}
    assert by["rate_down"]["shift_months"] <= 0
    assert by["rate_up"]["shift_months"] >= 0
    assert by["income_gap"]["shift_months"] >= 0
    assert by["income_bonus"]["shift_months"] <= 0
    # A real home loan + card persona: the range is not a single month.
    assert r["latest"] > r["earliest"]
    for s in r["scenarios"]:
        assert s["why"] and s["label"]


def test_rate_up_edge_equals_a_one_point_rate_shock():
    u = _user()
    r = debt_free_range(u)
    up = with_rate_shock(u, D("0.01")).debt_free_month
    assert {s["id"]: s for s in r["scenarios"]}["rate_up"]["debt_free_month"] == up


def test_no_floating_loans_means_no_rate_rows():
    u = _user()
    for l in u.loans:
        l.rate_type = "fixed"
    r = debt_free_range(u)
    assert not r["has_floating"]
    assert [s["id"] for s in r["scenarios"]] == ["income_gap", "income_bonus"]


def test_range_does_not_mutate_the_user():
    u = _user()
    before = [(l.outstanding, l.nominal_rate, l.scheduled_emi) for l in u.loans]
    debt_free_range(u)
    assert [(l.outstanding, l.nominal_rate, l.scheduled_emi) for l in u.loans] == before


def test_open_ended_when_an_edge_never_pays_off():
    u = _user()
    r = debt_free_range(u, horizon_months=24)   # 20-yr home loan can't clear in 2 years
    assert r["exact"] is None and r["open_ended"] and r["latest"] is None


def test_golden_persona_range():
    """Golden: the test persona (₹40L home loan at 8.5% floating + ₹1L card,
    ₹1.5L take-home). Pinned so any engine change that moves the range is a
    deliberate, reviewed fixture update."""
    r = debt_free_range(_user())
    got = (r["exact"], r["earliest"], r["latest"],
           tuple(s["debt_free_month"] for s in r["scenarios"]))
    assert got == GOLDEN, got


GOLDEN = (56, 53, 57, (54, 57, 57, 53))  # exact, earliest, latest, per scenario
