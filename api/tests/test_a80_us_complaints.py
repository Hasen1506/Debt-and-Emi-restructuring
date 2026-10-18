"""Audit 80+ D11: the US FCBA / RESPA protections are reachable.

Guards the class: every US letter states WHERE it must be sent (the one
mistake that loses the protection), hands off to the CFPB, carries only
placeholders (no personal data leaves the device), cites primary text, and
its timeline is internally ordered for any dates.
"""
from datetime import date, timedelta

import pytest

from engine.complaint_deadlines import us_billing_error_timeline
from engine.complaints_us import fcba_billing_error_letter, respa_notice_of_error_letter

KINDS = ["fcba_billing_error", "respa_notice_of_error"]


@pytest.mark.parametrize("kind", KINDS)
def test_draft_letter_without_dates(client, kind):
    r = client.post("/api/complaints/us", json={"kind": kind, "as_of": "2026-10-14"})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["timeline"] is None
    letter = body["letter"]
    assert letter["kind"] == kind
    joined = " ".join(letter["how_to_send"]).lower()
    assert "address" in joined
    assert any("consumerfinance.gov/complaint" in x for x in letter["if_no_answer"])
    assert all(u.startswith("https://www.consumerfinance.gov/") for u in letter["sources"])
    assert "lawyer" in letter["draft_notice"]


@pytest.mark.parametrize("make", [fcba_billing_error_letter, respa_notice_of_error_letter])
def test_letters_carry_only_placeholders(make):
    x = make()
    text = x.text()
    assert "[Full name]" in text and "[Account number]" in text
    # No digits outside regulation references and placeholders: a letter is a
    # template, never a stored figure or a person's details.
    import re
    stripped = re.sub(r"\[[^\]]*\]|\d+ CFR [\d.()a-z]+|1026\.13\([a-z]\)(\(\d\))?", "", text)
    assert not re.search(r"\d{3,}", stripped), stripped


def test_fcba_says_billing_error_address_not_payment_address():
    x = fcba_billing_error_letter()
    assert "billing-error address" in x.send_to.lower()
    assert any("not the payment address" in h.lower() for h in x.how_to_send)
    assert any("60 days" in h for h in x.how_to_send)
    t = us_billing_error_timeline(date(2026, 9, 1), date(2026, 9, 10), today=date(2026, 9, 20))
    assert any("payment address" in n for n in t.notes)


def test_fcba_timeline_via_api(client):
    r = client.post("/api/complaints/us", json={
        "kind": "fcba_billing_error", "statement_on": "2026-09-01",
        "sent_on": "2026-09-10", "as_of": "2026-09-20"})
    assert r.status_code == 200, r.text
    t = r.json()["timeline"]
    assert t["market"] == "US" and t["stage"] == "awaiting_reply"
    keys = [m["key"] for m in t["milestones"]]
    assert keys[:2] == ["notice_by", "sent"]


def test_fcba_needs_statement_date_once_sent(client):
    r = client.post("/api/complaints/us", json={"kind": "fcba_billing_error", "sent_on": "2026-09-10", "as_of": "2026-09-20"})
    assert r.status_code == 422
    assert r.json()["detail"]["field"] == "statement_on"


@pytest.mark.parametrize("kind", KINDS)
def test_received_without_sent_is_refused(client, kind):
    r = client.post("/api/complaints/us", json={"kind": kind, "received_on": "2026-09-10", "as_of": "2026-09-20"})
    assert r.status_code == 422 and r.json()["detail"]["field"] == "sent_on"


@pytest.mark.parametrize("kind", KINDS)
def test_future_dates_are_refused(client, kind):
    r = client.post("/api/complaints/us", json={
        "kind": kind, "statement_on": "2026-09-01", "sent_on": "2026-10-30", "as_of": "2026-10-14"})
    assert r.status_code == 422


@pytest.mark.parametrize("offset", [0, 1, 7, 29, 45, 59, 61, 120])
@pytest.mark.parametrize("kind", KINDS)
def test_timeline_milestones_are_ordered(client, kind, offset):
    statement = date(2026, 6, 1)
    sent = statement + timedelta(days=offset)
    r = client.post("/api/complaints/us", json={
        "kind": kind, "statement_on": statement.isoformat(), "sent_on": sent.isoformat(),
        "as_of": (sent + timedelta(days=3)).isoformat()})
    assert r.status_code == 200, r.text
    ms = {m["key"]: date.fromisoformat(m["day"]) for m in r.json()["timeline"]["milestones"]}
    assert ms["ack"] <= ms.get("resolve", ms.get("response"))
    assert ms["sent"] <= ms["ack"]
    if kind == "fcba_billing_error":
        late = offset > 60
        stage = r.json()["timeline"]["stage"]
        assert (stage == "late_notice") == late


def test_unknown_kind_is_refused(client):
    r = client.post("/api/complaints/us", json={"kind": "tila_rescission"})
    assert r.status_code == 422
