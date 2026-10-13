"""Property-based tests through the HTTP API (same derandomized profile as
engine/tests/test_property_invariants.py).

* A foreign-currency loan without a usable exchange rate is a 422 on every
  plan endpoint — never a silent 1:1 conversion — and the same profile
  with the rate is a 200.
* Every money value the plan endpoints return is already rounded to the
  cent, so rounding it again changes nothing (idempotent rounding).
* A negative tenure, or one beyond the 100-year horizon, is refused (422).
  (0 is allowed: cards have no tenure and EMI loans may give the EMI instead.)
"""
from __future__ import annotations

from decimal import ROUND_HALF_UP, Decimal

from fastapi.testclient import TestClient
from hypothesis import given, settings
from hypothesis import strategies as st

from api.main import app
from engine.tests.strategies import examples

D = Decimal
client = TestClient(app)
PLAN_ENDPOINTS = ["/api/simulate", "/api/baseline", "/api/sensitivity/compare"]


@st.composite
def loan_payload(draw, currency=None, card=False):
    lt = "credit_card" if card else draw(st.sampled_from(
        ["home_loan", "auto_loan", "personal_loan", "education_loan", "gold_loan"]))
    out = draw(st.integers(1_000, 5_000_000))
    rate_bps = draw(st.integers(0, 3600))
    n = draw(st.integers(12, 240))
    emi = "0" if card else str(max(1, out // n + out * rate_bps // 120000))
    loan = {
        "loan_type": lt, "bank": "HDFC Bank", "outstanding": str(out),
        "nominal_rate": str(D(rate_bps) / 10000), "rate_type": "fixed",
        "tenure_months_remaining": n, "scheduled_emi": emi,
    }
    if currency:
        loan["currency"] = currency
    return loan


@st.composite
def user_payload(draw, country):
    loans = draw(st.lists(loan_payload(), min_size=1, max_size=3))
    if draw(st.booleans()):
        loans.append(draw(loan_payload(card=True)))
    income = draw(st.integers(10_000, 2_000_000))
    return {
        "country": country, "income_type": "salaried",
        "annual_income": str(income * 12), "monthly_income": str(income),
        "fixed_expenses": str(draw(st.integers(0, income))),
        "savings_balance": "0", "primary_bank": "HDFC Bank",
        "loans": loans,
    }


def _body(path: str, user: dict) -> dict:
    body = {"user": user, "horizon_months": 120}
    if path.endswith("compare"):
        body["lump_sum_amount"] = "1000"
        body["lump_sum_target_loan_index"] = 0
    return body


@settings(max_examples=examples(60))
@given(
    country=st.sampled_from(["IN", "US"]),
    data=st.data(),
    bad_rate=st.sampled_from([None, "0"]),
    path=st.sampled_from(PLAN_ENDPOINTS),
)
def test_foreign_loan_without_fx_rate_is_422(country, data, bad_rate, path):
    foreign = "USD" if country == "IN" else "INR"
    user = data.draw(user_payload(country))
    user["loans"].append(data.draw(loan_payload(currency=foreign)))
    if bad_rate is not None:
        user["fx_to_user_currency"] = {foreign: bad_rate}
    r = client.post(path, json=_body(path, user))
    assert r.status_code == 422, r.text
    assert "exchange rate" in r.json()["detail"]["message"].lower()

    # The same profile with a rate is a normal plan.
    user["fx_to_user_currency"] = {foreign: "83.25" if foreign == "USD" else "0.012012"}
    ok = client.post(path, json=_body(path, user))
    assert ok.status_code == 200, ok.text


def _money_values(trajectory: list[dict]):
    for point in trajectory:
        for key in ("balance", "interest_paid", "invested", "available_surplus",
                    "total_paid", "extra_paid", "shortfall"):
            if point.get(key) is not None:
                yield key, point[key]
        for key in ("payments_by_loan_index", "balances_by_loan_index", "balances_by_currency"):
            for v in (point.get(key) or {}).values():
                yield key, v


@settings(max_examples=examples(40))
@given(country=st.sampled_from(["IN", "US"]), data=st.data(), path=st.sampled_from(["/api/simulate", "/api/baseline"]))
def test_returned_money_is_rounded_and_rounding_is_idempotent(country, data, path):
    user = data.draw(user_payload(country))
    r = client.post(path, json=_body(path, user))
    assert r.status_code == 200, r.text
    for key, raw in _money_values(r.json()["trajectory"]):
        v = D(str(raw))
        q = v.quantize(D("0.01"), rounding=ROUND_HALF_UP)
        assert v == q, f"{key}={raw} is not rounded to the cent"
        assert q.quantize(D("0.01"), rounding=ROUND_HALF_UP) == q


@settings(max_examples=examples(40))
@given(country=st.sampled_from(["IN", "US"]), data=st.data(), n=st.one_of(st.integers(-500, -1), st.integers(1201, 5000)))
def test_out_of_range_tenure_is_422(country, data, n):
    user = data.draw(user_payload(country))
    user["loans"][0]["tenure_months_remaining"] = n
    r = client.post("/api/simulate", json=_body("/api/simulate", user))
    assert r.status_code == 422, r.text


# ── Live re-test 13 Oct (NEW-2/NEW-3): bounded or flagged ───────────────────

@settings(max_examples=examples(25), deadline=None)
@given(loan=loan_payload(), cut=st.sampled_from([None, "x10", "emi_half_interest"]))
def test_plan_endpoints_bounded_or_never_clears(loan, cut):
    loan = dict(loan)
    out, r = D(loan["outstanding"]), D(loan["nominal_rate"])
    if cut == "x10":
        loan["outstanding"] = str(out * 10)
    elif cut == "emi_half_interest" and r > 0:
        loan["scheduled_emi"] = str(max(D(1), (out * r / 24).quantize(D("1"))))
    user = {
        "country": "IN", "income_type": "salaried", "annual_income": "2400000",
        "monthly_income": "200000", "fixed_expenses": "40000", "savings_balance": "0",
        "primary_bank": "HDFC Bank", "loans": [loan],
    }
    owed = D(loan["outstanding"])
    for path in ("/api/simulate", "/api/baseline"):
        res = client.post(path, json={"user": user})
        assert res.status_code == 200, res.text[:300]
        b = res.json()
        if b.get("never_clears"):
            if b.get("non_amortising"):
                assert b["trajectory"] == [] and b["months_in_horizon"] == 0
            continue
        assert b["debt_free_month"] is not None
        assert b["months_in_horizon"] < 360 or b["debt_free_month"] <= 360
        assert D(b["total_interest_paid"]) <= owed * 100 + 1
        assert max((D(p["balance"]) for p in b["trajectory"]), default=D(0)) <= owed * 100 + 1


def test_live_retest_10x_home_loan_returns_never_clears_not_1200_months():
    user = {
        "country": "IN", "income_type": "salaried", "annual_income": "1440000",
        "monthly_income": "120000", "fixed_expenses": "50000", "savings_balance": "0",
        "primary_bank": "HDFC Bank",
        "loans": [{"loan_type": "home_loan", "bank": "HDFC Bank", "outstanding": "25000000",
                   "nominal_rate": "0.086", "rate_type": "floating", "tenure_months_remaining": 0,
                   "scheduled_emi": "22000"}],
    }
    for path in ("/api/simulate", "/api/baseline"):
        b = client.post(path, json={"user": user, "horizon_months": 1200}).json()
        assert b["never_clears"] is True
        assert b["non_amortising"][0]["loan_index"] == 0
        assert D(b["non_amortising"][0]["monthly_interest"]) == D("179166.67")
        assert b["trajectory"] == [] and b["months_in_horizon"] == 0
    c = client.post("/api/sensitivity/compare", json={"user": user, "surplus_delta": "1000"}).json()
    assert c["baseline_never_clears"]
    assert D(c["interest_saved"]) == 0


# ── Live re-test 2 (NEW-2): gap / shortfall outputs are bounded or flagged ──

def _persona_b_user(take_home="70000"):
    return {
        "country": "IN", "income_type": "salaried", "annual_income": str(D(take_home) * 12),
        "monthly_income": take_home, "fixed_expenses": "40000", "savings_balance": "0",
        "primary_bank": "HDFC Bank",
        "loans": [
            {"loan_type": "credit_card", "bank": "HDFC Bank", "outstanding": "150000",
             "nominal_rate": "0.42", "rate_type": "fixed", "tenure_months_remaining": 0, "scheduled_emi": "0"},
            {"loan_type": "personal_loan", "bank": "HDFC Bank", "outstanding": "400000",
             "nominal_rate": "0.14", "rate_type": "fixed", "tenure_months_remaining": 0, "scheduled_emi": "13000"},
            {"loan_type": "home_loan", "bank": "HDFC Bank", "outstanding": "2500000",
             "nominal_rate": "0.086", "rate_type": "floating", "tenure_months_remaining": 0, "scheduled_emi": "22000"},
        ],
    }


def _assert_gap_bounded(b, owed_cap):
    traj = b["trajectory"]
    if b.get("never_clears"):
        # Flagged: the run stops at the horizon or before figures run away.
        assert len(traj) <= 360
        assert b["trajectory_cut_month"] is None or b["trajectory_cut_month"] <= 360
    for p in traj:
        assert D(p["gap_debt"] or 0) <= owed_cap, p
        assert D(p["balance"]) + D(p["gap_debt"] or 0) <= owed_cap, p


def test_persona_b_short_month_schedule_stops_and_gap_owed_is_bounded():
    user = _persona_b_user()
    for path in ("/api/simulate", "/api/baseline"):
        b = client.post(path, json={"user": user, "horizon_months": 1200}).json()
        assert b["never_clears"] is True
        assert 0 < len(b["trajectory"]) <= 360
        start = D(b["trajectory"][0]["balance"]) + D(b["trajectory"][0]["gap_debt"] or 0)
        _assert_gap_bounded(b, start * 100 + 1)
    c = client.post("/api/sensitivity/compare", json={
        "user": user, "horizon_months": 1200, "include_trajectory": True,
        "surplus_delta": "1000",
    }).json()
    assert c["scenario_trajectory"] and len(c["scenario_trajectory"]) <= 360


@settings(max_examples=examples(20), deadline=None)
@given(
    take_home=st.integers(30_000, 140_000),
    spend=st.integers(10_000, 90_000),
    path=st.sampled_from(["/api/simulate", "/api/baseline"]),
)
def test_gap_outputs_bounded_or_flagged(take_home, spend, path):
    user = _persona_b_user(str(take_home))
    user["fixed_expenses"] = str(spend)
    r = client.post(path, json={"user": user, "horizon_months": 1200})
    assert r.status_code == 200, r.text[:300]
    b = r.json()
    if not b["trajectory"]:
        assert b.get("never_clears")
        return
    start = D(b["trajectory"][0]["balance"]) + D(b["trajectory"][0]["gap_debt"] or 0)
    if b.get("never_clears"):
        _assert_gap_bounded(b, start * 100 + 1)
    else:
        assert b["debt_free_month"] is not None
        # A plan that clears repays its gap borrowing too.
        assert max((D(p["gap_debt"] or 0) for p in b["trajectory"]), default=D(0)) <= start * 100 + 1
