"""Polymarket odds for the coming rate decisions, and Right time on them.

The fetcher is replaced with canned Gamma API answers, shaped as Gamma
sends them: `outcomes` and `outcomePrices` are JSON text.
"""
import json
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal

import pytest

from api import market_odds
from api.market_odds import OddsCache, move_bps, parse_event, parse_events

D = Decimal
TODAY = date(2026, 10, 2)
CAL_IN = [date(2026, 10, 7), date(2026, 12, 5), date(2027, 2, 4)]
CAL_US = [date(2026, 10, 28), date(2026, 12, 9), date(2027, 1, 27)]


def _market(label, yes):
    return {
        "question": f"{label}?",
        "groupItemTitle": label,
        "outcomes": json.dumps(["Yes", "No"]),
        "outcomePrices": json.dumps([str(yes), str(round(1 - yes, 4))]),
        "closed": False,
    }


def _event(title, end, odds, slug="fed-decision-in-october", volume="2500000", closed=False):
    return {
        "title": title, "slug": slug, "endDate": f"{end}T12:00:00Z", "closed": closed,
        "volume": volume, "markets": [_market(label, p) for label, p in odds],
    }


FED_OCT = _event("Fed decision in October?", "2026-10-28", [
    ("50+ bps decrease", 0.02), ("25 bps decrease", 0.81), ("No change", 0.165), ("25+ bps increase", 0.005),
])
FED_DEC = _event("Fed decision in December?", "2026-12-09", [
    ("50+ bps decrease", 0.05), ("25 bps decrease", 0.55), ("No change", 0.39), ("25+ bps increase", 0.01),
], slug="fed-decision-in-december")
RBI_OCT = _event("RBI decision in October?", "2026-10-06", [
    ("25 bps decrease", 0.12), ("No change", 0.86), ("25 bps increase", 0.02),
], slug="rbi-decision-in-october", volume="48000")
RBI_DEC = _event("RBI decision in December?", "2026-12-05", [
    ("25 bps decrease", 0.62), ("No change", 0.37), ("25 bps increase", 0.01),
], slug="rbi-decision-in-december", volume="21000")


def test_labels_read_as_moves():
    assert move_bps("25 bps decrease") == -25
    assert move_bps("50+ bps decrease") == -50
    assert move_bps("No change") == 0
    assert move_bps("25+ bps increase") == 25
    assert move_bps("Will the Fed decrease interest rates by 25 bps after the October 2026 meeting?") == -25
    # A market on how many cuts this year is not a single decision.
    assert move_bps("3 (75 bps)") is None


def test_an_event_becomes_the_chance_of_each_move():
    m = parse_event(FED_OCT, "US", TODAY, CAL_US)
    assert m is not None and m.day == date(2026, 10, 28)
    assert [o.bps for o in m.outcomes] == [-50, -25, 0, 25]
    assert m.cut_chance == D("0.83")
    assert m.url == "https://polymarket.com/event/fed-decision-in-october"


def test_end_date_is_matched_to_the_calendar_meeting():
    """Gamma ends the RBI market a day early; the decision is on the 7th."""
    m = parse_event(RBI_OCT, "IN", TODAY, CAL_IN)
    assert m.day == date(2026, 10, 7)


@pytest.mark.parametrize("bad", [
    {**FED_OCT, "title": "How many Fed rate cuts in 2026?"},                      # not a decision
    {**FED_OCT, "closed": True},                                                  # settled
    {**FED_OCT, "endDate": "2026-09-16T12:00:00Z"},                               # already decided
    {**FED_OCT, "volume": "200"},                                                 # too thin to mean much
    _event("Fed decision in October?", "2026-10-28", [("25 bps decrease", 0.5)]),  # one outcome only
    _event("Fed decision in October?", "2026-10-28",
           [("25 bps decrease", 0.5), ("No change", 0.2)]),                       # chances sum to 0.7
    _event("Fed decision in October?", "2026-10-28",
           [("25 bps decrease", 0.5), ("Powell resigns", 0.5)]),                  # an outcome that isn't a move
    _event("RBI decision in October?", "2026-10-06", [("No change", 0.9), ("25 bps decrease", 0.1)]),  # wrong bank
])
def test_unusable_events_are_left_out(bad):
    assert parse_event(bad, "US", TODAY, CAL_US) is None


def test_one_market_per_meeting_soonest_first():
    small = {**FED_OCT, "volume": "5000", "slug": "other"}
    got = parse_events([FED_DEC, small, FED_OCT, "junk"], "US", TODAY, CAL_US)
    assert [m.day for m in got] == [date(2026, 10, 28), date(2026, 12, 9)]
    assert got[0].url.endswith("fed-decision-in-october")


class _Gamma:
    """Answers the tag listing and the search like Gamma does."""

    def __init__(self, events, fail=False):
        self.events, self.fail, self.calls = events, fail, 0

    def __call__(self, path, params):
        self.calls += 1
        if self.fail:
            import httpx
            raise httpx.ConnectError("down")
        return self.events if path == "/events" else {"events": self.events}


def _cache(gamma, clock):
    return OddsCache(get=gamma, now=lambda: clock[0])


def test_odds_are_kept_half_an_hour_then_refreshed(monkeypatch):
    monkeypatch.setenv("MARKET_ODDS", "on")
    clock = [datetime(2026, 10, 2, 9, tzinfo=timezone.utc)]
    gamma = _Gamma([RBI_OCT, RBI_DEC])
    c = _cache(gamma, clock)
    first = c.odds("IN", CAL_IN)
    assert [m.day for m in first.meetings] == [date(2026, 10, 7), date(2026, 12, 5)]
    assert gamma.calls == 2
    clock[0] += timedelta(minutes=20)
    assert c.odds("IN", CAL_IN) is first and gamma.calls == 2
    clock[0] += timedelta(minutes=15)
    assert c.odds("IN", CAL_IN) is not first and gamma.calls == 4


def test_a_failed_fetch_keeps_the_last_odds_for_a_day(monkeypatch):
    monkeypatch.setenv("MARKET_ODDS", "on")
    clock = [datetime(2026, 10, 2, 9, tzinfo=timezone.utc)]
    gamma = _Gamma([RBI_OCT])
    c = _cache(gamma, clock)
    good = c.odds("IN", CAL_IN)
    gamma.fail = True
    clock[0] += timedelta(hours=2)
    assert c.odds("IN", CAL_IN) is good
    clock[0] += timedelta(hours=23)
    assert c.odds("IN", CAL_IN) is None


def test_off_means_no_fetch(monkeypatch):
    monkeypatch.setenv("MARKET_ODDS", "off")
    gamma = _Gamma([RBI_OCT])
    assert _cache(gamma, [datetime.now(timezone.utc)]).odds("IN", CAL_IN) is None
    assert gamma.calls == 0


@pytest.fixture()
def live_odds(monkeypatch):
    """The API's cache answering from canned Gamma events."""
    def use(events, country):
        monkeypatch.setenv("MARKET_ODDS", "on")
        cache = OddsCache(get=_Gamma(events), now=lambda: datetime(2026, 10, 2, 9, tzinfo=timezone.utc))
        monkeypatch.setattr(market_odds, "CACHE", cache)
        monkeypatch.setattr(market_odds, "calendar", lambda c: CAL_IN if c == "IN" else CAL_US)
        monkeypatch.setattr("api.routes.decisions.date", type("d", (), {"today": staticmethod(lambda: TODAY)}))
    return use


def test_odds_route(client, live_odds):
    live_odds([RBI_OCT, RBI_DEC], "IN")
    body = client.get("/api/rates/odds?country=IN").json()
    assert body["source"] == "Polymarket"
    assert [m["date"] for m in body["meetings"]] == ["2026-10-07", "2026-12-05"]
    assert D(body["meetings"][1]["cut_chance"]) == D("0.62")
    assert client.get("/api/rates/odds?country=XX").status_code == 422


# A ₹15 lakh fixed-rate loan over five years: a 0.25% cut saves about ₹9,900.
BASE = {"current_rate": "0.09", "principal": "1500000", "tenure_months": 60,
        "country": "IN", "monthly_room": "60000"}


def test_wait_when_a_cut_is_likely_by_a_decision_you_can_wait_for(client, live_odds):
    """Fixed rate, can wait 3 months: the December cut is 62% likely on
    its own, 65% with October's chances too."""
    live_odds([RBI_OCT, RBI_DEC], "IN")
    r = client.post("/api/right-time-to-borrow", json={**BASE, "urgency": "3m_ok"})
    assert r.status_code == 200, r.text
    v = r.json()
    assert v["verdict"] == "wait", v["detail"]
    assert v["wait_until"] == "2026-12-05"
    assert D(v["cut_chance"]) == D("0.652")
    assert "chance of a cut by the RBI decision on 05 Dec 2026" in v["detail"]
    assert D(v["saving_if_cut"]) > D(v["estimated_savings"]) > 0
    assert len(v["odds"]["meetings"]) == 2


def test_a_floating_rate_gains_nothing_from_waiting(client, live_odds):
    live_odds([RBI_OCT, RBI_DEC], "IN")
    v = client.post("/api/right-time-to-borrow",
                    json={**BASE, "urgency": "6m_ok", "rate_type": "floating"}).json()
    assert v["verdict"] == "borrow_now"
    assert "floats with the RBI rate" in v["detail"]
    assert D(v["estimated_savings"]) == 0


def test_odds_for_the_next_meeting_only(client, live_odds):
    """No market on December yet: October's 12% is all there is."""
    live_odds([RBI_OCT], "IN")
    v = client.post("/api/right-time-to-borrow", json={**BASE, "urgency": "3m_ok"}).json()
    assert v["verdict"] == "borrow_now"
    assert "only a 12% chance of a cut by the RBI decision on 07 Oct 2026" in v["detail"]


def test_needing_it_now_points_to_a_floating_rate_when_a_cut_is_likely(client, live_odds):
    live_odds([FED_OCT], "US")
    v = client.post("/api/right-time-to-borrow", json={
        **BASE, "country": "US", "principal": "30000", "monthly_room": "2000", "urgency": "now"}).json()
    assert v["verdict"] == "borrow_now"
    assert "83% chance of a Fed cut on 28 Oct 2026" in v["detail"]
    assert "a floating rate would follow it down" in v["detail"]


def test_markets_leaning_to_a_rise_say_lock_in(client, live_odds):
    hike = _event("Fed decision in October?", "2026-10-28",
                  [("25 bps decrease", 0.05), ("No change", 0.55), ("25+ bps increase", 0.40)])
    live_odds([hike], "US")
    v = client.post("/api/right-time-to-borrow", json={
        **BASE, "country": "US", "principal": "30000", "monthly_room": "2000", "urgency": "3m_ok"}).json()
    assert v["verdict"] == "borrow_now"
    assert v["detail"].startswith("Markets lean to a rise: a 40% chance")


def test_no_odds_says_so_and_judges_on_todays_rate(client):
    v = client.post("/api/right-time-to-borrow", json={**BASE, "urgency": "3m_ok"}).json()
    assert v["verdict"] == "borrow_now"
    assert v["detail"].startswith("No market odds for the next RBI decision right now")
    assert v["odds"]["meetings"] == []


def test_a_likely_cut_too_small_to_matter(client, live_odds):
    """₹3 lakh over a year: the cut is likely but saves a few hundred."""
    live_odds([RBI_OCT, RBI_DEC], "IN")
    v = client.post("/api/right-time-to-borrow",
                    json={**BASE, "principal": "300000", "tenure_months": 12, "urgency": "3m_ok"}).json()
    assert v["verdict"] == "borrow_now"
    assert v["detail"].startswith("A cut is likely (65% by the RBI decision on 05 Dec 2026)")


def test_an_emi_that_doesnt_fit_still_says_so(client, live_odds):
    live_odds([RBI_OCT, RBI_DEC], "IN")
    v = client.post("/api/right-time-to-borrow",
                    json={**BASE, "urgency": "3m_ok", "monthly_room": "5000"}).json()
    assert v["verdict"] == "cant_afford"
    assert "On timing alone: Markets give a" in v["detail"]
