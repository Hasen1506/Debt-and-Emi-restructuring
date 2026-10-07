"""User-programmable values over the API (roadmap PR D)."""
from copy import deepcopy


def _car(user):
    u = deepcopy(user)
    u["loans"] = [{
        "loan_type": "auto_loan", "bank": "x", "outstanding": "400000", "nominal_rate": "0.079",
        "rate_type": "fixed", "tenure_months_remaining": 60, "scheduled_emi": "8100",
    }]
    u["investment_options"][0]["expected_return"] = "0.075"
    return u


def test_windfall_reads_the_users_prepay_margin(client, india_user_payload):
    u = _car(india_user_payload)
    r = client.post("/api/windfall", json={"user": u, "amount": "50000", "marginal_rate": "0"})
    assert r.status_code == 200, r.text
    assert r.json()["invest_instead"] is True
    u["prepay_hurdle"] = "0"
    r = client.post("/api/windfall", json={"user": u, "amount": "50000", "marginal_rate": "0"})
    assert r.status_code == 200, r.text
    assert r.json()["invest_instead"] is False


def test_out_of_range_assumptions_are_refused(client, india_user_payload):
    for field, value in (("prepay_hurdle", "0.5"), ("asset_returns", {"equity_mf": "3"}), ("liquidation_costs", {"gold_physical": "-0.1"})):
        u = deepcopy(india_user_payload)
        u[field] = value
        r = client.post("/api/simulate", json={"user": u, "horizon_months": 12})
        assert r.status_code == 422, (field, r.text)
    u = deepcopy(india_user_payload)
    u.update(prepay_hurdle="0.01", asset_returns={"equity_mf": "0.09"}, liquidation_costs={"gold_physical": "0.02"},
             assumptions={"ef_months": 4})
    assert client.post("/api/simulate", json={"user": u, "horizon_months": 12}).status_code == 200
