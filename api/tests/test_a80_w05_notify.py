"""A12/A13/A14 (W5): notification scheduling, idempotency, the shared email
budget, unsubscribe tokens and the rate-move email."""
import time
from datetime import date

import pytest
from fastapi.testclient import TestClient

from api.main import app
from api.notify import budget, flags, routes, sender, tokens
from api.notify import store as nstore

KEY = "k" * 40
CRON = "c" * 24
AUTH = {"Authorization": f"Bearer {CRON}"}
SNAP = {
    "month": "2026-11", "made_on": "2026-10-30", "country": "IN", "currency": "INR",
    "rows": [{"name": "HDFC credit card", "amount": "18500", "kind": "extra"}],
}
HOME = {"name": "SBI home loan", "outstanding": 5_000_000, "rate": 0.085, "months_left": 240}


@pytest.fixture()
def env(tmp_path, monkeypatch):
    for k, v in {"PAYDAY_EMAIL_ENABLED": "true", "DEADLINE_REMINDERS_ENABLED": "true",
                 "RATE_MOVE_EMAIL_ENABLED": "true", "NOTIFY_SIGNING_KEY": KEY, "NOTIFY_CRON_SECRET": CRON,
                 "PUBLIC_APP_URL": "https://rightdue.test"}.items():
        monkeypatch.setenv(k, v)
    for k in ("NOTIFY_DAILY_CAP", "RESEND_DAILY_LIMIT", "OTP_GLOBAL_DAILY_CAP"):
        monkeypatch.delenv(k, raising=False)
    s = nstore.NotifyStore(nstore.sqlite_engine(tmp_path / "n.sqlite3"))
    nstore.set_store(s)
    sent: list[sender.Message] = []
    sender.set_sender(lambda m: sent.append(m) or True)
    clock = {"today": date(2026, 10, 30)}
    monkeypatch.setattr(routes, "today_fn", lambda country="IN": clock["today"])
    who = {"u": routes.NotifyUser("u1", "asha@example.com")}
    app.dependency_overrides[routes.notify_user] = lambda: who["u"]
    yield {"store": s, "sent": sent, "clock": clock, "client": TestClient(app), "who": who}
    app.dependency_overrides.pop(routes.notify_user, None)
    sender.set_sender(None)
    nstore.set_store(None)


def opt_in(env, uid, day=1):
    env["who"]["u"] = routes.NotifyUser(uid, f"{uid}@example.com")
    assert env["client"].put("/api/notify/payday", json={"on": True, "day": day, "snapshot": SNAP}).status_code == 200


# ── the shared daily budget ─────────────────────────────────────────────────

@pytest.mark.parametrize("envs,want", [
    ({}, 10),                                                   # Resend Free 100 − sign-in cap 90
    ({"OTP_GLOBAL_DAILY_CAP": "60"}, 40),
    ({"NOTIFY_DAILY_CAP": "5"}, 5),
    ({"OTP_GLOBAL_DAILY_CAP": "60", "NOTIFY_DAILY_CAP": "80"}, 40),   # never past the provider's room
    ({"RESEND_DAILY_LIMIT": "0"}, None),                        # Pro: no daily limit
    ({"RESEND_DAILY_LIMIT": "0", "NOTIFY_DAILY_CAP": "500"}, 500),
    ({"OTP_GLOBAL_DAILY_CAP": "150"}, 0),
])
def test_allowance_never_eats_sign_in_codes(monkeypatch, envs, want):
    for k in ("NOTIFY_DAILY_CAP", "RESEND_DAILY_LIMIT", "OTP_GLOBAL_DAILY_CAP"):
        monkeypatch.delenv(k, raising=False)
    for k, v in envs.items():
        monkeypatch.setenv(k, v)
    assert budget.daily_allowance() == want


def test_budget_defers_the_rest_and_a_later_run_sends_them(env, monkeypatch):
    monkeypatch.setenv("NOTIFY_DAILY_CAP", "2")
    for u in ("u1", "u2", "u3"):
        opt_in(env, u)
    env["clock"]["today"] = date(2026, 11, 1)
    r = env["client"].post("/api/notify/run", headers=AUTH).json()
    assert r["payday"] == {"sent": 2, "deferred": 1} and r["budget"]["deferred"] == 1
    assert len(env["sent"]) == 2
    # Same day again: budget spent, the sent ones aren't sent twice.
    r = env["client"].post("/api/notify/run", headers=AUTH).json()
    assert len(env["sent"]) == 2 and r["payday"].get("deferred") == 1
    env["clock"]["today"] = date(2026, 11, 2)                 # within the late-send grace
    env["client"].post("/api/notify/run", headers=AUTH)
    assert sorted(m.to for m in env["sent"]) == ["u1@example.com", "u2@example.com", "u3@example.com"]


def test_failed_send_gives_the_budget_back(env, monkeypatch):
    monkeypatch.setenv("NOTIFY_DAILY_CAP", "1")
    opt_in(env, "u1")
    opt_in(env, "u2")
    calls = []
    sender.set_sender(lambda m: calls.append(m.to) or m.to != "u1@example.com")
    env["clock"]["today"] = date(2026, 11, 1)
    r = env["client"].post("/api/notify/run", headers=AUTH).json()
    assert r["payday"] == {"not_sent": 1, "sent": 1}


# ── idempotency: two schedulers, one send ───────────────────────────────────

def test_concurrent_run_gets_409_and_sends_nothing(env):
    opt_in(env, "u1")
    env["clock"]["today"] = date(2026, 11, 1)
    import asyncio
    assert asyncio.run(env["store"].try_lock("run", 600))
    r = env["client"].post("/api/notify/run", headers=AUTH)
    assert r.status_code == 409 and r.json()["busy"] and env["sent"] == []
    asyncio.run(env["store"].unlock("run"))
    assert env["client"].post("/api/notify/run", headers=AUTH).json()["payday"] == {"sent": 1}
    for _ in range(3):                                         # retries the same day: still one email
        env["client"].post("/api/notify/run", headers=AUTH)
    assert len(env["sent"]) == 1


def test_stale_lock_expires(env):
    import asyncio
    from datetime import datetime, timedelta, timezone
    s = env["store"]
    assert asyncio.run(s.try_lock("run", 600))
    assert not asyncio.run(s.try_lock("run", 600))
    s.now = lambda: datetime.now(timezone.utc) + timedelta(minutes=11)   # a crashed run's lock runs out
    assert asyncio.run(s.try_lock("run", 600))


# ── unsubscribe tokens ──────────────────────────────────────────────────────

def _flip(t: str) -> str:
    i = len(t) // 3
    return t[:i] + ("A" if t[i] != "A" else "B") + t[i + 1:]


@pytest.mark.parametrize("mutate", [_flip, lambda t: t + "x", lambda t: t.split(".")[0], lambda t: "", lambda t: "a.b"])
def test_tampered_unsubscribe_links_are_refused(env, mutate):
    opt_in(env, "u1")
    t = tokens.sign("u1", "-", "unsub")
    r = env["client"].post(f"/api/notify/unsubscribe?t={mutate(t)}")
    assert r.status_code in (400, 422)
    assert asyncio_get(env, "u1")["payday_on"]


def asyncio_get(env, uid):
    import asyncio
    return asyncio.run(env["store"].get(uid))


def test_link_signed_with_another_key_is_refused(env, monkeypatch):
    monkeypatch.setenv("NOTIFY_SIGNING_KEY", "z" * 40)
    t = tokens.sign("u1", "-", "unsub")
    monkeypatch.setenv("NOTIFY_SIGNING_KEY", KEY)
    with pytest.raises(tokens.TokenError):
        tokens.verify(t)


def test_unsubscribe_link_lasts_400_days_payday_links_45():
    import os
    os.environ.setdefault("NOTIFY_SIGNING_KEY", KEY)
    now = time.time()
    u = tokens.sign("u1", "-", "unsub", now=now)
    a = tokens.sign("u1", "2026-11", "all", now=now)
    tokens.verify(u, now=now + 399 * 86400)
    with pytest.raises(tokens.TokenError):
        tokens.verify(u, now=now + 401 * 86400)
    with pytest.raises(tokens.TokenError):
        tokens.verify(a, now=now + 46 * 86400)


def test_an_ack_link_cant_unsubscribe(env):
    opt_in(env, "u1")
    t = tokens.sign("u1", "2026-11", "all")
    assert env["client"].post(f"/api/notify/unsubscribe?t={t}").status_code == 400


def test_one_click_unsubscribe_clears_every_email_kind(env):
    opt_in(env, "u1")
    env["client"].put("/api/notify/rate-move", json={"on": True, "loans": [HOME]})
    t = tokens.sign("u1", "-", "unsub")
    assert env["client"].post(f"/api/notify/unsubscribe?t={t}").status_code == 200
    import asyncio
    sub = asyncio.run(env["store"].get("u1"))
    w = asyncio.run(env["store"].get_rate_watch("u1"))
    assert not sub["payday_on"] and sub["snapshot"] is None and not sub["reminders_on"]
    assert not w["watch_on"] and w["loans"] == []


# ── A13 rate-move email ─────────────────────────────────────────────────────

def test_rate_move_email_after_the_october_hike(env):
    c = env["client"]
    assert c.put("/api/notify/rate-move", json={"on": True, "loans": [HOME]}).json() == {"ok": True, "on": True, "count": 1}
    assert c.get("/api/notify/settings").json()["rate_move"] == {"available": True, "on": True, "count": 1}
    env["clock"]["today"] = date(2026, 10, 14)                 # a week after RBI's 7 Oct hike
    r = c.post("/api/notify/run", headers=AUTH).json()
    assert r["rate_move"] == {"sent": 1}
    m = env["sent"][-1]
    assert m.subject == "RBI raised the repo rate: check your loan by 06 Jan 2027"
    assert "₹43,391 to ₹44,186" in m.text and "13 months longer" in m.text
    assert "List-Unsubscribe" in m.headers
    assert c.post("/api/notify/run", headers=AUTH).json()["rate_move"] == {"already_sent": 1}
    env["clock"]["today"] = date(2026, 11, 30)
    assert c.post("/api/notify/run", headers=AUTH).json()["rate_move"] == {"no_recent_move": 1}


def test_rate_move_needs_emi_or_months(env):
    r = env["client"].put("/api/notify/rate-move", json={"on": True, "loans": [{"name": "x", "outstanding": 1e6, "rate": 0.09}]})
    assert r.status_code == 422


def test_rate_move_404_when_flag_off(env, monkeypatch):
    monkeypatch.delenv("RATE_MOVE_EMAIL_ENABLED")
    assert env["client"].put("/api/notify/rate-move", json={"on": False}).status_code == 404


# ── A14: the email's app link opens the payday ritual ───────────────────────

def test_payday_email_links_to_the_ritual(env):
    opt_in(env, "u1")
    env["clock"]["today"] = date(2026, 11, 1)
    env["client"].post("/api/notify/run", headers=AUTH)
    assert "https://rightdue.test/?ritual=payday&m=2026-11#pay-this-month" in env["sent"][0].text
    assert "60-second payday check" in env["sent"][0].text


# ── founder status ──────────────────────────────────────────────────────────

def test_status_says_what_is_missing_even_with_flags_off(monkeypatch, tmp_path):
    for k in ("PAYDAY_EMAIL_ENABLED", "DEADLINE_REMINDERS_ENABLED", "RATE_MOVE_EMAIL_ENABLED", "NOTIFY_SIGNING_KEY",
              "PUBLIC_APP_URL", "RESEND_API_KEY", "RESEND_FROM", "DATABASE_URL"):
        monkeypatch.delenv(k, raising=False)
    monkeypatch.setenv("NOTIFY_CRON_SECRET", CRON)
    c = TestClient(app)
    assert c.get("/api/notify/status").status_code == 401
    j = c.get("/api/notify/status", headers=AUTH).json()
    text = " ".join(j["missing"])
    for name in ("PAYDAY_EMAIL_ENABLED", "NOTIFY_SIGNING_KEY", "PUBLIC_APP_URL", "RESEND_API_KEY", "RESEND_FROM"):
        assert name in text
    assert j["budget"]["allowance_today"] == 10


def test_missing_config_names_never_values(monkeypatch):
    monkeypatch.setenv("RESEND_API_KEY", "re_supersecretvalue")
    monkeypatch.setenv("RESEND_FROM", "onboarding@resend.dev")
    out = " ".join(flags.missing_config())
    assert "supersecret" not in out and "resend.dev sandbox" in out
