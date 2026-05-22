"""GET /api/rates/central · POST /api/admin/rate-update.

Central-bank policy rates (RBI repo + Fed funds) and the published MPC /
FOMC meeting calendar. Source of truth is `api/data/central_bank_calendar.json`,
read at request time so a dev can edit the file and have all clients
pick up the change on next fetch.

Architecture: backend owns one record per central bank; web + future
mobile clients hit GET /api/rates/central with a short cache. After each
MPC / FOMC meeting, the dev POSTs the new outcome to
/api/admin/rate-update with the ADMIN_RATE_UPDATE_TOKEN env-var token.
Every connected client sees the update on its next poll — no per-install
push needed.

Proper auth (JWT, RBAC) ships with the broader auth deferral. For now,
a single shared env-var token is sufficient: only the dev knows it, the
endpoint is mutation-only, and the data is non-PII.
"""

import json
import os
from datetime import date, datetime
from decimal import Decimal
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, Header, HTTPException

from api.schemas import _Base


router = APIRouter(tags=["rates"])

_DATA_FILE = Path(__file__).parent.parent / "data" / "central_bank_calendar.json"


class MeetingEntry(_Base):
    date: str
    outcome_rate: Optional[Decimal]
    note: str


class CountryRateEntry(_Base):
    country: str  # "IN" | "US"
    current_rate: Decimal
    updated_at: str
    upcoming_meetings: list[MeetingEntry]
    next_meeting_date: Optional[str]
    days_until_next: Optional[int]


class CentralRatesResponse(_Base):
    last_updated: str
    IN: CountryRateEntry  # noqa: N815 - intentional country-code field
    US: CountryRateEntry  # noqa: N815


class RateUpdateRequest(_Base):
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


def _save_calendar(data: dict) -> None:
    _DATA_FILE.write_text(json.dumps(data, indent=2, sort_keys=False))


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


@router.get("/rates/central", response_model=CentralRatesResponse)
def get_central_rates() -> CentralRatesResponse:
    """Current policy rates + upcoming meeting schedule for RBI + Fed.
    Clients should cache for ~1 hour; meeting decisions land 6-8x/year
    per central bank so the data is intentionally slow-moving."""
    cal = _load_calendar()
    today = date.today()
    in_meetings, in_next, in_days = _upcoming_for("IN", cal, today)
    us_meetings, us_next, us_days = _upcoming_for("US", cal, today)

    in_cur = cal.get("current_rates", {}).get("IN", {})
    us_cur = cal.get("current_rates", {}).get("US", {})

    return CentralRatesResponse(
        last_updated=cal.get("last_updated", ""),
        IN=CountryRateEntry(
            country="IN",
            current_rate=Decimal(str(in_cur.get("repo", "0"))),
            updated_at=in_cur.get("updated_at", ""),
            upcoming_meetings=in_meetings,
            next_meeting_date=in_next,
            days_until_next=in_days,
        ),
        US=CountryRateEntry(
            country="US",
            current_rate=Decimal(str(us_cur.get("fed_funds_upper", "0"))),
            updated_at=us_cur.get("updated_at", ""),
            upcoming_meetings=us_meetings,
            next_meeting_date=us_next,
            days_until_next=us_days,
        ),
    )


@router.post("/admin/rate-update")
def post_rate_update(
    req: RateUpdateRequest,
    x_admin_token: str = Header(default=""),
) -> dict:
    """Dev-only endpoint to record a central-bank decision. The dev posts
    after each MPC / FOMC meeting; all clients see the new rate on next
    poll of /rates/central. Token check is via X-Admin-Token header
    matched against ADMIN_RATE_UPDATE_TOKEN env var. Returns the updated
    record for confirmation.
    """
    expected = os.environ.get("ADMIN_RATE_UPDATE_TOKEN", "")
    if not expected or x_admin_token != expected:
        raise HTTPException(status_code=403, detail="Invalid admin token.")
    if req.country not in ("IN", "US"):
        raise HTTPException(status_code=400, detail="country must be IN or US.")
    try:
        date.fromisoformat(req.decision_date)
    except ValueError:
        raise HTTPException(status_code=400, detail="decision_date must be YYYY-MM-DD.")

    cal = _load_calendar()
    cal.setdefault("current_rates", {})
    cur_key = "repo" if req.country == "IN" else "fed_funds_upper"
    cal["current_rates"][req.country] = {
        cur_key: str(req.new_rate),
        "updated_at": req.decision_date,
    }
    # Mark the meeting outcome in-place if we have it on file.
    for m in cal.get("meetings", {}).get(req.country, []):
        if m["date"] == req.decision_date:
            m["outcome_rate"] = str(req.new_rate)
            if req.note:
                m["note"] = req.note
            break

    cal["last_updated"] = datetime.utcnow().date().isoformat()
    _save_calendar(cal)
    return {
        "country": req.country,
        "new_rate": str(req.new_rate),
        "decision_date": req.decision_date,
    }
