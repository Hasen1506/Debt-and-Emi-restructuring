"""Live re-test 3 (13 Oct 2026), R3-2: New Debt Check never returns figures
for an invalid tenure, and what it returns is non-negative and bounded."""
from __future__ import annotations

from decimal import Decimal

from fastapi.testclient import TestClient
from hypothesis import given, settings
from hypothesis import strategies as st

from api.main import app
from engine.decisions import MAX_APR

D = Decimal
client = TestClient(app)


def _body(months, price=300_000, emi=None, fee=0, card=False):
    emi = emi if emi is not None else max(1, price // max(1, abs(months) or 1) + price // 100)
    return {
        "list_price": str(price), "cash_price_elsewhere": str(price),
        "emi_offer_months": months, "emi_offer_monthly_payment": str(emi),
        "processing_fee": str(fee), "user_savings_after_efund": "0",
        "country": "IN", "card_emi": card,
    }


def test_invalid_tenures_are_refused_with_a_field_error():
    for months in (0, -1, 1, 2, 481, 600, 6016):
        r = client.post("/api/new-debt", json=_body(months))
        assert r.status_code == 422, (months, r.text)
        assert "emi_offer_months" in r.text


def test_edges_of_the_range_are_accepted():
    for months in (3, 480):
        r = client.post("/api/new-debt", json=_body(months, emi=5_000))
        assert r.status_code == 200, (months, r.text)


@settings(max_examples=150, deadline=None, derandomize=True)
@given(
    months=st.integers(-50, 7000),
    price=st.integers(1, 50_000_000),
    emi=st.integers(1, 50_000_000),
    fee_pct=st.integers(0, 99),
    card=st.booleans(),
)
def test_new_debt_outputs_are_non_negative_and_bounded_or_rejected(months, price, emi, fee_pct, card):
    r = client.post("/api/new-debt", json=_body(months, price=price, emi=emi, fee=price * fee_pct // 100, card=card))
    if not 3 <= months <= 480:
        assert r.status_code == 422, r.text
        return
    if r.status_code == 422:
        return  # another field the engine refuses (e.g. a fee above the price)
    assert r.status_code == 200, r.text
    v = r.json()
    for k in ("total_real_cost", "monthly_emi", "effective_apr", "processing_fee", "foregone_discount", "gst"):
        assert D(str(v[k])) >= 0, (k, v[k])
    # Bounded: never more than every payment plus the fee and its GST, and
    # the APR is capped where the copy says "over 1000%".
    paid = D(emi) * months * D("1.18") + D(price) * fee_pct / 100 * D("1.18")
    assert D(str(v["total_real_cost"])) <= paid + 1
    assert D(str(v["effective_apr"])) <= MAX_APR
