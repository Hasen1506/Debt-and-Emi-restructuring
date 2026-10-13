"""Size cap, security headers and rate limits (api/security.py)."""
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.security import Limit, SecurityMiddleware


class Clock:
    def __init__(self):
        self.t = 1000.0

    def __call__(self) -> float:
        return self.t


def _app(**kw) -> tuple[TestClient, Clock]:
    app = FastAPI()

    @app.post("/api/echo")
    async def echo(body: dict) -> dict:
        return {"n": len(body)}

    @app.post("/api/auth/request-otp")
    async def otp() -> dict:
        return {}

    @app.get("/api/read")
    async def read() -> dict:
        return {}

    clock = Clock()
    kw.setdefault("rate_limits", True)
    kw.setdefault("limits", [("/api/auth/request-otp", Limit(per_minute=2, burst=2)),
                             ("/api/", Limit(per_minute=60, burst=3))])
    app.add_middleware(SecurityMiddleware, clock=clock, **kw)
    return TestClient(app), clock


# ── headers and size ────────────────────────────────────────────────────────

def test_account_reads_cannot_be_cached():
    app = FastAPI()
    app.add_middleware(SecurityMiddleware, rate_limits=False)
    with TestClient(app) as client:
        for path in ('/api/auth/me', '/api/user/state'):
            assert client.get(path).headers['cache-control'] == 'no-store'


def test_headers_on_the_real_app(client):
    r = client.get("/api/health")
    assert r.headers["x-content-type-options"] == "nosniff"
    assert r.headers["referrer-policy"] == "no-referrer"
    assert "cache-control" not in r.headers
    assert "strict-transport-security" not in r.headers
    r = client.post("/api/new-debt", json={"list_price": "50000", "cash_price_elsewhere": "45000",
                                           "emi_offer_months": 12, "emi_offer_monthly_payment": "4500"})
    assert r.status_code == 200 and r.headers["cache-control"] == "no-store"


def test_hsts_only_behind_https():
    c, _ = _app(proxy_hops=1)
    assert "strict-transport-security" not in c.get("/api/read").headers
    r = c.get("/api/read", headers={"x-forwarded-proto": "https"})
    assert r.headers["strict-transport-security"] == "max-age=63072000; includeSubDomains"  # UX50 E-08: was 15552000 (180 d); now 2 y like the pages
    c, _ = _app(proxy_hops=0)      # not behind a proxy we trust: the header is ignored
    assert "strict-transport-security" not in c.get("/api/read", headers={"x-forwarded-proto": "https"}).headers


def test_large_body_is_refused(client):
    big = {"user": {"loans": [{"bank": "x" * 1000}] * 300}}
    r = client.post("/api/simulate", json=big)
    assert r.status_code == 413
    assert r.json() == {"detail": {"field": "", "message": "The request is too large."}}
    assert r.headers["x-content-type-options"] == "nosniff"


def test_large_body_without_a_length_is_refused():
    c, _ = _app(max_body=1000)

    def chunks():
        for _ in range(20):
            yield b'{"a": "' + b"x" * 100 + b'"}'
    r = c.post("/api/echo", content=chunks(), headers={"content-type": "application/json"})
    assert r.status_code == 413
    r = c.post("/api/echo", json={"a": 1})
    assert r.status_code == 200 and r.json() == {"n": 1}


# ── rate limits ─────────────────────────────────────────────────────────────

def test_writes_are_limited_per_client_and_refill():
    c, clock = _app()
    for _ in range(3):
        assert c.post("/api/echo", json={}).status_code == 200
    r = c.post("/api/echo", json={})
    assert r.status_code == 429
    assert r.headers["retry-after"] == "1"
    assert "Wait a minute" in r.json()["detail"]["message"]
    assert c.get("/api/read").status_code == 200          # reads are not limited
    clock.t += 1
    assert c.post("/api/echo", json={}).status_code == 200


def test_sign_in_has_its_own_tighter_limit():
    c, clock = _app()
    assert [c.post("/api/auth/request-otp").status_code for _ in range(3)] == [200, 200, 429]
    assert c.post("/api/auth/request-otp").headers["retry-after"] == "30"
    assert c.post("/api/echo", json={}).status_code == 200


def test_forwarded_for_cannot_be_spoofed():
    c, _ = _app(proxy_hops=1)
    # Our proxy appends the real address; whatever the client put first is ignored.
    for fake in ("1.1.1.1", "2.2.2.2", "3.3.3.3", "4.4.4.4"):
        r = c.post("/api/echo", json={}, headers={"x-forwarded-for": f"{fake}, 9.9.9.9"})
    assert r.status_code == 429
    r = c.post("/api/echo", json={}, headers={"x-forwarded-for": "8.8.8.8"})
    assert r.status_code == 200


def test_forwarded_for_ignored_when_not_behind_a_proxy():
    c, _ = _app(proxy_hops=0)
    codes = [c.post("/api/echo", json={}, headers={"x-forwarded-for": f"10.0.0.{i}"}).status_code
             for i in range(4)]
    assert codes == [200, 200, 200, 429]


def test_internal_calls_are_not_limited():
    c, _ = _app(internal_token="s3cret")
    codes = [c.post("/api/echo", json={}, headers={"x-internal-token": "s3cret"}).status_code
             for _ in range(10)]
    assert set(codes) == {200}
    wrong = [c.post("/api/echo", json={}, headers={"x-internal-token": "guess"}).status_code
             for _ in range(4)]
    assert wrong[-1] == 429


def test_limits_off():
    c, _ = _app(rate_limits=False)
    assert {c.post("/api/echo", json={}).status_code for _ in range(10)} == {200}
