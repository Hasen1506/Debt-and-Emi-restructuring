"""Alembic environment for the account database (users, sessions, state).

Two ways in:
* The app's start-up (api/db/database.py `run_migrations`) hands over an
  open connection in `config.attributes["connection"]`.
* The `alembic` command line builds its own engine from DATABASE_URL, with
  the same URL handling as the app (api/db/connection.py).

The outcomes store (api/outcomes_store.py) is a separate database with its
own tables and is not managed here.
"""
from __future__ import annotations

import asyncio
import os

from alembic import context
from sqlalchemy.engine import Connection

from api.db.database import Base
from api.db import models  # noqa: F401  (registers the tables)
from api.db.migrations_filter import include_object

config = context.config
target_metadata = Base.metadata


def _run(connection: Connection) -> None:
    context.configure(connection=connection, target_metadata=target_metadata, compare_type=True, include_object=include_object)
    with context.begin_transaction():
        context.run_migrations()


def run_offline() -> None:
    from api.db.connection import connection_options

    url, _ = connection_options(os.environ["DATABASE_URL"])
    context.configure(url=url, target_metadata=target_metadata, literal_binds=True, include_object=include_object)
    with context.begin_transaction():
        context.run_migrations()


async def _run_online_async() -> None:
    from api.db.connection import database_engine

    engine = database_engine(os.environ["DATABASE_URL"])
    async with engine.connect() as conn:
        await conn.run_sync(_run)
    await engine.dispose()


def run_online() -> None:
    connection = config.attributes.get("connection")
    if connection is not None:
        _run(connection)
    else:
        asyncio.run(_run_online_async())


if context.is_offline_mode():
    run_offline()
else:
    run_online()
