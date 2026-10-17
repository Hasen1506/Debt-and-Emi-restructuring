"""Behind / collections loans through the API (founder decision 17 Oct 2026,
FOUNDER-RECORDS B17; engine/debt_status.py)."""
from copy import deepcopy
from decimal import Decimal as D

from api.schemas import UserIn

PL = {"loan_type": "personal_loan", "bank": "SBI", "outstanding": "500000", "nominal_rate": "0.11",
      "rate_type": "fixed", "tenure_months_remaining": 60, "scheduled_emi": "10871"}


def _run(client, u):
    r = client.post("/api/simulate", json={"user": u, "strategy": "avalanche", "horizon_months": 600})
    assert r.status_code == 200, r.text
    return r.json()


def _m1(body):
    return next(p for p in body["trajectory"] if p["month"] == 1)


def test_overdue_amount_reaches_the_engine(india_user_payload):
    u = deepcopy(india_user_payload)
    u["loans"].append({**PL, "debt_status": "behind", "overdue_amount": "25000"})
    u["loans"].append({**PL, "debt_status": "behind"})
    eng = UserIn.model_validate(u).to_engine()
    assert eng.loans[-2].debt_status == "behind" and eng.loans[-2].overdue_amount == D("25000")
    assert eng.loans[-1].overdue_amount is None          # blank: the engine estimates one EMI


def test_settled_reaches_the_engine_as_normal_and_zeroed(india_user_payload):
    u = deepcopy(india_user_payload)
    u["loans"].append({**PL, "debt_status": "settled"})
    l = UserIn.model_validate(u).to_engine().loans[-1]
    assert l.debt_status == "normal" and l.outstanding == 0


def test_behind_catch_up_is_in_the_trajectory(client, india_user_payload):
    u = deepcopy(india_user_payload)
    u["loans"].append({**PL, "debt_status": "behind", "overdue_amount": "25000"})
    m1 = _m1(_run(client, u))
    assert D(m1["catch_up_by_loan_index"]["2"]) == D("25000")
    assert D(m1["payments_by_loan_index"]["2"]) >= D("10871") + D("25000")


def test_collections_card_builds_a_settlement_pot(client, india_user_payload):
    u = deepcopy(india_user_payload)
    u["loans"][1]["debt_status"] = "collections"            # the 42% card
    m1 = _m1(_run(client, u))
    assert D(m1["settlement_pot_by_loan_index"]["1"]) > 0


def test_users_pin_wins(client, india_user_payload):
    u = deepcopy(india_user_payload)
    u["loans"][1]["debt_status"] = "collections"
    u["payoff_rules"] = {"small_first_below": None, "pinned": [1], "custom_order": []}
    assert UserIn.model_validate(u).to_engine().loans[1].extra_ok is True
    m1 = _m1(_run(client, u))
    assert m1["settlement_pot_by_loan_index"] == {}


def test_windfall_skips_a_collections_loan(client, india_user_payload):
    u = deepcopy(india_user_payload)
    u["loans"][1]["debt_status"] = "collections"
    r = client.post("/api/windfall", json={"amount": "50000", "user": u, "marginal_rate": "0.30", "strategy": "avalanche"})
    assert r.status_code == 200, r.text
    assert r.json()["loan_index"] != 1
