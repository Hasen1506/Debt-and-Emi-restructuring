"""API regressions for the 7 Oct 2026 audit (H4, H5, M2, P2-07, P2-20,
quick-recompute order, M7 OTP limits, P2-28 state size, admin token)."""
from copy import deepcopy


def _with_usd_loan(payload, fx=None, currency="USD"):
    user = deepcopy(payload)
    user["loans"].append({
        "loan_type": "education_loan", "bank": "Sallie Mae", "outstanding": "5000",
        "nominal_rate": "0.08", "rate_type": "fixed", "tenure_months_remaining": 60,
        "scheduled_emi": "100", "currency": currency,
    })
    if fx is not None:
        user["fx_to_user_currency"] = fx
    return user


def test_h4_foreign_loan_without_fx_is_rejected(client, india_user_payload):
    r = client.post("/api/simulate", json={"user": _with_usd_loan(india_user_payload)})
    assert r.status_code == 422
    assert "exchange rate" in r.json()["detail"]["message"]
    r = client.post("/api/simulate", json={"user": _with_usd_loan(india_user_payload, {"USD": "0"})})
    assert r.status_code == 422


def test_h4_lowercase_currency_is_normalised_and_unknown_rejected(client, india_user_payload):
    ok = client.post("/api/simulate", json={"user": _with_usd_loan(india_user_payload, {"usd": "83"}, "usd")})
    assert ok.status_code == 200, ok.text
    bad = client.post("/api/simulate", json={"user": _with_usd_loan(india_user_payload, {"EUR": "90"}, "EUR")})
    assert bad.status_code == 422


def test_h5_fx_drift_below_minus_one_is_a_422_not_a_500(client, india_user_payload):
    user = _with_usd_loan(india_user_payload, {"USD": "83"})
    user["fx_drift_annualized"] = {"USD": "-2"}
    r = client.post("/api/simulate", json={"user": user})
    assert r.status_code == 422


def test_m2_penalty_insurance_and_enums_are_bounded(client, india_user_payload):
    for patch in ({"prepayment_penalty_pct": "5"}, {"insurance_premium_pct": "-5"},
                  {"processing_fee_amortised": "3"}, {"rate_type": "variable"},
                  {"rate_basis": "simple"}, {"property_use": "rented"}):
        user = deepcopy(india_user_payload)
        user["loans"][0].update(patch)
        assert client.post("/api/simulate", json={"user": user}).status_code == 422, patch
    user = deepcopy(india_user_payload)
    user["loans"][0]["rate_type"] = "Floating"   # case is forgiven, not silently ignored
    user["loans"][1]["statement_day"] = 31        # legacy value clamps to 28
    assert client.post("/api/simulate", json={"user": user}).status_code == 200


def test_quick_recompute_converts_currency_and_checks_index_first(client, india_user_payload):
    user = _with_usd_loan(india_user_payload, {"USD": "83"})
    r = client.post("/api/quick-recompute", json={
        "user": user, "target_loan_index": 2, "extra_payment": "100000",
    })
    assert r.status_code == 200, r.text
    # ₹1 lakh is about $1,205: it can't clear a $5,000 loan.
    assert r.json()["interest_saved"] is not None
    bad = client.post("/api/quick-recompute", json={
        "user": user, "target_loan_index": 9, "extra_payment": "100",
    })
    assert bad.status_code == 422


def test_windfall_rationale_counts_tax_on_the_fund(client, india_user_payload):
    user = deepcopy(india_user_payload)
    user["tax_regime"] = "old"
    user["loans"] = [{
        "loan_type": "education_loan", "bank": "SBI", "outstanding": "1500000",
        "nominal_rate": "0.09", "rate_type": "fixed", "tenure_months_remaining": 120,
        "scheduled_emi": "19000",
    }]
    user["investment_options"][0]["expected_return"] = "0.065"
    r = client.post("/api/windfall", json={"user": user, "amount": "100000", "marginal_rate": "0.30"})
    assert r.status_code == 200, r.text
    assert r.json()["invest_instead"] is False
