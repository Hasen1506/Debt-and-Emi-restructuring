"""Async SQLAlchemy engine + session factory.

Reads DATABASE_URL from the environment (loaded via python-dotenv at app
startup). On boot `init_db()` runs the Alembic migrations
(api/db/migrations) up to the newest one.

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
)
from sqlalchemy.orm import DeclarativeBase
from api.db.connection import database_engine

log = logging.getLogger(__name__)


class Base(DeclarativeBase):
    pass


_url = os.environ.get("DATABASE_URL")
engine: Optional[AsyncEngine] = None
SessionLocal: Optional[async_sessionmaker[AsyncSession]] = None
if _url:
    engine = database_engine(_url)
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


# Critique #63: the schema is now versioned with Alembic (api/db/migrations).
BASELINE_REVISION = "0001_baseline"
_BASELINE_TABLES = {"users", "otp_codes", "sessions", "user_state"}


def run_migrations(connection) -> list[str]:
    """Bring the account database to the newest migration (sync, inside
    `conn.run_sync`). A database made by the old `create_all`, with the four
    tables but no alembic_version, is stamped at the baseline first, so the
    baseline never tries to create tables that exist. Returns the tables a
    model declares that no migration created (see init_db)."""
    from pathlib import Path

    from alembic import command
    from alembic.config import Config
    from sqlalchemy import inspect

    root = Path(__file__).resolve().parents[2]
    cfg = Config(str(root / "alembic.ini"))
    cfg.set_main_option("script_location", str(root / "api" / "db" / "migrations"))
    cfg.attributes["connection"] = connection
    tables = set(inspect(connection).get_table_names())
    if "alembic_version" not in tables and _BASELINE_TABLES <= tables:
        log.info("Account database predates Alembic: stamping %s", BASELINE_REVISION)
        command.stamp(cfg, BASELINE_REVISION)
    command.upgrade(cfg, "head")
    have = set(inspect(connection).get_table_names())
    return sorted(t for t in Base.metadata.tables if t not in have)


async def init_db() -> None:
    if engine is None:
        return
    # Import models so they register on Base.metadata.
    from api.db import models  # noqa: F401

    async with engine.begin() as conn:
        missing = await conn.run_sync(run_migrations)
        if missing:
            # A model added without a migration still gets its table, so a
            # deploy never breaks on it, but say so: the schema test
            # (api/tests/test_migrations.py) fails until a migration exists.
            log.warning("Tables without an Alembic migration, created directly: %s", ", ".join(missing))
            await conn.run_sync(Base.metadata.create_all)
