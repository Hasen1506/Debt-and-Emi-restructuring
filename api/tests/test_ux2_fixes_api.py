"""UX walkthrough round 2, part A, at the API (work/reports/ux-walkthrough-2.md)."""
from copy import deepcopy
from decimal import Decimal as D


def _with(base, loan, **user):
    u = deepcopy(base)
    u["loans"] = [loan]
    u.update(user)
    return u


def _first_month(client, u):
    r = client.post("/api/simulate", json={"user": u, "strategy": "avalanche", "horizon_months": 1200})
    assert r.status_code == 200, r.text
    return r.json()


def test_3_setup_shapes_validate_and_run(client, india_user_payload):
    """What Setup now saves for a moratorium, an overdraft and a gold bullet
    (web/src/lib/repayment-shape.ts finishShape) is accepted and planned."""
    moratorium = {"loan_type": "education_loan", "bank": "SBI", "outstanding": "1200000", "nominal_rate": "0.10",
                  "rate_type": "floating", "tenure_months_remaining": 120, "scheduled_emi": "15858",
                  "repayment": "emi", "pre_emi_months_remaining": 8}
    overdraft = {"loan_type": "personal_loan", "bank": "HDFC Bank", "outstanding": "200000", "nominal_rate": "0.12",
                 "rate_type": "floating", "tenure_months_remaining": 0, "scheduled_emi": "2000", "repayment": "interest_only"}
    gold = {"loan_type": "gold_loan", "bank": "Muthoot Finance", "outstanding": "100000", "nominal_rate": "0.09",
            "rate_type": "fixed", "tenure_months_remaining": 6, "scheduled_emi": "0", "repayment": "bullet"}
    for loan in (moratorium, overdraft, gold):
        b = _first_month(client, _with(india_user_payload, loan))
        assert b["debt_free_month"] is not None, loan["loan_type"]


def test_2_zero_take_home_is_a_plan(client, india_user_payload):
    u = deepcopy(india_user_payload)
    u.update(monthly_income="0", annual_income="0")
    b = _first_month(client, u)
    assert D(b["shortfall"]) > 0


def test_4_payday_rate_is_accepted(client, india_user_payload):
    loan = {"loan_type": "personal_loan", "bank": "", "outstanding": "20000", "nominal_rate": "3.65",
            "rate_type": "fixed", "tenure_months_remaining": 3, "scheduled_emi": "8000"}
    _first_month(client, _with(india_user_payload, loan))
