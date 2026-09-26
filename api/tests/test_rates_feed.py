"""Live rate feeds: parsing, dating new decisions, fallback, feed health.

No network: FRED replies are built from the verified table, and the RBI
page is a hand-made copy of its rate panel (fixtures/rbi_policy_rates.html).
"""
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
from pathlib import Path

import pytest

from api import rates_feed
from api.rates_feed import FeedError, RatesFeed, fed_reading, parse_fred_csv, parse_rbi_rates, rbi_reading
from engine import policy_rates
from engine.models import Country

D = Decimal
RBI_PAGE = (Path(__file__).parent / "fixtures" / "rbi_policy_rates.html").read_text()
US_MEETINGS = [date(2026, 9, 16), date(2026, 10, 28), date(2026, 12, 9)]
IN_MEETINGS = [date(2026, 8, 5), date(2026, 10, 7), date(2026, 12, 5)]


@pytest.fixture(autouse=True)
def _clean():
    policy_rates.clear_live()
    yield
    policy_rates.clear_live()


def fred_csv(end: date, extra=(), header="observation_date", override=None) -> str:
    """Daily DFEDTARU/DFEDTARL as FRED would print them, from the table.

    FRED moves the day after the announcement. `extra` adds later
    (effective date, upper) changes; `override` forces one day's value.
    """
    changes = [(d + timedelta(days=1), r) for d, r in policy_rates.FED_FUNDS_UPPER_US] + list(extra)
    lines = [f"{header},DFEDTARU,DFEDTARL"]
    day, i, upper = date(2018, 12, 17), 0, D("0.0250")
    while day <= end:
        while i < len(changes) and changes[i][0] <= day:
            upper = changes[i][1]
            i += 1
        u = override[1] if override and override[0] == day else upper
        lines.append(f"{day},{u * 100:.2f},{(u - D('0.0025')) * 100:.2f}")
        day += timedelta(days=1)
    return "\n".join(lines) + "\n"


def rbi_page(repo: str, sdf: str, msf: str) -> str:
    page = RBI_PAGE
    for label, old, new in [("Policy Repo Rate", "5.25", repo),
                            ("Standing Deposit Facility Rate", "5.00", sdf),
                            ("Marginal Standing Facility Rate", "5.50", msf)]:
        row = f"{label}</td><td>:</td><td>{old}%"
        assert row in page
        page = page.replace(row, f"{label}</td><td>:</td><td>{new}%")
    return page


# ── parsing ─────────────────────────────────────────────────────────────────

def test_fred_csv_both_headers_and_gaps():
    for header in ("DATE", "observation_date"):
        text = f"﻿{header},DFEDTARU\n2026-09-16,3.75\n2026-09-17,4.00\n2026-09-18,.\n"
        assert parse_fred_csv(text) == {
            "DFEDTARU": [(date(2026, 9, 16), D("0.0375")), (date(2026, 9, 17), D("0.0400"))],
        }


@pytest.mark.parametrize("text", ["<html>Service unavailable</html>", "", "DATE\n"])
def test_fred_reply_that_is_not_csv_is_refused(text):
    with pytest.raises(FeedError):
        parse_fred_csv(text)


def test_rbi_panel_is_read_and_scripts_ignored():
    assert parse_rbi_rates(RBI_PAGE) == {
        "repo": D("0.0525"), "sdf": D("0.0500"), "msf": D("0.0550"),
    }


# ── FRED ────────────────────────────────────────────────────────────────────

def test_fred_agrees_with_the_table_and_finds_nothing_new():
    r = fed_reading(fred_csv(date(2026, 9, 25)), US_MEETINGS)
    assert r.changes == [] and r.current == D("0.0400")
    assert r.detail == {"upper": "0.0400", "lower": "0.0375"}
    assert r.as_of == date(2026, 9, 25)


def test_fred_new_decision_is_dated_to_the_meeting():
    text = fred_csv(date(2026, 11, 2), extra=[(date(2026, 10, 29), D("0.0375"))])
    r = fed_reading(text, US_MEETINGS)
    assert r.changes == [(date(2026, 10, 28), D("0.0375"))]
    assert r.current == D("0.0375")


def test_fred_new_decision_without_a_meeting_on_file():
    text = fred_csv(date(2026, 11, 2), extra=[(date(2026, 10, 20), D("0.0375"))])
    assert fed_reading(text, []).changes == [(date(2026, 10, 19), D("0.0375"))]


def test_fred_not_yet_caught_up_is_not_a_mismatch():
    """The day after a decision FRED may still show the old rate."""
    text = "\n".join(fred_csv(date(2026, 9, 25)).splitlines()[:-8]) + "\n"   # ends 17 Sep
    r = fed_reading(text, US_MEETINGS)
    assert r.changes == []


def test_fred_disagreeing_with_the_table_is_refused():
    text = fred_csv(date(2026, 9, 25), override=(date(2025, 11, 2), D("0.0425")))
    with pytest.raises(FeedError, match="verified table"):
        fed_reading(text, US_MEETINGS)


# ── RBI ─────────────────────────────────────────────────────────────────────

def test_rbi_same_rate_is_no_new_decision():
    r = rbi_reading(RBI_PAGE, date(2026, 9, 26), IN_MEETINGS, policy_rates.history(Country.IN))
    assert r.changes == [] and r.current == D("0.0525")
    assert r.detail == {"sdf": "0.0500", "msf": "0.0550", "printed_repo": "0.0525"}


def test_rbi_cut_is_dated_to_the_mpc_meeting():
    page = rbi_page("5.00", "4.75", "5.25")
    r = rbi_reading(page, date(2026, 10, 8), IN_MEETINGS, policy_rates.history(Country.IN))
    assert r.changes == [(date(2026, 10, 7), D("0.0500"))]


def test_rbi_off_cycle_change_is_dated_the_day_it_is_seen():
    page = rbi_page("5.00", "4.75", "5.25")
    r = rbi_reading(page, date(2026, 11, 20), IN_MEETINGS, policy_rates.history(Country.IN))
    assert r.changes == [(date(2026, 11, 20), D("0.0500"))]


def test_rbi_repo_derived_from_the_corridor_when_not_printed():
    page = rbi_page("5.25", "4.75", "5.25").replace("Policy Repo Rate", "Policy Rate Note")
    r = rbi_reading(page, date(2026, 10, 8), IN_MEETINGS, policy_rates.history(Country.IN))
    assert r.current == D("0.0500") and "printed_repo" not in r.detail


@pytest.mark.parametrize("page, match", [
    (rbi_page("5.25", "4.75", "5.50"), "not midway"),
    (rbi_page("5.25", "5.50", "5.00"), "corridor"),
    ("<html>Access denied</html>", "no longer shows"),
])
def test_rbi_page_that_does_not_add_up_is_refused(page, match):
    with pytest.raises(FeedError, match=match):
        rbi_reading(page, date(2026, 9, 26), IN_MEETINGS, policy_rates.history(Country.IN))


# ── the verified table only grows ───────────────────────────────────────────

def test_apply_live_ignores_the_past_and_checks_the_future():
    policy_rates.apply_live(Country.IN, [
        (date(2025, 6, 6), D("0.0900")),              # inside the table: ignored
        (date(2026, 10, 7), D("0.0500")),
    ], date(2026, 10, 8))
    assert policy_rates.rate_on(Country.IN, date(2025, 7, 1)) == D("0.0550")
    assert policy_rates.rate_on(Country.IN, date(2026, 10, 7)) == D("0.0500")
    assert policy_rates.rates_as_of(Country.IN) == date(2026, 10, 8)
    for bad in ([(date(2026, 10, 7), D("0.0725"))],       # 2-point jump
                [(date(2026, 10, 7), D("0.0525"))],       # repeats the rate in force
                [(date(2026, 12, 5), D("0.0500")), (date(2026, 10, 7), D("0.0475"))]):
        with pytest.raises(policy_rates.LiveRateError):
            policy_rates.apply_live(Country.IN, bad, date(2026, 12, 6))
    assert policy_rates.rate_on(Country.IN, date(2026, 10, 7)) == D("0.0500")   # unchanged


# ── refresh, fallback, restart, health ──────────────────────────────────────

class Clock:
    def __init__(self, at: datetime):
        self.at = at

    def __call__(self) -> datetime:
        return self.at


def _feed(tmp_path, pages: dict, clock: Clock) -> RatesFeed:
    def get(url: str) -> str:
        v = pages["fred" if "fred" in url else "rbi"]
        if isinstance(v, Exception):
            raise v
        return v
    return RatesFeed(tmp_path / "rates.json", get=get, now=clock)


def test_refresh_fallback_restart_and_health(tmp_path):
    clock = Clock(datetime(2026, 10, 8, 6, 0, tzinfo=timezone.utc))
    pages = {
        "fred": fred_csv(date(2026, 10, 7)),
        "rbi": rbi_page("5.00", "4.75", "5.25"),
    }
    feed = _feed(tmp_path, pages, clock)
    feed.refresh()
    h = feed.health(enabled=True)
    assert h["status"] == "ok", h
    assert policy_rates.rate_on(Country.IN, date(2026, 10, 8)) == D("0.0500")
    assert policy_rates.rates_as_of(Country.IN) == date(2026, 10, 8)

    # Both feeds fail: the last good values stay in use, the error is shown.
    pages["fred"] = OSError("Connection refused")
    pages["rbi"] = "<html>Access denied</html>"
    clock.at += timedelta(hours=6)
    feed.refresh()
    h = feed.health(enabled=True)
    fred, rbi = h["sources"]
    assert fred["error"] == "OSError: Connection refused"
    assert "no longer shows" in rbi["error"]
    assert rbi["status"] == "ok" and rbi["current"] == "0.0500" and rbi["age_hours"] == 6.0
    assert policy_rates.rate_on(Country.IN, date(2026, 10, 8)) == D("0.0500")

    # A restart reloads the last good values from the store.
    policy_rates.clear_live()
    again = _feed(tmp_path, pages, clock)
    again.load()
    assert policy_rates.rate_on(Country.IN, date(2026, 10, 8)) == D("0.0500")
    assert again.sources["rbi"].error and again.sources["rbi"].current == D("0.0500")

    # A day without a good fetch is stale.
    clock.at += timedelta(hours=19)
    h = again.health(enabled=True)
    assert h["status"] == "degraded"
    assert [s["status"] for s in h["sources"]] == ["stale", "stale"]


def test_implausible_fetch_keeps_the_history(tmp_path):
    clock = Clock(datetime(2026, 10, 8, tzinfo=timezone.utc))
    feed = _feed(tmp_path, {"fred": fred_csv(date(2026, 10, 7)),
                            "rbi": rbi_page("7.50", "7.25", "7.75")}, clock)
    feed.refresh()
    rbi = feed.sources["rbi"]
    assert "jumps" in rbi.error and rbi.last_success is None
    assert policy_rates.rate_on(Country.IN, date(2026, 10, 8)) == D("0.0525")


def test_corrupt_store_is_ignored(tmp_path):
    (tmp_path / "rates.json").write_text("{not json")
    feed = _feed(tmp_path, {}, Clock(datetime(2026, 10, 8, tzinfo=timezone.utc)))
    feed.load()
    assert feed.health(enabled=True)["status"] == "degraded"


# ── endpoints ───────────────────────────────────────────────────────────────

def test_feed_health_endpoint(client, tmp_path, monkeypatch):
    assert client.get("/api/rates/feed-health").json()["status"] == "off"

    clock = Clock(datetime.now(timezone.utc))
    feed = _feed(tmp_path, {"fred": OSError("timed out"), "rbi": RBI_PAGE}, clock)
    monkeypatch.setattr(rates_feed, "feed", feed)
    monkeypatch.setenv("RATES_FEED", "on")
    feed.refresh()
    r = client.get("/api/rates/feed-health")
    assert r.status_code == 503
    body = r.json()
    assert body["status"] == "degraded"
    assert [(s["source"], s["status"]) for s in body["sources"]] == [("fred", "never"), ("rbi", "ok")]

    body = client.get("/api/rates/central").json()
    assert body["IN"]["source"] == "RBI repo rate (rbi.org.in)"
    assert body["IN"]["as_of"] == date.today().isoformat()
    assert body["US"]["source"].startswith("Official decisions, checked by hand on")
    assert body["US"]["updated_at"] == "2026-09-16"
