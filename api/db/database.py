"""Async SQLAlchemy engine + session factory.

Reads DATABASE_URL from the environment (loaded via python-dotenv at app
startup). On boot we call `init_db()` to create tables that don't yet
exist — fine for phase 1; swap for Alembic when the schema starts
evolving.
"""
from __future__ import annotations

import os
from typing import AsyncIterator

from sqlalchemy.ext.asyncio import (
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)
from sqlalchemy.orm import DeclarativeBase


class Base(DeclarativeBase):
    pass


def _database_url() -> str:
    url = os.environ.get("DATABASE_URL")
    if not url:
        raise RuntimeError(
            "DATABASE_URL is not set. Copy .env.example to .env and fill in "
            "the Neon connection string."
        )
    return url


engine = create_async_engine(_database_url(), pool_pre_ping=True)
SessionLocal = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)


async def get_db() -> AsyncIterator[AsyncSession]:
    async with SessionLocal() as session:
        yield session


async def init_db() -> None:
    # Import models so they register on Base.metadata before create_all.
    from api.db import models  # noqa: F401

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
