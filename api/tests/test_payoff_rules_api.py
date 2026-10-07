"""Your rules over the API (roadmap PR E): UserIn carries payoff_rules and
strategy "rules" reaches the engine; "hybrid" is still accepted."""
from copy import deepcopy


def _three(user):
    u = deepcopy(user)
    u["loans"].append({
        "loan_type": "personal_loan", "bank": "SBI", "outstanding": "300000",
        "nominal_rate": "0.13", "rate_type": "fixed", "tenure_months_remaining": 36,
        "scheduled_emi": "10110",
    })
    return u


def test_simulate_with_rules_pins_the_loan(client, india_user_payload):
    u = _three(india_user_payload)
    base = client.post("/api/simulate", json={"user": u, "strategy": "avalanche", "horizon_months": 360})
    assert base.status_code == 200, base.text
    u["payoff_rules"] = {"pinned": [2]}
    pinned = client.post("/api/simulate", json={"user": u, "strategy": "rules", "horizon_months": 360})
    assert pinned.status_code == 200, pinned.text
    assert float(pinned.json()["total_interest_paid"]) > float(base.json()["total_interest_paid"])


def test_windfall_with_rules(client, india_user_payload):
    u = _three(india_user_payload)
    u["payoff_rules"] = {"pinned": [2]}
    r = client.post("/api/windfall", json={"user": u, "amount": "50000", "strategy": "rules", "marginal_rate": "0.30"})
    assert r.status_code == 200, r.text
    assert r.json()["loan_index"] == 2


def test_hybrid_still_accepted_and_bad_rules_refused(client, india_user_payload):
    u = _three(india_user_payload)
    assert client.post("/api/simulate", json={"user": u, "strategy": "hybrid", "horizon_months": 120}).status_code == 200
    u["payoff_rules"] = {"pinned": [99]}
    assert client.post("/api/simulate", json={"user": u, "strategy": "rules", "horizon_months": 120}).status_code == 422
    u["payoff_rules"] = {"small_first_below": "-5"}
    assert client.post("/api/simulate", json={"user": u, "strategy": "rules", "horizon_months": 120}).status_code == 422
