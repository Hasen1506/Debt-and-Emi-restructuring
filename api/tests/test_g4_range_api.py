"""Sprint G4 (grill #24): POST /api/sensitivity/range."""


def test_range_endpoint_returns_exact_and_edges(client, india_user_payload):
    r = client.post("/api/sensitivity/range", json={
        "user": india_user_payload, "horizon_months": 360,
        "marginal_rate": "0.30", "strategy": "avalanche",
    })
    assert r.status_code == 200, r.text
    b = r.json()
    sim = client.post("/api/simulate", json={
        "user": india_user_payload, "horizon_months": 360,
        "marginal_rate": "0.30", "strategy": "avalanche",
    }).json()
    # The exact month is the plan's own date, not a plainer run's.
    assert b["exact"] == sim["debt_free_month"]
    if b["exact"] is not None and not b["open_ended"]:
        assert b["earliest"] <= b["exact"] <= b["latest"]
    assert {s["id"] for s in b["scenarios"]} >= {"income_gap", "income_bonus"}
    for s in b["scenarios"]:
        assert s["why"]


def test_range_endpoint_ignores_what_if_knobs(client, india_user_payload):
    body = {"user": india_user_payload, "horizon_months": 360, "marginal_rate": "0.30"}
    a = client.post("/api/sensitivity/range", json=body).json()
    b = client.post("/api/sensitivity/range", json={**body, "surplus_delta": "50000"}).json()
    assert a["exact"] == b["exact"]
