from decimal import Decimal
D = Decimal


def test_employer_match_unmet(client):
    """Salary 100k, 6% cap, 50% match, user contributes 3% → unmet 3%."""
    r = client.post("/api/employer-match", json={
        "name": "401k", "annual_salary": "100000",
        "match_cap_pct": "0.06", "match_rate": "0.5",
        "current_user_contribution_pct": "0.03",
        "expected_annual_return": "0.07", "years_to_retirement": 30,
    })
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["has_unmet_match"] is True
    # 3% of 100k / 12 = 250/mo
    assert D(body["monthly_contribution_needed"]) == D("250")
    # Non-zero PV
    assert D(body["pv_at_retirement"]) > 0


def test_employer_match_already_capped(client):
    r = client.post("/api/employer-match", json={
        "name": "401k", "annual_salary": "100000",
        "match_cap_pct": "0.06", "match_rate": "0.5",
        "current_user_contribution_pct": "0.10",
        "expected_annual_return": "0.07", "years_to_retirement": 30,
    })
    assert r.status_code == 200
    body = r.json()
    assert body["has_unmet_match"] is False
    assert D(body["monthly_contribution_needed"]) == 0
