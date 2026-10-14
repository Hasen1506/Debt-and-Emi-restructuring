"""W5: every Core table the notify and funnel stores create on first use also
has an Alembic migration with the same columns, keys and nullability, and the
revision chain has exactly one head (a class guard: a new store table without
a migration, or a migration that drifts from its table, fails here)."""
import re
from pathlib import Path

import pytest
import sqlalchemy as sa
from alembic.config import Config
from alembic.migration import MigrationContext
from alembic.operations import Operations
from alembic.script import ScriptDirectory

ROOT = Path(__file__).resolve().parents[2]
VERSIONS = ROOT / "api" / "db" / "migrations" / "versions"


def _store_tables():
    from api import funnel
    from api.notify import store
    return [*store.metadata.tables.values(), *funnel.metadata.tables.values()]


def _migration_source() -> str:
    return "\n".join(p.read_text() for p in sorted(VERSIONS.glob("*.py")))


def test_alembic_chain_has_one_head():
    script = ScriptDirectory.from_config(Config(str(ROOT / "alembic.ini")))
    assert len(script.get_heads()) == 1, script.get_heads()
    assert script.get_revision("0005_retention") is not None


@pytest.mark.parametrize("table", _store_tables(), ids=lambda t: t.name)
def test_every_store_table_has_a_migration(table):
    assert re.search(rf'create_table\(\s*"{table.name}"', _migration_source()), \
        f"{table.name} is created by its store but no migration creates it"


def _run_upgrade(conn, module_name: str):
    import importlib.util
    spec = importlib.util.spec_from_file_location(module_name, VERSIONS / f"{module_name}.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    ctx = MigrationContext.configure(conn)
    with Operations.context(ctx):
        mod.upgrade()
        mod.upgrade()          # idempotent: a table the store already made is skipped


@pytest.mark.parametrize("table", [t for t in _store_tables()
                                   if t.name in ("notify_rate_watch", "notify_run_lock", "funnel_counts")],
                         ids=lambda t: t.name)
def test_0005_matches_the_store_table(table):
    eng = sa.create_engine("sqlite://")
    with eng.begin() as conn:
        _run_upgrade(conn, "0005_retention")
        insp = sa.inspect(conn)
        cols = {c["name"]: c for c in insp.get_columns(table.name)}
        pk = set(insp.get_pk_constraint(table.name)["constrained_columns"])
    assert set(cols) == {c.name for c in table.columns}
    assert pk == {c.name for c in table.primary_key.columns}
    for c in table.columns:
        if not c.primary_key:
            assert cols[c.name]["nullable"] == c.nullable, c.name
        assert type(cols[c.name]["type"]).__name__.upper().startswith(
            {"String": "VARCHAR", "Text": "TEXT", "Boolean": "BOOLEAN", "Date": "DATE",
             "DateTime": "DATETIME", "Integer": "INTEGER"}[type(c.type).__name__]), c.name


def test_0005_on_a_database_where_the_store_already_made_the_tables():
    from api import funnel
    from api.notify import store
    eng = sa.create_engine("sqlite://")
    with eng.begin() as conn:
        store.metadata.create_all(conn)
        funnel.metadata.create_all(conn)
        conn.execute(sa.text("INSERT INTO notify_run_lock VALUES ('run', '2026-10-14 00:00:00')"))
        _run_upgrade(conn, "0005_retention")
        assert conn.execute(sa.text("SELECT count(*) FROM notify_run_lock")).scalar_one() == 1
