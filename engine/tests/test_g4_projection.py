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


# ─── _reset_rate: the contract end date is the anchor (L5 golden statement) ──

from engine.formulas import emi as _emi
from engine.models import LifecycleEvent, LifecycleEventKind, Loan, LoanType


def _home_after(events, months=36):
    u = _user()
    home = Loan(loan_type=LoanType.HOME, bank="SBI", outstanding=D("3000000"),
                nominal_rate=D("0.085"), rate_type="floating", tenure_months_remaining=240,
                scheduled_emi=_emi(D("3000000"), D("0.085"), 240), currency="INR")
    u.loans = [home]
    res = simulate_plan(u, Strategy.AVALANCHE, months, minimums_only=True,
                        lifecycle_events=[LifecycleEvent(kind=LifecycleEventKind.FLOATING_RATE_RESET,
                                                         effective_month=m, loan_index=0, new_rate=D(r))
                                          for m, r in events])
    return res


def test_rise_after_a_cut_reamortises_to_the_original_maturity():
    """Cut at month 13 (EMI kept, end date moves earlier), rise at month 25.
    The bank keeps the ORIGINAL maturity: the EMI after the rise is what
    clears the balance over the 216 months left on the contract, not the
    higher EMI that would keep the new, earlier end date."""
    res = _home_after([(13, "0.080"), (25, "0.090")])
    bal_24 = res.months[23].balances_by_loan_index[0]
    want = _emi(bal_24, D("0.090"), 240 - 24)
    paid_26 = res.months[25].payments_by_loan_index[0]
    assert abs(paid_26 - want) < D("1"), (paid_26, want)


def test_rise_on_an_untouched_loan_still_keeps_the_end_date():
    res = _home_after([(13, "0.095")])
    bal_12 = res.months[11].balances_by_loan_index[0]
    assert abs(res.months[13].payments_by_loan_index[0] - _emi(bal_12, D("0.095"), 228)) < D("1")


def test_small_rise_after_a_cut_keeps_the_emi():
    """A rise smaller than the earlier cut: the loan still clears before its
    contract date at the old EMI, so the EMI doesn't move (tenor absorbs it)."""
    base = _emi(D("3000000"), D("0.085"), 240)
    res = _home_after([(13, "0.075"), (25, "0.080")])
    assert abs(res.months[25].payments_by_loan_index[0] - base) < D("1")
