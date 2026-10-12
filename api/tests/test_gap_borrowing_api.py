"""Sprint L2: grill #38 and live tests #15/#16/#26 through the API."""
from decimal import Decimal

D = Decimal


def _short_user(india_user_payload):
    """The live-test stress persona: a personal loan EMI that eats most of
    the pay, a home loan, costs that leave the month short."""
    return {
        **india_user_payload,
        "monthly_income": "120000", "annual_income": "1440000",
        "fixed_expenses": "55000", "variable_expenses": "0",
        "efund_balance": "0", "efund_target": "0",
        "loans": [
            {"loan_type": "personal_loan", "bank": "HDFC Bank", "outstanding": "400000",
             "nominal_rate": "0.14", "rate_type": "fixed", "tenure_months_remaining": 8,
             "scheduled_emi": "52661"},
            {"loan_type": "home_loan", "bank": "SBI", "outstanding": "2500000",
             "nominal_rate": "0.086", "rate_type": "floating", "tenure_months_remaining": 240,
             "scheduled_emi": "21854"},
        ],
    }


def test_short_months_come_back_as_gap_borrowing(client, india_user_payload):
    r = client.post("/api/simulate", json={"user": _short_user(india_user_payload), "horizon_months": 360})
    assert r.status_code == 200, r.text
    body = r.json()
    first = body["trajectory"][0]
    assert D(first["shortfall"]) > 0
    assert D(first["gap_borrowed"]) == D(first["shortfall"])
    assert D(body["gap_rate"]) == D("0.45") and body["gap_rate_basis"] == "default"
    assert "SBI Card" in body["gap_rate_source"]
    assert D(body["total_gap_interest"]) > 0
    # #15: no extra payment while the month is short.
    for p in body["trajectory"]:
        if D(p["shortfall"]) > 0:
            assert D(p["extra_paid"]) == 0
    # The date waits for the borrowing to be repaid.
    last = body["trajectory"][body["debt_free_month"] - 1]
    assert D(last["gap_debt"]) == 0


def test_gap_closed_date_comes_with_a_short_plan(client, india_user_payload):
    """#16: the headline can say "<date> if the ₹X gap closes"."""
    body = client.post("/api/simulate", json={"user": _short_user(india_user_payload), "horizon_months": 360}).json()
    closed = body["gap_closed"]
    assert closed is not None
    assert D(closed["cut"]) == D(body["shortfall"])
    assert closed["debt_free_month"] is not None
    assert closed["debt_free_month"] <= body["debt_free_month"]
    assert D(closed["total_interest_paid"]) < D(body["total_interest_paid"])


def test_no_gap_fields_when_covered(client, india_user_payload):
    body = client.post("/api/simulate", json={"user": india_user_payload, "horizon_months": 360}).json()
    assert body["gap_closed"] is None
    assert D(body["total_gap_interest"]) == 0
    assert all(D(p["gap_debt"]) == 0 for p in body["trajectory"])


def test_old_assumption_on_request(client, india_user_payload):
    u = _short_user(india_user_payload)
    real = client.post("/api/simulate", json={"user": u, "horizon_months": 360}).json()
    free = client.post("/api/simulate", json={"user": u, "horizon_months": 360, "gap_as_debt": False}).json()
    assert D(free["total_gap_interest"]) == 0
    assert D(free["total_interest_paid"]) < D(real["total_interest_paid"])
    base = client.post("/api/baseline", json={"user": u, "horizon_months": 360, "gap_as_debt": False}).json()
    assert D(base["total_gap_interest"]) == 0


def test_longer_tenure_what_if(client, india_user_payload):
    """#26: stretch the home loan; EMI falls, this month's gap shrinks."""
    u = {**_short_user(india_user_payload), "loans": [_short_user(india_user_payload)["loans"][1]],
         "monthly_income": "60000", "fixed_expenses": "45000"}
    r = client.post("/api/sensitivity/compare", json={
        "user": u, "horizon_months": 360,
        "tenure_extension_loan_index": 0, "tenure_extension_months": 120,
    })
    assert r.status_code == 200, r.text
    body = r.json()
    assert D(body["tenure_new_emi"]) < D(body["tenure_old_emi"]) == D("21854")
    assert body["tenure_old_months"] == 240 and body["tenure_new_months"] == 360
    assert D(body["scenario_shortfall"]) < D(body["baseline_shortfall"])


def test_longer_tenure_refuses_a_card(client, india_user_payload):
    r = client.post("/api/sensitivity/compare", json={
        "user": india_user_payload, "horizon_months": 120,
        "tenure_extension_loan_index": 1, "tenure_extension_months": 12,
    })
    assert r.status_code == 422
