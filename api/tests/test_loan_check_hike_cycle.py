"""Hike-cycle Loan Check over HTTP (audit 80+ A11, A19).

- /api/loan-check returns the rate rise, the switch saving and the
  rises-vs-cuts check;
- /api/complaints/in/reset-choice writes the "EMI raised without the
  choice" letter, and refuses when there is nothing to write about;
- /api/rbi-decision (the public MPC page) runs the reset arithmetic with
  no sign-in and shows scenarios, never odds.
"""
from decimal import Decimal

import pytest

D = Decimal
AS_OF = "2026-10-14"


def _loan(**kw) -> dict:
    body = {
        "lender": "SBI", "loan_start": "2023-06", "start_rate": "0.0915",
        "current_rate": "0.0790", "outstanding": "5000000", "tenure_months_remaining": 240,
        "benchmark": "repo", "spread_changed": "no", "as_of": AS_OF,
    }
    body.update(kw)
    return body


def test_loan_check_returns_rate_rise(client):
    r = client.post("/api/loan-check", json=_loan())
    assert r.status_code == 200, r.text
    b = r.json()
    rr = b["rate_rise"]
    assert rr["status"] == "pending" and rr["reach_by"] == "2027-01-06"
    assert D(rr["impact"]["emi_before"]) == 41511 and D(rr["impact"]["emi_after"]) == 42290
    assert "rate_rise" in [f["kind"] for f in b["findings"]]
    assert D(b["claim_amount"]) == 0


def test_rate_history_round_trip_and_errors(client):
    body = _loan(rate_history=[{"month": "2025-03", "rate": "0.0890"}])
    assert client.post("/api/loan-check", json=body).status_code == 200
    bad = client.post("/api/loan-check", json=_loan(rate_history=[{"month": "2025-3", "rate": "0.089"}]))
    assert bad.status_code == 422 and bad.json()["detail"]["field"] == "rate_history"
    pct = client.post("/api/loan-check", json=_loan(rate_history=[{"month": "2025-03", "rate": "8.9"}]))
    assert pct.status_code == 422 and pct.json()["detail"]["field"] == "rate_history"


def test_mclr_switch_round_trip(client):
    r = client.post("/api/loan-check", json=_loan(
        loan_start="2017-04", start_rate="0.0850", current_rate="0.0925", benchmark="mclr",
        outstanding="3000000", tenure_months_remaining=180, switch_rate="0.0815", switch_cost="5000",
    ))
    assert r.status_code == 200, r.text
    sw = r.json()["switch"]
    assert D(sw["switch_rate"]) == D("0.0815") and D(sw["interest_saved_rest"]) > 0


def test_reset_choice_letter(client):
    r = client.post("/api/complaints/in/reset-choice", json=_loan(
        current_rate="0.0815", bank_action="emi_raised", choice_offered="no", preference="tenure",
    ))
    assert r.status_code == 200, r.text
    L = r.json()["letter"]
    assert L["kind"] == "reset_choice" and D(L["claim_amount"]) == 0
    assert "choice of EMI or tenure not offered" in L["subject"]
    assert "[Loan account number]" in L["text"]


@pytest.mark.parametrize("extra", [
    {"bank_action": "emi_raised", "choice_offered": "yes"},
    {"bank_action": "none_yet", "choice_offered": "no"},
    {},
])
def test_reset_choice_refused_without_the_issue(client, extra):
    r = client.post("/api/complaints/in/reset-choice", json=_loan(**extra))
    assert r.status_code == 422 and r.json()["detail"]["field"] == "choice_offered"


def test_rbi_decision_public_page_golden(client):
    r = client.post("/api/rbi-decision", json={
        "outstanding": "5000000", "current_rate": "0.0790", "tenure_months_remaining": 240,
        "reached": "no", "as_of": AS_OF,
    })
    assert r.status_code == 200, r.text
    b = r.json()
    assert b["decision"]["decided"] == "2026-10-07"
    assert D(b["decision"]["move"]) == D("0.0025")
    assert "prid=63742" in b["decision"]["source_url"]
    assert b["next_meeting"] == "2026-12-04"
    assert D(b["impact"]["emi_before"]) == 41511 and D(b["impact"]["emi_after"]) == 42290
    assert [D(s["move"]) for s in b["scenarios"]] == [D("0"), D("0.0025"), D("0.0050")]
    assert b["scenarios"][0]["impact"] is None
    # Scenarios stack on the rate after this decision.
    assert D(b["scenarios"][1]["impact"]["rate_before"]) == D("0.0815")
    assert "odds" not in r.text.lower() and "probab" not in r.text.lower()


def test_rbi_decision_reached_yes_runs_from_old_rate(client):
    r = client.post("/api/rbi-decision", json={
        "outstanding": "5000000", "current_rate": "0.0815", "tenure_months_remaining": 240,
        "reached": "yes", "as_of": AS_OF,
    })
    b = r.json()
    assert b["applied_to"] == "rate_after"
    assert D(b["impact"]["rate_before"]) == D("0.0790") and D(b["impact"]["rate_after"]) == D("0.0815")


@pytest.mark.parametrize("body,field", [
    ({"current_rate": "8.15"}, "current_rate"),
    ({"tenure_months_remaining": 0}, "tenure_months_remaining"),
    ({"outstanding": "0"}, "outstanding"),
])
def test_rbi_decision_input_errors(client, body, field):
    base = {"outstanding": "5000000", "current_rate": "0.0815", "tenure_months_remaining": 240,
            "as_of": AS_OF}
    base.update(body)
    r = client.post("/api/rbi-decision", json=base)
    assert r.status_code == 422
