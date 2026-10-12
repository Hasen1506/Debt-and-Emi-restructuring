"""Meeting outcomes recorded by an admin, kept in Postgres (grill #61).

`POST /api/admin/rate-update` used to write the outcome into
api/data/central_bank_calendar.json on the container's disk, which Render
wipes on every deploy, restart and spin-down. The outcome now goes to the
`rate_meeting_outcomes` table in the app's database (the same one as
sign-in), and `GET /api/rates/central` lays the stored outcomes over the
calendar file. Without DATABASE_URL there is nowhere durable to keep an
edit, so the endpoint refuses (503) instead of pretending to save.

The table is created on first use, so api.main needs no change.
"""
from __future__ import annotations

import asyncio
import time
from datetime import date, datetime, timezone
from decimal import Decimal
from typing import Optional

from sqlalchemy import Column, Date, DateTime, MetaData, Numeric, String, Table, and_, delete, insert, select
from sqlalchemy.ext.asyncio import AsyncEngine

metadata = MetaData()
outcomes = Table(
    "rate_meeting_outcomes",
    metadata,
    Column("country", String(2), primary_key=True),
    Column("meeting_date", Date, primary_key=True),
    Column("outcome_rate", Numeric(7, 5), nullable=False),
    Column("note", String(500)),
    Column("updated_at", DateTime(timezone=True), nullable=False),
)

CACHE_SECONDS = 300.0


class RateOutcomeStore:
    def __init__(self, engine: AsyncEngine):
        self.engine = engine
        self._ready = False
        self._lock = asyncio.Lock()
        self._cache: Optional[tuple[float, dict]] = None

    async def _init(self) -> None:
        if self._ready:
            return
        async with self._lock:
            if not self._ready:
                async with self.engine.begin() as conn:
                    await conn.run_sync(metadata.create_all)
                self._ready = True

    async def record(self, country: str, meeting: date, rate: Decimal, note: Optional[str]) -> None:
        """Insert or replace one meeting's outcome (portable: delete + insert
        in one transaction works on Postgres and SQLite alike)."""
        await self._init()
        async with self.engine.begin() as conn:
            await conn.execute(delete(outcomes).where(and_(
                outcomes.c.country == country, outcomes.c.meeting_date == meeting)))
            await conn.execute(insert(outcomes).values(
                country=country, meeting_date=meeting, outcome_rate=rate,
                note=note, updated_at=datetime.now(timezone.utc)))
        self._cache = None

    async def all(self) -> dict[tuple[str, str], tuple[Decimal, Optional[str]]]:
        """{(country, 'YYYY-MM-DD'): (rate, note)}, cached for 5 minutes."""
        if self._cache and time.monotonic() - self._cache[0] < CACHE_SECONDS:
            return self._cache[1]
        await self._init()
        async with self.engine.connect() as conn:
            rows = (await conn.execute(select(outcomes))).all()
        out = {(r.country, r.meeting_date.isoformat()): (Decimal(str(r.outcome_rate)), r.note) for r in rows}
        self._cache = (time.monotonic(), out)
        return out


_store: Optional[RateOutcomeStore] = None
_set = False


def store() -> Optional[RateOutcomeStore]:
    """The database-backed store, or None when DATABASE_URL is unset."""
    global _store
    if _store is None and not _set:
        from api.db.database import engine
        if engine is not None:
            _store = RateOutcomeStore(engine)
    return _store


def set_store(s: Optional[RateOutcomeStore]) -> None:
    """Tests: use this store (None = no database)."""
    global _store, _set
    _store, _set = s, s is not None
