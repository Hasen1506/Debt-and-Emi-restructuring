"""Async SQLAlchemy engine + session factory.

Reads DATABASE_URL from the environment (loaded via python-dotenv at app
startup). On boot we call `init_db()` to create tables that don't yet
exist — fine for phase 1; swap for Alembic when the schema starts
evolving.

DB is optional: if DATABASE_URL is unset, the engine is not created
and `db_enabled()` returns False. `api.main` then skips mounting the
DB-bound routers (auth, user-state) and the pure-engine routes
(simulation, portfolio, etc.) continue to serve. This lets the Render
free tier run without a Postgres add-on while we're still trialling.
"""
from __future__ import annotations

import logging
import os
from typing import AsyncIterator, Optional

from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)
from sqlalchemy.orm import DeclarativeBase

log = logging.getLogger(__name__)


class Base(DeclarativeBase):
    pass


_url = os.environ.get("DATABASE_URL")
if _url and _url.startswith(("postgres://", "postgresql://")):
    _url = "postgresql+asyncpg://" + _url.split("://", 1)[1]
engine: Optional[AsyncEngine] = None
SessionLocal: Optional[async_sessionmaker[AsyncSession]] = None
if _url:
    engine = create_async_engine(_url, pool_pre_ping=True)
    SessionLocal = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)
else:
    log.warning(
        "DATABASE_URL not set — DB-backed routes (auth, user-state) will be "
        "disabled. Set DATABASE_URL to enable."
    )


def db_enabled() -> bool:
    return SessionLocal is not None


async def get_db() -> AsyncIterator[AsyncSession]:
    if SessionLocal is None:
        # Should be unreachable: routes that depend on this aren't mounted
        # when the DB is disabled. Guard anyway so a stray import doesn't
        # crash the worker.
        raise RuntimeError("DATABASE_URL is not set; DB-backed route invoked.")
    async with SessionLocal() as session:
        yield session


async def init_db() -> None:
    if engine is None:
        return
    # Import models so they register on Base.metadata before create_all.
    from api.db import models  # noqa: F401

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
