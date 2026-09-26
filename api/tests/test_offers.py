"""POST /api/offers/compare — keep, pay the fee to reset, or refinance."""
from decimal import Decimal

import pytest

D = Decimal


def _payload(**kw) -> dict:
    body = {
        "lender": "HDFC Bank",
        "loan_start": "2022-01",
        "start_rate": "0.0690",
        "current_rate": "0.0890",
        "outstanding": "4000000",
        "tenure_months_remaining": 200,
        "benchmark": "repo",
        "as_of": "2026-09-26",
    }
    body.update(kw)
    return {k: v for k, v in body.items() if v is not None}


def test_fee_for_the_owed_cut_is_turned_down(client):
    """Loan Check finds 8.15% owed; a fee to reach it is not a saving."""
    r = client.post("/api/offers/compare", json=_payload(
        reset={"rate": "0.0815", "fee": "20000", "fee_plus_gst": True},
    ))
    assert r.status_code == 200, r.text
    body = r.json()
    assert D(body["entitled_rate"]) == D("0.0815")
    assert body["baseline"] == "keep_owed"
    assert body["verdict"] == "keep"
    reset = next(o for o in body["options"] if o["key"] == "reset")
    assert D(reset["saving"]) == D("-23600")
    assert [x["label"] for x in reset["upfront"]] == ["Reset fee", "GST on the reset fee (18%)"]
    assert any("passed on free" in w for w in body["warnings"])


def test_refinance_wins_when_nothing_is_owed(client):
    body = client.post("/api/offers/compare", json=_payload(
        current_rate="0.0815",
        reset={"rate": "0.0790", "fee": "25000"},
        refinance={"rate": "0.0740", "lender": "SBI", "processing_fee": "10000",
                   "fee_plus_gst": True, "stamp_duty": "20000"},
    )).json()
    assert body["entitled_rate"] is None and body["baseline"] == "keep"
    assert body["verdict"] == "refinance"
    refi = next(o for o in body["options"] if o["key"] == "refinance")
    assert refi["label"] == "Move the loan to SBI"
    assert refi["break_even_on"] and refi["break_even_month"] > 0
    assert D(refi["upfront_total"]) == D("31800")


def test_prepayment_charge_cites_the_rule(client):
    body = client.post("/api/offers/compare", json=_payload(
        current_rate="0.0815",
        refinance={"rate": "0.0740", "prepayment_charge": "40000"},
    )).json()
    assert body["citations"][0]["rule"].startswith("RBI (Pre-payment Charges on Loans) Directions, 2025")
    assert body["citations"][0]["verified_against_text"] is False


def test_horizon_and_same_emi(client):
    body = client.post("/api/offers/compare", json=_payload(
        current_rate="0.0815", mode="same_emi", horizon_months=24,
        reset={"rate": "0.0790", "fee_percent": "0.0035"},
    )).json()
    assert body["horizon_months"] == 24
    keep, reset = body["options"][0], body["options"][1]
    assert keep["emi"] == reset["emi"] and reset["months"] < keep["months"]


@pytest.mark.parametrize("kw, field", [
    (dict(), "reset"),
    (dict(reset={"rate": "7.9"}), "reset.rate"),
    (dict(reset={"rate": "0.079", "fee": "1000", "fee_percent": "0.005"}), "reset.fee"),
    (dict(reset={"rate": "0.079", "fee_percent": "0.5"}), "reset.fee_percent"),
    (dict(refinance={"rate": "0.074", "stamp_duty": "-1"}), "refinance.stamp_duty"),
    (dict(refinance={"rate": "0.074", "months": 900}), "refinance.months"),
    (dict(reset={"rate": "0.079"}, horizon_months=0), "horizon_months"),
    (dict(reset={"rate": "0.079"}, loan_start="03/2022"), "loan_start"),
    (dict(reset={"rate": "0.25"}, mode="same_emi", tenure_months_remaining=480), "mode"),
])
def test_bad_input_names_the_field(client, kw, field):
    r = client.post("/api/offers/compare", json=_payload(**kw))
    assert r.status_code == 422, r.text
    assert r.json()["detail"]["field"] == field

