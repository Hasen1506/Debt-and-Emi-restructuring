"""UX walkthrough fixes at the API (work/reports/ux-walkthrough.md)."""
from copy import deepcopy
from decimal import Decimal as D


def test_fix3_windfall_on_a_short_month_keeps_the_cash(client, india_user_payload):
    u = deepcopy(india_user_payload)
    u["fixed_expenses"] = str(D(u["monthly_income"]) * 2)        # costs twice the take-home
    r = client.post("/api/windfall", json={"amount": "100000", "user": u, "marginal_rate": "0.30"})
    assert r.status_code == 200, r.text
    b = r.json()
    assert b["loan_index"] is None and not b["invest_instead"]
    assert D(b["leftover"]) == D("100000") and D(b["interest_avoided"]) == 0
    assert "short" in b["rationale"] and "Keep" in b["rationale"]


def test_fix3_windfall_on_a_capped_plan_keeps_the_cash(client, india_user_payload):
    """Month 1 covered, but the plan is not fundable from a later month: the
    client sends that gap and month, and nothing is prepaid."""
    r = client.post("/api/windfall", json={"amount": "100000", "user": india_user_payload, "marginal_rate": "0.30",
                                           "monthly_gap": "17500", "short_from_label": "Apr 2027"})
    assert r.status_code == 200, r.text
    b = r.json()
    assert b["loan_index"] is None and "from Apr 2027" in b["rationale"] and "5 short months" in b["rationale"]


def test_fix3_healthy_plan_still_prepays(client, india_user_payload):
    r = client.post("/api/windfall", json={"amount": "50000", "user": india_user_payload, "marginal_rate": "0.30"})
    b = r.json()
    assert b["invest_instead"] or b["loan_index"] is not None


def test_fix4_simulate_returns_one_owed_today(client, india_user_payload):
    """/simulate says what is owed today (after this month's EMIs already
    paid) beside the plan's start-of-month balance; with none paid they agree."""
    r = client.post("/api/simulate", json={"user": india_user_payload, "paid_emi_this_month": [0, 1]})
    assert r.status_code == 200, r.text
    b = r.json()
    start, today, interest = D(b["owed_start_of_month"]), D(b["owed_today"]), D(b["owed_today_interest_in_paid"])
    assert start == D("3580000")
    month_interest = D("3500000") * D("0.085") / 12
    assert today == (D("3500000") + month_interest - D("35200") + D("80000")).quantize(D("1"))  # card unchanged
    assert abs(interest - month_interest) <= 1
    none = client.post("/api/simulate", json={"user": india_user_payload}).json()
    assert D(none["owed_today"]) == D(none["owed_start_of_month"]) == start
    # The plan itself is the same run either way: owed_today only reports.
    assert none["debt_free_month"] == b["debt_free_month"] and none["total_interest_paid"] == b["total_interest_paid"]
    assert client.post("/api/simulate", json={"user": india_user_payload, "paid_emi_this_month": [-1]}).status_code == 422
