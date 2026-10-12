"""Live rate feeds: parsing, dating new decisions, fallback, feed health.

No network: FRED replies are built from the verified table, and the RBI
page is a hand-made copy of its rate panel (fixtures/rbi_policy_rates.html).
"""
import json
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
def _clean(monkeypatch):
    # These tests act out decisions after the table as it stood on 26 Sep
    # 2026 (last entry: the 5 Dec 2025 cut), so the 7 Oct 2026 MPC is still
    # in the future here. The real table has since recorded that meeting.
    monkeypatch.setitem(policy_rates._TABLE, Country.IN,
                        [e for e in policy_rates.REPO_RATE_IN if e[0] <= date(2025, 12, 5)])
    monkeypatch.setattr(policy_rates, "LAST_VERIFIED", date(2026, 9, 26))
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

    # Weekly cadence (grill #61): a quiet week is not stale...
    clock.at += timedelta(days=6)
    assert again.health(enabled=True)["status"] == "ok"
    # ...but 46 days without a good check is.
    clock.at += timedelta(days=40)
    h = again.health(enabled=True)
    assert h["status"] == "degraded"
    assert all("over 45 days" in s["stale_reason"] for s in h["sources"])
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


# ── grill #61: weekly job, committed file, staleness by meeting ─────────────

def test_stale_when_a_meeting_passed_without_a_check(tmp_path, monkeypatch):
    monkeypatch.setattr(rates_feed, "_meetings",
                        lambda c: {"US": US_MEETINGS, "IN": IN_MEETINGS}.get(c, []))
    clock = Clock(datetime(2026, 10, 8, 6, 0, tzinfo=timezone.utc))
    feed = _feed(tmp_path, {"fred": fred_csv(date(2026, 10, 7)), "rbi": RBI_PAGE}, clock)
    feed.refresh()
    # FOMC 28 Oct: still ok within the 7-day grace, stale after it.
    clock.at = datetime(2026, 11, 4, tzinfo=timezone.utc)
    assert feed.health(enabled=True)["status"] == "ok"
    clock.at = datetime(2026, 11, 5, 1, tzinfo=timezone.utc)
    h = feed.health(enabled=True)
    fred = h["sources"][0]
    assert fred["status"] == "stale" and fred["stale_reason"] == "no check since the 2026-10-28 meeting"


def test_meeting_day_check_does_not_count_as_after_it():
    m = [date(2026, 10, 28)]
    assert rates_feed.missed_meeting(m, date(2026, 10, 28), date(2026, 11, 10)) == date(2026, 10, 28)
    assert rates_feed.missed_meeting(m, date(2026, 10, 29), date(2026, 11, 10)) is None
    assert rates_feed.missed_meeting(m, date(2026, 10, 1), date(2026, 11, 4)) is None   # inside grace


def _entry(as_of, current="0.0525", changes=()):
    return {"current": current, "as_of": as_of, "detail": {}, "changes": [list(c) for c in changes],
            "last_success": as_of + "T03:00:00+00:00"}


def test_should_commit_only_on_change_meeting_or_heartbeat(monkeypatch):
    monkeypatch.setattr(rates_feed, "_meetings", lambda c: [date(2026, 10, 7)] if c == "IN" else [])
    old = {"rbi": _entry("2026-09-28")}
    # An ordinary week: nothing to commit, so no redeploy.
    assert rates_feed.should_commit(old, {"rbi": _entry("2026-10-05")}, date(2026, 10, 5)) == (False, "no change")
    # First check after the 7 Oct MPC: record "checked, no change".
    ok, why = rates_feed.should_commit(old, {"rbi": _entry("2026-10-12")}, date(2026, 10, 12))
    assert ok and "after the 2026-10-07 meeting" in why
    # A new decision.
    ok, why = rates_feed.should_commit(old, {"rbi": _entry("2026-10-05", "0.0550", [("2026-10-07", "0.0550")])},
                                       date(2026, 10, 5))
    assert ok and "changed" in why
    # 30-day heartbeat.
    assert rates_feed.should_commit({"rbi": _entry("2026-11-01")}, {"rbi": _entry("2026-12-01")},
                                    date(2026, 12, 1))[0]
    # A source that has never been read well proposes nothing.
    assert rates_feed.should_commit(old, {"rbi": dict(_entry("x"), as_of=None)}, date(2026, 10, 5))[0] is False


def test_committed_form_has_no_per_run_fields(tmp_path):
    clock = Clock(datetime(2026, 10, 8, 6, 0, tzinfo=timezone.utc))
    feed = _feed(tmp_path, {"fred": OSError("down"), "rbi": RBI_PAGE}, clock)
    feed.refresh(save=False)
    assert not (tmp_path / "rates.json").exists()
    stored = feed.stored(committed=True)
    assert "last_attempt" not in stored["rbi"] and "error" not in stored["rbi"]


def test_weekly_script_writes_only_when_needed_and_fails_loudly(tmp_path, monkeypatch):
    import importlib.util
    spec = importlib.util.spec_from_file_location(
        "fetch_policy_rates", Path(__file__).resolve().parents[2] / "scripts" / "fetch_policy_rates.py")
    script = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(script)
    monkeypatch.setattr(rates_feed, "_meetings",
                        lambda c: {"US": US_MEETINGS, "IN": IN_MEETINGS}.get(c, []))
    store = tmp_path / "policy_rates_live.json"
    pages = {"fred": fred_csv(date(2026, 9, 25)), "rbi": RBI_PAGE}
    get = lambda url: pages["fred" if "fred" in url else "rbi"]  # noqa: E731

    status, summary, wrote = script.run(store, get=get, now=lambda: datetime(2026, 9, 26, tzinfo=timezone.utc))
    assert (status, wrote) == (0, True) and "first good check" in summary
    first = store.read_text()

    # A week later, nothing new and no meeting in between: file untouched.
    policy_rates.clear_live()
    pages["fred"] = fred_csv(date(2026, 10, 2))
    status, summary, wrote = script.run(store, get=get, now=lambda: datetime(2026, 10, 3, tzinfo=timezone.utc))
    assert (status, wrote) == (0, False) and store.read_text() == first

    # RBI page broken: the run fails (red X, email) but keeps the good file.
    policy_rates.clear_live()
    pages["rbi"] = "<html>Access denied</html>"
    status, summary, wrote = script.run(store, get=get, now=lambda: datetime(2026, 10, 3, tzinfo=timezone.utc))
    assert status == 1 and "FAILED" in summary
    assert json.loads(store.read_text())["rbi"]["current"] == "0.0525"


def test_app_start_reads_the_committed_file_without_a_thread(tmp_path, monkeypatch):
    import threading
    clock = Clock(datetime(2026, 10, 8, 6, 0, tzinfo=timezone.utc))
    src = _feed(tmp_path, {"fred": fred_csv(date(2026, 10, 7)), "rbi": rbi_page("5.00", "4.75", "5.25")}, clock)
    src.refresh(save=False)
    store = tmp_path / "committed.json"
    store.write_text(json.dumps(src.stored(committed=True)))
    policy_rates.clear_live()

    calls = []
    app_feed = RatesFeed(store, get=lambda url: calls.append(url) or "", now=clock)
    monkeypatch.setattr(rates_feed, "feed", app_feed)
    monkeypatch.setenv("RATES_FEED", "on")
    before = threading.active_count()
    rates_feed.start()
    assert calls == [] and threading.active_count() == before
    assert policy_rates.rate_on(Country.IN, date(2026, 10, 8)) == D("0.0500")


def test_committed_file_is_valid_and_matches_the_verified_table():
    """api/data/policy_rates_live.json (written by the weekly job) loads
    cleanly against the real verified table."""
    from api.rates_feed import _DEFAULT_STORE
    raw = json.loads(_DEFAULT_STORE.read_text())
    assert set(raw) == {"fred", "rbi"}
    for key, entry in raw.items():
        assert "last_attempt" not in entry and "error" not in entry
        assert D(entry["current"]) <= policy_rates.MAX_RATE


# ── grill #61: admin edits persist in the database ──────────────────────────

@pytest.fixture()
def outcome_db(tmp_path):
    from api import outcomes_store, rate_outcomes_store
    st = rate_outcomes_store.RateOutcomeStore(outcomes_store.sqlite_engine(tmp_path / "rates.sqlite3"))
    rate_outcomes_store.set_store(st)
    yield st
    rate_outcomes_store.set_store(None)


def _first_meeting(country):
    cal = json.loads((Path(__file__).resolve().parents[1] / "data" / "central_bank_calendar.json").read_text())
    upcoming = [m for m in cal["meetings"][country] if m["date"] >= date.today().isoformat()]
    return upcoming[0]["date"]


def test_admin_edit_is_stored_in_the_database_and_shown(client, outcome_db, monkeypatch):
    monkeypatch.setenv("ADMIN_RATE_UPDATE_TOKEN", "t0ken")
    cal_file = Path(__file__).resolve().parents[1] / "data" / "central_bank_calendar.json"
    before = cal_file.read_text()
    day = _first_meeting("IN")
    r = client.post("/api/admin/rate-update", headers={"X-Admin-Token": "t0ken"},
                    json={"country": "IN", "new_rate": "0.0525", "decision_date": day, "note": "cut 25 bps"})
    assert r.status_code == 200 and r.json()["stored_in"] == "database"
    assert cal_file.read_text() == before          # the container's disk is not written
    body = client.get("/api/rates/central").json()
    m = [x for x in body["IN"]["upcoming_meetings"] if x["date"] == day][0]
    assert D(m["outcome_rate"]) == D("0.0525") and m["note"] == "cut 25 bps"

    # Survives a "restart": a fresh store on the same database sees it.
    from api import rate_outcomes_store
    rate_outcomes_store.set_store(rate_outcomes_store.RateOutcomeStore(outcome_db.engine))
    body = client.get("/api/rates/central").json()
    assert any(x["date"] == day and x["outcome_rate"] for x in body["IN"]["upcoming_meetings"])


def test_admin_edit_refused_without_a_database_or_a_meeting(client, monkeypatch):
    from api import rate_outcomes_store
    monkeypatch.setattr(rate_outcomes_store, "store", lambda: None)
    monkeypatch.setenv("ADMIN_RATE_UPDATE_TOKEN", "t0ken")
    h = {"X-Admin-Token": "t0ken"}
    day = _first_meeting("US")
    assert client.post("/api/admin/rate-update", headers=h,
                       json={"country": "US", "new_rate": "0.0375", "decision_date": day}).status_code == 503
    assert client.post("/api/admin/rate-update", headers=h,
                       json={"country": "US", "new_rate": "0.0375", "decision_date": "2026-01-02"}).status_code == 404
    assert client.post("/api/admin/rate-update", headers=h,
                       json={"country": "US", "new_rate": "6.25", "decision_date": day}).status_code == 400
    assert client.post("/api/admin/rate-update", headers={"X-Admin-Token": "nope"},
                       json={"country": "US", "new_rate": "0.0375", "decision_date": day}).status_code == 403
