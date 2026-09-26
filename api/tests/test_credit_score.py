"""Round-trip tests for /api/score-impact, /score-band, /rate-offered."""
from decimal import Decimal
D = Decimal


def test_score_impact_hard_inquiry(client):
    r = client.post("/api/score-impact", json={
        "action": "hard_inquiry", "current_score": 720, "country": "IN",
    })
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["delta_low"] <= body["delta_high"] <= 0
    assert "CIBIL" in body["source"] or "FICO" in body["source"]


def test_score_impact_utilisation_drop(client):
    r = client.post("/api/score-impact", json={
        "action": "utilisation_drop", "current_score": 680, "country": "IN",
        "utilisation_from": "0.80", "utilisation_to": "0.30",
    })
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["delta_low"] >= 25
    assert body["current_band"] in ("good", "fair")
    assert body["projected_band_high"] in ("good", "very_good", "excellent")


def test_score_impact_missing_required_params_400(client):
    """utilisation_drop without from/to should 400."""
    r = client.post("/api/score-impact", json={
        "action": "utilisation_drop", "current_score": 700, "country": "IN",
    })
    assert r.status_code == 400


def test_score_band_endpoint(client):
    r = client.get("/api/score-band?score=770&country=IN")
    assert r.status_code == 200
    assert r.json()["band"] == "very_good"


def test_rate_offered_personal_loan_poor_score(client):
    r = client.post("/api/rate-offered", json={
        "advertised_rate": "0.105", "score": 540,
        "loan_type": "personal_loan", "country": "IN",
    })
    assert r.status_code == 200
    body = r.json()
    assert D(body["offered_rate"]) > D("0.18")
    assert body["band"] == "poor"


def test_rate_offered_home_loan_excellent_score(client):
    r = client.post("/api/rate-offered", json={
        "advertised_rate": "0.085", "score": 820,
        "loan_type": "home_loan", "country": "IN",
    })
    assert r.status_code == 200
    body = r.json()
    assert D(body["spread"]) == D("0")


def test_us_score_above_850_is_rejected(client):
    """FICO runs 300–850; an 880 used to be accepted and 'projected' down to 850."""
    r = client.post("/api/score-impact", json={
        "action": "hard_inquiry", "current_score": 880, "country": "US",
    })
    assert r.status_code == 422
    r = client.post("/api/score-impact", json={
        "action": "hard_inquiry", "current_score": 880, "country": "IN",
    })
    assert r.status_code == 200


def test_score_band_rejects_out_of_range(client):
    assert client.get("/api/score-band?score=42").status_code == 422
    assert client.get("/api/score-band?score=760").status_code == 200
