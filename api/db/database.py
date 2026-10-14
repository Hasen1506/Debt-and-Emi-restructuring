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


def schema_drift(connection) -> list[str]:
    """What the models need that the database lacks (sync): a missing table
    as "table", a missing column as "table.column". Empty means the schema
    has everything the code will query (audit80 D26)."""
    from sqlalchemy import inspect

    insp = inspect(connection)
    have_tables = set(insp.get_table_names())
    drift: list[str] = []
    for name, table in Base.metadata.tables.items():
        if name not in have_tables:
            drift.append(name)
            continue
        have_cols = {c["name"] for c in insp.get_columns(name)}
        drift.extend(f"{name}.{c.name}" for c in table.columns if c.name not in have_cols)
    return sorted(drift)


def run_migrations(connection) -> list[str]:
    """Bring the account database to the newest migration (sync, inside
    `conn.run_sync`). A database made by the old `create_all`, with the four
    tables but no alembic_version, is stamped at the baseline first, so the
    baseline never tries to create tables that exist. Returns what the
    models declare that no migration created (see schema_drift, init_db)."""
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
    return schema_drift(connection)


class SchemaDriftError(RuntimeError):
    """The code needs tables or columns no migration created."""


def is_production(env: Optional[dict] = None) -> bool:
    """Render sets RENDER on every service; RIGHTDUE_ENV=production says so
    anywhere else."""
    env = os.environ if env is None else env
    return bool(env.get("RENDER")) or env.get("RIGHTDUE_ENV", "").lower() == "production"


def check_drift(drift: list[str], env: Optional[dict] = None) -> None:
    """audit80 D26: in production, refuse to start on drift. The container
    then fails its start, Render keeps the previous deploy serving, and the
    deploy log names what is missing. ALLOW_SCHEMA_DRIFT=1 is the escape
    hatch for an emergency, never a default."""
    env = os.environ if env is None else env
    if drift and is_production(env) and env.get("ALLOW_SCHEMA_DRIFT") != "1":
        raise SchemaDriftError(
            "Schema drift: the code needs " + ", ".join(drift) + " but no Alembic migration created "
            "them. Add a migration under api/db/migrations/versions; refusing to start in production."
        )


async def init_db() -> None:
    if engine is None:
        return
    # Import models so they register on Base.metadata.
    from api.db import models  # noqa: F401

    async with engine.begin() as conn:
        drift = await conn.run_sync(run_migrations)
        if drift:
            check_drift(drift)  # raises in production (D26)
            # Development and tests only: create missing tables so a local run
            # works, and say so. The schema test
            # (api/tests/test_state_versions_and_migrations.py) fails until a
            # migration exists. create_all never adds columns.
            log.warning("Schema drift (no Alembic migration): %s", ", ".join(drift))
            await conn.run_sync(Base.metadata.create_all)
