"""POST /api/complaints/in — letter, deadlines, escalation."""
from decimal import Decimal

import pytest

from engine.complaints_in import stray_you

D = Decimal


def _payload(**kw) -> dict:
    body = {
        "lender": "HDFC Bank",
        "loan_start": "2022-01",
        "start_rate": "0.0690",
        "current_rate": "0.0890",
        "outstanding": "4000000",
        "tenure_months_remaining": 200,
        "benchmark": "repo",
        "as_of": "2026-09-26",
    }
    body.update(kw)
    return {k: v for k, v in body.items() if v is not None}


def test_draft_letter_only(client):
    r = client.post("/api/complaints/in", json=_payload())
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["timeline"] is None and body["ombudsman"] is None
    letter = body["letter"]
    assert D(letter["claim_amount"]) == D("12500")
    assert len(letter["annexure"]) == 5
    assert "[Full name]" in letter["text"]
    assert stray_you(letter["text"]) is None
    assert body["placeholders"]["account"] == "[Loan account number]"
    assert "[Phone]" in body["placeholders"]["optional_lines"]


def test_personal_details_are_not_accepted(client):
    """Name and account stay in the browser; the API ignores them."""
    r = client.post("/api/complaints/in", json=_payload(name="A. Kumar", account="HL1"))
    assert r.status_code in (200, 422)
    if r.status_code == 200:
        assert "A. Kumar" not in r.text and "HL1" not in r.text


def test_sent_complaint_waiting(client):
    r = client.post("/api/complaints/in", json=_payload(sent_on="2026-09-01"))
    body = r.json()
    assert body["timeline"]["stage"] == "awaiting_reply"
    assert body["timeline"]["escalation_deadline"] == "2026-12-30"
    assert body["letter"]["date_line"] == "1 September 2026"
    assert body["io_followup"] is None
    assert body["ombudsman"]["opens"] == "2026-10-02"


def test_rejected_without_io_gets_followup(client):
    r = client.post("/api/complaints/in", json=_payload(
        sent_on="2026-09-01", reply="rejected", reply_on="2026-09-10", bank_reference="GRV-9",
    ))
    body = r.json()
    assert body["timeline"]["stage"] == "internal_ombudsman"
    assert "GRV-9" in body["io_followup"]["subject"]
    fields = {f["label"]: f["value"] for f in body["ombudsman"]["fields"]}
    assert fields["Bank's complaint reference"] == "GRV-9"


def test_fixed_has_no_escalation(client):
    body = client.post("/api/complaints/in", json=_payload(
        sent_on="2026-09-01", reply="fixed", reply_on="2026-09-10",
    )).json()
    assert body["timeline"]["stage"] == "fixed"
    assert body["ombudsman"] is None and body["io_followup"] is None


def test_nothing_to_claim_is_a_clear_422(client):
    r = client.post("/api/complaints/in", json=_payload(current_rate="0.0815"))
    assert r.status_code == 422
    assert r.json()["detail"]["field"] == "claim"
    assert "new borrowers" in r.json()["detail"]["message"]


@pytest.mark.parametrize("kw, field", [
    (dict(reply="rejected", reply_on="2026-09-10"), "sent_on"),
    (dict(sent_on="2026-10-01"), "sent_on"),
    (dict(sent_on="2026-09-01", reply="rejected"), "reply_on"),
    (dict(sent_on="2026-09-01", received_on="2026-08-01"), "received_on"),
    (dict(sent_on="01/09/2026"), "sent_on"),
])
def test_bad_tracking_dates(client, kw, field):
    r = client.post("/api/complaints/in", json=_payload(**kw))
    assert r.status_code == 422, r.text
    assert r.json()["detail"]["field"] == field


# ── Sprint G5: draft step (critique #54) and verified rules (#40) ──────────

def test_every_letter_comes_back_as_a_draft_with_a_self_check(client):
    body = client.post("/api/complaints/in", json=_payload()).json()
    assert body["draft_notice"].startswith("Draft. Check before sending.")
    assert "never sends" in body["draft_notice"]
    assert len(body["self_check"]) >= 5
    assert any("spread" in item for item in body["self_check"])
    assert any("housing finance company" in item for item in body["self_check"])
    # No claim of professional review anywhere in the letter or the notice.
    for text in (body["letter"]["text"], body["draft_notice"]):
        assert "reviewed by" not in text.replace("has not been reviewed by", "")


def test_letters_cite_the_2026_internal_ombudsman_directions(client):
    body = client.post("/api/complaints/in", json=_payload(
        sent_on="2026-09-01", reply="rejected", reply_on="2026-09-10")).json()
    text = body["io_followup"]["text"]
    assert "Internal Ombudsman) Directions, 2026" in text and "clause 14" in text
    assert "2023" not in text
    assert all(c["verified_against_text"] for c in body["letter"]["citations"])
    assert "paragraphs 38 and 33" in body["letter"]["text"]


def test_hfc_gets_no_letter(client):
    r = client.post("/api/complaints/in", json=_payload(lender="LIC Housing Finance"))
    assert r.status_code == 422
    assert "housing finance" in r.json()["detail"]["message"]
