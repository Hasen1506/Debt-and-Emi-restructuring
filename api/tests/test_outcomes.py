"""POST /api/outcomes and the scorecard: checks, limits, privacy, caching."""
import asyncio
from decimal import Decimal
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import select

from api import client_ip
from api.outcomes_store import LimitReached, OutcomeStore, outcomes
from engine.outcomes import Outcome, OutcomeReport

FIXED = {"lender": "HDFC Bank", "outcome": "fixed_full", "days_taken": 12,
         "rate_before": "0.0925", "rate_after": "0.0870"}


def share(client, body=None, ip=None, **changes):
    headers = {"x-forwarded-for": ip} if ip else {}
    return client.post("/api/outcomes", json={**(body or FIXED), **changes}, headers=headers)


def rows(store):
    async def go():
        await store.init()
        async with store.engine.connect() as conn:
            return (await conn.execute(select(outcomes))).mappings().all()
    return asyncio.run(go())


@pytest.fixture()
def behind_proxy(monkeypatch):
    monkeypatch.setenv("TRUSTED_PROXY_HOPS", "1")


class Clock:
    def __init__(self):
        self.t = datetime(2026, 9, 26, 10, 0, tzinfo=timezone.utc)

    def __call__(self):
        return self.t


# ── sharing ─────────────────────────────────────────────────────────────────

def test_share_a_report(client, outcome_store):
    r = share(client)
    assert r.status_code == 200
    assert r.json() == {"lender": "HDFC Bank", "reports_for_lender": 1, "min_reports": 5,
                        "message": "Thank you. HDFC Bank has 1 shared report; figures appear from 5."}
    [row] = rows(outcome_store)
    assert row["lender_id"] == "IN_HDFC" and row["outcome"] == "fixed_full" and row["days_taken"] == 12
    assert row["verified"] is False


def test_the_address_is_never_stored(client, outcome_store):
    share(client)
    [row] = rows(outcome_store)
    assert "testclient" not in str(dict(row))
    assert row["client"] == outcome_store.client_hash("testclient") and len(row["client"]) == 32


@pytest.mark.parametrize("changes, field, words", [
    ({"lender": "Fake Bank"}, "lender", "banks on our list"),
    ({"rate_after": "0.0950"}, "rate_after", "must be lower"),
    ({"rate_after": None}, "rate_after", "new rate"),
    ({"outcome": "no_reply", "rate_after": None, "days_taken": 10}, "days_taken", "30 days"),
    ({"rate_before": "9.25"}, "rate_before", "send 0.0925 for 9.25%"),
    ({"outcome": "maybe"}, "outcome", "outcome"),
    ({"days_taken": 10 ** 9}, "days_taken", ""),
    ({"lender": "x" * 500}, "lender", ""),
])
def test_bad_reports_are_refused_with_the_field(client, outcome_store, changes, field, words):
    r = share(client, **changes)
    assert r.status_code == 422
    assert r.json()["detail"]["field"] == field and words in r.json()["detail"]["message"]
    assert rows(outcome_store) == []


# ── limits ──────────────────────────────────────────────────────────────────

def test_independent_sqlite_stores_share_one_report_budget(outcome_store):
    async def run():
        stores = [OutcomeStore(outcome_store.engine, key=b'test-key') for _ in range(8)]
        for store in stores:
            await store.init()
        report = OutcomeReport('hdfc', Outcome.REFUSED, 10, Decimal('.09'), None)
        results = await asyncio.gather(*(store.add(report, '192.0.2.1') for store in stores), return_exceptions=True)
        assert sum(isinstance(result, int) for result in results) == 2
        assert sum(isinstance(result, LimitReached) for result in results) == 6
    asyncio.run(run())

def test_ten_a_day_per_address_and_two_per_bank(client, outcome_store):
    clock = Clock()
    outcome_store.now = clock
    banks = ["SBI", "ICICI Bank", "Axis Bank", "PNB", "Canara Bank"]
    codes = [share(client, lender=b).status_code for b in banks for _ in range(2)]
    assert codes == [200] * 10
    r = share(client, lender="Bank of Baroda")
    assert r.status_code == 429 and r.headers["retry-after"] == "86400"
    assert "10 reports in the last day" in r.json()["detail"]["message"]
    clock.t += timedelta(hours=24, seconds=1)
    assert share(client, lender="Bank of Baroda").status_code == 200


def test_two_per_bank(client, outcome_store):
    assert [share(client).status_code for _ in range(3)] == [200, 200, 429]
    assert "2 reports about this bank" in share(client).json()["detail"]["message"]
    assert share(client, lender="SBI").status_code == 200


def test_the_lost_fake_bank_attack_fails(client, outcome_store, behind_proxy):
    """36 reports with made-up X-Forwarded-For values once gave a fake bank a 100% record."""
    for i in range(36):
        r = share(client, ip=f"10.0.{i}.1, 203.0.113.7", lender="Fake Bank")
        assert r.status_code == 422
    accepted = sum(share(client, ip=f"10.0.{i}.1, 203.0.113.7").status_code == 200 for i in range(36))
    assert accepted == 2                      # all 36 came from 203.0.113.7
    assert share(client, ip="198.51.100.9").status_code == 200    # a different real client


def test_client_ip_reads_the_proxy_chain_from_the_right():
    assert client_ip.client_ip("10.1.1.1", "6.6.6.6, 1.2.3.4", 1) == "1.2.3.4"
    assert client_ip.client_ip("10.1.1.1", "6.6.6.6, 1.2.3.4, 10.0.0.2", 2) == "1.2.3.4"
    assert client_ip.client_ip("10.1.1.1", "6.6.6.6, 1.2.3.4", 0) == "10.1.1.1"
    assert client_ip.client_ip("10.1.1.1", "", 1) == "10.1.1.1"
    assert client_ip.client_ip(None, None, 0) == "unknown"
    scope = {"client": ("10.1.1.1", 1), "headers": [(b"x-forwarded-for", b"6.6.6.6"),
                                                    (b"x-forwarded-for", b"1.2.3.4")]}
    assert client_ip.from_scope(scope, 1) == "1.2.3.4"


def test_address_hashes_are_wiped_after_two_days(client, outcome_store):
    clock = Clock()
    outcome_store.now = clock
    share(client)
    clock.t += timedelta(days=2, minutes=1)
    share(client, lender="SBI")
    old, new = rows(outcome_store)
    assert old["client"] is None and new["client"] is not None


# ── the scorecard ───────────────────────────────────────────────────────────

def _fill(client, n, lender="HDFC Bank", **changes):
    for i in range(n):
        assert share(client, ip=f"198.51.100.{i}", lender=lender, **changes).status_code == 200


def test_scorecard_waits_for_five(client, behind_proxy):
    _fill(client, 4)
    s = client.get("/api/outcomes/scorecard/lender", params={"name": "hdfc"}).json()
    assert s["known"] and s["reports"] == 4 and not s["shown"]
    assert s["hidden_reason"] == "Shown once 5 borrowers have shared a report (1 more needed)."
    assert s["fixed_in_full_pct"] is None and s["counts"] == {}
    _fill(client, 1)
    s = client.get("/api/outcomes/scorecard/lender", params={"name": "HDFC Bank Ltd"}).json()
    assert s["shown"] and s["reports"] == 5 and s["label"] == "unverified"
    assert s["headline"] == "HDFC Bank: 100% fixed in full · median 12 days · median rate cut 0.55%"
    assert s["counts"] == {"fixed_full": 5, "fixed_part": 0, "refused": 0, "no_reply": 0}


def test_scorecard_for_unknown_and_quiet_banks(client):
    assert client.get("/api/outcomes/scorecard/lender", params={"name": "Fake Bank"}).json()["known"] is False
    s = client.get("/api/outcomes/scorecard/lender", params={"name": "SBI"}).json()
    assert s["known"] and s["lender"] == "SBI" and s["reports"] == 0 and not s["shown"]


def test_scorecard_lists_banks_with_reports(client, behind_proxy):
    _fill(client, 5)
    _fill(client, 2, lender="SBI", outcome="refused", rate_after=None)
    card = client.get("/api/outcomes/scorecard").json()
    assert [(s["lender"], s["reports"], s["shown"]) for s in card] == [("HDFC Bank", 5, True), ("SBI", 2, False)]


def test_hidden_mode_keeps_figures_back(client, behind_proxy, monkeypatch):
    _fill(client, 5)
    monkeypatch.setenv("SCORECARD_MODE", "hidden")
    s = client.get("/api/outcomes/scorecard/lender", params={"name": "HDFC"}).json()
    assert s["reports"] == 5 and not s["shown"] and s["headline"] is None
    assert s["hidden_reason"] == "Kept back until reports can be verified."


def test_scorecard_is_cached_and_a_new_report_clears_it(client, outcome_store, behind_proxy):
    calls = []
    real = outcome_store.reports

    async def counting(*a, **k):
        calls.append(1)
        return await real(*a, **k)
    outcome_store.reports = counting
    _fill(client, 5)
    for _ in range(5):
        client.get("/api/outcomes/scorecard/lender", params={"name": "HDFC"})
    assert len(calls) == 1
    share(client, ip="192.0.2.1")
    s = client.get("/api/outcomes/scorecard/lender", params={"name": "HDFC"}).json()
    assert len(calls) == 2 and s["reports"] == 6


def test_scorecard_cache_expires_after_a_minute(client, outcome_store):
    t = [1000.0]
    outcome_store.clock = lambda: t[0]
    calls = []
    real = outcome_store.reports

    async def counting(*a, **k):
        calls.append(1)
        return await real(*a, **k)
    outcome_store.reports = counting
    client.get("/api/outcomes/scorecard")
    t[0] += 59
    client.get("/api/outcomes/scorecard")
    t[0] += 2
    client.get("/api/outcomes/scorecard")
    assert len(calls) == 2


def test_lender_list(client):
    names = [x["name"] for x in client.get("/api/outcomes/lenders").json()]
    assert "HDFC Bank" in names and "SBI" in names and len(names) == len(set(names)) >= 25


def test_health_says_where_reports_are_kept(client):
    assert client.get("/api/health").json()["outcomes_storage"] == "local file"
