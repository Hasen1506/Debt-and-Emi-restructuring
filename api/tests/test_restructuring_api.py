"""POST /api/restructuring with the plan's balances and a credit score (H1)."""
from decimal import Decimal


def _card_user(payload: dict) -> dict:
    # The fixture's card is HDFC's own; a transfer goes to another bank.
    payload["loans"][1]["bank"] = "Axis Bank"
    return payload


def test_plan_that_clears_the_card_holds_the_transfer_back(client, india_user_payload):
    user = _card_user(india_user_payload)
    today = client.post("/api/restructuring", json={"user": user}).json()
    assert any(o["kind"] == "balance_transfer" for o in today["opportunities"])
    assert today["held_back"] == []

    r = client.post("/api/restructuring", json={
        "user": user, "plan_balances": {"1": ["40000", "0"]},
    })
    assert r.status_code == 200
    body = r.json()
    assert not any(o["kind"] == "balance_transfer" for o in body["opportunities"])
    held = body["held_back"]
    assert [h["reason"] for h in held] == ["plan_clears"]
    assert held[0]["affected_loan_indices"] == [1]
    # The total counts only what's still recommended.
    assert Decimal(body["total_annual_saving"]) == sum(
        (Decimal(o["estimated_annual_saving"]) for o in body["opportunities"]), Decimal("0"),
    )


def test_low_credit_score_holds_back_a_transfer(client, india_user_payload):
    user = _card_user(india_user_payload)
    user["credit_score"] = 640
    body = client.post("/api/restructuring", json={"user": user}).json()
    assert [h["reason"] for h in body["held_back"]] == ["credit_score"]


def test_opportunity_says_how_its_saving_was_worked_out(client, india_user_payload):
    user = _card_user(india_user_payload)
    path = [str(80000 - 10000 * m) for m in range(1, 9)]
    body = client.post("/api/restructuring", json={"user": user, "plan_balances": {"1": path}}).json()
    bt = next(o for o in body["opportunities"] if o["kind"] == "balance_transfer")
    assert bt["saving_basis"] == "plan" and bt["plan_clears_in_months"] == 8
    assert bt["credit_fit"] == "unknown" and bt["score_needed"] == 750


def test_plan_balances_are_bounded(client, india_user_payload):
    r = client.post("/api/restructuring", json={
        "user": india_user_payload, "plan_balances": {"1": ["1"] * 601},
    })
    assert r.status_code == 422
    # A path for a loan the user doesn't have is ignored.
    r = client.post("/api/restructuring", json={
        "user": india_user_payload, "plan_balances": {"7": ["1000"]},
    })
    assert r.status_code == 200
