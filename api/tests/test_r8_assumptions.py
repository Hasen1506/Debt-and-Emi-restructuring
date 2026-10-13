"""Live re-test 8 R8-6: a person's own assumptions are bounded.

* Out of range (a 99,999,999,999,999% pay rise, a 70% marginal tax rate,
  a 50% processing fee, a credit score of 5000) is a 422 naming the field,
  never a plan built on it.
* Inside the bounds, even at the extremes, every plan endpoint returns a
  finite, bounded plan whose first month has a payment ("paying this
  month" is never blank).
"""
from __future__ import annotations

from decimal import Decimal

from fastapi.testclient import TestClient
from hypothesis import given, settings
from hypothesis import strategies as st

from api.main import app
from engine.tests.strategies import examples

D = Decimal
client = TestClient(app)


def _user(**extra):
    u = {
        "country": "IN", "income_type": "salaried", "annual_income": "1140000",
        "monthly_income": "95000", "fixed_expenses": "41000", "savings_balance": "0",
        "primary_bank": "HDFC Bank",
        "loans": [
            {"loan_type": "credit_card", "bank": "HDFC Bank", "outstanding": "180000",
             "nominal_rate": "0.39", "rate_type": "fixed", "tenure_months_remaining": 0,
             "scheduled_emi": "0"},
            {"loan_type": "personal_loan", "bank": "HDFC Bank", "outstanding": "60000",
             "nominal_rate": "0.13", "rate_type": "fixed", "tenure_months_remaining": 12,
             "scheduled_emi": "5200"},
        ],
    }
    u.update(extra)
    return u


def _loc(r):
    body = r.json()
    return str(body)


def test_absurd_pay_rise_is_422():
    r = client.post("/api/simulate", json={"user": _user(annual_hike_rate="999999999999.99"), "horizon_months": 120})
    assert r.status_code == 422, r.text
    assert "annual_hike_rate" in _loc(r)


def test_pay_rise_phase_out_of_range_is_422():
    r = client.post("/api/simulate", json={"user": _user(hike_schedule=[[1, 3, "5"]]), "horizon_months": 120})
    assert r.status_code == 422, r.text


def test_marginal_tax_above_60_percent_is_422():
    r = client.post("/api/simulate", json={"user": _user(), "horizon_months": 120, "marginal_rate": "0.7"})
    assert r.status_code == 422, r.text
    ok = client.post("/api/simulate", json={"user": _user(), "horizon_months": 120, "marginal_rate": "0.6"})
    assert ok.status_code == 200, ok.text


def test_loan_fees_above_10_percent_are_422():
    for field in ("processing_fee_amortised", "insurance_premium_pct", "prepayment_penalty_pct"):
        u = _user()
        u["loans"][1][field] = "0.5"
        r = client.post("/api/simulate", json={"user": u, "horizon_months": 120})
        assert r.status_code == 422, (field, r.text)


def test_credit_score_out_of_range_is_422():
    for bad in (5000, 299, -5000):
        r = client.post("/api/simulate", json={"user": _user(credit_score=bad), "horizon_months": 120})
        assert r.status_code == 422, (bad, r.text)
    assert client.post("/api/simulate", json={"user": _user(credit_score=750), "horizon_months": 120}).status_code == 200


@settings(max_examples=examples(25), deadline=None)
@given(
    hike=st.sampled_from(["-0.5", "0", "0.5"]) | st.decimals(D("-0.5"), D("0.5"), places=4).map(str),
    infl=st.sampled_from(["-0.1", "0.5"]),
    fee=st.sampled_from(["0", "0.1"]),
    tax=st.sampled_from(["0", "0.6"]),
    path=st.sampled_from(["/api/simulate", "/api/baseline"]),
    absurd=st.booleans(),
)
def test_extreme_assumptions_plan_is_bounded_or_refused(hike, infl, fee, tax, path, absurd):
    """Hypothesis invariant (R8-6): absurd assumptions are refused; any
    accepted set, however extreme, gives a finite plan with a first-month
    payment."""
    u = _user(annual_hike_rate=hike, inflation_rate=infl)
    u["loans"][1]["processing_fee_amortised"] = fee
    u["loans"][1]["insurance_premium_pct"] = fee
    if absurd:
        u["annual_hike_rate"] = "999999999999.99"
    body = {"user": u, "horizon_months": 360}
    if path == "/api/simulate":
        body["marginal_rate"] = tax
    r = client.post(path, json=body)
    if absurd:
        assert r.status_code == 422, r.text
        return
    assert r.status_code == 200, r.text
    traj = r.json()["trajectory"]
    assert traj, "empty plan"
    first = traj[0]
    assert D(str(first["total_paid"])) > 0, "no payment in the first month"
    for p in traj:
        for k in ("balance", "total_paid", "interest_paid"):
            if p.get(k) is not None:
                v = D(str(p[k]))
                assert v.is_finite() and abs(v) < D("1e13"), (k, p[k])
