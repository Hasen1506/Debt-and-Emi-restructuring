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
