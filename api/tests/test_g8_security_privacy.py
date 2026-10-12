"""Sprint G8 regressions: grill #51 (data rights, retention), #59 (sign-in
abuse), #58 (API frame/CSP headers), #64 (error reports).

Same SQLite harness as test_auth_sessions_sql.py; Postgres-only behaviour
(advisory locks under concurrency) is in test_postgres_concurrency.py.
"""
import json
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import func, select
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.ext.compiler import compiles, deregister

from api import observability, rate_buckets
from api.auth import account, dependencies, retention, routes, turnstile
from api.auth.session import utc_now
from api.db.database import Base, get_db
from api.db.models import OtpChallenge, OtpCode, RateBucket, Session, User, UserState
from api.routes import user_state
from api.security import SecurityMiddleware

EMAIL = "g8-test@example.com"


@pytest.fixture
def harness(tmp_path, monkeypatch):
    compiles(JSONB, "sqlite")(lambda element, compiler, **kw: "JSON")
    engine = create_async_engine(f"sqlite+aiosqlite:///{tmp_path / 'g8.sqlite'}")
    sessions = async_sessionmaker(engine, expire_on_commit=False)
    monkeypatch.setattr(dependencies, "utc_now", lambda: utc_now().replace(tzinfo=None))
    monkeypatch.setattr(retention, "_last_purge", None)
    monkeypatch.delenv("TURNSTILE_SECRET_KEY", raising=False)
    codes = []
    issued = iter(f"{i:06d}" for i in range(1, 500))
    monkeypatch.setattr("api.auth.routes.generate_otp", lambda: next(issued))
    monkeypatch.setattr("api.auth.routes.send_otp_email", lambda email, code: codes.append(code))

    @asynccontextmanager
    async def lifespan(app):
        async with engine.begin() as connection:
            await connection.run_sync(Base.metadata.create_all)
        yield
        await engine.dispose()

    async def database():
        async with sessions() as db:
            yield db

    app = FastAPI(lifespan=lifespan)
    app.include_router(routes.router, prefix="/api")
    app.include_router(account.router, prefix="/api")
    app.include_router(user_state.router, prefix="/api")
    app.dependency_overrides[get_db] = database

    def query(stmt):
        async def run():
            async with sessions() as db:
                return (await db.execute(stmt)).scalars().all()
        return client.portal.call(run)

    try:
        with TestClient(app) as client:
            client.query = query
            client.sessions = sessions
            yield client, codes
    finally:
        deregister(JSONB)


def sign_in(client, codes, email=EMAIL):
    assert client.post("/api/auth/request-otp", json={"email": email}).status_code == 204
    r = client.post("/api/auth/verify-otp", json={"email": email, "code": codes[-1]})
    assert r.status_code == 200, r.text
    return r.cookies["finoptima_session"]


# ── #59: an account exists only after the email is proven ─────────────────

def test_requesting_a_code_creates_no_account(harness):
    client, codes = harness
    assert client.post("/api/auth/request-otp", json={"email": "stranger@example.com"}).status_code == 204
    assert client.query(select(User)) == []
    assert [c.email for c in client.query(select(OtpChallenge))] == ["stranger@example.com"]
    # Asking about an address that never asked for a code reveals nothing either.
    r = client.post("/api/auth/verify-otp", json={"email": "nobody@example.com", "code": "123456"})
    assert r.status_code == 400 and "Request a new one" in r.json()["detail"]


def test_verifying_creates_the_account_once_and_blanks_the_code(harness):
    client, codes = harness
    sign_in(client, codes)
    sign_in(client, codes)
    users = client.query(select(User))
    assert [u.email for u in users] == [EMAIL]
    assert all(c.code_hash == "" for c in client.query(select(OtpChallenge)))


def test_global_daily_cap_pauses_codes_for_every_address(harness, monkeypatch):
    client, codes = harness
    monkeypatch.setattr(routes, "OTP_GLOBAL_DAILY_CAP", 2)
    for i in range(2):
        assert client.post("/api/auth/request-otp", json={"email": f"p{i}@example.com"}).status_code == 204
    r = client.post("/api/auth/request-otp", json={"email": "third@example.com"})
    assert r.status_code == 503
    assert r.json()["detail"]["code"] == "sign_in_paused"
    assert r.headers["retry-after"] == str(24 * 3600)
    assert len(codes) == 2  # no third email went out


def test_cap_default_is_under_the_email_providers_free_daily_quota():
    from api.auth.session import OTP_GLOBAL_DAILY_CAP
    assert 0 < OTP_GLOBAL_DAILY_CAP < 100  # Resend free: 100 a day (resend.com/pricing, 12 Oct 2026)


# ── #59: Turnstile, off by default ────────────────────────────────────────

def test_turnstile_is_off_without_a_secret(harness):
    client, codes = harness
    assert not turnstile.enabled()
    assert client.post("/api/auth/request-otp", json={"email": EMAIL}).status_code == 204


def test_turnstile_on_refuses_a_missing_or_bad_token_before_sending(harness, monkeypatch):
    client, codes = harness
    monkeypatch.setenv("TURNSTILE_SECRET_KEY", "test-secret")
    monkeypatch.setattr(turnstile, "verify", lambda token, ip=None: token == "good")
    r = client.post("/api/auth/request-otp", json={"email": EMAIL})
    assert r.status_code == 400 and r.json()["detail"]["code"] == "turnstile_failed"
    r = client.post("/api/auth/request-otp", json={"email": EMAIL, "turnstile_token": "forged"})
    assert r.status_code == 400
    assert codes == [] and client.query(select(OtpChallenge)) == []
    assert client.post("/api/auth/request-otp", json={"email": EMAIL, "turnstile_token": "good"}).status_code == 204


def test_turnstile_verify_fails_closed(monkeypatch):
    monkeypatch.setenv("TURNSTILE_SECRET_KEY", "s")
    sent = {}

    def ok(url, data, timeout):
        sent.update(url=url, data=data.decode())
        return b'{"success": true}'

    assert turnstile.verify("tok", "203.0.113.9", post=ok)
    assert sent["url"] == "https://challenges.cloudflare.com/turnstile/v0/siteverify"
    assert "secret=s" in sent["data"] and "response=tok" in sent["data"] and "remoteip=203.0.113.9" in sent["data"]
    assert not turnstile.verify("tok", post=lambda *a: b'{"success": false}')
    assert not turnstile.verify("tok", post=lambda *a: b"not json")

    def down(*a):
        raise TimeoutError

    assert not turnstile.verify("tok", post=down)
    assert not turnstile.verify("", post=ok)
    assert not turnstile.verify("x" * 2049, post=ok)


# ── #51: download my data ─────────────────────────────────────────────────

def test_export_has_the_saved_plan_and_no_secrets(harness):
    client, codes = harness
    token = sign_in(client, codes)
    cookie = {"Cookie": f"finoptima_session={token}"}
    plan = {"profile": {"loans": [{"bank": "SBI", "outstanding": "3000000"}]}}
    assert client.put("/api/user/state", json={"data": plan}, headers=cookie).status_code == 200
    r = client.get("/api/auth/account/export", headers=cookie)
    assert r.status_code == 200
    assert r.headers["content-disposition"].startswith('attachment; filename="rightdue-my-data-')
    body = r.json()
    assert body["account"]["email"] == EMAIL
    assert body["saved_plan"] == plan
    assert body["sign_in_sessions"][0]["this_device"] is True
    assert len(body["sign_in_codes_sent"]) == 1
    text = r.text
    assert token not in text and "sha256:" not in text and "code_hash" not in text
    client.cookies.clear()
    assert client.get("/api/auth/account/export").status_code == 401


# ── #51: delete my account ────────────────────────────────────────────────

def test_delete_needs_the_accounts_own_email(harness):
    client, codes = harness
    token = sign_in(client, codes)
    r = client.post("/api/auth/account/delete", json={"confirm_email": "other@example.com"},
                    headers={"Cookie": f"finoptima_session={token}"})
    assert r.status_code == 400 and r.json()["detail"]["field"] == "confirm_email"
    assert len(client.query(select(User))) == 1
    client.cookies.clear()
    assert client.post("/api/auth/account/delete", json={"confirm_email": EMAIL}).status_code == 401


def test_delete_erases_every_linked_record_and_signs_out_everywhere(harness):
    client, codes = harness
    first = sign_in(client, codes)
    second = sign_in(client, codes)  # another device
    sign_in(client, codes, "someone-else@example.com")
    cookie = {"Cookie": f"finoptima_session={first}"}
    client.put("/api/user/state", json={"data": {"profile": {"x": 1}}}, headers=cookie)
    r = client.post("/api/auth/account/delete", json={"confirm_email": EMAIL.upper()}, headers=cookie)
    assert r.status_code == 200, r.text
    assert r.json()["removed"] == {"saved_plan": 1, "sessions": 2, "sign_in_codes": 2}
    assert "Max-Age=0" in r.headers["set-cookie"]
    for t in (first, second):
        assert client.get("/api/auth/me", headers={"Cookie": f"finoptima_session={t}"}).status_code == 401
    assert [u.email for u in client.query(select(User))] == ["someone-else@example.com"]
    assert client.query(select(UserState)) == []
    assert [c.email for c in client.query(select(OtpChallenge))] == ["someone-else@example.com"]
    assert len(client.query(select(Session))) == 1
    # The address can sign up again later, as a new empty account.
    again = sign_in(client, codes)
    assert client.get("/api/user/state", headers={"Cookie": f"finoptima_session={again}"}).json()["data"] is None


# ── #51: retention ────────────────────────────────────────────────────────

def test_retention_purges_old_records_and_keeps_recent_ones(harness):
    client, codes = harness
    sign_in(client, codes)
    now = datetime.now(timezone.utc)
    old = now - timedelta(days=400)

    async def seed():
        async with client.sessions() as db:
            user = (await db.execute(select(User))).scalar_one()
            db.add_all([
                OtpChallenge(email="old@example.com", code_hash="", expires_at=old, created_at=old),
                OtpChallenge(email="live@example.com", code_hash="abc", expires_at=now + timedelta(minutes=5), created_at=now),
                OtpChallenge(email="stale@example.com", code_hash="abc", expires_at=now - timedelta(minutes=1), created_at=now - timedelta(minutes=11)),
                OtpCode(user_id=user.id, code_hash="x", expires_at=old, created_at=old),
                Session(token="sha256:old", user_id=user.id, expires_at=old),
                Session(token="sha256:revoked-old", user_id=user.id, expires_at=now + timedelta(days=1), revoked_at=old),
                RateBucket(key="k-old", count=3, expires_at=now - timedelta(days=2)),
                RateBucket(key="k-now", count=3, expires_at=now + timedelta(minutes=30)),
            ])
            await db.commit()
            return await retention.purge(db, now)

    counts = client.portal.call(seed)
    assert counts["otp_challenges"] == 1 and counts["otp_codes_legacy"] == 1
    assert counts["sessions"] == 2 and counts["rate_buckets"] == 1
    hashes = {c.email: c.code_hash for c in client.query(select(OtpChallenge))}
    assert "old@example.com" not in hashes
    assert hashes["live@example.com"] == "abc"      # still usable
    assert hashes["stale@example.com"] == ""         # expired: hash blanked
    assert [b.key for b in client.query(select(RateBucket))] == ["k-now"]
    assert len(client.query(select(Session))) == 1   # the real, live session


def test_retention_default_is_one_year():
    from api.auth.session import AUTH_LOG_RETENTION
    assert AUTH_LOG_RETENTION == timedelta(days=365)


# ── #59: rate limits that survive a restart ──────────────────────────────

def test_db_rate_counter_counts_per_address_and_window(harness):
    client, _ = harness
    counter = rate_buckets.DbRateCounter(client.sessions, key=b"k",
                                         limits=[("/api/auth/request-otp", rate_buckets.WindowLimit(limit=3))])
    t = datetime(2026, 10, 12, 10, 15, tzinfo=timezone.utc)
    hit = lambda ip, path="/api/auth/request-otp", now=t: client.portal.call(counter.hit, ip, path, now)
    assert [hit("198.51.100.7") for _ in range(3)] == [None, None, None]
    assert hit("198.51.100.7") == 45 * 60          # seconds to the end of the hour
    assert hit("198.51.100.8") is None              # another client
    assert hit("198.51.100.7", "/api/simulate") is None  # not a persisted route
    assert hit("198.51.100.7", now=t + timedelta(hours=1)) is None  # next window
    keys = [b.key for b in client.query(select(RateBucket))]
    assert keys and not any("198.51.100" in k for k in keys)  # address only as a keyed hash


def test_db_rate_counter_allows_when_the_database_is_down():
    def broken():
        raise ConnectionError("db down")

    counter = rate_buckets.DbRateCounter(broken, key=b"k")
    import asyncio
    assert asyncio.run(counter.hit("1.2.3.4", "/api/auth/request-otp")) is None


def test_persisted_limit_still_applies_after_a_restart():
    """A new middleware (a restarted container) has fresh memory buckets
    but the persisted counter still says no."""
    seen = {"n": 0}

    class Counter:
        async def hit(self, ip, path):
            seen["n"] += 1
            return 1200 if seen["n"] > 2 else None

    async def ok(scope, receive, send):
        await send({"type": "http.response.start", "status": 204, "headers": []})
        await send({"type": "http.response.body", "body": b""})

    counter = Counter()
    statuses = []
    for _ in range(3):
        app = FastAPI()
        app.post("/api/auth/request-otp")(lambda: None)
        mw = SecurityMiddleware(ok, rate_limits=True, persistent=counter)
        statuses.append(TestClient(mw).post("/api/auth/request-otp", json={}).status_code)
    assert statuses == [204, 204, 429]


def test_memory_only_when_no_database(monkeypatch):
    monkeypatch.setattr("api.db.database.SessionLocal", None)
    assert rate_buckets.default_counter() is None
    monkeypatch.setenv("RATE_LIMIT_STORE", "memory")
    assert rate_buckets.default_counter() is None


# ── #58: API replies can't be framed ─────────────────────────────────────

def test_api_replies_forbid_framing(client):
    r = client.get("/api/health")
    assert r.headers["content-security-policy"] == "default-src 'none'; frame-ancestors 'none'"
    assert r.headers["x-frame-options"] == "DENY"


# ── #64: error reports, off by default, nothing personal ─────────────────

def test_error_reports_are_off_without_a_dsn(monkeypatch):
    monkeypatch.delenv("SENTRY_DSN", raising=False)
    assert observability.capture_exception(ValueError("x")) is None


def test_error_report_envelope_carries_no_figures(monkeypatch):
    monkeypatch.setenv("SENTRY_DSN", "https://publickey@o123.ingest.sentry.io/4567")
    sent = []
    try:
        raise ValueError("balance 3500000 for user@example.com")
    except ValueError as exc:
        event_id = observability.capture_exception(
            exc, "POST", "/api/user/state", sender=lambda *a: sent.append(a), background=False)
    url, body, key = sent[0]
    assert url == "https://o123.ingest.sentry.io/api/4567/envelope/" and key == "publickey"
    header, item, payload = body.decode().rstrip("\n").split("\n")
    assert json.loads(header)["event_id"] == event_id
    assert json.loads(item)["type"] == "event" and json.loads(item)["length"] == len(payload.encode())
    event = json.loads(payload)
    assert event["exception"]["values"][0]["type"] == "ValueError"
    assert "3500000" not in payload and "#######" in payload
    assert event["request"] == {"method": "POST", "url": "/api/user/state"}
    assert "vars" not in payload and "cookies" not in payload and "data" not in event["request"]


def test_bad_dsn_turns_reports_off(monkeypatch):
    monkeypatch.setenv("SENTRY_DSN", "not a dsn")
    assert observability.dsn() is None


def test_unhandled_error_answers_500_and_is_reported(monkeypatch):
    from api.main import app
    calls = []
    monkeypatch.setattr(observability, "capture_exception", lambda exc, m, r: calls.append((type(exc).__name__, m, r)))

    @app.get("/api/__g8_boom/{loan_id}")
    def boom(loan_id: str):
        raise RuntimeError("secret 123")

    try:
        r = TestClient(app, raise_server_exceptions=False).get("/api/__g8_boom/abc?income=900000")
        assert r.status_code == 500
        assert "secret" not in r.text and "900000" not in r.text
        assert calls == [("RuntimeError", "GET", "/api/__g8_boom/{loan_id}")]
    finally:
        app.router.routes[:] = [rt for rt in app.router.routes if getattr(rt, "path", "") != "/api/__g8_boom/{loan_id}"]
