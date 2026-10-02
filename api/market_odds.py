"""Market odds for the next central-bank decisions, from Polymarket.

Polymarket runs a market on each Fed (FOMC) and RBI (MPC) rate decision:
one Yes/No contract per outcome ("25 bps decrease", "No change", ...).
The price of Yes is the crowd's chance of that outcome. Right time to
borrow uses these odds instead of asking people what they expect, which
was asking them for the answer.

The Gamma API is public and needs no key. Only the search below is sent:
nothing about the user leaves the server.

Odds are fetched on request and kept 30 minutes. A failed fetch keeps the
last good odds for up to a day, then reports none, and the tool says so.
MARKET_ODDS=off turns fetching off (tests, CI); MARKET_ODDS_FILE=<path>
answers from a saved list of Gamma events instead (offline work, demos).

An event is used only when every one of its outcomes reads as a move in
basis points and the chances add up to about 1; anything else (a market
on the year's number of cuts, a thin or half-listed one) is left out.
"""
from __future__ import annotations

import json
import logging
import os
import re
import threading
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal, InvalidOperation
from typing import Any, Callable, Optional

import httpx

log = logging.getLogger(__name__)
D = Decimal

GAMMA = "https://gamma-api.polymarket.com"
SOURCE = "Polymarket"
TIMEOUT_SECONDS = 6
FRESH_FOR = timedelta(minutes=30)
KEEP_FOR = timedelta(hours=24)
# Below this much traded, a price is one person's guess.
MIN_VOLUME_USD = D("1000")
USER_AGENT = "RightDue-odds/1.0 (+https://github.com/Hasen1506/Debt-and-Emi-restructuring)"
# An event's end date and the meeting it is about can differ by a day or
# two; it is matched to a calendar meeting this close.
MATCH_DAYS = 10

# Where to look, per country: the topic's tag, then a text search.
_QUERIES: dict[str, list[tuple[str, dict[str, str]]]] = {
    "US": [
        ("/events", {"tag_slug": "fed-rates", "closed": "false", "limit": "50"}),
        ("/public-search", {"q": "Fed decision", "events_status": "active", "limit_per_type": "20"}),
    ],
    "IN": [
        ("/events", {"tag_slug": "rbi", "closed": "false", "limit": "50"}),
        ("/public-search", {"q": "RBI decision", "events_status": "active", "limit_per_type": "20"}),
    ],
}
_TITLE = {
    "US": re.compile(r"\b(fed|fomc|federal reserve)\b.*\b(decision|meeting)\b", re.I),
    "IN": re.compile(r"\b(rbi|reserve bank of india|mpc)\b.*\b(decision|meeting|repo)\b", re.I),
}

_HOLD = re.compile(r"\b(no change|unchanged|hold|holds|pause|maintain)\b", re.I)
_DOWN = r"(decrease|cut|lower|reduction|reduce)"
_UP = r"(increase|hike|raise|rise)"
_BPS = r"(\d{1,3})\s*\+?\s*(?:bps|bp|basis points?)"
# "25 bps decrease", or a question's "decrease interest rates by 25 bps".
_MOVE = re.compile(rf"{_BPS}\s*{_DOWN}|{_DOWN}s?\b[^\d]{{0,30}}?{_BPS}|{_BPS}\s*{_UP}|{_UP}s?\b[^\d]{{0,30}}?{_BPS}", re.I)


@dataclass(frozen=True)
class Outcome:
    bps: int            # the move: -25 is a 0.25% cut
    label: str          # as the market words it
    chance: Decimal     # 0–1; an event's chances sum to 1


@dataclass(frozen=True)
class MeetingOdds:
    day: date
    title: str
    url: str
    volume: Decimal
    outcomes: tuple[Outcome, ...]

    @property
    def cut_chance(self) -> Decimal:
        return sum((o.chance for o in self.outcomes if o.bps < 0), D("0"))

    @property
    def rise_chance(self) -> Decimal:
        return sum((o.chance for o in self.outcomes if o.bps > 0), D("0"))


@dataclass(frozen=True)
class OddsReading:
    country: str
    meetings: tuple[MeetingOdds, ...]
    fetched_at: datetime


def move_bps(label: str) -> Optional[int]:
    """'25 bps decrease' → -25, 'No change' → 0, '50+ bps cut' → -50.
    None when the label isn't a single move."""
    if _HOLD.search(label):
        return 0
    m = _MOVE.search(label)
    if not m:
        return None
    g = m.groups()
    if g[0]:
        return -int(g[0])
    if g[3]:
        return -int(g[3])
    if g[4]:
        return int(g[4])
    return int(g[7])


def _json_list(v: Any) -> list:
    """Gamma sends `outcomes` and `outcomePrices` as JSON text."""
    if isinstance(v, list):
        return v
    if isinstance(v, str):
        try:
            out = json.loads(v)
        except ValueError:
            return []
        return out if isinstance(out, list) else []
    return []


def _when(v: Any) -> Optional[date]:
    if not isinstance(v, str) or len(v) < 10:
        return None
    try:
        return date.fromisoformat(v[:10])
    except ValueError:
        return None


def _num(v: Any) -> Optional[Decimal]:
    try:
        d = D(str(v))
    except (InvalidOperation, ValueError):
        return None
    return d if d.is_finite() else None


def parse_event(event: dict, country: str, today: date, calendar: list[date]) -> Optional[MeetingOdds]:
    """One Gamma event → the odds of each move at that meeting, or None
    when it isn't a usable rate-decision market."""
    title = str(event.get("title") or "")
    if not _TITLE[country].search(title) or event.get("closed"):
        return None
    end = _when(event.get("endDate"))
    if end is None:
        return None
    near = [d for d in calendar if abs((d - end).days) <= MATCH_DAYS]
    day = min(near, key=lambda d: abs((d - end).days)) if near else end
    if day < today:
        return None
    volume = _num(event.get("volume")) or D("0")
    if volume < MIN_VOLUME_USD:
        return None
    moves: dict[int, tuple[str, Decimal]] = {}
    markets = event.get("markets")
    if not isinstance(markets, list):
        return None
    for m in markets:
        if not isinstance(m, dict):
            return None
        if m.get("closed") or m.get("archived"):
            return None
        label = str(m.get("groupItemTitle") or m.get("question") or "")
        bps = move_bps(label)
        names = [str(x).lower() for x in _json_list(m.get("outcomes"))]
        prices = _json_list(m.get("outcomePrices"))
        if bps is None or "yes" not in names or len(prices) != len(names):
            return None
        chance = _num(prices[names.index("yes")])
        if chance is None or not D("0") <= chance <= D("1"):
            return None
        old = moves.get(bps)
        moves[bps] = (old[0] if old else label, (old[1] if old else D("0")) + chance)
    total = sum((c for _, c in moves.values()), D("0"))
    if len(moves) < 2 or not D("0.85") <= total <= D("1.15"):
        return None
    slug = str(event.get("slug") or "")
    return MeetingOdds(
        day=day,
        title=title,
        url=f"https://polymarket.com/event/{slug}" if slug else "https://polymarket.com",
        volume=volume.quantize(D("1")),
        outcomes=tuple(
            Outcome(bps=b, label=label, chance=(c / total).quantize(D("0.0001")))
            for b, (label, c) in sorted(moves.items())
        ),
    )


def parse_events(events: list, country: str, today: date, calendar: list[date]) -> list[MeetingOdds]:
    """Usable meetings, soonest first; one per meeting day (the most traded)."""
    best: dict[date, MeetingOdds] = {}
    for e in events:
        if not isinstance(e, dict):
            continue
        m = parse_event(e, country, today, calendar)
        if m and (m.day not in best or m.volume > best[m.day].volume):
            best[m.day] = m
    return [best[d] for d in sorted(best)]


def _get(path: str, params: dict[str, str]) -> Any:
    # Offline work and demos: canned Gamma events from a file.
    canned = os.environ.get("MARKET_ODDS_FILE")
    if canned:
        with open(canned, encoding="utf-8") as f:
            events = json.load(f)
        return events if path == "/events" else {"events": events}
    with httpx.Client(timeout=TIMEOUT_SECONDS, headers={"User-Agent": USER_AGENT}) as c:
        r = c.get(GAMMA + path, params=params)
        r.raise_for_status()
        return r.json()


def fetch_events(country: str, get: Callable[[str, dict[str, str]], Any] = _get) -> list:
    """Every candidate event the searches turn up. Raises when none answer."""
    found: list = []
    answered = False
    for path, params in _QUERIES[country]:
        try:
            body = get(path, params)
        except (httpx.HTTPError, ValueError) as e:
            log.warning("market odds %s %s failed: %s", country, path, e)
            continue
        candidates = body if isinstance(body, list) else body.get("events") if isinstance(body, dict) else None
        if not isinstance(candidates, list):
            continue
        answered = True
        found.extend(candidates)
    if not answered:
        raise RuntimeError("Polymarket did not answer")
    return found


def calendar(country: str) -> list[date]:
    """The published meeting days, to date each market by."""
    from api import rates_feed
    return rates_feed._meetings(country)


class OddsCache:
    """Last good odds per country, refreshed on request when stale."""

    def __init__(self, get: Callable[[str, dict[str, str]], Any] = _get,
                 now: Callable[[], datetime] = lambda: datetime.now(timezone.utc)) -> None:
        self._get = get
        self._now = now
        self._lock = threading.Lock()
        self._good: dict[str, OddsReading] = {}
        self._next_try: dict[str, datetime] = {}

    def clear(self) -> None:
        with self._lock:
            self._good.clear()
            self._next_try.clear()

    def _kept(self, country: str, now: datetime) -> Optional[OddsReading]:
        good = self._good.get(country)
        if not good or now - good.fetched_at >= KEEP_FOR:
            return None
        upcoming = tuple(m for m in good.meetings if m.day >= now.date())
        if not upcoming:
            return None
        return good if upcoming == good.meetings else OddsReading(country, upcoming, good.fetched_at)

    def odds(self, country: str, calendar: list[date]) -> Optional[OddsReading]:
        """None when there are no odds to be had (off, or nothing usable
        within the last day)."""
        if os.environ.get("MARKET_ODDS", "on").lower() == "off" or country not in _QUERIES:
            return None
        now = self._now()
        with self._lock:
            if now < self._next_try.get(country, now - timedelta(seconds=1)):
                return self._kept(country, now)
            # Claimed before fetching, so requests arriving meanwhile use
            # what is kept instead of fetching too.
            self._next_try[country] = now + timedelta(minutes=1)
        try:
            meetings: Optional[list[MeetingOdds]] = parse_events(
                fetch_events(country, self._get), country, now.date(), calendar)
        except RuntimeError as e:
            log.warning("market odds %s: %s", country, e)
            meetings = None
        with self._lock:
            if meetings:
                self._good[country] = OddsReading(country, tuple(meetings), now)
            # Polymarket answered: ask again when the odds go stale. It
            # didn't: try again in a minute.
            if meetings is not None:
                self._next_try[country] = now + FRESH_FOR
            return self._kept(country, now)


CACHE = OddsCache()


def reading_out(country: str, reading: Optional[OddsReading]) -> dict:
    """The odds as the API sends them."""
    return {
        "country": country,
        "source": SOURCE,
        "fetched_at": reading.fetched_at.isoformat(timespec="seconds") if reading else None,
        "meetings": [
            {
                "date": m.day.isoformat(), "title": m.title, "url": m.url, "volume": m.volume,
                "cut_chance": m.cut_chance, "rise_chance": m.rise_chance,
                "outcomes": [{"bps": o.bps, "label": o.label, "chance": o.chance} for o in m.outcomes],
            }
            for m in (reading.meetings if reading else ())
        ],
    }
