"""POST /api/windfall: a behind loan's overdue is paid first, unless the user
pinned a loan or set their own order (founder 17 Oct 2026; integration-4)."""
from copy import deepcopy
from decimal import Decimal as D

PL = {"loan_type": "personal_loan", "bank": "SBI", "outstanding": "500000", "nominal_rate": "0.11",
      "rate_type": "fixed", "tenure_months_remaining": 60, "scheduled_emi": "10871"}


def _wf(client, u, amount="200000", strategy="avalanche"):
    r = client.post("/api/windfall", json={"amount": amount, "user": u, "strategy": strategy, "monthly_gap": "0"})
    assert r.status_code == 200, r.text
    return r.json()


def test_behind_loan_is_caught_up_before_the_dearest(client, india_user_payload):
    u = deepcopy(india_user_payload)
    u["loans"].append({**PL, "debt_status": "behind", "overdue_amount": "25000"})
    w = _wf(client, u)
    assert w["catch_up"] is True and w["loan_index"] == 2
    assert D(w["amount"]) == D("25000") and D(w["leftover"]) == D("175000")
    assert "behind" in w["rationale"]


def test_after_catch_up_the_normal_pick_follows(client, india_user_payload):
    u = deepcopy(india_user_payload)
    u["loans"].append({**PL, "debt_status": "normal", "outstanding": "475000"})   # what the client sends next
    w = _wf(client, u, amount="175000")
    assert w["catch_up"] is False and w["loan_index"] == 1                        # the 42% card


def test_users_pin_wins_over_catch_up(client, india_user_payload):
    u = deepcopy(india_user_payload)
    u["loans"].append({**PL, "debt_status": "behind", "overdue_amount": "25000"})
    u["payoff_rules"] = {"small_first_below": None, "pinned": [0], "custom_order": []}
    w = _wf(client, u, strategy="rules")
    assert w["catch_up"] is False and w["loan_index"] != 2


def test_no_behind_loan_unchanged(client, india_user_payload):
    w = _wf(client, deepcopy(india_user_payload))
    assert w["catch_up"] is False
