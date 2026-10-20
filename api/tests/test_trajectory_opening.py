""" /simulate and /baseline both take paid_off_this_month off the opening.

The chart's month-0 point is owed today. If only that figure moved, the
first projected month climbed back to the statement (₹98,481 → ₹1,96,962
on the 20 Oct 2026 plan screenshot).
"""
from decimal import Decimal

D = Decimal


def _user() -> dict:
    return {
        "country": "IN",
        "income_type": "salaried",
        "annual_income": "1800000",
        "monthly_income": "150000",
        "fixed_expenses": "0",
        "savings_balance": "0",
        "primary_bank": "HDFC Bank",
        "tax_regime": "new",
        "efund_balance": "0",
        "efund_target": "0",
        "loans": [{
            "loan_type": "credit_card",
            "bank": "HDFC Bank",
            "outstanding": "200000",
            "nominal_rate": "0.36",
            "rate_type": "fixed",
            "tenure_months_remaining": 0,
            "scheduled_emi": "10000",
            "min_payment_override": "10000",
        }],
    }


def _off() -> dict:
    return {
        "user": _user(),
        "strategy": "snowball",
        "horizon_months": 6,
        "debt_budget": "98646",
        "paid_off_this_month": [{"loan_index": 0, "amount": "101519"}],
    }


def test_simulate_and_baseline_start_from_whats_owed_today(client):
    sim = client.post("/api/simulate", json=_off())
    assert sim.status_code == 200, sim.text
    body = sim.json()
    assert D(body["owed_today"]) == D("98481")
    assert D(body["owed_start_of_month"]) == D("200000")
    assert body["debt_free_month"] == 2
    assert D(body["trajectory"][0]["balance"]) == D("2159.15")
    assert D(body["trajectory"][1]["balance"]) == D("0.00")
    # The statement on the profile is untouched.
    assert body["trajectory"][0]["balance"] != "196962.00"

    base = client.post("/api/baseline", json={
        "user": _user(),
        "horizon_months": 4,
        "paid_off_this_month": [{"loan_index": 0, "amount": "101519"}],
    })
    assert base.status_code == 200, base.text
    first = D(base.json()["trajectory"][0]["balance"])
    assert first == D("91849.23")
    assert first < D("98481")


def test_what_if_uses_the_same_opening(client):
    r = client.post("/api/sensitivity/compare", json={
        **_off(),
        "include_trajectory": True,
        "surplus_delta": "0",
    })
    assert r.status_code == 200, r.text
    body = r.json()
    assert D(body["scenario_trajectory"][0]["balance"]) == D("2159.15")
