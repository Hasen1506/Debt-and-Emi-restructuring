"""G7: /api/notify (payday email loop, reminders) and /api/closure-letter."""
import base64
import hashlib
import hmac
import json
import time
from datetime import date

import pytest
from fastapi.testclient import TestClient

from api.main import app
from api.notify import inbound, routes, sender, tokens
from api.notify import store as nstore

KEY = "k" * 40
CRON = "c" * 24


@pytest.fixture()
def notify(tmp_path, monkeypatch):
    monkeypatch.setenv("PAYDAY_EMAIL_ENABLED", "true")
    monkeypatch.setenv("DEADLINE_REMINDERS_ENABLED", "true")
    monkeypatch.setenv("NOTIFY_SIGNING_KEY", KEY)
    monkeypatch.setenv("NOTIFY_CRON_SECRET", CRON)
    monkeypatch.setenv("PUBLIC_APP_URL", "https://rightdue.test")
    s = nstore.NotifyStore(nstore.sqlite_engine(tmp_path / "n.sqlite3"))
    nstore.set_store(s)
    sent: list[sender.Message] = []
    sender.set_sender(lambda m: sent.append(m) or True)
    clock = {"today": date(2026, 10, 30)}
    monkeypatch.setattr(routes, "today_fn", lambda country="IN": clock["today"])
    app.dependency_overrides[routes.notify_user] = lambda: routes.NotifyUser("u1", "asha@example.com")
    yield {"store": s, "sent": sent, "clock": clock, "client": TestClient(app)}
    app.dependency_overrides.pop(routes.notify_user, None)
    sender.set_sender(None)
    nstore.set_store(None)


SNAP = {
    "month": "2026-11", "made_on": "2026-10-30", "country": "IN", "currency": "INR",
    "rows": [{"name": "HDFC credit card", "amount": "18500", "kind": "extra"},
             {"name": "SBI home loan", "amount": "32000", "kind": "emi"}],
}


def run(c):
    return c.post("/api/notify/run", headers={"Authorization": f"Bearer {CRON}"})


def test_everything_404s_with_flags_off(monkeypatch):
    for k in ("PAYDAY_EMAIL_ENABLED", "DEADLINE_REMINDERS_ENABLED"):
        monkeypatch.delenv(k, raising=False)
    c = TestClient(app)
    assert c.get("/api/notify/flags").json() == {"payday_email": False, "deadline_reminders": False, "reply_done": False}
    assert c.post("/api/notify/run", headers={"Authorization": f"Bearer {CRON}"}).status_code == 404
    assert c.get("/api/notify/ack?t=x").status_code == 404
    assert c.post("/api/notify/inbound", content=b"{}").status_code == 404


def test_signed_in_routes_need_a_database():
    # No DATABASE_URL in tests and no override: 503, not a crash.
    import os
    os.environ["PAYDAY_EMAIL_ENABLED"] = "true"
    try:
        r = TestClient(app).get("/api/notify/settings")
        assert r.status_code == 503
    finally:
        del os.environ["PAYDAY_EMAIL_ENABLED"]


def test_opt_in_sends_once_on_payday_with_signed_links(notify):
    c, sent = notify["client"], notify["sent"]
    assert c.put("/api/notify/payday", json={"on": True, "day": 1, "snapshot": SNAP}).json()["ok"]
    st = c.get("/api/notify/settings").json()
    assert st["payday"]["on"] and st["payday"]["day"] == 1 and st["payday"]["list_month"] == "2026-11"

    assert run(c).json()["payday"] == {"not_due": 1}          # 30 Oct: not payday yet
    notify["clock"]["today"] = date(2026, 11, 1)
    assert run(c).json()["payday"] == {"sent": 1}
    assert run(c).json()["payday"] == {"not_due": 1}          # never twice a month
    assert len(sent) == 1
    m = sent[0]
    assert m.to == "asha@example.com"
    assert m.subject.startswith("Payday: ₹50,500")
    assert "List-Unsubscribe" in m.headers and m.headers["List-Unsubscribe-Post"] == "List-Unsubscribe=One-Click"
    assert "https://rightdue.test/api/notify/ack?t=" in m.text


def test_bad_snapshot_is_refused(notify):
    r = notify["client"].put("/api/notify/payday", json={"on": True, "day": 1, "snapshot": {**SNAP, "rows": []}})
    assert r.status_code == 422
    r = notify["client"].put("/api/notify/payday", json={"on": True})
    assert r.status_code == 422


def test_get_link_changes_nothing_post_records_and_app_applies(notify):
    c = notify["client"]
    c.put("/api/notify/payday", json={"on": True, "day": 1, "snapshot": SNAP})
    t = tokens.sign("u1", "2026-11", "all")
    page = c.get(f"/api/notify/ack?t={t}")
    assert page.status_code == 200 and "Yes, record it" in page.text and "noindex" in page.text
    assert c.get("/api/notify/answers").json()["answers"] == []     # a mail scanner's GET did nothing
    r = c.post("/api/notify/ack", data={"t": t})
    assert r.status_code == 200 and "Recorded" in r.text
    # A second tap the same month replaces the first, it doesn't stack.
    c.post("/api/notify/ack", data={"t": tokens.sign("u1", "2026-11", "some")})
    answers = c.get("/api/notify/answers").json()["answers"]
    assert [a["kind"] for a in answers] == ["ack_some"]
    assert c.post(f"/api/notify/answers/{answers[0]['id']}/applied").json()["ok"]
    assert c.get("/api/notify/answers").json()["answers"] == []


def test_tampered_or_expired_link_is_refused(notify):
    c = notify["client"]
    t = tokens.sign("u1", "2026-11", "all")
    bad = t[:-2] + ("AA" if not t.endswith("AA") else "BB")
    assert c.post("/api/notify/ack", data={"t": bad}).status_code == 400
    old = tokens.sign("u1", "2026-11", "all", now=time.time() - 60 * 24 * 3600)
    r = c.post("/api/notify/ack", data={"t": old})
    assert r.status_code == 400 and "expired" in r.text


def test_tokens_need_a_real_key(monkeypatch):
    monkeypatch.setenv("NOTIFY_SIGNING_KEY", "short")
    with pytest.raises(tokens.TokenError):
        tokens.sign("u1", "2026-11", "all")


def test_unsubscribe_one_click_turns_everything_off_and_deletes_the_list(notify):
    c, s = notify["client"], notify["store"]
    c.put("/api/notify/payday", json={"on": True, "day": 1, "snapshot": SNAP})
    t = tokens.sign("u1", "-", "unsub")
    assert "Turn them off" in c.get(f"/api/notify/unsubscribe?t={t}").text
    r = c.post(f"/api/notify/unsubscribe?t={t}", data={"List-Unsubscribe": "One-Click"})
    assert r.status_code == 200
    import asyncio
    sub = asyncio.run(s.get("u1"))
    assert not sub["payday_on"] and sub["snapshot"] is None


def test_cron_needs_the_secret(notify):
    c = notify["client"]
    assert c.post("/api/notify/run").status_code == 401
    assert c.post("/api/notify/run", headers={"Authorization": "Bearer wrong-wrong-wrong"}).status_code == 401


def test_reminders_go_out_on_their_day_once(notify):
    c, sent = notify["client"], notify["sent"]
    r = c.put("/api/notify/reminders", json={"on": True, "items": [
        {"key": "reply", "label": "Bank's reply due", "day": "2026-11-10", "state": "upcoming"},
        {"key": "sent", "label": "Complaint sent", "day": "2026-10-11", "state": "done"},
    ]}).json()
    assert r["next"]["send_on"] == "2026-11-11"
    notify["clock"]["today"] = date(2026, 11, 11)
    assert run(c).json()["reminders_sent"] == 1
    assert run(c).json()["reminders_sent"] == 0
    assert "next step is open" in sent[-1].text


def test_complaint_and_closure_reminders_keep_each_other(notify):
    import asyncio
    c, s = notify["client"], notify["store"]
    c.put("/api/notify/reminders", json={"on": True, "source": "complaint", "items": [
        {"key": "reply", "label": "Bank's reply due", "day": "2026-11-10"}]})
    c.put("/api/notify/reminders", json={"on": True, "source": "closure", "items": [
        {"key": "documents_by", "label": "Documents back by", "day": "2026-11-20"}]})
    keys = {i["key"] for i in asyncio.run(s.get("u1"))["reminder_items"]}
    assert keys == {"reply", "documents_by"}
    c.put("/api/notify/reminders", json={"on": False, "source": "complaint", "items": []})
    sub = asyncio.run(s.get("u1"))
    assert [i["key"] for i in sub["reminder_items"]] == ["documents_by"] and sub["reminders_on"]


def test_forget_deletes_everything(notify):
    import asyncio
    c, s = notify["client"], notify["store"]
    c.put("/api/notify/payday", json={"on": True, "day": 1, "snapshot": SNAP})
    asyncio.run(s.forget("u1"))
    assert asyncio.run(s.get("u1")) is None
    assert asyncio.run(s.all_events()) == []


def test_metrics_counts_opted_in_returns(notify):
    c = notify["client"]
    notify["clock"]["today"] = date(2026, 9, 1)
    c.put("/api/notify/payday", json={"on": True, "day": 1, "snapshot": SNAP})
    notify["clock"]["today"] = date(2026, 10, 5)
    c.post("/api/notify/ack", data={"t": tokens.sign("u1", "2026-10", "all")})
    rates = c.get("/api/notify/metrics", headers={"Authorization": f"Bearer {CRON}"}).json()["rates"]
    assert rates[0] == {"window": "D30", "eligible": 1, "returned": 1, "share": 1.0}
    assert rates[1]["eligible"] == 0


# ── inbound "done" reply ────────────────────────────────────────────────────

SECRET = "whsec_" + base64.b64encode(b"s" * 24).decode()


def _sign(body: bytes, ts: int, msg_id="msg_1"):
    key = base64.b64decode(SECRET.removeprefix("whsec_"))
    sig = base64.b64encode(hmac.new(key, f"{msg_id}.{ts}.".encode() + body, hashlib.sha256).digest()).decode()
    return {"svix-id": msg_id, "svix-timestamp": str(ts), "svix-signature": f"v1,{sig}"}


def test_webhook_signature_checks():
    body = b'{"type":"email.received"}'
    now = 1_800_000_000
    inbound.verify_signature(body, _sign(body, now), now=now, secret=SECRET)
    with pytest.raises(inbound.InboundError):
        inbound.verify_signature(body + b" ", _sign(body, now), now=now, secret=SECRET)
    with pytest.raises(inbound.InboundError, match="stale"):
        inbound.verify_signature(body, _sign(body, now - 600), now=now, secret=SECRET)
    with pytest.raises(inbound.InboundError):
        inbound.verify_signature(body, {}, now=now, secret=SECRET)


def test_done_reply_is_recorded_only_from_the_subscriber_with_dkim(notify, monkeypatch):
    monkeypatch.setenv("PAYDAY_REPLY_INBOUND", "true")
    monkeypatch.setenv("RESEND_WEBHOOK_SECRET", SECRET)
    monkeypatch.setenv("NOTIFY_REPLY_TO", "reply@in.rightdue.test")
    c, sent = notify["client"], notify["sent"]
    c.put("/api/notify/payday", json={"on": True, "day": 1, "snapshot": SNAP})
    notify["clock"]["today"] = date(2026, 11, 1)
    run(c)
    reply_to = sent[0].reply_to
    assert reply_to.startswith("reply+") and 'reply to this email with the word "done"' in sent[0].text

    received = {"from": "Asha <asha@example.com>", "text": "done\n\n> Payday...", "authentication": {"dkim": "pass"}}
    monkeypatch.setattr(inbound, "fetch_received", lambda _id: received)

    def post(payload):
        body = json.dumps(payload).encode()
        return c.post("/api/notify/inbound", content=body, headers=_sign(body, int(time.time())))

    ev = {"type": "email.received", "data": {"email_id": "abcdef12-3456", "to": [reply_to]}}
    assert post(ev).json()["recorded"] == "done"
    assert [a["kind"] for a in c.get("/api/notify/answers").json()["answers"]] == ["reply_done"]

    received["from"] = "someone@else.com"
    assert post(ev).json()["ignored"] == "sender"
    received.update({"from": "asha@example.com", "authentication": {"dkim": "fail", "dmarc": "fail"}})
    assert post(ev).json()["ignored"] == "sender"
    assert post({"type": "email.received", "data": {"email_id": "abcdef12", "to": ["reply+zzzzzzzzzz@x"]}}).json()["ignored"] == "unknown"
    assert c.post("/api/notify/inbound", content=b"{}", headers={"svix-id": "1"}).status_code == 401


# ── closure letter route ────────────────────────────────────────────────────

def test_closure_letter_route(client):
    r = client.post("/api/closure-letter", json={
        "market": "IN", "loan_type": "home_loan", "lender": "HDFC Bank", "closed_on": "2026-10-01",
        "today": "2026-10-12", "lender_kind": "bank"})
    assert r.status_code == 200
    j = r.json()
    assert j["draft"] is True and j["key_dates"][0]["day"] == "2026-10-31"
    assert j["checklist"] and j["citations"]
    bad = client.post("/api/closure-letter", json={"market": "IN", "loan_type": "yacht", "closed_on": "2026-10-01"})
    assert bad.status_code == 422
