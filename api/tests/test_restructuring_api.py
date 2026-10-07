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


def _audit_book(payload):
    from copy import deepcopy
    user = deepcopy(payload)
    user.update(fixed_expenses='60000', savings_balance='0', efund_balance='0', efund_target='0',
                annual_hike_rate='0', credit_score=720)
    user['loans'][0].update(loan_type='personal_loan', outstanding='500000', nominal_rate='.16',
                            rate_type='fixed', tenure_months_remaining=60, scheduled_emi='12160')
    user['loans'][1].update(outstanding='80000', scheduled_emi='0')
    return user


def test_full_plan_rejects_harmful_consolidation_and_ignores_supplied_fake_paths(client, india_user_payload):
    user = _audit_book(india_user_payload)
    plan = {'user': user, 'debt_budget': '50000', 'marginal_rate': '.208'}
    simulated = client.post('/api/simulate', json=plan)
    assert simulated.status_code == 200
    assert simulated.json()['debt_free_month'] == 13
    response = client.post('/api/restructuring', json={
        'user': user, 'marginal_rate': '.208', 'plan': plan,
        'plan_balances': {'0': ['0'], '1': ['0']},
    })
    assert response.status_code == 200
    body = response.json()
    assert not any(o['kind'] == 'consolidation' for o in body['opportunities'])
    held = next(h for h in body['held_back'] if h['kind'] == 'consolidation')
    assert held['reason'] == 'costs_more'
    # The figure moved from ₹7,135 when Indian card interest started to
    # carry its 18% GST in the cash flow (P2-13); the verdict is unchanged.
    import re
    assert re.search(r'₹[\d,]+ more in the first year', held['note'])


def test_restructuring_plan_must_describe_the_same_user_and_marginal_rate(client, india_user_payload):
    from copy import deepcopy
    user = _audit_book(india_user_payload)
    different = deepcopy(user)
    different['fixed_expenses'] = '0'
    response = client.post('/api/restructuring', json={'user': user, 'plan': {'user': different}})
    assert response.status_code == 422
    response = client.post('/api/restructuring', json={
        'user': user, 'marginal_rate': '.208', 'plan': {'user': user, 'marginal_rate': '.3'},
    })
    assert response.status_code == 422


def test_spending_cut_preview_matches_a_saved_profile_with_hikes_resets_and_inflation(client, india_user_payload):
    from copy import deepcopy
    user = _audit_book(india_user_payload)
    user['loans'][0]['outstanding'] = '2000000'
    user['annual_hike_rate'] = '.08'
    args = dict(user=user, debt_budget='50000.25', inflate_expenses=True,
                lifecycle_events=[{'kind': 'salary_reset', 'effective_month': 7, 'new_monthly_take_home': '160000'}])
    preview = client.post('/api/sensitivity/compare', json={**args, 'surplus_delta': '10000.25', 'spending_cut': True})
    assert preview.status_code == 200
    changed = deepcopy(user)
    changed['fixed_expenses'] = '49999.75'
    actual = client.post('/api/simulate', json={**args, 'user': changed, 'debt_budget': '60000.50'})
    assert actual.status_code == 200
    assert preview.json()['scenario_debt_free_month'] == actual.json()['debt_free_month']
    assert Decimal(preview.json()['scenario_total_interest']) == Decimal(actual.json()['total_interest_paid'])
    for bad in ['-1', '60000.01']:
        rejected = client.post('/api/sensitivity/compare', json={**args, 'surplus_delta': bad, 'spending_cut': True})
        assert rejected.status_code == 422
