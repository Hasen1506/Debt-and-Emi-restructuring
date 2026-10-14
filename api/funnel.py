"""Counts-only funnel (A15, A18; design in docs/SETUP-FUNNEL.md).

What it is: a handful of named counters per day. The browser says "one more
person reached the EMI field" or "one more plan was saved"; the server adds
1 to that day's counter and forgets the request. There are no rows per
visitor, no user ids, no cookies, no IP addresses, no amounts and no free
text, so there is nothing personal to store, export or delete (DPDP Act
2023: data that can't identify anyone is not personal data). The privacy
notice should still say these counts are kept.

  POST /api/funnel        {"event": "...", "step"?, "field"?, "loan_kind"?, "country"?}  (no sign-in)
  GET  /api/funnel/admin  ?days=30  Authorization: Bearer FUNNEL_ADMIN_SECRET

Both answer 404 until FUNNEL_ENABLED=true. The web side sends only when it
was built with NEXT_PUBLIC_FUNNEL=1 (web/src/lib/funnel.ts).

Events:
  setup fields   field_focus | field_filled | field_left_empty | field_dont_know | field_abandon  (step + field)
  product (A15)  plan_saved | return_month2 | loan_check_finding_5k | loan_check_result
  fake doors     door_letter_shown | door_letter_notify | door_plus_shown | door_plus_notify  (A18)
"""
from __future__ import annotations

import hmac
import json
import logging
import os
import re
from datetime import date, datetime, timedelta
from typing import Annotated, Any, Optional
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Header, HTTPException, Query, Request
from fastapi.responses import Response
from sqlalchemy import Column, Date, Integer, MetaData, PrimaryKeyConstraint, String, Table, and_, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncEngine

log = logging.getLogger(__name__)
router = APIRouter(prefix="/funnel", tags=["funnel"])

FIELD_EVENTS = {"field_focus", "field_filled", "field_left_empty", "field_dont_know", "field_abandon"}
PRODUCT_EVENTS = {"plan_saved", "return_month2", "loan_check_finding_5k", "loan_check_result"}
DOOR_EVENTS = {"door_letter_shown", "door_letter_notify", "door_plus_shown", "door_plus_notify"}
EVENTS = FIELD_EVENTS | PRODUCT_EVENTS | DOOR_EVENTS
LOAN_KINDS = {"", "home_loan", "auto_loan", "personal_loan", "credit_card", "education_loan", "gold_loan", "bnpl"}
COUNTRIES = {"", "IN", "US"}
FIELD_RE = re.compile(r"^[a-z0-9_.]{1,40}$")
# A18: kill a fake door when fewer than this share of people who saw it tap "notify me".
DOOR_KILL_BELOW = 0.02
# Per-IP rate limit: api/security.py gives /api/funnel its own bucket (IP in memory only).
MAX_BODY = 512

metadata = MetaData()
counts = Table(
    "funnel_counts",
    metadata,
    Column("day", Date, nullable=False),
    Column("event", String(32), nullable=False),
    Column("step", Integer, nullable=False, default=0),
    Column("field", String(40), nullable=False, default=""),
    Column("loan_kind", String(20), nullable=False, default=""),
    Column("country", String(2), nullable=False, default=""),
    Column("n", Integer, nullable=False, default=0),
    PrimaryKeyConstraint("day", "event", "step", "field", "loan_kind", "country", name="pk_funnel_counts"),
)


def enabled() -> bool:
    return os.environ.get("FUNNEL_ENABLED", "").strip().lower() == "true"


def _today() -> date:
    return datetime.now(ZoneInfo("Asia/Kolkata")).date()


today_fn = _today


class FunnelStore:
    def __init__(self, engine: AsyncEngine):
        self.engine = engine
        self._ready = False

    async def init(self) -> None:
        if not self._ready:
            async with self.engine.begin() as conn:
                await conn.run_sync(metadata.create_all)
            self._ready = True

    async def bump(self, day: date, event: str, step: int = 0, field: str = "", loan_kind: str = "",
                   country: str = "") -> None:
        await self.init()
        key = and_(counts.c.day == day, counts.c.event == event, counts.c.step == step, counts.c.field == field,
                   counts.c.loan_kind == loan_kind, counts.c.country == country)
        for _ in range(3):
            try:
                async with self.engine.begin() as conn:
                    res = await conn.execute(update(counts).where(key).values(n=counts.c.n + 1))
                    if (res.rowcount or 0) == 0:
                        await conn.execute(counts.insert().values(day=day, event=event, step=step, field=field,
                                                                  loan_kind=loan_kind, country=country, n=1))
                return
            except IntegrityError:      # two first-of-the-day bumps raced; the update wins next time
                continue

    async def rows(self, since: date) -> list[dict[str, Any]]:
        await self.init()
        async with self.engine.connect() as conn:
            res = await conn.execute(select(counts).where(counts.c.day >= since))
            return [dict(r) for r in res.mappings().all()]


_store: Optional[FunnelStore] = None


def store() -> FunnelStore:
    global _store
    if _store is None:
        from api.notify.store import DEFAULT_SQLITE, sqlite_engine
        from api.db.database import engine as db_engine
        if db_engine is not None:
            _store = FunnelStore(db_engine)
        else:
            path = DEFAULT_SQLITE.with_name("funnel.sqlite3")
            path.parent.mkdir(parents=True, exist_ok=True)
            _store = FunnelStore(sqlite_engine(path))
    return _store


def set_store(s: Optional[FunnelStore]) -> None:
    global _store
    _store = s


# ── validation ──────────────────────────────────────────────────────────────

class Invalid(ValueError):
    pass


def parse(raw: bytes) -> dict[str, Any]:
    if len(raw) > MAX_BODY:
        raise Invalid("too big")
    try:
        body = json.loads(raw.decode("utf-8") or "{}")
    except (ValueError, UnicodeDecodeError):
        raise Invalid("not json") from None
    if not isinstance(body, dict):
        raise Invalid("not an object")
    extra = set(body) - {"event", "step", "field", "loan_kind", "country"}
    if extra:
        raise Invalid("unknown keys")       # nothing else may ride along
    ev = body.get("event")
    if ev not in EVENTS:
        raise Invalid("unknown event")
    step = body.get("step", 0)
    field = body.get("field", "") or ""
    kind = body.get("loan_kind", "") or ""
    country = body.get("country", "") or ""
    if not isinstance(step, int) or isinstance(step, bool) or not 0 <= step <= 9:
        raise Invalid("bad step")
    if not isinstance(field, str) or (field and not FIELD_RE.match(field)):
        raise Invalid("bad field")
    if kind not in LOAN_KINDS or country not in COUNTRIES:
        raise Invalid("bad dimension")
    if ev in FIELD_EVENTS and not field:
        raise Invalid("field events need a field")
    if ev not in FIELD_EVENTS:
        field, step = "", 0
    return {"event": ev, "step": step, "field": field, "loan_kind": kind, "country": country}


# ── routes ──────────────────────────────────────────────────────────────────

@router.post("", status_code=204)
async def record(request: Request) -> Response:
    if not enabled():
        raise HTTPException(404, "Not available.")
    try:
        ev = parse(await request.body())
    except Invalid:
        raise HTTPException(422, "Not a funnel event.") from None
    await store().bump(today_fn(), **ev)
    return Response(status_code=204, headers={"Cache-Control": "no-store"})


def _admin(authorization: Optional[str]) -> None:
    secret = os.environ.get("FUNNEL_ADMIN_SECRET", "")
    given = (authorization or "").removeprefix("Bearer ").strip()
    if len(secret) < 16 or not hmac.compare_digest(given, secret):
        raise HTTPException(401, "Not authorised.")


def _share(a: int, b: int) -> Optional[float]:
    return round(a / b, 4) if b else None


def summarise(rows: list[dict[str, Any]]) -> dict[str, Any]:
    totals: dict[str, int] = {}
    by_day: dict[str, dict[str, int]] = {}
    fields: dict[tuple[int, str], dict[str, int]] = {}
    for r in rows:
        totals[r["event"]] = totals.get(r["event"], 0) + r["n"]
        d = by_day.setdefault(r["day"].isoformat(), {})
        d[r["event"]] = d.get(r["event"], 0) + r["n"]
        if r["event"] in FIELD_EVENTS:
            f = fields.setdefault((r["step"], r["field"]), {})
            k = r["event"].removeprefix("field_")
            f[k] = f.get(k, 0) + r["n"]
    setup = []
    for (step, field), f in sorted(fields.items()):
        focus = f.get("focus", 0)
        lost = f.get("left_empty", 0) + f.get("abandon", 0)
        setup.append({"step": step, "field": field, **{k: f.get(k, 0) for k in
                      ("focus", "filled", "left_empty", "dont_know", "abandon")},
                      "dropoff": _share(lost, focus), "dont_know_share": _share(f.get("dont_know", 0), focus)})
    setup.sort(key=lambda x: -(x["dropoff"] or 0))
    doors = {}
    for door in ("letter", "plus"):
        shown, notify = totals.get(f"door_{door}_shown", 0), totals.get(f"door_{door}_notify", 0)
        share = _share(notify, shown)
        doors[door] = {"shown": shown, "notify": notify, "share": share,
                       "verdict": None if shown < 50 else ("kill" if (share or 0) < DOOR_KILL_BELOW else "keep"),
                       "rule": f"kill under {int(DOOR_KILL_BELOW * 100)}% of people who saw it (decided after 50 views)"}
    return {
        "totals": totals,
        "product": {k: totals.get(k, 0) for k in sorted(PRODUCT_EVENTS)},
        "loan_check_5k_share": _share(totals.get("loan_check_finding_5k", 0), totals.get("loan_check_result", 0)),
        "setup_fields": setup,
        "doors": doors,
        "by_day": dict(sorted(by_day.items())),
    }


@router.get("/admin")
async def admin(authorization: Annotated[Optional[str], Header()] = None,
                days: int = Query(30, ge=1, le=400)) -> dict[str, Any]:
    if not enabled():
        raise HTTPException(404, "Not available.")
    _admin(authorization)
    since = today_fn() - timedelta(days=days - 1)
    return {"since": since.isoformat(), "days": days, **summarise(await store().rows(since))}
