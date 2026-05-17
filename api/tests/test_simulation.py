from decimal import Decimal

D = Decimal


def test_simulate_returns_trajectory(client, india_user_payload):
    r = client.post("/api/simulate", json={
        "user": india_user_payload, "strategy": "avalanche",
        "horizon_months": 60, "marginal_rate": "0.30",
    })
    assert r.status_code == 200, r.text
    body = r.json()
    assert "trajectory" in body
    assert body["months_in_horizon"] > 0
    assert D(body["total_interest_paid"]) > 0
    # First trajectory point should have a positive total balance
    assert D(body["trajectory"][0]["balance"]) > 0


def test_simulate_emits_per_currency_balance_bucket_single_currency(
    client, india_user_payload
):
    """Single-currency users get a 1-element balances_by_currency dict that
    matches the scalar `balance` field exactly. Used by the FE to drive the
    per-ccy trajectory chart for hybrid users without a special-case for
    the single-currency path."""
    r = client.post("/api/simulate", json={
        "user": india_user_payload, "strategy": "avalanche",
        "horizon_months": 24, "marginal_rate": "0.30",
    })
    body = r.json()
    first = body["trajectory"][0]
    assert "balances_by_currency" in first
    bucket = first["balances_by_currency"]
    assert set(bucket.keys()) == {"INR"}
    assert D(bucket["INR"]) == D(first["balance"])


def test_simulate_emits_per_currency_balance_bucket_hybrid(client):
    """NRI-US user with one INR loan + one USD loan gets two buckets, each
    summing to the per-currency outstanding (no cross-currency conversion at
    the API layer — the chart layer needs each ccy separately)."""
    payload = {
        "country": "US",
        "income_type": "salaried",
        "annual_income": "120000",
        "monthly_income": "10000",
        "fixed_expenses": "4000",
        "savings_balance": "50000",
        "primary_bank": "JPMorgan Chase",
        "efund_balance": "20000",
        "efund_target": "40000",
        "is_nri_us": True,
        "fx_to_user_currency": {"INR": "0.012"},
        "loans": [
            {
                "loan_type": "home_loan", "bank": "HDFC Bank",
                "outstanding": "4000000", "nominal_rate": "0.085",
                "rate_type": "floating", "tenure_months_remaining": 240,
                "scheduled_emi": "34713", "currency": "INR",
            },
            {
                "loan_type": "credit_card", "bank": "Chase",
                "outstanding": "25000", "nominal_rate": "0.249",
                "rate_type": "fixed", "tenure_months_remaining": 0,
                "scheduled_emi": "800", "currency": "USD",
            },
        ],
        "investment_options": [
            {"name": "HYSA", "expected_return": "0.045",
             "liquidity_class": "liquid", "is_in_pool": True},
        ],
    }
    r = client.post("/api/simulate", json={
        "user": payload, "strategy": "avalanche",
        "horizon_months": 12, "marginal_rate": "0.24",
    })
    assert r.status_code == 200, r.text
    body = r.json()
    first = body["trajectory"][0]
    bucket = first["balances_by_currency"]
    assert set(bucket.keys()) == {"INR", "USD"}
    # Each bucket is in its own currency, no FX conversion at the API edge.
    assert D(bucket["INR"]) > D("3_900_000")  # home loan slightly amortised
    assert D(bucket["USD"]) > D("0")          # card not cleared in month 1


def test_baseline_minimums_only(client, india_user_payload):
    r = client.post("/api/baseline", json={
        "user": india_user_payload, "horizon_months": 60,
    })
    assert r.status_code == 200, r.text
    body = r.json()
    # Baseline pays only minimums → no investment
    assert D(body["total_invested"]) == 0


def test_baseline_pays_more_interest_than_avalanche(client, india_user_payload):
    """Avalanche with surplus should pay less interest over the same horizon."""
    baseline = client.post("/api/baseline", json={
        "user": india_user_payload, "horizon_months": 60,
    }).json()
    sim = client.post("/api/simulate", json={
        "user": india_user_payload, "strategy": "avalanche",
        "horizon_months": 60, "marginal_rate": "0.30",
    }).json()
    assert D(baseline["total_interest_paid"]) >= D(sim["total_interest_paid"])


def test_sensitivity_surplus_delta(client, india_user_payload):
    r = client.post("/api/sensitivity/compare", json={
        "user": india_user_payload, "horizon_months": 60,
        "marginal_rate": "0.30", "strategy": "avalanche",
        "surplus_delta": "10000",
    })
    assert r.status_code == 200, r.text
    body = r.json()
    # Extra ₹10k/mo of surplus → either more interest saved, or no change if
    # the loan already clears within horizon. interest_saved must be ≥ 0.
    assert D(body["interest_saved"]) >= 0


def test_sensitivity_rate_shock(client, india_user_payload):
    """A 50bps rate cut on the floating home loan saves interest."""
    r = client.post("/api/sensitivity/compare", json={
        "user": india_user_payload, "horizon_months": 60,
        "marginal_rate": "0.30", "strategy": "avalanche",
        "rate_shock_delta": "-0.005",
    })
    assert r.status_code == 200, r.text
    body = r.json()
    assert D(body["interest_saved"]) > 0
