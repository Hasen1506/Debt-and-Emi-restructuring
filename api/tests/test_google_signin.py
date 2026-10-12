"""Sign in with Google behind GOOGLE_SIGNIN (live test #6, sprint L3)."""
import base64
import hashlib
import json
import time
from contextlib import asynccontextmanager
from urllib.parse import parse_qs, urlparse

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.ext.compiler import compiles, deregister

from api.auth import dependencies, google
from api.auth.routes import router as auth_router
from api.auth.session import utc_now
from api.db.database import Base, get_db

CLIENT_ID = "test-client.apps.googleusercontent.com"


def _jwt(claims: dict) -> str:
    enc = lambda d: base64.urlsafe_b64encode(json.dumps(d).encode()).rstrip(b"=").decode()
    return f"{enc({'alg': 'RS256'})}.{enc(claims)}.sig"


def _claims(**over):
    c = {"iss": "https://accounts.google.com", "aud": CLIENT_ID, "exp": time.time() + 600,
         "email": "Asha@Example.com", "email_verified": True, "sub": "123"}
    c.update(over)
    return c


@pytest.fixture
def make_client(tmp_path, monkeypatch):
    compiles(JSONB, "sqlite")(lambda element, compiler, **kw: "JSON")
    engine = create_async_engine(f"sqlite+aiosqlite:///{tmp_path / 'g.sqlite'}")
    sessions = async_sessionmaker(engine, expire_on_commit=False)
    monkeypatch.setattr(dependencies, "utc_now", lambda: utc_now().replace(tzinfo=None))

    @asynccontextmanager
    async def lifespan(app):
        async with engine.begin() as c:
            await c.run_sync(Base.metadata.create_all)
        yield
        await engine.dispose()

    async def database():
        async with sessions() as db:
            yield db

    def make(enabled=True, claims=None, seen=None):
        for k in ("GOOGLE_SIGNIN", "GOOGLE_OAUTH_CLIENT_ID", "GOOGLE_OAUTH_CLIENT_SECRET", "GOOGLE_OAUTH_REDIRECT_URI", "WEB_ORIGIN"):
            monkeypatch.delenv(k, raising=False)
        if enabled:
            monkeypatch.setenv("GOOGLE_SIGNIN", "1")
            monkeypatch.setenv("GOOGLE_OAUTH_CLIENT_ID", CLIENT_ID)
            monkeypatch.setenv("GOOGLE_OAUTH_CLIENT_SECRET", "not-a-real-secret")
            monkeypatch.setenv("WEB_ORIGIN", "https://rightdue.app")

        async def fake_exchange(code, verifier, s):
            if seen is not None:
                seen.append({"code": code, "verifier": verifier, **s})
            return {"id_token": _jwt(claims or _claims())}

        monkeypatch.setattr(google, "exchange_code", fake_exchange)
        app = FastAPI(lifespan=lifespan)
        app.include_router(auth_router, prefix="/api")
        app.include_router(google.router, prefix="/api")
        app.dependency_overrides[get_db] = database
        return TestClient(app, follow_redirects=False)

    yield make
    deregister(JSONB)


def _start(client, next_="/plan"):
    r = client.get("/api/auth/google/start", params={"next": next_})
    assert r.status_code == 302
    q = parse_qs(urlparse(r.headers["location"]).query)
    return r, q


def test_off_by_default_every_route_404s_and_config_says_disabled(make_client):
    with make_client(enabled=False) as c:
        assert c.get("/api/auth/google/config").json() == {"enabled": False}
        assert c.get("/api/auth/google/start").status_code == 404
        assert c.get("/api/auth/google/callback", params={"code": "x", "state": "y"}).status_code == 404


def test_start_redirects_to_google_with_state_and_pkce(make_client):
    with make_client() as c:
        assert c.get("/api/auth/google/config").json() == {"enabled": True}
        r, q = _start(c)
        assert r.headers["location"].startswith(google.AUTH_URL)
        assert q["client_id"] == [CLIENT_ID]
        assert q["redirect_uri"] == ["https://rightdue.app/api/auth/google/callback"]
        assert q["scope"] == ["openid email"]
        assert q["code_challenge_method"] == ["S256"]
        cookie = r.headers["set-cookie"]
        assert google.FLOW_COOKIE in cookie and "HttpOnly" in cookie and "Path=/api/auth/google" in cookie
        flow = json.loads(base64.urlsafe_b64decode(r.cookies[google.FLOW_COOKIE] + "=="))
        assert flow["s"] == q["state"][0]
        expected = base64.urlsafe_b64encode(hashlib.sha256(flow["v"].encode()).digest()).rstrip(b"=").decode()
        assert q["code_challenge"] == [expected]


def test_callback_signs_in_creates_the_user_once_and_lands_on_next(make_client):
    seen = []
    with make_client(seen=seen) as c:
        _, q = _start(c, "/plan")
        r = c.get("/api/auth/google/callback", params={"code": "abc", "state": q["state"][0]})
        assert r.status_code == 302
        assert r.headers["location"] == "/login?google=1&next=%2Fplan"
        token = r.cookies["finoptima_session"]
        me = c.get("/api/auth/me", headers={"Cookie": f"finoptima_session={token}"})
        assert me.status_code == 200 and me.json()["email"] == "asha@example.com"
        assert seen[0]["code"] == "abc" and seen[0]["verifier"]
        # A second Google sign-in reaches the same account.
        _, q2 = _start(c)
        r2 = c.get("/api/auth/google/callback", params={"code": "def", "state": q2["state"][0]})
        me2 = c.get("/api/auth/me", headers={"Cookie": f"finoptima_session={r2.cookies['finoptima_session']}"})
        assert me2.json()["id"] == me.json()["id"]


def test_existing_email_code_account_is_reused(make_client, monkeypatch):
    codes = []
    monkeypatch.setattr("api.auth.routes.generate_otp", lambda: "123456")
    monkeypatch.setattr("api.auth.routes.send_otp_email", lambda e, code: codes.append(code))
    with make_client() as c:
        assert c.post("/api/auth/request-otp", json={"email": "asha@example.com"}).status_code == 204
        v = c.post("/api/auth/verify-otp", json={"email": "asha@example.com", "code": "123456"})
        _, q = _start(c)
        r = c.get("/api/auth/google/callback", params={"code": "x", "state": q["state"][0]})
        me = c.get("/api/auth/me", headers={"Cookie": f"finoptima_session={r.cookies['finoptima_session']}"})
        assert me.json()["id"] == v.json()["id"]


@pytest.mark.parametrize("bad", [
    {"aud": "someone-else.apps.googleusercontent.com"},
    {"iss": "https://evil.example"},
    {"email_verified": False},
    {"exp": time.time() - 10},
    {"email": ""},
])
def test_bad_id_token_claims_never_sign_in(make_client, bad):
    with make_client(claims=_claims(**bad)) as c:
        _, q = _start(c)
        r = c.get("/api/auth/google/callback", params={"code": "x", "state": q["state"][0]})
        assert r.status_code == 302 and r.headers["location"].startswith("/login?google_error=")
        assert "finoptima_session" not in r.cookies


def test_state_mismatch_or_missing_flow_cookie_is_refused(make_client):
    with make_client() as c:
        _start(c)
        r = c.get("/api/auth/google/callback", params={"code": "x", "state": "forged"})
        assert r.headers["location"].startswith("/login?google_error=")
        assert "finoptima_session" not in r.cookies
        c.cookies.clear()
        r = c.get("/api/auth/google/callback", params={"code": "x", "state": "anything"})
        assert r.headers["location"].startswith("/login?google_error=")


def test_user_cancel_at_google_returns_to_login(make_client):
    with make_client() as c:
        r = c.get("/api/auth/google/callback", params={"error": "access_denied"})
        assert r.headers["location"].startswith("/login?google_error=")


@pytest.mark.parametrize("raw,expected", [
    ("/plan", "/plan"), ("/tools/windfall?x=1", "/tools/windfall?x=1"),
    ("//evil.example", "/"), ("https://evil.example", "/"), ("/\\evil", "/"),
    ("/login", "/"), ("/api/auth/me", "/"), (None, "/"), ("", "/"),
])
def test_next_is_always_a_same_site_path(raw, expected):
    assert google.safe_next(raw) == expected
