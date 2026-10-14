"""Audit 80 Section D (trust, security, ops) regressions, workstream W8.

Each test guards a CLASS of defect, not one repro:
  D13  no sequence of new-sign-up requests can lock out an existing account
  D2   consent lifecycle: given -> required again on a new version -> re-given
       -> withdrawn on delete -> purged a year later
  D5   the export lists every record kind and the live processor list
  D6   deleting keeps only tombstones (no codes, no figures) for the year
  D8   every read/write of a saved plan leaves an access line without figures
  D21  devices are listed by a coarse label and can be signed out
  D25  sign-in codes are keyed hashes (no key, no reversal)
  D24  the request log never carries a query string or a token
  D26  schema drift stops a production start
  D15  PDF parses are bounded (one at a time, memory, structure)
  D14  the backup preflight fails without its secrets
Same SQLite harness as test_g8_security_privacy.py.
"""
from __future__ import annotations

import hashlib
import logging
import os
import re
import subprocess
import threading
import zlib
from contextlib import asynccontextmanager
from datetime import timedelta
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.ext.compiler import compiles, deregister

from api import netkey, privacy_facts
from api.auth import account, consent, dependencies, retention, routes
from api.auth import session as auth_session
from api.auth.devices import device_label, public_session_id
from api.auth.session import hash_otp, otp_matches, utc_now
from api.db.database import Base, get_db
from api.db.models import AccessLog, AuthLogTombstone, ConsentEvent, OtpChallenge, Session, User
from api.routes import user_state

ROOT = Path(__file__).resolve().parents[2]
EMAIL = "w8-test@example.com"
AGREE = {"notice_version": privacy_facts.NOTICE_VERSION, "terms_version": privacy_facts.TERMS_VERSION,
         "age_confirmed": True}


@pytest.fixture
def harness(tmp_path, monkeypatch):
    compiles(JSONB, "sqlite")(lambda element, compiler, **kw: "JSON")
    engine = create_async_engine(f"sqlite+aiosqlite:///{tmp_path / 'w8.sqlite'}")
    sessions = async_sessionmaker(engine, expire_on_commit=False)
    naive_now = lambda: utc_now().replace(tzinfo=None)  # noqa: E731 (SQLite returns naive datetimes)
    monkeypatch.setattr(dependencies, "utc_now", naive_now)
    monkeypatch.setattr(retention, "_last_purge", None)
    monkeypatch.setattr(routes, "_alerted_day", None)
    monkeypatch.delenv("TURNSTILE_SECRET_KEY", raising=False)
    codes: list[str] = []
    issued = iter(f"{i:06d}" for i in range(1, 900))
    monkeypatch.setattr("api.auth.routes.generate_otp", lambda: next(issued))
    monkeypatch.setattr("api.auth.routes.send_otp_email", lambda email, code: codes.append(code))
    from api.notify import store as notify_store_mod
    notify = notify_store_mod.NotifyStore(create_async_engine(f"sqlite+aiosqlite:///{tmp_path / 'notify.sqlite'}"))
    monkeypatch.setattr(notify_store_mod, "store", lambda: notify)

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
    app.include_router(consent.router, prefix="/api")
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


def ask(client, email, ip="198.51.100.7"):
    return client.post("/api/auth/request-otp", json={"email": email}, headers={"X-Forwarded-For": ip})


def sign_in(client, codes, email=EMAIL, agree=AGREE, ua="Mozilla/5.0 (Linux; Android 14) Chrome/130.0 Mobile Safari/537.36"):
    assert ask(client, email).status_code == 204
    body = {"email": email, "code": codes[-1], **(agree or {})}
    r = client.post("/api/auth/verify-otp", json=body, headers={"User-Agent": ua})
    assert r.status_code == 200, r.text
    return r


# ── D13: the global circuit can't lock anyone out ─────────────────────────

@pytest.mark.parametrize("cap,networks,per_network", [(3, 1, 100), (3, 5, 1), (10, 20, 2), (1, 50, 5)])
def test_no_flood_of_new_sign_ups_blocks_an_existing_account(harness, monkeypatch, cap, networks, per_network):
    client, codes = harness
    sign_in(client, codes, "member@example.com")
    monkeypatch.setattr(routes, "OTP_GLOBAL_DAILY_CAP", cap)
    monkeypatch.setattr(routes, "OTP_NEW_PER_NETWORK_DAILY", per_network)
    monkeypatch.setattr("api.client_ip.from_request", lambda request, hops=None: request.headers.get("x-forwarded-for", "?"))
    statuses = set()
    for n in range(networks):
        for k in range(per_network + 1):
            statuses.add(ask(client, f"bot{n}-{k}@example.com", ip=f"203.0.113.{n}").status_code)
    assert statuses <= {204, 429, 503}
    assert 503 in statuses or 429 in statuses  # the flood was stopped somewhere...
    before = len(codes)
    r = ask(client, "member@example.com", ip="203.0.113.250")
    assert r.status_code == 204, r.text  # ...but the existing account still gets its code
    assert len(codes) == before + 1


def test_one_network_cannot_spend_the_new_sign_up_budget(harness, monkeypatch):
    client, codes = harness
    monkeypatch.setattr(routes, "OTP_NEW_PER_NETWORK_DAILY", 2)
    monkeypatch.setattr("api.client_ip.from_request", lambda request, hops=None: request.headers.get("x-forwarded-for", "?"))
    assert ask(client, "a@example.com", "2001:db8:1:2::1").status_code == 204
    # Another address in the same IPv6 /64 is the same network.
    assert ask(client, "b@example.com", "2001:db8:1:2::ffff").status_code == 204
    r = ask(client, "c@example.com", "2001:db8:1:2:abcd::9")
    assert r.status_code == 429 and "new sign-ups from this connection" in r.json()["detail"]
    # A different network is unaffected.
    assert ask(client, "d@example.com", "2001:db8:9:9::1").status_code == 204


def test_existing_accounts_have_their_own_small_daily_cap(harness, monkeypatch):
    client, codes = harness
    sign_in(client, codes)
    monkeypatch.setattr(routes, "OTP_ACCOUNT_DAILY_CAP", 3)
    monkeypatch.setattr(routes, "OTP_MAX_REQUESTS", 100)
    results = [ask(client, EMAIL).status_code for _ in range(4)]
    assert results == [204, 204, 429, 429]  # one code was already sent by sign_in


def test_half_cap_alert_fires_once_a_day(harness, monkeypatch, caplog):
    client, codes = harness
    monkeypatch.setattr(routes, "OTP_GLOBAL_DAILY_CAP", 4)
    sent = []
    monkeypatch.setattr(routes.observability, "capture_message", lambda m, **kw: sent.append(m))
    with caplog.at_level(logging.WARNING):
        for i in range(4):
            ask(client, f"x{i}@example.com", ip=f"192.0.2.{i}")
    assert len(sent) == 1 and "of the daily cap 4" in sent[0]


@pytest.mark.parametrize("a,b,same", [
    ("2001:db8::1", "2001:db8::ffff:1", True),          # same /64
    ("2001:db8:0:1::1", "2001:db8:0:2::1", False),      # neighbouring /64s
    ("198.51.100.1", "198.51.100.2", False),            # IPv4 stays per address (carrier NAT)
    ("::ffff:198.51.100.1", "198.51.100.1", True),      # IPv4-mapped IPv6
])
def test_network_grouping(a, b, same):
    assert (netkey.network_key(a, b"k") == netkey.network_key(b, b"k")) is same
    assert "198.51.100.1" not in netkey.network_key("198.51.100.1", b"k")  # a hash, never the address


# ── D2/D7/D12: consent record lifecycle ───────────────────────────────────

def test_consent_lifecycle_given_required_regiven_withdrawn_purged(harness, monkeypatch):
    client, codes = harness
    r = sign_in(client, codes)
    assert r.json()["consent_required"] is False
    ev = client.query(select(ConsentEvent))
    assert [(e.action, e.channel, e.age_confirmed, e.notice_version) for e in ev] == [
        ("given", "otp", True, privacy_facts.NOTICE_VERSION)]
    assert privacy_facts.NOTICE_VERSION in ev[0].purpose
    assert client.get("/api/auth/me").json()["consent_required"] is False

    # A new notice version: the account must agree again.
    monkeypatch.setattr(consent, "NOTICE_VERSION", "2099-01-01")
    assert client.get("/api/auth/me").json()["consent_required"] is True
    stale = client.post("/api/auth/consent", json=AGREE)
    assert stale.status_code == 409 and stale.json()["detail"]["code"] == "notice_changed"
    no_age = client.post("/api/auth/consent", json={**AGREE, "notice_version": "2099-01-01", "age_confirmed": False})
    assert no_age.status_code == 400 and no_age.json()["detail"]["code"] == "age_required"
    ok = client.post("/api/auth/consent", json={**AGREE, "notice_version": "2099-01-01"})
    assert ok.status_code == 200 and ok.json()["recorded"] is True
    again = client.post("/api/auth/consent", json={**AGREE, "notice_version": "2099-01-01"})
    assert again.json()["recorded"] is False  # idempotent
    assert client.get("/api/auth/me").json()["consent_required"] is False
    hist = client.get("/api/auth/consent").json()["history"]
    assert [h["action"] for h in hist] == ["given", "re-given"]

    # Delete = withdraw: the record stays, linked to nothing that can sign in.
    assert client.post("/api/auth/account/delete", json={"confirm_email": EMAIL}).status_code == 200
    actions = [e.action for e in client.query(select(ConsentEvent).order_by(ConsentEvent.at))]
    assert actions == ["given", "re-given", "withdrawn"]
    assert client.query(select(User)) == []

    # A year and a day later the purge clears it.
    later = utc_now() + auth_session.AUTH_LOG_RETENTION + timedelta(days=1)

    async def purge():
        async with client.sessions() as db:
            return await retention.purge(db, now=later)
    counts = client.portal.call(purge)
    assert counts["consent_events"] == 3 and counts["auth_log_tombstones"] >= 2 and counts["access_log"] >= 1
    assert client.query(select(ConsentEvent)) == []


def test_consent_of_a_live_account_is_never_purged(harness):
    client, codes = harness
    sign_in(client, codes)
    later = utc_now() + auth_session.AUTH_LOG_RETENTION * 3

    async def purge():
        async with client.sessions() as db:
            return await retention.purge(db, now=later)
    client.portal.call(purge)
    assert [e.action for e in client.query(select(ConsentEvent))] == ["given"]


@pytest.mark.parametrize("agree,status,code", [
    ({**AGREE, "age_confirmed": False}, 400, "age_required"),
    ({**AGREE, "notice_version": "2000-01-01"}, 409, "notice_changed"),
    ({"notice_version": AGREE["notice_version"]}, 400, "consent_incomplete"),
])
def test_a_bad_agreement_is_refused_before_the_code_is_spent(harness, agree, status, code):
    client, codes = harness
    assert ask(client, EMAIL).status_code == 204
    r = client.post("/api/auth/verify-otp", json={"email": EMAIL, "code": codes[-1], **agree})
    assert r.status_code == status and r.json()["detail"]["code"] == code
    assert client.query(select(User)) == []
    # The same code still works once the agreement is right.
    r = client.post("/api/auth/verify-otp", json={"email": EMAIL, "code": codes[-1], **AGREE})
    assert r.status_code == 200


def test_an_old_client_without_consent_fields_signs_in_but_is_asked(harness):
    client, codes = harness
    r = sign_in(client, codes, agree=None)
    assert r.json()["consent_required"] is True
    assert client.query(select(ConsentEvent)) == []


# ── D5/D6/D8: export, tombstones, access log ─────────────────────────────

def test_export_lists_every_record_kind_and_live_processors(harness, monkeypatch):
    client, codes = harness
    sign_in(client, codes)
    client.patch("/api/user/state", json={"data": {"profile": {"loans": [{"balance": 123456}]}}})
    monkeypatch.setenv("SENTRY_DSN", "https://k@o1.ingest.sentry.io/1")
    monkeypatch.delenv("PAYDAY_EMAIL_ENABLED", raising=False)
    body = client.get("/api/auth/account/export").json()
    for key in ("account", "saved_plan", "sign_in_sessions", "sign_in_codes_sent", "consent", "payday_email",
                "access_log", "shared_with"):
        assert key in body, key
    assert body["format_version"] == 2
    who = [p["who"] for p in body["shared_with"]]
    assert {"Neon", "Render", "Cloudflare", "Resend", "Google Fonts", "Yahoo Finance", "Sentry"} <= set(who)
    assert "Resend (payday emails)" not in who and "Cloudflare Turnstile" not in who
    assert body["consent"]["history"][0]["action"] == "given"
    assert body["sign_in_sessions"][0]["device"] == "Chrome on Android"
    actions = [(a["action"], a["route"]) for a in body["access_log"]]
    assert ("write", "/api/user/state") in actions
    # Access lines carry no figures.
    assert "123456" not in str(body["access_log"])


def test_access_log_line_for_every_read_write_and_refusal(harness):
    client, codes = harness
    sign_in(client, codes)
    client.get("/api/user/state")
    client.patch("/api/user/state", json={"data": {"goals": []}})
    stale = client.patch("/api/user/state", json={"data": {"goals": [1]}, "base_version": 0, "slice_versions": {"goals": 0}})
    lines = [(a.action, a.outcome) for a in client.query(select(AccessLog).order_by(AccessLog.at))]
    assert ("read", "empty") in lines and ("write", "ok") in lines
    if stale.status_code == 412:
        assert ("write", "refused_412") in lines
    assert all(a.route.startswith("/api/") and "?" not in a.route for a in client.query(select(AccessLog)))


def test_delete_keeps_only_tombstones_without_codes_or_keys(harness):
    client, codes = harness
    sign_in(client, codes)
    r = client.post("/api/auth/account/delete", json={"confirm_email": EMAIL})
    assert r.status_code == 200 and r.json()["kept_for_a_year"]["days"] == auth_session.AUTH_LOG_RETENTION.days
    assert client.query(select(OtpChallenge)) == [] and client.query(select(Session)) == []
    tombs = client.query(select(AuthLogTombstone))
    assert {t.kind for t in tombs} == {"code", "session"}
    assert all(t.email == EMAIL for t in tombs)
    cols = {c.name for c in AuthLogTombstone.__table__.columns}
    assert not cols & {"code_hash", "token", "data"}


# ── D21: devices ──────────────────────────────────────────────────────────

@pytest.mark.parametrize("ua,label", [
    ("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1", "Safari on iPhone"),
    ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130.0 Safari/537.36 Edg/130.0", "Edge on Windows"),
    ("Mozilla/5.0 (X11; Linux x86_64; rv:131.0) Gecko/20100101 Firefox/131.0", "Firefox on Linux"),
    ("curl/8.0", "A browser"),
    (None, "A browser"),
])
def test_device_labels_are_coarse(ua, label):
    got = device_label(ua)
    assert got == label
    assert not re.search(r"\d", got)  # no versions, nothing to fingerprint


def test_devices_list_and_sign_out_one_or_all(harness):
    client, codes = harness
    sign_in(client, codes)
    other = TestClient(client.app)
    with other:
        other.post("/api/auth/request-otp", json={"email": EMAIL})
        other.post("/api/auth/verify-otp", json={"email": EMAIL, "code": codes[-1], **AGREE},
                   headers={"User-Agent": "Mozilla/5.0 (Macintosh; Mac OS X 14) Firefox/131.0"})
        listed = client.get("/api/auth/sessions").json()["sessions"]
        assert len(listed) == 2 and sum(s["this_device"] for s in listed) == 1
        assert {s["device"] for s in listed} == {"Chrome on Android", "Firefox on Mac"}
        mac = next(s for s in listed if not s["this_device"])
        assert client.post(f"/api/auth/sessions/{mac['id']}/revoke").status_code == 204
        assert other.get("/api/auth/me").status_code == 401
        assert client.get("/api/auth/me").status_code == 200
        assert client.post("/api/auth/sessions/0000000000000000/revoke").status_code == 404
    r = client.post("/api/auth/sessions/revoke-all", json={"keep_this_device": False})
    assert r.status_code == 200
    assert client.get("/api/auth/me").status_code == 401


def test_public_session_ids_are_not_the_token():
    sid = public_session_id("sha256:abc")
    assert re.fullmatch(r"[0-9a-f]{16}", sid) and "abc" not in sid


# ── D25: OTP hashing ──────────────────────────────────────────────────────

@pytest.mark.parametrize("code", ["000000", "123456", "999999", "042137"])
def test_otp_hash_is_keyed_per_address_and_not_plain_sha256(code, monkeypatch):
    monkeypatch.setenv("OTP_HASH_KEY", "server-secret")
    h = hash_otp(code, "a@example.com")
    assert h.startswith("h1:")
    assert hashlib.sha256(code.encode()).hexdigest() not in h
    assert h != hash_otp(code, "b@example.com")
    assert h != hash_otp(code, "a@example.com", key=b"another-key")
    assert otp_matches(h, code, "A@Example.com ")
    assert not otp_matches(h, f"{(int(code) + 1) % 1_000_000:06d}", "a@example.com")
    # A dump alone can't be brute-forced: without the key no candidate matches.
    monkeypatch.setenv("OTP_HASH_KEY", "attacker-guess")
    assert not otp_matches(h, code, "a@example.com")


def test_legacy_unkeyed_rows_still_verify_for_their_last_minutes():
    legacy = hashlib.sha256(b"654321").hexdigest()
    assert otp_matches(legacy, "654321", "x@example.com")
    assert not otp_matches(legacy, "654320", "x@example.com")
    assert not otp_matches("", "654321", "x@example.com")


def test_stored_code_hash_is_keyed(harness):
    client, codes = harness
    ask(client, EMAIL)
    row = client.query(select(OtpChallenge))[0]
    assert row.code_hash.startswith("h1:") and row.code_hash != hashlib.sha256(codes[-1].encode()).hexdigest()


# ── D24: request log ──────────────────────────────────────────────────────

def test_request_log_has_route_templates_and_never_query_strings():
    from api.request_log import RequestLogMiddleware

    app = FastAPI()

    @app.get("/api/score-band")
    def band(score: int = 0):
        return {"ok": True}

    @app.get("/api/notify/ack/{token}")
    def ack(token: str):
        return {"ok": True}

    lines: list[str] = []

    class Grab(logging.Handler):
        def emit(self, record):
            lines.append(record.getMessage())

    logger = logging.getLogger("test.rightdue.access")
    logger.addHandler(Grab())
    logger.setLevel(logging.INFO)
    app.add_middleware(RequestLogMiddleware, logger=logger, enabled=True)
    with TestClient(app) as c:
        c.get("/api/score-band?score=742")
        c.get("/api/notify/ack/eyJhbGciOiJIUzI1NiJ9abcdefghijklmnop?t=secret")
        c.get("/api/unknown/9876543210/abcdefghijklmnopqrstuvwxyz0123")
    joined = "\n".join(lines)
    assert "GET /api/score-band 200" in joined
    assert "/api/notify/ack/{token}" in joined
    for leak in ("742", "secret", "eyJhbGci", "9876543210", "abcdefghijklmnopqrstuvwxyz0123", "?"):
        assert leak not in joined, leak


def test_uvicorn_access_log_is_off_in_the_container():
    start = (ROOT / "deploy" / "start.sh").read_text()
    assert "--no-access-log" in start


# ── D26: schema drift ─────────────────────────────────────────────────────

def test_drift_refuses_production_start_only():
    from api.db.database import SchemaDriftError, check_drift
    with pytest.raises(SchemaDriftError, match="consent_events"):
        check_drift(["consent_events"], {"RENDER": "true"})
    with pytest.raises(SchemaDriftError):
        check_drift(["sessions.device_label"], {"RIGHTDUE_ENV": "production"})
    check_drift(["consent_events"], {})                                  # development: warn only
    check_drift(["consent_events"], {"RENDER": "1", "ALLOW_SCHEMA_DRIFT": "1"})  # explicit escape hatch
    check_drift([], {"RENDER": "1"})


def test_migrations_create_exactly_what_the_models_need(tmp_path):
    """Runs every Alembic revision on SQLite (Postgres runs in CI via
    test_state_versions_and_migrations.py) and checks nothing is missing
    and nothing is added or dropped against the models."""
    from alembic.autogenerate import compare_metadata
    from alembic.migration import MigrationContext
    from sqlalchemy import create_engine
    from api.db.database import run_migrations, schema_drift
    from api.db.migrations_filter import include_object

    compiles(JSONB, "sqlite")(lambda element, compiler, **kw: "JSON")
    try:
        engine = create_engine(f"sqlite:///{tmp_path / 'mig.sqlite'}")
        with engine.begin() as conn:
            assert run_migrations(conn) == []
            assert schema_drift(conn) == []
            diff = compare_metadata(MigrationContext.configure(conn, opts={"include_object": include_object}), Base.metadata)
        structural = [d for d in diff if not (isinstance(d, list) and d and d[0][0] == "modify_type")]
        assert structural == [], structural
    finally:
        deregister(JSONB)


def test_drift_detects_a_missing_column(tmp_path):
    from sqlalchemy import create_engine, text
    from api.db.database import schema_drift
    compiles(JSONB, "sqlite")(lambda element, compiler, **kw: "JSON")
    try:
        engine = create_engine(f"sqlite:///{tmp_path / 'd.sqlite'}")
        with engine.begin() as conn:
            Base.metadata.create_all(conn)
            conn.execute(text("ALTER TABLE sessions DROP COLUMN device_label"))
            conn.execute(text("DROP TABLE access_log"))
            assert schema_drift(conn) == ["access_log", "sessions.device_label"]
    finally:
        deregister(JSONB)


# ── D15: PDF parse limits ─────────────────────────────────────────────────

def _bomb_pdf(inflated_mb: int) -> bytes:
    stream = zlib.compress(b"0" * (inflated_mb * 1024 * 1024), 9)
    objs = [
        b"1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n",
        b"2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj\n",
        b"3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R >> endobj\n",
        b"4 0 obj << /Length %d /Filter /FlateDecode >> stream\n" % len(stream) + stream + b"\nendstream endobj\n",
    ]
    return b"%PDF-1.4\n" + b"".join(objs) + b"trailer << /Root 1 0 R >>\n%%EOF\n"


def test_a_decompression_bomb_dies_alone_and_quickly():
    from engine.pdf_text import PdfTextError, read_pdf_text
    data = _bomb_pdf(300)
    assert len(data) < 4 * 1024 * 1024
    with pytest.raises(PdfTextError) as err:
        read_pdf_text(data, timeout=10)
    assert err.value.kind in {"too_complex", "unreadable", "scan", "timeout"}


@pytest.mark.parametrize("objects", [20_001, 50_000])
def test_too_many_objects_is_refused_before_any_parse(objects, monkeypatch):
    from engine import pdf_text
    called = []
    monkeypatch.setattr(pdf_text, "_run_child", lambda *a, **k: called.append(1) or "")
    data = b"%PDF-1.4\n" + b"".join(b"%d 0 obj null endobj\n" % i for i in range(objects))
    with pytest.raises(pdf_text.PdfTextError) as err:
        pdf_text.read_pdf_text(data)
    assert err.value.kind == "too_complex" and called == []


def test_only_one_parse_at_a_time(monkeypatch):
    from engine import pdf_text
    monkeypatch.setattr(pdf_text, "BUSY_WAIT_S", 0.05)
    started, release = threading.Event(), threading.Event()

    def slow(*a, **k):
        started.set()
        release.wait(5)
        return "text"
    monkeypatch.setattr(pdf_text, "_run_child", slow)
    t = threading.Thread(target=lambda: pdf_text.read_pdf_text(b"%PDF-1.4 x"))
    t.start()
    assert started.wait(5)
    with pytest.raises(pdf_text.PdfTextError) as err:
        pdf_text.read_pdf_text(b"%PDF-1.4 y")
    assert err.value.kind == "busy"
    release.set()
    t.join(5)
    assert pdf_text.read_pdf_text.__module__  # the slot is free again:
    monkeypatch.setattr(pdf_text, "_run_child", lambda *a, **k: "ok")
    assert pdf_text.read_pdf_text(b"%PDF-1.4 z") == "ok"


def test_busy_parse_is_a_503_with_retry_after(monkeypatch):
    import base64
    from api.main import app
    from engine import pdf_text
    monkeypatch.setattr(pdf_text, "read_pdf_text", lambda *a, **k: (_ for _ in ()).throw(pdf_text.PdfTextError("busy")))
    monkeypatch.setattr("engine.credit_report.read_pdf_text", pdf_text.read_pdf_text)
    monkeypatch.setattr("engine.kfs.read_pdf_text", pdf_text.read_pdf_text)
    with TestClient(app) as c:
        pdf = base64.b64encode(b"%PDF-1.4 hello").decode()
        for path in ("/api/kfs/read", "/api/credit-report/read"):
            r = c.post(path, json={"pdf_base64": pdf})
            assert r.status_code == 503, (path, r.text)
            assert r.headers["retry-after"] == "60"


def test_the_child_runs_under_memory_and_cpu_limits():
    src = (ROOT / "engine" / "pdf_text.py").read_text()
    assert "RLIMIT_AS" in src and "RLIMIT_CPU" in src and "preexec_fn=_limit_child" in src


# ── D14: backups fail loudly ──────────────────────────────────────────────

SECRETS = {"DATABASE_URL": "postgresql://backup:x@ep-x.ap-southeast-1.aws.neon.tech/neondb",
           "AGE_RECIPIENT": "age1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq",
           "S3_BUCKET": "rightdue-backups", "S3_ENDPOINT": "https://acct.r2.cloudflarestorage.com",
           "AWS_ACCESS_KEY_ID": "id", "AWS_SECRET_ACCESS_KEY": "secret"}


def _preflight(tmp_path, env):
    out = tmp_path / "out.txt"
    out.write_text("")
    clean = {k: v for k, v in os.environ.items() if k not in SECRETS and k != "BACKUP_DISABLED"}
    p = subprocess.run(["bash", str(ROOT / "scripts" / "backup_preflight.sh")], env={**clean, **env, "GITHUB_OUTPUT": str(out)},
                       capture_output=True, text=True, timeout=30)
    return p.returncode, p.stdout + p.stderr, out.read_text()


@pytest.mark.parametrize("drop", [None, *SECRETS.keys()])
def test_backup_preflight_fails_red_when_any_secret_is_missing(tmp_path, drop):
    env = {k: v for k, v in SECRETS.items() if k != drop}
    code, log, out = _preflight(tmp_path, env)
    if drop is None:
        assert code == 0 and "run=true" in out
    else:
        assert code == 1 and "run=false" in out and "missing" in log


def test_backup_preflight_with_nothing_set_is_red_not_green(tmp_path):
    code, log, out = _preflight(tmp_path, {})
    assert code == 1 and log.count("missing:") == 6


def test_backup_disabled_on_purpose_is_the_only_quiet_skip(tmp_path):
    code, log, out = _preflight(tmp_path, {"BACKUP_DISABLED": "1"})
    assert code == 0 and "run=false" in out and "OFF on purpose" in log


def test_backup_preflight_refuses_a_private_age_key(tmp_path):
    code, log, _ = _preflight(tmp_path, {**SECRETS, "AGE_RECIPIENT": "AGE-SECRET-KEY-1XYZ"})
    assert code == 1 and "public key" in log


def test_backup_workflow_uses_the_preflight_restores_and_has_no_silent_exit():
    wf = (ROOT / ".github" / "workflows" / "db-backup.yml").read_text()
    assert "bash scripts/backup_preflight.sh" in wf
    assert "Restore test" in wf and "pg_restore --no-owner" in wf and "head-object" in wf
    cfg = wf.split("- name: Check configuration", 1)[1].split("- name:", 1)[0]
    assert "exit 0" not in cfg
    assert "if: failure()" in wf


def test_data_bot_never_pushes_straight_to_main():
    action = (ROOT / ".github" / "actions" / "data-pr" / "action.yml").read_text()
    assert 'git push -q origin "HEAD:$BASE"' not in action
    assert "--auto" in action and "gh workflow run ci.yml" in action


@pytest.mark.parametrize("wf", ["market-data", "policy-rates", "rate-disclosures"])
def test_scheduled_data_jobs_open_an_issue_when_they_fail(wf):
    src = (ROOT / ".github" / "workflows" / f"{wf}.yml").read_text()
    assert "uses: ./.github/actions/failure-issue" in src and "if: failure()" in src
    assert "issues: write" in src and "actions: write" in src


def test_security_gate_runs_audits_with_read_only_token():
    src = (ROOT / ".github" / "workflows" / "security.yml").read_text()
    assert "npm audit --package-lock-only --omit=dev --audit-level=high" in src
    assert "pip-audit -r requirements.txt" in src
    assert "permissions:\n  contents: read" in src


# ── D2/D5: the notice and the server agree ────────────────────────────────

def test_versions_and_processors_match_the_web_notice():
    ts = (ROOT / "web" / "src" / "lib" / "privacy-facts.ts").read_text()
    assert f"NOTICE_VERSION = '{privacy_facts.NOTICE_VERSION}'" in ts
    assert f"TERMS_VERSION = '{privacy_facts.TERMS_VERSION}'" in ts
    web_names = set(re.findall(r"\{ who: '([^']+)'", ts))
    api_names = {p.who for p in privacy_facts.PROCESSORS}
    assert web_names == api_names, (web_names ^ api_names)


@pytest.mark.parametrize("flag,name", [("SENTRY_DSN", "Sentry"), ("TURNSTILE_SECRET_KEY", "Cloudflare Turnstile"),
                                       ("PAYDAY_EMAIL_ENABLED", "Resend (payday emails)"), ("GOOGLE_SIGNIN", "Google sign-in")])
def test_switchable_processors_appear_only_when_switched_on(flag, name):
    assert name not in [p["who"] for p in privacy_facts.shared_with({})]
    assert name not in [p["who"] for p in privacy_facts.shared_with({flag: "false"})]
    assert name in [p["who"] for p in privacy_facts.shared_with({flag: "true"})]


def test_health_says_whether_sentry_is_on_without_the_dsn(monkeypatch):
    from api.main import app
    monkeypatch.setenv("SENTRY_DSN", "https://publickey@o1.ingest.sentry.io/42")
    with TestClient(app) as c:
        body = c.get("/api/health").json()
    assert body["sentry"] == "on" and "publickey" not in str(body)


# ── render.yaml: the W8 settings are declared, never with a value ─────────
def test_render_blueprint_declares_trust_settings_without_values():
    """Secrets and switches the founder fills in are listed with sync: false
    (so a Blueprint sync never overwrites or invents them), and none of them
    carries a value or a generated one in the file."""
    import pathlib

    import yaml

    spec = yaml.safe_load((pathlib.Path(__file__).resolve().parents[2] / "render.yaml").read_text())
    env = {e["key"]: e for e in spec["services"][0]["envVars"]}
    for key in ("NEXT_PUBLIC_TURNSTILE_SITE_KEY", "TURNSTILE_SECRET_KEY", "OTP_HASH_KEY", "SENTRY_DSN",
                "DATABASE_URL", "RESEND_API_KEY"):
        assert key in env, key
        assert env[key].get("sync") is False, key
        assert "value" not in env[key] and "generateValue" not in env[key], key
    assert "ALLOW_SCHEMA_DRIFT" not in env, "the drift escape hatch is never on by default"
