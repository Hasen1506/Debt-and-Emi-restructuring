"""Tests for /api/fx-rate and /api/cross-border-decision.

The FX-rate endpoint hits frankfurter.app; we mock httpx for determinism.
The cross-border endpoint is tested via the manual_fx_rate path (no network).
"""
from decimal import Decimal
from unittest.mock import patch, AsyncMock

D = Decimal


def test_cross_border_with_manual_fx_prepay_verdict(client):
    """NRI archetype: 8.5% INR loan, 5% USD HYSA, 24% tax, 3% INR depreciation.
    Manual FX rate so test is hermetic."""
    r = client.post("/api/cross-border-decision", json={
        "loan_balance": "3500000",
        "loan_nominal_rate": "0.085",
        "loan_tenure_months": 180,
        "loan_currency": "INR",
        "user_currency": "USD",
        "user_savings_yield": "0.05",
        "user_marginal_tax": "0.24",
        "manual_fx_rate": "0.012",
        # uses historical default INR→USD drift = -0.030
    })
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["verdict"] == "prepay"
    assert D(body["fx_rate_used"]) == D("0.012")
    assert D(body["fx_drift_used"]) == D("-0.030")
    # EMI in 5y should be lower (INR depreciates → cheaper in USD)
    assert D(body["loan_emi_user_currency_y5"]) < D(body["loan_emi_user_currency"])


def test_cross_border_manual_drift_overrides_default(client):
    """If caller passes manual_fx_drift_annual, historical default is ignored."""
    r = client.post("/api/cross-border-decision", json={
        "loan_balance": "3500000",
        "loan_nominal_rate": "0.085",
        "loan_tenure_months": 180,
        "loan_currency": "INR",
        "user_currency": "USD",
        "user_savings_yield": "0.05",
        "user_marginal_tax": "0.24",
        "manual_fx_rate": "0.012",
        "manual_fx_drift_annual": "0.02",     # override: INR strengthening
    })
    assert r.status_code == 200
    body = r.json()
    assert D(body["fx_drift_used"]) == D("0.02")


@patch("api.routes.fx.httpx.AsyncClient")
def test_fx_rate_live_path_mocked(mock_client, client):
    """Mock frankfurter response so the test doesn't depend on internet."""
    mock_response = AsyncMock()
    mock_response.raise_for_status = lambda: None
    mock_response.json = lambda: {"date": "2026-05-13", "rates": {"USD": 0.01205}}
    mock_client.return_value.__aenter__.return_value.get = AsyncMock(return_value=mock_response)

    r = client.get("/api/fx-rate?base=INR&quote=USD")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["base"] == "INR"
    assert body["quote"] == "USD"
    assert D(body["rate"]) == D("0.01205")
    assert body["source"] == "frankfurter"


def test_fx_rate_unsupported_pair_returns_502(client):
    r = client.get("/api/fx-rate?base=XYZ&quote=USD")
    assert r.status_code == 502


def test_cross_border_rejects_zero_or_negative_fx_rate(client):
    """A 0 rate made every EMI 0 in the user's currency; negative made it < 0."""
    base = {
        "loan_balance": "3500000", "loan_nominal_rate": "0.085",
        "loan_tenure_months": 180, "loan_currency": "INR", "user_currency": "USD",
        "user_savings_yield": "0.05",
    }
    for bad in ("0", "-0.012"):
        r = client.post("/api/cross-border-decision", json={**base, "manual_fx_rate": bad})
        assert r.status_code == 422, bad
    r = client.post("/api/cross-border-decision",
                    json={**base, "manual_fx_rate": "0.012", "manual_fx_drift_annual": "3"})
    assert r.status_code == 422


def test_same_currency_needs_no_fetch(client):
    """A rupee loan checked from rupees used to call the provider, which
    has no INR/INR quote, and fail with a 502."""
    with patch("api.routes.fx.httpx.AsyncClient") as never:
        r = client.get("/api/fx-rate", params={"base": "INR", "quote": "INR"})
        assert r.status_code == 200, r.text
        assert D(r.json()["rate"]) == 1 and r.json()["source"] == "parity"
        r = client.post("/api/cross-border-decision", json={
            "loan_balance": "2600000", "loan_nominal_rate": "0.0875",
            "loan_tenure_months": 180, "loan_currency": "INR", "user_currency": "INR",
            "user_savings_yield": "0.068", "user_marginal_tax": "0.30",
        })
        assert r.status_code == 200, r.text
        assert D(r.json()["fx_rate_used"]) == 1
        never.assert_not_called()
