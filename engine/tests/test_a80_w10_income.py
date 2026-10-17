"""Audit 80 W10 — income that isn't one flat salary (engine/income_scenarios.py)
and the same-month hike + salary-reset fix in simulation.py.

Class-of-defect guards:
* a path with no scenario reproduces the plain simulation exactly, for any
  hike rate / hike month / start month (the path can't drift from the engine);
* a SALARY_RESET states the month's pay: no hike is stacked on it, in any
  month, for any hike month;
* a seasonal pattern averaging the same as a flat salary never shows *less*
  shortfall than the flat salary (lumpiness can't be averaged away);
* shifts compound on top of past hikes; career-switch gaps are exactly zero.
"""
from decimal import Decimal

import pytest
from hypothesis import given, settings, strategies as st

from engine.income_scenarios import (
    CareerSwitch, IncomeScenario, SalaryShift, SeasonalIncome,
    build_income_path, income_shape, plan_user, simulate_with_income, to_lifecycle_events,
)
from engine.models import (
    Country, IncomeType, LifecycleEvent, LifecycleEventKind, Loan, LoanType, User,
)
from engine.simulation import Strategy, simulate_plan

D = Decimal


def _user(income="100000", expenses="45000", hike="0.08", hike_month=4, loans=None, **kw):
    loans = loans if loans is not None else [
        Loan(LoanType.PERSONAL, "HDFC Bank", D("300000"), D("0.14"), "fixed", 36, D("10253")),
        Loan(LoanType.CREDIT_CARD, "SBI Card", D("120000"), D("0.42"), "fixed", 0, D("0")),
    ]
    kw.setdefault("savings_balance", D("0"))
    return User(country=Country.IN, income_type=IncomeType.SALARIED,
                annual_income=D(income) * 12, monthly_income=D(income),
                fixed_expenses=D(expenses), primary_bank="x", loans=loans,
                annual_hike_rate=D(hike), hike_effective_month=hike_month, **kw)


# ── the fix: a reset in the hike month is not hiked again ──────────────────

@pytest.mark.parametrize("hike_month", [1, 4, 7, 12])
def test_reset_in_hike_month_is_not_raised_by_the_hike(hike_month):
    u = _user(hike="0.10", hike_month=hike_month, loans=[
        Loan(LoanType.HOME, "SBI", D("2000000"), D("0.085"), "floating", 240, D("17356"))])
    start = 4
    from engine.simulation import _first_hike_month_index
    m = _first_hike_month_index(start, hike_month)
    ev = [LifecycleEvent(LifecycleEventKind.SALARY_RESET, m, new_monthly_take_home=D("80000"))]
    r = simulate_plan(u, Strategy.AVALANCHE, horizon_months=m + 1, lifecycle_events=ev,
                      simulation_start_month=start)
    flat = _user(income="80000", hike="0", loans=u.loans)
    rf = simulate_plan(flat, Strategy.AVALANCHE, horizon_months=1)
    # The reset month's surplus is exactly what ₹80,000 with no hike gives.
    assert r.months[m - 1].available_surplus == rf.months[0].available_surplus


def test_hike_after_a_reset_compounds_from_the_new_pay():
    u = _user(hike="0.10", hike_month=1, loans=[
        Loan(LoanType.HOME, "SBI", D("2000000"), D("0.085"), "floating", 240, D("17356"))])
    ev = [LifecycleEvent(LifecycleEventKind.SALARY_RESET, 6, new_monthly_take_home=D("80000"))]
    r = simulate_plan(u, Strategy.AVALANCHE, horizon_months=14, lifecycle_events=ev)
    # Hike at m=13 lifts 80,000 to 88,000: surplus rises by exactly 8,000.
    assert r.months[12].available_surplus - r.months[11].available_surplus == D("8000")


# ── path ⇔ engine equivalence ──────────────────────────────────────────────

@settings(max_examples=25, deadline=None)
@given(hike=st.sampled_from(["0", "0.05", "0.1"]), hike_month=st.integers(1, 12),
       start=st.integers(1, 12))
def test_plain_path_reproduces_plain_simulation(hike, hike_month, start):
    u = _user(hike=hike, hike_month=hike_month)
    base = simulate_plan(u, Strategy.AVALANCHE, horizon_months=60, simulation_start_month=start)
    path = build_income_path(u, 60, simulation_start_month=start)
    via = simulate_with_income(u, path, Strategy.AVALANCHE, simulation_start_month=start)
    assert via.debt_free_month == base.debt_free_month
    assert via.total_interest_paid == base.total_interest_paid
    assert [r.available_surplus for r in via.months] == [r.available_surplus for r in base.months]


def test_plan_user_turns_hikes_off_and_events_mark_changes():
    u = _user(hike="0.08")
    path = build_income_path(u, 30)
    pu = plan_user(u, path)
    assert pu.annual_hike_rate == 0 and pu.hike_schedule == [] and u.annual_hike_rate == D("0.08")
    evs = to_lifecycle_events(path)
    assert [e.effective_month for e in evs] == [4, 16, 28]     # hike in April, sim starts in January
    assert evs[0].new_monthly_take_home == D("108000.00")


def test_salary_resets_must_go_in_the_path():
    u = _user()
    ev = [LifecycleEvent(LifecycleEventKind.SALARY_RESET, 5, new_monthly_take_home=D("1"))]
    with pytest.raises(ValueError):
        simulate_with_income(u, build_income_path(u, 12), lifecycle_events=ev)


# ── seasonal business income ───────────────────────────────────────────────

FESTIVE = SeasonalIncome(tuple(D(x) for x in [
    "60000", "60000", "90000", "60000", "50000", "40000",
    "40000", "50000", "80000", "200000", "240000", "130000"]))   # avg 91,666.67


def test_seasonal_pattern_follows_the_calendar_and_scales_with_growth():
    u = _user(hike="0.10", hike_month=4)
    path = build_income_path(u, 24, IncomeScenario(seasonal=FESTIVE), simulation_start_month=4)
    assert path[0] == D("60000.00")            # April
    assert path[6] == D("200000.00")           # October
    # Month 13 = next April: the growth fires and lifts the pattern 10%.
    assert path[12] == D("66000.00")
    assert path[18] == D("220000.00")


def test_lumpy_income_shows_shortfalls_a_flat_average_hides():
    avg = (sum(FESTIVE.pattern) / 12).quantize(D("0.01"))
    lumpy_user = _user(income=str(avg), expenses="70000", hike="0")
    flat = simulate_plan(lumpy_user, Strategy.AVALANCHE, horizon_months=12, simulation_start_month=1)
    path = build_income_path(lumpy_user, 12, IncomeScenario(seasonal=FESTIVE))
    lumpy = simulate_with_income(lumpy_user, path, Strategy.AVALANCHE, simulation_start_month=1)
    short_flat = sum(r.shortfall for r in flat.months)
    short_lumpy = sum(r.shortfall for r in lumpy.months)
    assert short_lumpy > short_flat
    assert sum(r.gap_borrowed for r in lumpy.months) > 0


@settings(max_examples=40, deadline=None)
@given(st.lists(st.integers(0, 300000), min_size=12, max_size=12).filter(lambda p: sum(p) > 0),
       st.integers(10000, 200000))
def test_income_shape_buffer_is_the_deepest_running_dip(pattern, outgo):
    path = [D(x) for x in pattern]
    s = income_shape(path, D(outgo))
    running, low = D(0), D(0)
    for x in path:
        running += x - outgo
        low = min(low, running)
    assert s.buffer_needed == -low >= 0
    assert set(s.lean_months) == {i for i, x in enumerate(path, 1) if x < outgo}
    assert s.lowest <= s.average <= s.highest


# ── career switch and salary shift ─────────────────────────────────────────

def test_career_switch_gap_then_new_salary_with_its_own_hikes():
    u = _user(hike="0.08", hike_month=4)
    sc = IncomeScenario(career_switch=CareerSwitch(gap_from_month=7, gap_months=3,
                                                   new_monthly_take_home=D("140000"),
                                                   new_hike_rate=D("0.05")))
    path = build_income_path(u, 30, sc, simulation_start_month=4)
    assert path[:6] == [D("100000.00")] * 6
    assert path[6:9] == [D("0.00")] * 3
    assert path[9] == D("140000.00")
    assert path[21] == D("147000.00")           # one year into the new job
    assert path[20] == D("140000.00")


def test_career_gap_months_borrow_or_spend_savings():
    u = _user(hike="0", savings_balance=D("0"))
    path = build_income_path(u, 18, IncomeScenario(career_switch=CareerSwitch(
        gap_from_month=3, gap_months=4, new_monthly_take_home=D("120000"))))
    r = simulate_with_income(u, path, Strategy.AVALANCHE)
    assert all(r.months[i].shortfall > 0 for i in range(2, 6))
    assert r.months[1].shortfall == 0


def test_salary_shift_compounds_on_top_of_past_hikes():
    u = _user(hike="0.10", hike_month=1)
    path = build_income_path(u, 30, IncomeScenario(shifts=[SalaryShift(20, D("0.20"))]))
    assert path[12] == D("110000.00")           # hike at m13
    assert path[19] == D("132000.00")           # +20% on the hiked pay, not on 100,000
    assert path[24] == D("145200.00")           # next hike on top of the shift


@pytest.mark.parametrize("bad", [
    lambda: SeasonalIncome(tuple([D("1")] * 11)),
    lambda: SeasonalIncome(tuple([D("-1")] + [D("1")] * 11)),
    lambda: CareerSwitch(gap_from_month=0, new_monthly_take_home=D("1")),
    lambda: CareerSwitch(gap_from_month=2, gap_months=-1, new_monthly_take_home=D("1")),
    lambda: SalaryShift(3, D("-1")),
])
def test_bad_inputs_are_refused(bad):
    with pytest.raises(ValueError):
        bad()
