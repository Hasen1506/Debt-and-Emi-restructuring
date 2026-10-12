"""POST /api/loan-check — round trip and input errors."""
from decimal import Decimal

import pytest

from engine import policy_rates

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


def test_loan_check_round_trip(client):
    r = client.post("/api/loan-check", json=_payload())
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["status"] == "issues_found"
    assert D(body["expected_rate"]) == D("0.0815")
    assert D(body["claim_amount"]) == D("12500")
    kinds = [f["kind"] for f in body["findings"]]
    assert kinds == ["missed_rate_cut", "pricing_gap"]
    missed = body["findings"][0]
    assert missed["claimable"] is True
    assert missed["citations"][0]["rule"].startswith("Reserve Bank of India (Commercial Banks")
    c = missed["citations"][0]
    assert c["verified_against_text"] is True and c["paragraph"] == "paragraph 38"
    assert c["url"].startswith("https://www.rbi.org.in/") and "reset at least once in three months" in c["clause"]
    assert body["verdict"] == "missed_rate_cut" and body["rule_applies"] is True
    assert body["lender_type"] == "commercial_bank" and body["lender_type_source"] == "from_name"
    assert body["rates_as_of"] == policy_rates.LAST_VERIFIED.isoformat()
    assert body["repo_changes_since_start"][-1]["new_rate"] in ("0.0525", 0.0525)


def test_split_start_rate(client):
    r = client.post("/api/loan-check", json=_payload(
        start_rate=None, start_benchmark_rate="0.0665", start_spread="0.0025",
    ))
    assert r.status_code == 200, r.text
    assert D(r.json()["start_rate"]) == D("0.0690")


@pytest.mark.parametrize("given, missing", [
    ({"start_benchmark_rate": "0.0665"}, "start_spread"),
    ({"start_spread": "0.0025"}, "start_benchmark_rate"),
])
def test_half_split_says_still_needed(client, given, missing):
    r = client.post("/api/loan-check", json=_payload(start_rate=None, **given))
    assert r.status_code == 422
    detail = r.json()["detail"]
    assert detail["field"] == missing
    assert detail["message"].startswith("Still needed:")


def test_no_start_rate_at_all(client):
    r = client.post("/api/loan-check", json=_payload(start_rate=None))
    assert r.status_code == 422
    assert r.json()["detail"]["message"].startswith("Still needed:")


def test_split_and_headline_disagree(client):
    r = client.post("/api/loan-check", json=_payload(
        start_rate="0.0700", start_benchmark_rate="0.0665", start_spread="0.0025",
    ))
    assert r.status_code == 422
    assert "does not match" in r.json()["detail"]["message"]


@pytest.mark.parametrize("bad", ["03/2019", "2019-3", "March 2019", "2019-13", "", "2019-03-01"])
def test_unreadable_month_is_rejected_not_skipped(client, bad):
    """Lost bug: '03/2019' from a Firefox text box silently dropped the finding."""
    r = client.post("/api/loan-check", json=_payload(loan_start=bad))
    assert r.status_code == 422
    detail = r.json()["detail"]
    assert detail["field"] == "loan_start"
    assert "2021-03" in detail["message"]


def test_bad_last_reset_month(client):
    r = client.post("/api/loan-check", json=_payload(last_reset="06/2023"))
    assert r.status_code == 422
    assert r.json()["detail"]["field"] == "last_reset"


@pytest.mark.parametrize("field, value, msg", [
    ("start_rate", "8.55", "percentage"),
    ("current_rate", "8.90", "percentage"),
    ("current_rate", "0.000890", "outside 1%"),
    ("outstanding", "1e30", "Outstanding"),
    ("outstanding", "-5", "Outstanding"),
    ("tenure_months_remaining", 100000, "Months left"),
])
def test_bad_numbers_get_clear_errors(client, field, value, msg):
    r = client.post("/api/loan-check", json=_payload(**{field: value}))
    assert r.status_code == 422, r.text
    assert msg in r.json()["detail"]["message"]
    assert r.json()["detail"]["field"] == field      # shown under that input


@pytest.mark.parametrize("changes, field", [
    ({"emi": "-5"}, "emi"),
    ({"emi": "9000000"}, "emi"),
    ({"last_reset": "2020-03"}, "last_reset"),         # before the loan started
    ({"last_reset": "2030-01"}, "last_reset"),         # in the future
    ({"loan_start": "2031-01"}, "loan_start"),
    ({"loan_start": "2018-01"}, "loan_start"),         # repo-linked loans began in July 2019
    ({"start_rate": "0.0300"}, "start_rate"),          # below the repo rate then
    ({"current_rate": "0.0300"}, "current_rate"),      # below the repo rate today
])
def test_engine_checks_name_the_field(client, changes, field):
    r = client.post("/api/loan-check", json=_payload(**changes))
    assert r.status_code == 422, r.text
    assert r.json()["detail"]["field"] == field, r.json()


def test_split_fraction_check(client):
    r = client.post("/api/loan-check", json=_payload(
        start_rate=None, start_benchmark_rate="6.65", start_spread="0.0025",
    ))
    assert r.status_code == 422
    assert r.json()["detail"]["field"] == "start_benchmark_rate"
    assert "percentage" in r.json()["detail"]["message"]


def test_central_rates_are_current(client):
    body = client.get("/api/rates/central").json()
    # RBI raised the repo rate to 5.50% on 7 Oct 2026; the Fed's upper
    # bound has been 4.00% since 16 Sep 2026.
    assert D(str(body["IN"]["current_rate"])) == D("0.0550")
    assert D(str(body["US"]["current_rate"])) == D("0.0400")
    assert body["IN"]["as_of"] == "2026-10-09"
    assert body["IN"]["source"] == "Official decisions, checked by hand on 09 Oct 2026"


def test_loan_check_says_where_the_rates_come_from(client):
    body = client.post("/api/loan-check", json=_payload()).json()
    assert body["rates_as_of"] == policy_rates.LAST_VERIFIED.isoformat()
    assert body["rates_source"] == f"Official decisions, checked by hand on {policy_rates.LAST_VERIFIED:%d %b %Y}"


# ── Sprint G5: live-test L#7–L#10 through the API ──────────────────────────

LIVE = dict(lender="SBI", loan_start="2022-03", start_rate="0.0915", current_rate="0.0915",
            outstanding="3000000", tenure_months_remaining=200, as_of="2026-10-12")


def test_live_negative_gap_reads_as_good_news(client):
    body = client.post("/api/loan-check", json=_payload(**LIVE)).json()
    assert body["verdict"] == "below_expected" and body["status"] == "no_issue"
    assert D(body["gap"]) < 0 and D(body["claim_amount"]) == 0
    assert "in your favour" in body["summary"]
    w = body["reset_watch"]
    assert w["last_change"] == "2026-10-07" and w["check_by"] == "2027-01-06"
    assert w["next_meeting"] == "2026-12-04"


def test_lic_hfl_gets_the_hfc_rules_not_a_bank_verdict(client):
    body = client.post("/api/loan-check", json=_payload(**{**LIVE, "lender": "LIC Housing Finance"})).json()
    assert body["verdict"] == "rule_not_binding" and body["rule_applies"] is False
    assert body["lender_type"] == "hfc"
    f = body["findings"][0]
    assert f["kind"] == "rule_not_binding" and f["claimable"] is False
    assert "grids.nhbonline.org.in" in f["next_step"]


def test_contradicting_type_is_a_422_on_the_type_field(client):
    r = client.post("/api/loan-check", json=_payload(**LIVE, lender_type="hfc"))
    assert r.status_code == 422 and r.json()["detail"]["field"] == "lender_type"


def test_spread_change_round_trip(client):
    body = client.post("/api/loan-check", json=_payload(
        spread_changed="yes", spread_change="0.0025", lender_type="commercial_bank")).json()
    assert D(body["expected_rate"]) == D("0.0840")
    r = client.post("/api/loan-check", json=_payload(spread_changed="yes"))
    assert r.status_code == 422 and r.json()["detail"]["field"] == "spread_change"
    r = client.post("/api/loan-check", json=_payload(spread_changed="yes", spread_change="0.25"))
    assert r.status_code == 422 and "fraction" in r.json()["detail"]["message"]


def test_lender_picker_list_carries_types(client):
    xs = {x["name"]: x for x in client.get("/api/loan-check/lenders").json()}
    assert xs["SBI"]["type"] == "commercial_bank" and xs["SBI"]["rule_applies"] and xs["SBI"]["has_rate_card"]
    assert xs["AU SFB"]["type"] == "small_finance_bank" and xs["AU SFB"]["rule_applies"]
    assert xs["LIC Housing Finance"]["type"] == "hfc" and not xs["LIC Housing Finance"]["rule_applies"]
    assert "KreditBee" not in xs
