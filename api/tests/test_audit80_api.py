"""Audit 80+ Section C (W1) through the API: C1, C3, C4, C11, C12, C15."""
from decimal import Decimal

import pytest
from hypothesis import given, settings
from hypothesis import strategies as st

from api import schemas
from api.schemas import LoanIn, _add_months

D = Decimal


def _loan(**kw):
    base = {"loan_type": "personal_loan", "bank": "X", "outstanding": "200000", "nominal_rate": "0.16",
            "rate_type": "fixed", "tenure_months_remaining": 24, "scheduled_emi": "9793"}
    base.update(kw)
    return base


# ── C4: lock-in counted from a calendar month and running down ─────────────

@pytest.fixture
def october(monkeypatch):
    monkeypatch.setattr(schemas, "current_month", lambda: "2026-10")


def test_c4_lock_in_until_a_calendar_month(october):
    assert LoanIn(**_loan(prepay_lock_in_until="2027-04")).to_engine().prepay_lock_in_months == 6
    assert LoanIn(**_loan(prepay_lock_in_until="2026-09")).to_engine().prepay_lock_in_months == 0


def test_c4_lock_in_months_count_from_the_loan_start(october):
    """api.ts documents prepay_lock_in_months as "months from disbursal":
    a 12-month lock-in on a loan taken in Jan 2026 has 3 months left."""
    l = LoanIn(**_loan(prepay_lock_in_months=12, loan_start_month="2026-01"))
    assert l.to_engine().prepay_lock_in_months == 3


def test_c4_saved_lock_in_runs_down_from_when_it_was_entered(october):
    """Repro lockin3: "12" saved in Aug 2026 has 10 months left in Oct, not
    12 for ever."""
    l = LoanIn(**_loan(prepay_lock_in_months=12, balance_as_of="2026-08-15"))
    assert l.to_engine().prepay_lock_in_months == 10


def test_c4_old_payloads_keep_counting_from_today(october):
    assert LoanIn(**_loan(prepay_lock_in_months=12)).to_engine().prepay_lock_in_months == 12


@settings(max_examples=60)
@given(start=st.integers(0, 120), months=st.integers(0, 60), until=st.booleans())
def test_property_lock_in_left_never_rises_as_time_passes(start, months, until):
    """C4 class guard: months left is non-increasing month to month, falls by
    exactly one while positive, and reaches 0 by the end month."""
    begin = _add_months("2020-01", start)
    kw = ({"prepay_lock_in_until": _add_months(begin, months)} if until
          else {"prepay_lock_in_months": months, "balance_as_of": begin})
    l = LoanIn(**_loan(**kw))
    seq = [l.lock_in_months_left(_add_months(begin, k)) for k in range(months + 3)]
    assert all(b <= a for a, b in zip(seq, seq[1:]))
    assert all(a - b == 1 for a, b in zip(seq, seq[1:]) if a > 0)
    assert seq[months] == 0


# ── C12: rates above 100% a year ────────────────────────────────────────────

def test_c12_instant_loan_at_120pct_is_accepted(client, india_user_payload):
    user = {**india_user_payload, "loans": [_loan(nominal_rate="1.2", outstanding="20000",
                                                  tenure_months_remaining=6, scheduled_emi="4600")]}
    r = client.post("/api/simulate", json={"user": user, "horizon_months": 60})
    assert r.status_code == 200, r.text


def test_c12_still_rejects_absurd_rates(client, india_user_payload):
    user = {**india_user_payload, "loans": [_loan(nominal_rate="12")]}
    r = client.post("/api/simulate", json={"user": user, "horizon_months": 60})
    assert r.status_code == 422
    assert "1,000%" in r.text


# ── C15: flat-rate conversion ───────────────────────────────────────────────

@pytest.mark.parametrize("left", [36, 18, 6])
def test_c15_original_tenure_gives_the_same_rate_at_any_age(left):
    l = LoanIn(**_loan(rate_basis="flat", nominal_rate="0.12", tenure_months_remaining=left,
                       original_tenure_months=36))
    assert abs(l.to_engine().nominal_rate - D("0.2120")) < D("0.0005")
    assert l.contract_warnings() == [] or all("flat" not in w for w in l.contract_warnings())


def test_c15_without_original_tenure_a_guess_is_flagged():
    # The balance doesn't fit a reducing schedule at a flat-like rate (it is
    # the flat schedule's principal), so the months left are used, with a note.
    l = LoanIn(**_loan(rate_basis="flat", nominal_rate="0.12", outstanding="16667",
                       tenure_months_remaining=6, scheduled_emi="3778"))
    assert any("original tenure" in w for w in l.contract_warnings())


# ── C1 / C3 / C11 surfaced on /simulate ─────────────────────────────────────

def test_c1_rate_rise_event_shows_both_outcomes(client, india_user_payload):
    user = {**india_user_payload, "monthly_income": "300000", "annual_income": "3600000",
            "loans": [{"loan_type": "home_loan", "bank": "SBI", "outstanding": "5000000",
                       "nominal_rate": "0.085", "rate_type": "floating", "tenure_months_remaining": 240,
                       "scheduled_emi": "43391.16"}]}
    body = client.post("/api/simulate", json={
        "user": user, "horizon_months": 400,
        "lifecycle_events": [{"kind": "floating_rate_reset", "effective_month": 13, "loan_index": 0,
                              "new_rate": "0.095"}]}).json()
    ev = body["rate_rise_events"][0]
    assert ev["applied"] == "extend" and ev["month"] == 13
    modes = {o["mode"]: o for o in ev["options"]}
    assert set(modes) == {"extend", "raise_emi", "mix"}
    assert D(modes["extend"]["emi_change"]) == 0
    assert ev["recommended"] in ("extend", "raise_emi", "keep_emi_and_prepay") and ev["reason"]
    assert "12529" in ev["source_url"]


def test_c3_mismatched_terms_come_back_as_a_warning(client, india_user_payload):
    user = {**india_user_payload, "loans": [_loan(outstanding="50000", nominal_rate="0.14",
                                                  tenure_months_remaining=1, scheduled_emi="10000")]}
    body = client.post("/api/simulate", json={"user": user, "horizon_months": 60}).json()
    assert body["loan_warnings"] and body["loan_warnings"][0]["loan_index"] == 0
    assert "don't match" in body["loan_warnings"][0]["message"]
    assert body["debt_free_month"] == 1


def test_c11_gap_limit_and_infeasible_month(client, india_user_payload):
    user = {**india_user_payload, "monthly_income": "50000", "annual_income": "600000",
            "fixed_expenses": "45000", "variable_expenses": "0", "efund_balance": "0", "efund_target": "0",
            "loans": [_loan(outstanding="500000", nominal_rate="0.12", tenure_months_remaining=60,
                            scheduled_emi="10253")]}
    body = client.post("/api/simulate", json={"user": user, "horizon_months": 120}).json()
    assert D(body["gap_limit"]) == D("150000") and body["gap_limit_assumed"] is True
    assert body["infeasible_from_month"] is not None
    assert D(body["shortfall"]) == D("5253")
    assert max(D(p["gap_debt"]) for p in body["trajectory"]) <= D("150000")


@pytest.mark.parametrize("path", ["/api/simulate", "/api/baseline"])
@pytest.mark.parametrize("spend, infeasible", [("45000", True), ("30000", False)])
def test_c11_a_plan_that_only_clears_with_unfundable_money_is_never_clears(
        client, india_user_payload, path, spend, infeasible):
    """Class guard: once the gap limit is hit the engine stops borrowing, so
    a debt-free date from then on is paid with money nobody has. Every plan
    endpoint flags such a run never_clears (not shown as a normal result);
    a fundable plan keeps its date."""
    user = {**india_user_payload, "monthly_income": "50000", "annual_income": "600000",
            "fixed_expenses": spend, "variable_expenses": "0", "efund_balance": "0", "efund_target": "0",
            "loans": [_loan(outstanding="500000", nominal_rate="0.12", tenure_months_remaining=60,
                            scheduled_emi="10253")]}
    body = client.post(path, json={"user": user, "horizon_months": 120}).json()
    assert (body["infeasible_from_month"] is not None) is infeasible
    assert body["never_clears"] is infeasible
    if not infeasible:
        assert body["debt_free_month"] is not None


def test_c11_capped_what_if_and_gap_closed_carry_no_paper_date(client, india_user_payload):
    """Integration phase 5: the what-if (compare) names the scenario's first
    unfundable month, and a gap-closed run that is itself capped has no
    debt-free month (it clears only on paper)."""
    user = {**india_user_payload, "monthly_income": "50000", "annual_income": "600000",
            "fixed_expenses": "45000", "variable_expenses": "0", "efund_balance": "0", "efund_target": "0",
            "loans": [_loan(outstanding="500000", nominal_rate="0.12", tenure_months_remaining=60,
                            scheduled_emi="10253")]}
    sim = client.post("/api/simulate", json={"user": user, "horizon_months": 120}).json()
    assert sim["infeasible_from_month"] is not None
    gc = sim.get("gap_closed")
    if gc is not None and gc["debt_free_month"] is not None:
        # closing month 1's gap must leave a genuinely fundable plan
        closed = client.post("/api/simulate", json={"user": {**user, "fixed_expenses": str(45000 - int(float(gc["cut"])))}, "horizon_months": 120}).json()
        assert closed["infeasible_from_month"] is None
    body = client.post("/api/sensitivity/compare", json={
        "user": user, "horizon_months": 120, "tenure_extension_loan_index": 0,
        "tenure_extension_months": 12, "include_trajectory": True}).json()
    assert "scenario_infeasible_from_month" in body
    if body["scenario_never_clears"] and body["scenario_debt_free_month"] is not None:
        assert body["scenario_infeasible_from_month"] is not None
