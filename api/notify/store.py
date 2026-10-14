"""Where notification settings and answers live.

Postgres when DATABASE_URL is set (same database as sign-in), otherwise a
SQLite file (local development and tests only). Two tables, both keyed by
the user's id, both wiped by `forget(user_id)` (call it from account
deletion):

notify_subscriptions  one row per user: the payday day, the latest payment
                      list (snapshot: names, amounts, kinds only), the
                      deadline items to remind about, and what was sent.
notify_events         what happened: sent, the user's answer from an email
                      link or reply, a snapshot refresh (for D30/D60).
                      Answers wait here until the app applies them.
"""
from __future__ import annotations

import json
import os
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Any, Callable, Optional

from sqlalchemy import (
    Boolean, Column, Date, DateTime, Integer, MetaData, String, Table, Text, and_, delete, select, update,
)
from sqlalchemy.ext.asyncio import AsyncEngine, create_async_engine
from sqlalchemy.pool import NullPool

DEFAULT_SQLITE = Path(__file__).resolve().parent.parent / "data" / "notify.sqlite3"

metadata = MetaData()
subscriptions = Table(
    "notify_subscriptions",
    metadata,
    Column("user_id", String(64), primary_key=True),
    Column("email", String(320), nullable=False),
    Column("payday_on", Boolean, nullable=False, default=False),
    Column("payday_day", Integer),
    Column("opted_in_on", Date),
    Column("snapshot", Text),            # JSON from engine.payday.snapshot_to_json
    Column("snapshot_at", DateTime(timezone=True)),
    Column("last_sent_month", String(7)),
    Column("reply_code", String(16)),    # short code in the Reply-To of the last payday email
    Column("reminders_on", Boolean, nullable=False, default=False),
    Column("reminder_items", Text),      # JSON list of {key,label,day,source,done}
    Column("reminders_sent", Text),      # JSON list of "key|send_on"
    Column("updated_at", DateTime(timezone=True)),
)
events = Table(
    "notify_events",
    metadata,
    Column("id", Integer, primary_key=True, autoincrement=True),
    Column("user_id", String(64), nullable=False, index=True),
    Column("kind", String(16), nullable=False),     # sent | ack_all | ack_some | ack_cant | reply_done | reply_not | snapshot | reminder
    Column("month", String(7)),
    Column("day", Date, nullable=False),
    Column("applied", Boolean, nullable=False, default=False),
    Column("created_at", DateTime(timezone=True), nullable=False),
)

# A13: repo-linked loans to watch for an RBI move (name, outstanding, rate,
# EMI, months left; no account numbers). Its own table so the G7 tables and
# migration 0003 stay as they are; created on first use like the others.
rate_watch = Table(
    "notify_rate_watch",
    metadata,
    Column("user_id", String(64), primary_key=True),
    Column("email", String(320), nullable=False),
    Column("watch_on", Boolean, nullable=False, default=False),
    Column("loans", Text),               # JSON list of {name,outstanding,rate,emi,months_left}
    Column("saved_at", DateTime(timezone=True)),
    Column("last_decision", String(10)), # "YYYY-MM-DD" of the RBI decision last emailed about
    Column("opted_in_on", Date),
)
# One scheduler run at a time: GitHub Actions and cron-job.org may both call
# /api/notify/run; the second gets 409 instead of sending twice.
run_lock = Table(
    "notify_run_lock",
    metadata,
    Column("name", String(32), primary_key=True),
    Column("locked_until", DateTime(timezone=True), nullable=False),
)

ANSWER_KINDS = ("ack_all", "ack_some", "ack_cant", "reply_done", "reply_not")
# Events that are one email each (the daily send budget counts these).
SENT_KINDS = ("sent", "reminder", "rate_move")


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


class NotifyStore:
    def __init__(self, engine: AsyncEngine, *, now: Callable[[], datetime] = _utcnow):
        self.engine = engine
        self.now = now
        self._ready = False

    async def init(self) -> None:
        if not self._ready:
            async with self.engine.begin() as conn:
                await conn.run_sync(metadata.create_all)
            self._ready = True

    # ── subscription ────────────────────────────────────────────────────
    async def get(self, user_id: str) -> Optional[dict[str, Any]]:
        await self.init()
        async with self.engine.connect() as conn:
            row = (await conn.execute(select(subscriptions).where(subscriptions.c.user_id == user_id))).mappings().first()
        if row is None:
            return None
        d = dict(row)
        d["snapshot"] = json.loads(d["snapshot"]) if d.get("snapshot") else None
        d["reminder_items"] = json.loads(d["reminder_items"]) if d.get("reminder_items") else []
        d["reminders_sent"] = json.loads(d["reminders_sent"]) if d.get("reminders_sent") else []
        return d

    async def _upsert(self, user_id: str, email: str, values: dict[str, Any]) -> None:
        await self.init()
        values = {**values, "email": email, "updated_at": self.now()}
        async with self.engine.begin() as conn:
            exists = (await conn.execute(
                select(subscriptions.c.user_id).where(subscriptions.c.user_id == user_id)
            )).first()
            if exists:
                await conn.execute(update(subscriptions).where(subscriptions.c.user_id == user_id).values(**values))
            else:
                await conn.execute(subscriptions.insert().values(
                    **{"user_id": user_id, "payday_on": False, "reminders_on": False, **values}))

    async def set_payday(self, user_id: str, email: str, *, on: bool, day: Optional[int],
                         snapshot: Optional[dict], today: date) -> None:
        cur = await self.get(user_id)
        values: dict[str, Any] = {"payday_on": on, "payday_day": day}
        if on and not (cur and cur.get("payday_on")):
            values["opted_in_on"] = today
        if snapshot is not None:
            values["snapshot"] = json.dumps(snapshot, separators=(",", ":"))
            values["snapshot_at"] = self.now()
        if not on:
            values["snapshot"] = None        # nothing kept that isn't needed
            values["snapshot_at"] = None
        await self._upsert(user_id, email, values)
        if on and snapshot is not None:
            await self.add_event(user_id, "snapshot", snapshot.get("month"), today)

    async def set_reminders(self, user_id: str, email: str, *, on: bool, items: list[dict]) -> None:
        await self._upsert(user_id, email, {
            "reminders_on": on,
            "reminder_items": json.dumps(items if on else [], separators=(",", ":")),
        })

    async def mark_sent(self, user_id: str, month: str, today: date, reply_code: Optional[str] = None) -> None:
        await self.init()
        async with self.engine.begin() as conn:
            await conn.execute(update(subscriptions).where(subscriptions.c.user_id == user_id)
                               .values(last_sent_month=month, reply_code=reply_code))
        await self.add_event(user_id, "sent", month, today)

    async def mark_reminders_sent(self, user_id: str, keys: list[str]) -> None:
        cur = await self.get(user_id)
        if cur is None:
            return
        sent = list(dict.fromkeys([*cur["reminders_sent"], *keys]))[-200:]
        async with self.engine.begin() as conn:
            await conn.execute(update(subscriptions).where(subscriptions.c.user_id == user_id)
                               .values(reminders_sent=json.dumps(sent)))

    async def by_reply_code(self, code: str) -> Optional[dict[str, Any]]:
        await self.init()
        async with self.engine.connect() as conn:
            uid = (await conn.execute(select(subscriptions.c.user_id).where(
                subscriptions.c.reply_code == code))).scalar_one_or_none()
        return await self.get(uid) if uid else None

    async def unsubscribe(self, user_id: str) -> None:
        await self.init()
        async with self.engine.begin() as conn:
            await conn.execute(update(subscriptions).where(subscriptions.c.user_id == user_id).values(
                payday_on=False, reminders_on=False, snapshot=None, snapshot_at=None,
                reminder_items=None, updated_at=self.now()))
            await conn.execute(update(rate_watch).where(rate_watch.c.user_id == user_id).values(
                watch_on=False, loans=None, saved_at=None))

    async def active(self) -> list[dict[str, Any]]:
        await self.init()
        async with self.engine.connect() as conn:
            ids = (await conn.execute(select(subscriptions.c.user_id).where(
                (subscriptions.c.payday_on.is_(True)) | (subscriptions.c.reminders_on.is_(True))))).scalars().all()
        return [s for s in [await self.get(i) for i in ids] if s]

    async def forget(self, user_id: str) -> None:
        """Delete everything about this user (account deletion)."""
        await self.init()
        async with self.engine.begin() as conn:
            await conn.execute(delete(events).where(events.c.user_id == user_id))
            await conn.execute(delete(subscriptions).where(subscriptions.c.user_id == user_id))
            await conn.execute(delete(rate_watch).where(rate_watch.c.user_id == user_id))

    # ── events ──────────────────────────────────────────────────────────
    async def add_event(self, user_id: str, kind: str, month: Optional[str], day: date) -> int:
        await self.init()
        async with self.engine.begin() as conn:
            if kind in ANSWER_KINDS:
                # One answer per month: a later tap replaces an unapplied earlier one.
                await conn.execute(delete(events).where(and_(
                    events.c.user_id == user_id, events.c.month == month,
                    events.c.kind.in_(ANSWER_KINDS), events.c.applied.is_(False))))
            res = await conn.execute(events.insert().values(
                user_id=user_id, kind=kind, month=month, day=day, applied=False, created_at=self.now()))
            return int(res.inserted_primary_key[0])

    async def pending_answers(self, user_id: str) -> list[dict[str, Any]]:
        await self.init()
        async with self.engine.connect() as conn:
            rows = (await conn.execute(select(events.c.id, events.c.kind, events.c.month, events.c.day).where(and_(
                events.c.user_id == user_id, events.c.kind.in_(ANSWER_KINDS), events.c.applied.is_(False)))
                .order_by(events.c.id))).mappings().all()
        return [{"id": r["id"], "kind": r["kind"], "month": r["month"], "day": r["day"].isoformat()} for r in rows]

    async def mark_applied(self, user_id: str, event_id: int) -> bool:
        await self.init()
        async with self.engine.begin() as conn:
            res = await conn.execute(update(events).where(and_(
                events.c.id == event_id, events.c.user_id == user_id)).values(applied=True))
        return (res.rowcount or 0) > 0

    async def all_events(self) -> list[tuple[str, str, date]]:
        await self.init()
        async with self.engine.connect() as conn:
            rows = (await conn.execute(select(events.c.user_id, events.c.kind, events.c.day))).all()
        return [(r[0], r[1], r[2]) for r in rows]

    async def sent_on(self, day: date) -> int:
        """Emails sent on `day` (one event per email), for the daily budget."""
        await self.init()
        from sqlalchemy import func
        async with self.engine.connect() as conn:
            return int((await conn.execute(select(func.count()).select_from(events).where(and_(
                events.c.day == day, events.c.kind.in_(SENT_KINDS))))).scalar_one())

    # ── rate-move watch (A13) ───────────────────────────────────────────
    async def get_rate_watch(self, user_id: str) -> Optional[dict[str, Any]]:
        await self.init()
        async with self.engine.connect() as conn:
            row = (await conn.execute(select(rate_watch).where(rate_watch.c.user_id == user_id))).mappings().first()
        if row is None:
            return None
        d = dict(row)
        d["loans"] = json.loads(d["loans"]) if d.get("loans") else []
        return d

    async def set_rate_watch(self, user_id: str, email: str, *, on: bool, loans: list[dict], today: date) -> None:
        await self.init()
        cur = await self.get_rate_watch(user_id)
        values: dict[str, Any] = {
            "email": email, "watch_on": on,
            "loans": json.dumps(loans, separators=(",", ":")) if on else None,
            "saved_at": self.now() if on else None,
        }
        if on and not (cur and cur["watch_on"]):
            values["opted_in_on"] = today
        async with self.engine.begin() as conn:
            if cur:
                await conn.execute(update(rate_watch).where(rate_watch.c.user_id == user_id).values(**values))
            else:
                await conn.execute(rate_watch.insert().values(user_id=user_id, **values))

    async def active_rate_watch(self) -> list[dict[str, Any]]:
        await self.init()
        async with self.engine.connect() as conn:
            ids = (await conn.execute(select(rate_watch.c.user_id).where(rate_watch.c.watch_on.is_(True)))).scalars().all()
        return [w for w in [await self.get_rate_watch(i) for i in ids] if w]

    async def mark_rate_sent(self, user_id: str, decision: str, today: date) -> None:
        await self.init()
        async with self.engine.begin() as conn:
            await conn.execute(update(rate_watch).where(rate_watch.c.user_id == user_id).values(last_decision=decision))
        await self.add_event(user_id, "rate_move", decision[:7], today)

    # ── one run at a time ───────────────────────────────────────────────
    async def try_lock(self, name: str, seconds: int) -> bool:
        from datetime import timedelta
        from sqlalchemy.exc import IntegrityError
        await self.init()
        now = self.now()
        until = now + timedelta(seconds=seconds)
        try:
            async with self.engine.begin() as conn:
                res = await conn.execute(update(run_lock).where(and_(
                    run_lock.c.name == name, run_lock.c.locked_until < now)).values(locked_until=until))
                if (res.rowcount or 0) == 1:
                    return True
                exists = (await conn.execute(select(run_lock.c.name).where(run_lock.c.name == name))).first()
                if exists:
                    return False
                await conn.execute(run_lock.insert().values(name=name, locked_until=until))
                return True
        except IntegrityError:          # another run inserted it first
            return False

    async def unlock(self, name: str) -> None:
        await self.init()
        async with self.engine.begin() as conn:
            await conn.execute(delete(run_lock).where(run_lock.c.name == name))

    async def close(self) -> None:
        await self.engine.dispose()


def sqlite_engine(path: Path) -> AsyncEngine:
    return create_async_engine(f"sqlite+aiosqlite:///{path}", poolclass=NullPool)


def default_store() -> NotifyStore:
    from api.db.database import engine as db_engine

    if db_engine is not None:
        return NotifyStore(db_engine)
    DEFAULT_SQLITE.parent.mkdir(parents=True, exist_ok=True)
    return NotifyStore(sqlite_engine(DEFAULT_SQLITE))


_store: Optional[NotifyStore] = None


def store() -> NotifyStore:
    global _store
    if _store is None:
        _store = default_store()
    return _store


def set_store(s: Optional[NotifyStore]) -> None:
    """Tests swap in their own store."""
    global _store
    _store = s
