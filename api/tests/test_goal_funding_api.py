"""Roadmap PR F: goal funding rules over the API, and the trade-off endpoint."""


def _goal(**kw):
    g = {"id": "g1", "target_month_index": 24, "required_amount": "240000"}
    g.update(kw)
    return g


def test_debt_first_goal_waits_while_the_card_is_open(client, india_user_payload):
    r = client.post("/api/simulate", json={"user": india_user_payload, "goals": [_goal(funding_rule="after_debt")]})
    assert r.status_code == 200, r.text
    c = r.json()["surplus_allocation"]["goal_contributions"][0]
    assert c["queued_reason"] == "waiting_on_debt" and float(c["amount"]) == 0
    # The same goal on schedule takes its run-rate from month 1.
    r = client.post("/api/simulate", json={"user": india_user_payload, "goals": [_goal()]})
    assert float(r.json()["surplus_allocation"]["goal_contributions"][0]["amount"]) == 10000


def test_fixed_and_share_rules(client, india_user_payload):
    r = client.post("/api/simulate", json={"user": india_user_payload, "goals": [_goal(funding_rule="fixed", funding_amount="3000")]})
    assert float(r.json()["surplus_allocation"]["goal_contributions"][0]["amount"]) == 3000
    r = client.post("/api/simulate", json={"user": india_user_payload, "goals": [_goal(funding_rule="surplus_pct", funding_pct="0.1")]})
    alloc = r.json()["surplus_allocation"]
    assert abs(float(alloc["goal_contributions"][0]["amount"]) - float(alloc["surplus"]) * 0.1) < 0.01


def test_bad_rules_are_refused(client, india_user_payload):
    for g in (_goal(funding_rule="fixed"), _goal(funding_rule="surplus_pct", funding_pct="1.5"),
              _goal(funding_rule="whenever"), _goal(funding_rule="after_debt", after_loan_index=-1)):
        assert client.post("/api/simulate", json={"user": india_user_payload, "goals": [g]}).status_code == 422, g


def test_tradeoff_endpoint(client, india_user_payload):
    r = client.post("/api/goals/tradeoff", json={"user": india_user_payload, "goals": [_goal(), _goal(id="g2", target_month_index=36)], "goal_ids": ["g1"]})
    assert r.status_code == 200, r.text
    (t,) = r.json()["tradeoffs"]
    assert t["goal_id"] == "g1" and t["has_high_apr_debt"] is True
    assert float(t["extra_interest"]) > 0
