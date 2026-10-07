"""Property-based tests through the HTTP API (same derandomized profile as
engine/tests/test_property_invariants.py).

* A foreign-currency loan without a usable exchange rate is a 422 on every
  plan endpoint — never a silent 1:1 conversion — and the same profile
  with the rate is a 200.
* Every money value the plan endpoints return is already rounded to the
  cent, so rounding it again changes nothing (idempotent rounding).
* A negative tenure, or one beyond the 100-year horizon, is refused (422).
  (0 is allowed: cards have no tenure and EMI loans may give the EMI instead.)
"""
from __future__ import annotations

from decimal import ROUND_HALF_UP, Decimal

from fastapi.testclient import TestClient
from hypothesis import given, settings
from hypothesis import strategies as st

from api.main import app
from engine.tests.strategies import examples

D = Decimal
client = TestClient(app)
PLAN_ENDPOINTS = ["/api/simulate", "/api/baseline", "/api/sensitivity/compare"]


@st.composite
def loan_payload(draw, currency=None, card=False):
    lt = "credit_card" if card else draw(st.sampled_from(
        ["home_loan", "auto_loan", "personal_loan", "education_loan", "gold_loan"]))
    out = draw(st.integers(1_000, 5_000_000))
    rate_bps = draw(st.integers(0, 3600))
    n = draw(st.integers(12, 240))
    emi = "0" if card else str(max(1, out // n + out * rate_bps // 120000))
    loan = {
        "loan_type": lt, "bank": "HDFC Bank", "outstanding": str(out),
        "nominal_rate": str(D(rate_bps) / 10000), "rate_type": "fixed",
        "tenure_months_remaining": n, "scheduled_emi": emi,
    }
    if currency:
        loan["currency"] = currency
    return loan


@st.composite
def user_payload(draw, country):
    loans = draw(st.lists(loan_payload(), min_size=1, max_size=3))
    if draw(st.booleans()):
        loans.append(draw(loan_payload(card=True)))
    income = draw(st.integers(10_000, 2_000_000))
    return {
        "country": country, "income_type": "salaried",
        "annual_income": str(income * 12), "monthly_income": str(income),
        "fixed_expenses": str(draw(st.integers(0, income))),
        "savings_balance": "0", "primary_bank": "HDFC Bank",
        "loans": loans,
    }


def _body(path: str, user: dict) -> dict:
    body = {"user": user, "horizon_months": 120}
    if path.endswith("compare"):
        body["lump_sum_amount"] = "1000"
        body["lump_sum_target_loan_index"] = 0
    return body


@settings(max_examples=examples(60))
@given(
    country=st.sampled_from(["IN", "US"]),
    data=st.data(),
    bad_rate=st.sampled_from([None, "0"]),
    path=st.sampled_from(PLAN_ENDPOINTS),
)
def test_foreign_loan_without_fx_rate_is_422(country, data, bad_rate, path):
    foreign = "USD" if country == "IN" else "INR"
    user = data.draw(user_payload(country))
    user["loans"].append(data.draw(loan_payload(currency=foreign)))
    if bad_rate is not None:
        user["fx_to_user_currency"] = {foreign: bad_rate}
    r = client.post(path, json=_body(path, user))
    assert r.status_code == 422, r.text
    assert "exchange rate" in r.json()["detail"]["message"].lower()

    # The same profile with a rate is a normal plan.
    user["fx_to_user_currency"] = {foreign: "83.25" if foreign == "USD" else "0.012012"}
    ok = client.post(path, json=_body(path, user))
    assert ok.status_code == 200, ok.text


def _money_values(trajectory: list[dict]):
    for point in trajectory:
        for key in ("balance", "interest_paid", "invested", "available_surplus",
                    "total_paid", "extra_paid", "shortfall"):
            if point.get(key) is not None:
                yield key, point[key]
        for key in ("payments_by_loan_index", "balances_by_loan_index", "balances_by_currency"):
            for v in (point.get(key) or {}).values():
                yield key, v


@settings(max_examples=examples(40))
@given(country=st.sampled_from(["IN", "US"]), data=st.data(), path=st.sampled_from(["/api/simulate", "/api/baseline"]))
def test_returned_money_is_rounded_and_rounding_is_idempotent(country, data, path):
    user = data.draw(user_payload(country))
    r = client.post(path, json=_body(path, user))
    assert r.status_code == 200, r.text
    for key, raw in _money_values(r.json()["trajectory"]):
        v = D(str(raw))
        q = v.quantize(D("0.01"), rounding=ROUND_HALF_UP)
        assert v == q, f"{key}={raw} is not rounded to the cent"
        assert q.quantize(D("0.01"), rounding=ROUND_HALF_UP) == q


@settings(max_examples=examples(40))
@given(country=st.sampled_from(["IN", "US"]), data=st.data(), n=st.one_of(st.integers(-500, -1), st.integers(1201, 5000)))
def test_out_of_range_tenure_is_422(country, data, n):
    user = data.draw(user_payload(country))
    user["loans"][0]["tenure_months_remaining"] = n
    r = client.post("/api/simulate", json=_body("/api/simulate", user))
    assert r.status_code == 422, r.text
