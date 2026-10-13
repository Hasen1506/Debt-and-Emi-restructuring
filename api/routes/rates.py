"""GET /api/rates/central · GET /api/rates/feed-health · POST /api/admin/rate-update.

Central-bank policy rates (RBI repo + Fed funds) and the published MPC /
FOMC meeting calendar.

Current rates come from engine/policy_rates.py: the verified table plus
decisions the weekly GitHub Action found since (api/rates_feed.py reads
the committed api/data/policy_rates_live.json at start). Each rate carries
`as_of`, the day it was last known to be current, so screens can show it.
The meeting calendar is `api/data/central_bank_calendar.json`, updated
once a year; outcomes an admin records are kept in Postgres
(api/rate_outcomes_store.py) and laid over it.

(`/rates/odds`, Polymarket's odds for the coming decisions, was retired with
the Right time tool in roadmap PR I.)

`/admin/rate-update` records a meeting's outcome in the database (it used
to write the calendar file on the container's disk, lost on every deploy:
grill #61). It does not change the rate history: corrections to that go
in the verified table, where they are reviewed.
"""

import hmac
import json
import os
from datetime import date
from decimal import Decimal
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, Header, HTTPException
from fastapi.responses import JSONResponse

from api import rate_outcomes_store, rates_feed
from api.schemas import _Base, _In
from engine import policy_rates
from engine.models import Country


router = APIRouter(tags=["rates"])

_DATA_FILE = Path(__file__).parent.parent / "data" / "central_bank_calendar.json"


class MeetingEntry(_Base):
    date: str
    outcome_rate: Optional[Decimal]
    note: str


class CountryRateEntry(_Base):
    country: str  # "IN" | "US"
    current_rate: Decimal
    updated_at: str               # the decision that set current_rate
    as_of: str                    # last day the rate was known to be current
    source: str
    upcoming_meetings: list[MeetingEntry]
    next_meeting_date: Optional[str]
    days_until_next: Optional[int]


class CentralRatesResponse(_Base):
    last_updated: str
    IN: CountryRateEntry  # noqa: N815 - intentional country-code field
    US: CountryRateEntry  # noqa: N815


class RateUpdateRequest(_In):
    country: str          # "IN" or "US"
    new_rate: Decimal     # decimal, e.g. 0.0625
    decision_date: str    # YYYY-MM-DD — which meeting this was the outcome of
    note: Optional[str] = None


def _load_calendar() -> dict:
    """Read + parse the calendar JSON. Raises 500 on malformed file —
    the file is dev-edited so corruption should surface loudly."""
    if not _DATA_FILE.exists():
        raise HTTPException(status_code=500, detail="Central-bank calendar missing.")
    try:
        return json.loads(_DATA_FILE.read_text())
    except json.JSONDecodeError as e:
        raise HTTPException(status_code=500, detail=f"Calendar JSON malformed: {e}")


async def _with_outcomes(cal: dict) -> dict:
    """The calendar with admin-recorded outcomes (database) laid over it."""
    st = rate_outcomes_store.store()
    if st is None:
        return cal
    try:
        stored = await st.all()
    except Exception:  # noqa: BLE001 - a database hiccup must not hide the calendar
        return cal
    if not stored:
        return cal
    meetings = {
        c: [dict(m, **({"outcome_rate": str(stored[(c, m["date"])][0])} if (c, m["date"]) in stored else {}),
                 **({"note": stored[(c, m["date"])][1]} if (c, m["date"]) in stored and stored[(c, m["date"])][1] else {}))
            for m in ms]
        for c, ms in cal.get("meetings", {}).items()
    }
    return dict(cal, meetings=meetings)


def _upcoming_for(country: str, calendar: dict, today: date) -> tuple[list[MeetingEntry], Optional[str], Optional[int]]:
    """Filter meetings to upcoming, return them + next-meeting metadata."""
    today_iso = today.isoformat()
    raw = calendar.get("meetings", {}).get(country, [])
    upcoming = [m for m in raw if m["date"] >= today_iso]
    next_iso = upcoming[0]["date"] if upcoming else None
    days_until = None
    if next_iso:
        days_until = (date.fromisoformat(next_iso) - today).days
    entries = [
        MeetingEntry(
            date=m["date"],
            outcome_rate=(Decimal(str(m["outcome_rate"])) if m.get("outcome_rate") else None),
            note=m.get("note", ""),
        )
        for m in upcoming[:6]  # six meetings is roughly a year out for either bank
    ]
    return entries, next_iso, days_until


def _country_entry(country: Country, cal: dict, today: date) -> CountryRateEntry:
    meetings, next_iso, days = _upcoming_for(country.value, cal, today)
    decided = [(d, r) for d, r in policy_rates.history(country) if d <= today]
    return CountryRateEntry(
        country=country.value,
        current_rate=decided[-1][1],
        updated_at=decided[-1][0].isoformat(),
        as_of=policy_rates.rates_as_of(country).isoformat(),
        source=rates_feed.source_label(country),
        upcoming_meetings=meetings,
        next_meeting_date=next_iso,
        days_until_next=days,
    )


@router.get("/rates/central", response_model=CentralRatesResponse)
async def get_central_rates() -> CentralRatesResponse:
    """Current policy rates + upcoming meeting schedule for RBI + Fed.
    Clients should cache for ~1 hour; meeting decisions land 6-8x/year
    per central bank so the data is intentionally slow-moving."""
    cal = await _with_outcomes(_load_calendar())
    today = date.today()
    return CentralRatesResponse(
        last_updated=cal.get("last_updated", ""),
        IN=_country_entry(Country.IN, cal, today),
        US=_country_entry(Country.US, cal, today),
    )


@router.get("/rates/feed-health")
def get_feed_health() -> JSONResponse:
    """Last good fetch per source, its age and any error.

    503 when a source has had no good fetch for 24 hours (or never), so a
    free uptime monitor can alert on the status code alone. The app keeps
    working meanwhile on the last good values.
    """
    body = rates_feed.feed.health(rates_feed.enabled())
    return JSONResponse(body, status_code=503 if body["status"] == "degraded" else 200)


@router.post("/admin/rate-update")
async def post_rate_update(
    req: RateUpdateRequest,
    x_admin_token: str = Header(default=""),
) -> dict:
    """Admin only: record a scheduled meeting's outcome, in the database.

    Current rates come from the weekly feed and the verified table, not
    from here. The token is the X-Admin-Token header, matched against
    ADMIN_RATE_UPDATE_TOKEN. 404 when the date is not a meeting on the
    calendar; 503 when there is no database to keep the edit in.
    """
    expected = os.environ.get("ADMIN_RATE_UPDATE_TOKEN", "")
    if not expected or not hmac.compare_digest(x_admin_token.encode(), expected.encode()):
        raise HTTPException(status_code=403, detail="Invalid admin token.")
    if req.country not in ("IN", "US"):
        raise HTTPException(status_code=400, detail="country must be IN or US.")
    try:
        day = date.fromisoformat(req.decision_date)
    except ValueError:
        raise HTTPException(status_code=400, detail="decision_date must be YYYY-MM-DD.")
    if not (Decimal("0") <= req.new_rate <= policy_rates.MAX_RATE):
        raise HTTPException(status_code=400, detail="new_rate must be a fraction between 0 and 0.20, e.g. 0.0625.")

    cal = _load_calendar()
    if not any(m["date"] == req.decision_date for m in cal.get("meetings", {}).get(req.country, [])):
        raise HTTPException(status_code=404, detail="No scheduled meeting on that date in the calendar.")
    st = rate_outcomes_store.store()
    if st is None:
        raise HTTPException(
            status_code=503,
            detail="No database (DATABASE_URL unset), so the outcome could not be kept. "
                   "Edits are no longer written to the container's disk, which a redeploy wipes.",
        )
    await st.record(req.country, day, req.new_rate, req.note)
    return {
        "country": req.country,
        "new_rate": str(req.new_rate),
        "decision_date": req.decision_date,
        "stored_in": "database",
    }
