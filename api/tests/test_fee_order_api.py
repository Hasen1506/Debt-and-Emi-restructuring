"""Roadmap PR K: the plan API reports the fee-aware order and its reason."""
import copy


def _fee_user(base):
    u = copy.deepcopy(base)
    u["loans"] = [
        {"loan_type": "personal_loan", "bank": "Alpha", "outstanding": "300000", "nominal_rate": "0.13",
         "rate_type": "fixed", "tenure_months_remaining": 18, "scheduled_emi": "18486.39",
         "prepayment_penalty_pct": "0.05"},
        {"loan_type": "personal_loan", "bank": "Beta", "outstanding": "600000", "nominal_rate": "0.12",
         "rate_type": "fixed", "tenure_months_remaining": 84, "scheduled_emi": "10591.66"},
    ]
    # About ₹25,000 a month spare after the EMIs, the emergency fund full.
    u["monthly_income"] = "99078"
    u["annual_income"] = str(99078 * 12)
    u["efund_balance"] = u["efund_target"]
    return u


def test_a_fee_portfolio_returns_the_search_and_the_reason(client, india_user_payload):
    r = client.post("/api/simulate", json={"user": _fee_user(india_user_payload), "marginal_rate": "0"})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["payoff_order_method"] == "exact"
    note = body["payoff_order_note"]
    assert note and note.startswith("A prepayment fee changed this order.")
    assert "Alpha personal loan" in note and "5% fee" in note and "Beta personal loan" in note


def test_no_fee_no_search_no_note(client, india_user_payload):
    r = client.post("/api/simulate", json={"user": india_user_payload})
    body = r.json()
    assert body["payoff_order_method"] is None and body["payoff_order_note"] is None
