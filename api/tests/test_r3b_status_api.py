"""Round 3 part B at the API: new loan kinds, debt status, salary-deducted EMIs
(work/reports/ux-walkthrough-2.md #10, #13, #21)."""
from copy import deepcopy
from decimal import Decimal as D

import pytest

from api.schemas import UserIn
from engine.models import LoanType

PL = {"loan_type": "personal_loan", "bank": "SBI", "outstanding": "500000", "nominal_rate": "0.11",
      "rate_type": "fixed", "tenure_months_remaining": 60, "scheduled_emi": "10871"}


def _run(client, u):
    r = client.post("/api/simulate", json={"user": u, "strategy": "avalanche", "horizon_months": 1200})
    assert r.status_code == 200, r.text
    return r.json()


@pytest.mark.parametrize("kind", ["loan_against_property", "home_topup", "two_wheeler_loan", "medical_loan"])
def test_new_kinds_are_planned(client, india_user_payload, kind):
    u = deepcopy(india_user_payload)
    u["loans"].append({**PL, "loan_type": kind, "house_use": "buy_build" if kind in ("loan_against_property", "home_topup") else None})
    assert _run(client, u)["debt_free_month"] is not None


def test_settled_loan_leaves_the_plan(india_user_payload):
    u = deepcopy(india_user_payload)
    u["loans"].append({**PL, "debt_status": "settled"})
    eng = UserIn.model_validate(u).to_engine()
    settled = eng.loans[-1]
    assert settled.outstanding == 0 and settled.scheduled_emi == 0 and settled.tenure_months_remaining == 0
    # its position is kept, so the web's loan indexes still line up
    assert len(eng.loans) == len(u["loans"])


def test_settled_plan_matches_the_plan_without_it(client, india_user_payload):
    u = deepcopy(india_user_payload)
    base = _run(client, u)
    u["loans"].append({**PL, "debt_status": "settled"})
    with_settled = _run(client, u)
    assert with_settled["debt_free_month"] == base["debt_free_month"]
    assert with_settled["total_interest_paid"] == base["total_interest_paid"]


def test_behind_and_collections_are_still_planned(india_user_payload):
    for status in ("behind", "collections"):
        u = deepcopy(india_user_payload)
        u["loans"].append({**PL, "debt_status": status})
        assert UserIn.model_validate(u).to_engine().loans[-1].outstanding == D("500000")


def test_unknown_status_is_rejected(client, india_user_payload):
    u = deepcopy(india_user_payload)
    u["loans"].append({**PL, "debt_status": "written_off"})
    assert client.post("/api/simulate", json={"user": u, "strategy": "avalanche"}).status_code == 422


def test_salary_deducted_emi_is_not_taken_off_take_home_twice(client, india_user_payload):
    """n01 govt: take-home ₹1,50,000 is after a ₹10,871 EMI cut from salary.
    Ticked, the plan sees ₹1,60,871 before its EMIs, so the same money is free."""
    u = deepcopy(india_user_payload)
    u["loans"].append({**PL, "salary_deducted": True})
    eng = UserIn.model_validate(u).to_engine()
    assert eng.monthly_income == D("150000") + D("10871")
    plain = deepcopy(india_user_payload)
    plain["loans"].append(dict(PL))
    assert UserIn.model_validate(plain).to_engine().monthly_income == D("150000")
    # the loan is still tracked and paid
    assert eng.loans[-1].scheduled_emi == D("10871")
    assert _run(client, u)["debt_free_month"] <= _run(client, plain)["debt_free_month"]


def test_salary_deducted_ignores_other_currency_and_settled(india_user_payload):
    u = deepcopy(india_user_payload)
    u["loans"].append({**PL, "salary_deducted": True, "currency": "USD"})
    u["fx_to_user_currency"] = {"USD": "88"}
    u["loans"].append({**PL, "salary_deducted": True, "debt_status": "settled"})
    assert UserIn.model_validate(u).to_engine().monthly_income == D("150000")


def test_house_use_reaches_the_engine(india_user_payload):
    u = deepcopy(india_user_payload)
    u["loans"].append({**PL, "loan_type": "home_topup", "house_use": "repair"})
    loan = UserIn.model_validate(u).to_engine().loans[-1]
    assert loan.loan_type == LoanType.HOME_TOPUP and loan.house_use == "repair"
    assert loan.sec24_full_cap is False and loan.principal_80c_eligible is False


def test_advice_check_takes_the_new_kinds(client):
    r = client.post("/api/advice-check", json={"text": "Prepay your loan against property first.", "country": "IN", "strategy": "avalanche",
                                               "loans": [{"loan_type": "loan_against_property", "outstanding": "3000000", "rate": "0.1",
                                                          "emi": "32000", "months_left": 150}]})
    assert r.status_code == 200, r.text
