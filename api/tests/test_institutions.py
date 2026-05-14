from decimal import Decimal
D = Decimal


def test_list_all_institutions(client):
    r = client.get("/api/institutions")
    assert r.status_code == 200
    body = r.json()
    assert len(body) == 45        # 30 India + 15 USA


def test_list_filtered_by_country(client):
    r = client.get("/api/institutions?country=IN")
    assert r.status_code == 200
    assert len(r.json()) == 30


def test_list_filtered_by_tier(client):
    r = client.get("/api/institutions?country=US&tier=A")
    assert r.status_code == 200
    body = r.json()
    assert len(body) == 6
    assert all(card["scrape_tier"] == "A" for card in body)


def test_get_hdfc(client):
    r = client.get("/api/institutions/HDFC Bank")
    assert r.status_code == 200
    body = r.json()
    assert body["name"] == "HDFC Bank"
    assert D(body["home_loan"]["median"]) == D("0.0795")


def test_get_unknown_institution_404(client):
    r = client.get("/api/institutions/Made-up Bank")
    assert r.status_code == 404


def test_market_median_india_home(client):
    r = client.get("/api/market-median?country=IN&loan_type=home_loan")
    assert r.status_code == 200
    body = r.json()
    assert body["median"] is not None
    assert D("0.075") < D(body["median"]) < D("0.090")
