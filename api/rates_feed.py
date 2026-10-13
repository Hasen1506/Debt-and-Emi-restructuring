"""Central-bank policy rates fetched by a weekly GitHub Action, not by the app.

Two sources, both official and free:

- **US:** the Fed funds target range from FRED (series DFEDTARU and
  DFEDTARL, the keyless CSV download). FRED dates a change on the day it
  takes effect, the day after the FOMC announces it; the app dates
  decisions by the announcement, so each change is moved back to the FOMC
  meeting just before it (or one day when no meeting is on file).
- **India:** the RBI website's policy-rate panel. The repo rate is taken as
  the midpoint of the Standing Deposit Facility and Marginal Standing
  Facility rates, and must match the repo rate printed beside them when
  the page prints one. RBI publishes only today's value, so a change is
  dated to the MPC meeting of the last 14 days (or the day it was seen).

A fetch is accepted only if it agrees with the verified table in
engine/policy_rates.py where the two overlap, and every new decision is
plausible (see policy_rates.apply_live).

**Where it runs (grill #61).** Policy rates change only at scheduled
meetings (RBI MPC 6 a year, FOMC 8 a year), so the app no longer fetches
in a background thread inside a container that sleeps after 15 minutes
and loses its disk on every restart. `.github/workflows/policy-rates.yml`
runs `scripts/fetch_policy_rates.py` every Monday; it proposes a change to
the committed file `api/data/policy_rates_live.json` only when a rate
moved, when it is the first check after a scheduled meeting, or after 30
days (a heartbeat). The app reads that file once at start.

`GET /api/rates/feed-health` calls a source stale when a scheduled meeting
passed more than MEETING_GRACE ago without a check after it, or when its
last good check is older than MAX_AGE. RATES_FEED=off skips the file
(tests, CI).
"""
from __future__ import annotations

import csv
import html
import io
import json
import logging
import os
import re
import threading
import urllib.request
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal, InvalidOperation
from pathlib import Path
from typing import Callable, Optional

from engine import policy_rates
from engine.models import Country

log = logging.getLogger(__name__)
D = Decimal

FRED_URL = "https://fred.stlouisfed.org/graph/fredgraph.csv?id=DFEDTARU,DFEDTARL"
RBI_URL = "https://www.rbi.org.in/"
# Feed health: a meeting passed this long ago with no check after it, or a
# last good check older than MAX_AGE, makes a source "stale" (503).
MEETING_GRACE = timedelta(days=7)
MAX_AGE = timedelta(days=45)
# The weekly job proposes a commit at least this often even when nothing
# changed, so the file's age proves the job is still running.
HEARTBEAT = timedelta(days=30)
TIMEOUT_SECONDS = 20
MAX_BYTES = 3_000_000
USER_AGENT = "RightDue-rates/1.0 (+https://github.com/Hasen1506/Debt-and-Emi-restructuring)"
# How far back a new RBI rate is matched to a scheduled MPC meeting.
MPC_MATCH_DAYS = 14
_CALENDAR = Path(__file__).parent / "data" / "central_bank_calendar.json"
_DEFAULT_STORE = Path(__file__).parent / "data" / "policy_rates_live.json"


class FeedError(Exception):
    """A fetch that cannot be used. The message is shown on feed health."""


@dataclass(frozen=True)
class Reading:
    """What one good fetch established."""
    changes: list[tuple[date, Decimal]]   # decisions after the verified table
    current: Decimal
    as_of: date                           # the day the source vouches for
    detail: dict[str, str] = field(default_factory=dict)


# ── parsing ─────────────────────────────────────────────────────────────────

def _pct(text: str) -> Decimal:
    try:
        v = D(text.strip())
    except InvalidOperation:
        raise FeedError(f"not a number: {text!r}")
    return (v / 100).quantize(D("0.0001"))


def parse_fred_csv(text: str) -> dict[str, list[tuple[date, Decimal]]]:
    """Daily observations per series id, as fractions. '.' marks no value."""
    rows = list(csv.reader(io.StringIO(text.lstrip("﻿"))))
    if not rows or len(rows[0]) < 2 or rows[0][0].strip() not in ("DATE", "observation_date"):
        raise FeedError("FRED reply is not the expected CSV")
    ids = [h.strip() for h in rows[0][1:]]
    out: dict[str, list[tuple[date, Decimal]]] = {i: [] for i in ids}
    for row in rows[1:]:
        if not row or not row[0].strip():
            continue
        try:
            day = date.fromisoformat(row[0].strip())
        except ValueError:
            raise FeedError(f"FRED row has a bad date: {row[0]!r}")
        for sid, cell in zip(ids, row[1:]):
            if cell.strip() in ("", "."):
                continue
            out[sid].append((day, _pct(cell)))
    return out


def change_points(series: list[tuple[date, Decimal]]) -> list[tuple[date, Decimal]]:
    """Collapse a daily series to the days its value changed."""
    out: list[tuple[date, Decimal]] = []
    for day, v in sorted(series):
        if not out or out[-1][1] != v:
            out.append((day, v))
    return out


_RBI_LABELS = {
    "repo": r"Policy\s+Repo\s+Rate",
    "sdf": r"Standing\s+Deposit\s+Facility(?:\s*\(SDF\))?\s+Rate",
    "msf": r"Marginal\s+Standing\s+Facility(?:\s*\(MSF\))?\s+Rate",
}


def _page_text(page: str) -> str:
    page = re.sub(r"(?is)<(script|style)\b.*?</\1>", " ", page)
    text = html.unescape(re.sub(r"<[^>]+>", " ", page))
    return re.sub(r"\s+", " ", text)


def parse_rbi_rates(page: str) -> dict[str, Decimal]:
    """Policy rates printed on an RBI page, as fractions, by key."""
    text = _page_text(page)
    out = {}
    for key, label in _RBI_LABELS.items():
        m = re.search(label + r"\s*[:\-–]?\s*(\d{1,2}(?:\.\d{1,2})?)\s*%", text, re.I)
        if m:
            out[key] = _pct(m.group(1))
    return out


# ── turning a fetch into decisions ─────────────────────────────────────────

def _meetings(country: str) -> list[date]:
    try:
        cal = json.loads(_CALENDAR.read_text())
        return sorted(date.fromisoformat(m["date"]) for m in cal["meetings"][country])
    except (OSError, ValueError, KeyError) as e:
        log.warning("central-bank calendar unreadable: %s", e)
        return []


def fed_reading(text: str, meetings: list[date]) -> Reading:
    """Check FRED against the verified table and find later decisions."""
    data = parse_fred_csv(text)
    upper = change_points(data.get("DFEDTARU", []))
    if not upper:
        raise FeedError("FRED reply has no DFEDTARU values")
    lower = change_points(data.get("DFEDTARL", []))

    def fred_on(day: date) -> Optional[Decimal]:
        v = None
        for d, r in upper:
            if d > day:
                break
            v = r
        return v

    # Where FRED and the table overlap they must agree, a few days after
    # each announcement (FRED moves the day after, or after a weekend).
    table = policy_rates.FED_FUNDS_UPPER_US
    as_of = max(d for d, _ in data["DFEDTARU"])
    for i, (day, rate) in enumerate(table):
        probe = day + timedelta(days=4)
        if i + 1 < len(table) and probe >= table[i + 1][0]:
            probe = table[i + 1][0] - timedelta(days=1)
        if day < upper[0][0] or probe > as_of:
            continue                    # before FRED starts, or FRED not caught up
        seen = fred_on(probe)
        if seen is not None and seen != rate:
            raise FeedError(
                f"FRED shows {seen:.2%} on {probe}, the verified table {rate:.2%}; not used"
            )

    def announced(effective: date) -> date:
        near = [m for m in meetings if effective - timedelta(days=4) <= m < effective]
        return near[-1] if near else effective - timedelta(days=1)

    table_end = table[-1][0]
    changes = [(announced(d), r) for d, r in upper if announced(d) > table_end]
    detail = {"upper": str(upper[-1][1])}
    if lower:
        detail["lower"] = str(lower[-1][1])
    return Reading(changes=changes, current=upper[-1][1], as_of=as_of, detail=detail)


def rbi_reading(page: str, today: date, meetings: list[date],
                known: list[tuple[date, Decimal]]) -> Reading:
    """The repo rate from SDF/MSF, and whether it is a new decision.

    `known` is the history already accepted (table plus earlier fetches);
    a rate different from its last entry is a new decision.
    """
    got = parse_rbi_rates(page)
    if "sdf" not in got or "msf" not in got:
        raise FeedError("RBI page no longer shows the SDF and MSF rates")
    sdf, msf = got["sdf"], got["msf"]
    if not D("0") < msf - sdf <= D("0.0100"):
        raise FeedError(f"RBI corridor looks wrong: SDF {sdf:.2%}, MSF {msf:.2%}")
    repo = ((sdf + msf) / 2).quantize(D("0.0001"))
    if "repo" in got and got["repo"] != repo:
        raise FeedError(
            f"RBI repo rate {got['repo']:.2%} is not midway between SDF {sdf:.2%} "
            f"and MSF {msf:.2%}; not used"
        )
    table_end = policy_rates.REPO_RATE_IN[-1][0]
    changes = [(d, r) for d, r in known if d > table_end]
    if repo != known[-1][1]:
        recent = [m for m in meetings if today - timedelta(days=MPC_MATCH_DAYS) <= m <= today]
        day = recent[-1] if recent else today
        if day <= known[-1][0]:
            day = today
        changes.append((day, repo))
    detail = {"sdf": str(sdf), "msf": str(msf)}
    if "repo" in got:
        detail["printed_repo"] = str(got["repo"])
    return Reading(changes=changes, current=repo, as_of=today, detail=detail)


# ── fetching, storing, health ──────────────────────────────────────────────

def http_get(url: str) -> str:
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=TIMEOUT_SECONDS) as resp:  # noqa: S310 - fixed https URLs
        body = resp.read(MAX_BYTES + 1)
        if len(body) > MAX_BYTES:
            raise FeedError("reply too large")
        return body.decode(resp.headers.get_content_charset() or "utf-8", errors="replace")


@dataclass
class SourceState:
    key: str
    country: Country
    label: str
    url: str
    last_attempt: Optional[datetime] = None
    last_success: Optional[datetime] = None
    error: Optional[str] = None
    current: Optional[Decimal] = None
    as_of: Optional[date] = None
    detail: dict[str, str] = field(default_factory=dict)
    changes: list[tuple[date, Decimal]] = field(default_factory=list)

    def to_json(self, committed: bool = False) -> dict:
        """The stored form. `committed` drops the per-run fields (attempt
        time, error) so an unchanged check leaves the committed file alone."""
        out = {
            "last_attempt": self.last_attempt.isoformat() if self.last_attempt else None,
            "last_success": self.last_success.isoformat() if self.last_success else None,
            "error": self.error,
            "current": str(self.current) if self.current is not None else None,
            "as_of": self.as_of.isoformat() if self.as_of else None,
            "detail": self.detail,
            "changes": [[d.isoformat(), str(r)] for d, r in self.changes],
        }
        if committed:
            del out["last_attempt"], out["error"]
        return out

    def load(self, raw: dict) -> None:
        ts = lambda v: datetime.fromisoformat(v) if v else None  # noqa: E731
        self.last_attempt = ts(raw.get("last_attempt"))
        self.last_success = ts(raw.get("last_success"))
        self.error = raw.get("error")
        self.current = D(raw["current"]) if raw.get("current") else None
        self.as_of = date.fromisoformat(raw["as_of"]) if raw.get("as_of") else None
        self.detail = dict(raw.get("detail") or {})
        self.changes = [(date.fromisoformat(d), D(r)) for d, r in raw.get("changes", [])]


def _now() -> datetime:
    return datetime.now(timezone.utc)


class RatesFeed:
    def __init__(self, store_path: Path, get: Callable[[str], str] = http_get,
                 now: Callable[[], datetime] = _now):
        self.store_path = store_path
        self.get = get
        self.now = now
        self.sources = {
            "fred": SourceState("fred", Country.US, "Fed funds target (FRED)",
                                os.environ.get("FRED_CSV_URL", FRED_URL)),
            "rbi": SourceState("rbi", Country.IN, "RBI repo rate (rbi.org.in)",
                               os.environ.get("RBI_RATES_URL", RBI_URL)),
        }
        self._lock = threading.Lock()
        self.loaded_at: Optional[datetime] = None

    # Last good values survive a restart.
    def load(self) -> None:
        try:
            raw = json.loads(self.store_path.read_text())
        except FileNotFoundError:
            return
        except (OSError, ValueError) as e:
            log.warning("rates store unreadable, starting empty: %s", e)
            return
        for key, s in self.sources.items():
            if key in raw:
                try:
                    s.load(raw[key])
                    if s.last_success:
                        policy_rates.apply_live(s.country, s.changes, s.as_of or s.last_success.date())
                except (ValueError, KeyError, InvalidOperation, policy_rates.LiveRateError) as e:
                    log.warning("stored %s rates rejected: %s", key, e)
                    self.sources[key] = SourceState(s.key, s.country, s.label, s.url)

    def stored(self, committed: bool = False) -> dict:
        return {k: s.to_json(committed) for k, s in self.sources.items()}

    def _save(self, committed: bool = False) -> None:
        try:
            self.store_path.parent.mkdir(parents=True, exist_ok=True)
            tmp = self.store_path.with_suffix(".tmp")
            tmp.write_text(json.dumps(self.stored(committed), indent=2) + "\n")
            tmp.replace(self.store_path)
        except OSError as e:
            log.warning("rates store not saved: %s", e)

    def _read(self, s: SourceState) -> Reading:
        text = self.get(s.url)
        if s.key == "fred":
            return fed_reading(text, _meetings("US"))
        return rbi_reading(text, self.now().date(), _meetings("IN"),
                           policy_rates.history(Country.IN))

    def refresh(self, save: bool = True) -> None:
        """Fetch every source once. Never raises. `save=False` leaves the
        store alone (the weekly script decides whether to write)."""
        with self._lock:
            for s in self.sources.values():
                s.last_attempt = self.now()
                try:
                    r = self._read(s)
                    policy_rates.apply_live(s.country, r.changes, r.as_of)
                except Exception as e:  # noqa: BLE001 - a feed must never take the app down
                    s.error = str(e) if isinstance(e, (FeedError, policy_rates.LiveRateError)) \
                        else f"{type(e).__name__}: {e}"
                    log.warning("rate feed %s failed: %s", s.key, s.error)
                    continue
                s.last_success, s.error = s.last_attempt, None
                s.current, s.as_of, s.detail, s.changes = r.current, r.as_of, r.detail, r.changes
            if save:
                self._save()

    def status_of(self, s: SourceState, today: date) -> tuple[str, Optional[str]]:
        """("ok" | "stale" | "never", why) for one source."""
        checked = s.as_of or (s.last_success.date() if s.last_success else None)
        if checked is None:
            return "never", "no good check on file"
        if today - checked > MAX_AGE:
            return "stale", f"last good check {checked}, over {MAX_AGE.days} days ago"
        missed = missed_meeting(_meetings(s.country.value), checked, today)
        if missed:
            return "stale", f"no check since the {missed} meeting"
        return "ok", None

    def health(self, enabled: bool) -> dict:
        now = self.now()
        out = []
        for s in self.sources.values():
            if not enabled and s.last_success is None:
                status, why = "off", None
            else:
                status, why = self.status_of(s, now.date())
            out.append({
                "source": s.key,
                "label": s.label,
                "country": s.country.value,
                "status": status,
                "stale_reason": why,
                "last_attempt": s.last_attempt.isoformat() if s.last_attempt else None,
                "last_success": s.last_success.isoformat() if s.last_success else None,
                "age_hours": (round((now - s.last_success).total_seconds() / 3600, 1)
                              if s.last_success else None),
                "error": s.error,
                "current": str(s.current) if s.current is not None else None,
                "as_of": s.as_of.isoformat() if s.as_of else None,
                "detail": s.detail,
                "in_use_as_of": policy_rates.rates_as_of(s.country).isoformat(),
            })
        if not enabled:
            overall = "off"
        elif all(x["status"] == "ok" for x in out):
            overall = "ok"
        else:
            overall = "degraded"
        return {"status": overall, "checked_at": now.isoformat(), "checked_by": CHECKED_BY,
                "sources": out}


CHECKED_BY = "weekly GitHub Action (.github/workflows/policy-rates.yml)"


def missed_meeting(meetings: list[date], checked: date, today: date) -> Optional[date]:
    """The first scheduled meeting that ended more than MEETING_GRACE ago
    with no check after it, if any. A check on the meeting day itself does
    not count: the decision may be announced later that day."""
    for m in meetings:
        if checked <= m and m + MEETING_GRACE < today:
            return m
    return None


def should_commit(old: dict, new: dict, today: date) -> tuple[bool, str]:
    """Whether the weekly job should propose `new` (the committed form).

    Yes when a rate or a decision changed, on the first check after a
    scheduled meeting (it records "checked, no change"), when a source has
    no committed entry, or after HEARTBEAT. Otherwise no, so an ordinary
    week makes no commit and no redeploy.
    """
    countries = {"fred": "US", "rbi": "IN"}
    for key, entry in new.items():
        if entry.get("as_of") is None:
            continue                        # never fetched well: nothing to propose
        was = old.get(key) or {}
        if not was.get("as_of"):
            return True, f"{key}: first good check"
        for field_ in ("current", "changes", "detail"):
            if was.get(field_) != entry.get(field_):
                return True, f"{key}: {field_} changed"
        before, after = date.fromisoformat(was["as_of"]), date.fromisoformat(entry["as_of"])
        for m in _meetings(countries.get(key, "")):
            if before <= m < after:
                return True, f"{key}: first check after the {m} meeting"
        if after - before >= HEARTBEAT:
            return True, f"{key}: {HEARTBEAT.days}-day heartbeat"
    return False, "no change"


def source_label(country: Country) -> str:
    """Where the rate history in use comes from, for display."""
    s = feed.sources["rbi" if country is Country.IN else "fred"]
    if s.last_success and s.as_of == policy_rates.rates_as_of(country):
        return s.label
    return f"Official decisions, checked by hand on {policy_rates.LAST_VERIFIED:%d %b %Y}"


def enabled() -> bool:
    return os.environ.get("RATES_FEED", "on").lower() not in ("off", "0", "false", "no")


feed = RatesFeed(Path(os.environ.get("RATES_STORE_PATH", _DEFAULT_STORE)))


def start() -> None:
    """Read the committed rates file once. No thread, no network: the
    weekly GitHub Action does the fetching (grill #61)."""
    if not enabled():
        log.info("RATES_FEED is off; using the verified rate table only.")
        return
    feed.load()
    feed.loaded_at = feed.now()


def stop() -> None:
    """Nothing to stop any more; kept so api.main's lifespan is unchanged."""
