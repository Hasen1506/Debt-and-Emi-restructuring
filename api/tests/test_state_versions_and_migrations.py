"""Critique #63 and live-test #2: stale writes are refused, not merged over,
and the account schema is migrated by Alembic.

The precondition tests use the SQLite adapter from
test_user_state_persistence.py (state_client). The migration tests run
against the disposable localhost Postgres (RIGHTDUE_TEST_DATABASE_URL), as
production uses Postgres JSONB.
"""
import asyncio
import os

import pytest
from sqlalchemy import inspect, text

from api.db.database import Base, run_migrations
from api.routes.user_state import migrate_state_shape
from api.tests.test_user_state_persistence import state_client  # noqa: F401  (fixture)

A = {'x-test-user': 'A'}


def _patch(client, data, base=None, force=False, headers=A):
    body = {'data': data}
    if base is not None:
        body['base_version'] = base
    if force:
        body['force'] = True
    return client.patch('/api/user/state', headers=headers, json=body)


def test_every_write_raises_the_version_and_get_reports_it(state_client):
    assert state_client.get('/api/user/state', headers=A).json()['version'] == 0
    r1 = _patch(state_client, {'profile': {'income': '1'}}, base=0)
    assert r1.status_code == 200 and r1.json()['version'] == 1
    r2 = _patch(state_client, {'goals': []}, base=1)
    assert r2.json()['version'] == 2
    assert state_client.get('/api/user/state', headers=A).json()['version'] == 2


def test_two_devices_editing_different_slices_both_land(state_client):
    _patch(state_client, {'profile': {'income': '1'}, 'goals': []}, base=0)   # v1, both devices read v1
    phone = _patch(state_client, {'goals': [{'id': 'phone'}]}, base=1)          # v2
    laptop = _patch(state_client, {'profile': {'income': '2'}}, base=1)         # profile unchanged since v1
    assert phone.status_code == 200 and laptop.status_code == 200
    data = state_client.get('/api/user/state', headers=A).json()['data']
    assert data == {'profile': {'income': '2'}, 'goals': [{'id': 'phone'}]}


def test_a_stale_write_to_a_slice_another_device_changed_is_refused_with_the_current_copy(state_client):
    _patch(state_client, {'profile': {'income': '1'}}, base=0)                  # v1
    assert _patch(state_client, {'profile': {'income': 'phone'}}, base=1).status_code == 200  # v2
    stale = _patch(state_client, {'profile': {'income': 'laptop'}}, base=1)
    assert stale.status_code == 412
    detail = stale.json()['detail']
    assert detail['code'] == 'stale_state' and detail['slices'] == ['profile']
    assert detail['data']['profile']['income'] == 'phone' and detail['version'] == 2
    # Nothing was overwritten.
    assert state_client.get('/api/user/state', headers=A).json()['data']['profile']['income'] == 'phone'
    # The person chose this device's copy: force writes it.
    forced = _patch(state_client, {'profile': {'income': 'laptop'}}, base=1, force=True)
    assert forced.status_code == 200 and forced.json()['data']['profile']['income'] == 'laptop'


def test_clients_without_a_base_version_merge_as_before(state_client):
    _patch(state_client, {'profile': {'income': '1'}}, base=0)
    _patch(state_client, {'profile': {'income': '2'}}, base=1)
    assert _patch(state_client, {'profile': {'income': 'old-client'}}).status_code == 200


def test_put_with_a_stale_base_is_refused(state_client):
    state_client.put('/api/user/state', headers=A, json={'data': {'profile': {}}, 'base_version': 0})
    _patch(state_client, {'goals': []}, base=1)
    r = state_client.put('/api/user/state', headers=A, json={'data': {'profile': {'x': 1}}, 'base_version': 1})
    assert r.status_code == 412


def test_blob_shape_migration_runs_on_the_server_and_is_idempotent(state_client):
    assert migrate_state_shape({'strategy': 'hybrid'}) == {'strategy': 'rules'}
    assert migrate_state_shape(migrate_state_shape({'strategy': 'hybrid'})) == {'strategy': 'rules'}
    _patch(state_client, {'strategy': 'hybrid'})
    assert state_client.get('/api/user/state', headers=A).json()['data']['strategy'] == 'rules'


# ── Alembic against Postgres ────────────────────────────────────────────────

@pytest.fixture
def pg_url():
    raw = os.environ.get('RIGHTDUE_TEST_DATABASE_URL')
    if not raw:
        pytest.skip('Set RIGHTDUE_TEST_DATABASE_URL to the disposable localhost rightdue_test database.')
    from sqlalchemy.engine import make_url
    url = make_url(raw)
    assert url.host in ('127.0.0.1', 'localhost') and url.database == 'rightdue_test'
    return raw


async def _reset(conn):
    await conn.run_sync(Base.metadata.drop_all)
    await conn.execute(text('DROP TABLE IF EXISTS alembic_version'))


def _schema(sync_conn):
    insp = inspect(sync_conn)
    return {t: sorted(c['name'] for c in insp.get_columns(t)) for t in insp.get_table_names() if t != 'alembic_version'}


def _diff(sync_conn):
    from alembic.autogenerate import compare_metadata
    from alembic.migration import MigrationContext
    from api.db.migrations_filter import include_object
    return compare_metadata(MigrationContext.configure(sync_conn, opts={'include_object': include_object}), Base.metadata)


def test_an_empty_database_migrates_to_exactly_the_models(pg_url):
    from api.db.connection import database_engine

    async def go():
        engine = database_engine(pg_url)
        async with engine.begin() as conn:
            await _reset(conn)
            missing = await conn.run_sync(run_migrations)
            diff = await conn.run_sync(_diff)
            rev = (await conn.execute(text('SELECT version_num FROM alembic_version'))).scalar_one()
        await engine.dispose()
        return missing, diff, rev

    missing, diff, rev = asyncio.run(go())
    assert missing == []
    # A model change without a migration fails here: add one under
    # api/db/migrations/versions (alembic revision --autogenerate -m "...").
    assert diff == [], diff
    assert rev == '0006_share_links'  # 0005_retention -> family share links


def test_a_database_made_by_create_all_is_stamped_then_upgraded_keeping_its_data(pg_url):
    from api.db.connection import database_engine

    async def go():
        engine = database_engine(pg_url)
        async with engine.begin() as conn:
            await _reset(conn)
            # The pre-Alembic production shape: create_all of the old models.
            await conn.run_sync(Base.metadata.create_all)
            await conn.execute(text('ALTER TABLE user_state DROP COLUMN version, DROP COLUMN slice_versions, DROP COLUMN slice_writers'))
            await conn.execute(text("INSERT INTO users (id, email) VALUES ('00000000-0000-0000-0000-000000000001', 'old@example.com')"))
            await conn.execute(text("""INSERT INTO user_state (user_id, data) VALUES ('00000000-0000-0000-0000-000000000001', '{"profile": {"income": "5"}}')"""))
            await conn.run_sync(run_migrations)
            row = (await conn.execute(text('SELECT data, version, slice_versions FROM user_state'))).one()
            diff = await conn.run_sync(_diff)
            # Running again is a no-op.
            await conn.run_sync(run_migrations)
        await engine.dispose()
        return row, diff

    row, diff = asyncio.run(go())
    assert row.data == {'profile': {'income': '5'}} and row.version == 0 and row.slice_versions == {}
    assert diff == [], diff


def test_a_retried_write_whose_answer_was_lost_is_not_a_conflict(state_client):
    # E2E (account-persistence "signed in"): onboarding's PATCH committed, but
    # the full navigation to /plan cancelled the fetch, so the device kept the
    # change queued at its old version and sent it again. Same value: no 412.
    _patch(state_client, {'profile': {'income': '1', 'loans': [1, 2]}}, base=0)    # v1, answer lost
    again = _patch(state_client, {'profile': {'loans': [1, 2], 'income': '1'}}, base=0)
    assert again.status_code == 200
    # A different value at that old version is still refused.
    assert _patch(state_client, {'profile': {'income': 'other'}}, base=0).status_code == 412


def test_a_retried_put_of_the_same_blob_is_not_a_conflict(state_client):
    state_client.put('/api/user/state', headers=A, json={'data': {'profile': {'x': 1}}, 'base_version': 0})
    r = state_client.put('/api/user/state', headers=A, json={'data': {'profile': {'x': 1}}, 'base_version': 0})
    assert r.status_code == 200


def test_a_browser_is_never_in_conflict_with_its_own_earlier_write(state_client):
    # E2E (account-persistence "sign-in ended"): onboarding's PATCH committed
    # but its answer was lost to the page navigation; the device, still at
    # version 0, then edits the profile again (signed out, queued) and sends it
    # after signing in. Its own write is not "another device".
    phone = {'device_id': 'phone-1'}
    body = lambda data, base: {'data': data, 'base_version': base, **phone}
    assert state_client.patch('/api/user/state', headers=A, json=body({'profile': {'income': '120000'}}, 0)).status_code == 200
    again = state_client.patch('/api/user/state', headers=A, json=body({'profile': {'income': '70000'}}, 0))
    assert again.status_code == 200 and again.json()['data']['profile']['income'] == '70000'
    # Another browser on that same old version is still refused.
    other = state_client.patch('/api/user/state', headers=A, json={'data': {'profile': {'income': '1'}}, 'base_version': 0, 'device_id': 'laptop-1'})
    assert other.status_code == 412
    # And once the laptop wrote it, the phone's stale write is refused too.
    state_client.patch('/api/user/state', headers=A, json={'data': {'profile': {'income': 'laptop'}}, 'base_version': 2, 'device_id': 'laptop-1'})
    assert state_client.patch('/api/user/state', headers=A, json=body({'profile': {'income': 'phone'}}, 2)).status_code == 412
