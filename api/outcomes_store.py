"""Where shared outcome reports live, and the limits on sharing them.

Postgres when DATABASE_URL is set (the same database as sign-in),
otherwise a SQLite file, `api/data/outcomes.sqlite3`. On Render's free
plan that file is lost on every deploy, so real use needs the database
(ROADMAP Phase 7).

**Abuse controls.** Each client address may share 10 reports a day, and
2 about any one bank. The address comes from the spoof-proof proxy
chain (api/client_ip.py) and is stored only as a keyed hash, which is
wiped after two days, once no limit needs it. Someone with many
addresses can still fake a record; the real fix is verified reports.

**Speed.** The scorecard is cached for 60 seconds and dropped as soon
as a report arrives.
"""
from __future__ import annotations

import asyncio
import hashlib
import hmac
import os
import secrets
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Callable, Optional

from sqlalchemy import (
    Boolean, Column, DateTime, Integer, MetaData, Numeric, String, Table, and_, func, select, update,
)
from sqlalchemy.ext.asyncio import AsyncEngine, create_async_engine
from sqlalchemy.pool import NullPool

from engine.outcomes import LenderScore, Outcome, OutcomeReport, scorecard

PER_DAY = 10
PER_LENDER_PER_DAY = 2
KEEP_CLIENT_HASH = timedelta(days=2)
CACHE_SECONDS = 60.0
DEFAULT_SQLITE = Path(__file__).parent / "data" / "outcomes.sqlite3"

metadata = MetaData()
outcomes = Table(
    "lender_outcomes",
    metadata,
    Column("id", Integer, primary_key=True, autoincrement=True),
    Column("lender_id", String(40), nullable=False, index=True),
    Column("outcome", String(16), nullable=False),
    Column("days_taken", Integer),
    Column("rate_before", Numeric(7, 5), nullable=False),
    Column("rate_after", Numeric(7, 5)),
    Column("verified", Boolean, nullable=False, default=False),
    Column("created_at", DateTime(timezone=True), nullable=False, index=True),
    # Keyed hash of the client address, for the daily limits only.
    Column("client", String(64), index=True),
)


class LimitReached(Exception):
    def __init__(self, message: str):
        super().__init__(message)
        self.message = message


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


class OutcomeStore:
    def __init__(
        self,
        engine: AsyncEngine,
        *,
        key: bytes,
        now: Callable[[], datetime] = _utcnow,
        clock: Callable[[], float] = time.monotonic,
    ):
        self.engine = engine
        self.key = key
        self.now = now
        self.clock = clock
        self.kind = engine.dialect.name          # "postgresql" or "sqlite"
        self._lock = asyncio.Lock()
        self._cache: Optional[tuple[float, dict[str, LenderScore]]] = None
        self._ready = False

    async def init(self) -> None:
        if not self._ready:
            async with self.engine.begin() as conn:
                await conn.run_sync(metadata.create_all)
            self._ready = True

    def client_hash(self, ip: str) -> str:
        return hmac.new(self.key, ip.encode(), hashlib.sha256).hexdigest()[:32]

    async def add(self, report: OutcomeReport, ip: str) -> int:
        """Save a report; returns how many reports the lender now has.

        Raises LimitReached when this address has shared enough today.
        """
        await self.init()
        client = self.client_hash(ip)
        now = self.now()
        since = now - timedelta(days=1)
        async with self._lock, self.engine.begin() as conn:
            today = (await conn.execute(
                select(func.count()).select_from(outcomes)
                .where(and_(outcomes.c.client == client, outcomes.c.created_at >= since))
            )).scalar_one()
            if today >= PER_DAY:
                raise LimitReached(
                    f"This connection has shared {PER_DAY} reports in the last day. Try again tomorrow.")
            same_bank = (await conn.execute(
                select(func.count()).select_from(outcomes)
                .where(and_(outcomes.c.client == client, outcomes.c.created_at >= since,
                            outcomes.c.lender_id == report.lender_id))
            )).scalar_one()
            if same_bank >= PER_LENDER_PER_DAY:
                raise LimitReached(
                    f"This connection has already shared {PER_LENDER_PER_DAY} reports about this bank "
                    "in the last day. Try again tomorrow.")
            await conn.execute(outcomes.insert().values(
                lender_id=report.lender_id,
                outcome=report.outcome.value,
                days_taken=report.days_taken,
                rate_before=report.rate_before,
                rate_after=report.rate_after,
                verified=report.verified,
                created_at=now,
                client=client,
            ))
            # Nothing needs an address hash once its day has passed.
            await conn.execute(
                update(outcomes)
                .where(and_(outcomes.c.client.is_not(None), outcomes.c.created_at < now - KEEP_CLIENT_HASH))
                .values(client=None)
            )
            total = (await conn.execute(
                select(func.count()).select_from(outcomes).where(outcomes.c.lender_id == report.lender_id)
            )).scalar_one()
        self._cache = None
        return total

    async def reports(self, lender_id: Optional[str] = None) -> list[OutcomeReport]:
        await self.init()
        q = select(outcomes.c.lender_id, outcomes.c.outcome, outcomes.c.days_taken,
                   outcomes.c.rate_before, outcomes.c.rate_after, outcomes.c.verified)
        if lender_id is not None:
            q = q.where(outcomes.c.lender_id == lender_id)
        async with self.engine.connect() as conn:
            rows = (await conn.execute(q)).all()
        return [
            OutcomeReport(lender_id=r[0], outcome=Outcome(r[1]), days_taken=r[2],
                          rate_before=r[3], rate_after=r[4], verified=bool(r[5]))
            for r in rows
        ]

    async def scorecard(self) -> dict[str, LenderScore]:
        cached = self._cache
        if cached is not None and self.clock() - cached[0] < CACHE_SECONDS:
            return cached[1]
        result = scorecard(await self.reports())
        self._cache = (self.clock(), result)
        return result

    async def close(self) -> None:
        await self.engine.dispose()


def _key() -> bytes:
    raw = os.environ.get("OUTCOMES_IP_KEY", "")
    # Without a set key, limits still work but restart with the process.
    return raw.encode() if raw else secrets.token_bytes(32)


def sqlite_engine(path: Path) -> AsyncEngine:
    # No pool: each request opens the file, so no connection outlives the
    # event loop that made it.
    return create_async_engine(f"sqlite+aiosqlite:///{path}", poolclass=NullPool)


def default_store() -> OutcomeStore:
    from api.db.database import engine as db_engine

    url = os.environ.get("OUTCOMES_DATABASE_URL")
    if url:
        engine = create_async_engine(url)
    elif db_engine is not None:
        engine = db_engine
    else:
        DEFAULT_SQLITE.parent.mkdir(parents=True, exist_ok=True)
        engine = sqlite_engine(DEFAULT_SQLITE)
    return OutcomeStore(engine, key=_key())


_store: Optional[OutcomeStore] = None


def store() -> OutcomeStore:
    global _store
    if _store is None:
        _store = default_store()
    return _store


def set_store(s: Optional[OutcomeStore]) -> None:
    """Tests swap in their own store."""
    global _store
    _store = s
