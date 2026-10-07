"""Roadmap PR I: the Right time tool is retired, so its endpoints are gone."""


def test_right_time_endpoints_are_retired(client):
    r = client.post("/api/right-time-to-borrow", json={"current_rate": "0.1", "principal": "100000", "tenure_months": 60, "urgency": "now", "country": "IN"})
    assert r.status_code == 404
    assert client.get("/api/rates/odds?country=IN").status_code == 404


def test_retired_engine_and_odds_module_are_gone():
    import importlib.util
    import engine.decisions as d
    assert not hasattr(d, "right_time_to_borrow")
    assert not hasattr(d, "right_time_from_odds")
    assert importlib.util.find_spec("api.market_odds") is None


def test_new_debt_still_answers(client):
    r = client.post("/api/new-debt", json={"list_price": "60000", "cash_price_elsewhere": "57000", "emi_offer_months": 6, "emi_offer_monthly_payment": "10000"})
    assert r.status_code == 200, r.text
