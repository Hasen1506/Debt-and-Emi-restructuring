"""Production locking checks against a disposable localhost database only."""
import asyncio
import os
from contextlib import asynccontextmanager
from decimal import Decimal

import httpx
import pytest
from fastapi import FastAPI
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker

from api.auth import routes as auth
from api.auth.session import hash_otp
from api.db.connection import database_engine
from api.db.database import Base, get_db
from api.db.models import OtpChallenge, Session, User
from api.outcomes_store import LimitReached, OutcomeStore, metadata
from api.routes.user_state import router as state_router
from engine.outcomes import Outcome, OutcomeReport


@pytest.fixture
def test_url():
    raw = os.environ.get('RIGHTDUE_TEST_DATABASE_URL')
    if not raw:
        pytest.skip('Set RIGHTDUE_TEST_DATABASE_URL to the disposable localhost rightdue_test database.')
    from sqlalchemy.engine import make_url
    url = make_url(raw)
    # These tests recreate tables. Refuse all hosted/real application DBs.
    assert url.host in ('127.0.0.1', 'localhost') and url.database == 'rightdue_test'
    return raw


@asynccontextmanager
async def database(raw):
    engine = database_engine(raw)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
        await conn.run_sync(metadata.drop_all)
        await conn.run_sync(Base.metadata.create_all)
    sessions = async_sessionmaker(engine, expire_on_commit=False)

    async def get_session():
        async with sessions() as session:
            yield session

    app = FastAPI()
    app.include_router(auth.router, prefix='/api')
    app.include_router(state_router, prefix='/api')
    app.dependency_overrides[get_db] = get_session
    try:
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url='http://localhost') as client:
            yield client, sessions, engine
    finally:
        await engine.dispose()


def test_concurrent_first_requests_create_one_usable_code_and_no_user_until_verified(test_url, monkeypatch):
    codes = []
    monkeypatch.setattr(auth, 'send_otp_email', lambda email, code: codes.append(code))
    sequence = iter(('123456', '654321'))
    monkeypatch.setattr(auth, 'generate_otp', lambda: next(sequence))

    async def run():
        async with database(test_url) as (client, sessions, engine):
            email = 'first-request@example.com'
            responses = await asyncio.gather(*(client.post('/api/auth/request-otp', json={'email': email}) for _ in range(2)))
            assert [r.status_code for r in responses] == [204, 204]
            async with sessions() as session:
                # Grill #59: requesting a code creates no account.
                assert (await session.execute(select(User))).scalars().all() == []
                active = (await session.execute(select(OtpChallenge).where(OtpChallenge.used_at.is_(None)))).scalar_one()
                usable = next(code for code in codes if hash_otp(code, email) == active.code_hash)
            # Race two consumers of exactly the same latest challenge.
            results = await asyncio.gather(*(client.post('/api/auth/verify-otp', json={'email': email, 'code': usable}) for _ in range(2)))
            assert sorted(r.status_code for r in results) == [200, 400]
            async with sessions() as session:
                assert len((await session.execute(select(Session))).scalars().all()) == 1
                assert len((await session.execute(select(User))).scalars().all()) == 1
    asyncio.run(run())


def test_concurrent_wrong_codes_cannot_lose_attempt_increments(test_url, monkeypatch):
    monkeypatch.setattr(auth, 'send_otp_email', lambda email, code: None)
    monkeypatch.setattr(auth, 'generate_otp', lambda: '123456')

    async def run():
        async with database(test_url) as (client, sessions, engine):
            email = 'attempts@example.com'
            assert (await client.post('/api/auth/request-otp', json={'email': email})).status_code == 204
            responses = await asyncio.gather(*(client.post('/api/auth/verify-otp', json={'email': email, 'code': '000000'}) for _ in range(8)))
            assert sorted(r.status_code for r in responses) == [400] * 5 + [429] * 3
            async with sessions() as session:
                assert (await session.execute(select(OtpChallenge))).scalar_one().attempts == 5
    asyncio.run(run())


def test_two_devices_patch_different_slices_without_lost_updates(test_url, monkeypatch):
    monkeypatch.setattr(auth, 'send_otp_email', lambda email, code: None)
    monkeypatch.setattr(auth, 'generate_otp', lambda: '123456')

    async def run():
        async with database(test_url) as (client, sessions, engine):
            email = 'state@example.com'
            await client.post('/api/auth/request-otp', json={'email': email})
            assert (await client.post('/api/auth/verify-otp', json={'email': email, 'code': '123456'})).status_code == 200
            responses = await asyncio.gather(
                client.patch('/api/user/state', json={'data': {'strategy': 'snowball'}}),
                client.patch('/api/user/state', json={'data': {'goals': [{'id': 'g'}]}}),
            )
            assert [r.status_code for r in responses] == [200, 200]
            assert (await client.get('/api/user/state')).json()['data'] == {'strategy': 'snowball', 'goals': [{'id': 'g'}]}
    asyncio.run(run())


def test_outcome_limits_hold_across_independent_server_workers(test_url):
    async def run():
        async with database(test_url) as (client, sessions, engine):
            stores = [OutcomeStore(engine, key=b'test-worker-key') for _ in range(8)]
            await stores[0].init()
            for store in stores[1:]:
                await store.init()
            report = OutcomeReport('hdfc', Outcome.REFUSED, 10, Decimal('.09'), None)
            responses = await asyncio.gather(*(store.add(report, '192.0.2.1') for store in stores), return_exceptions=True)
            assert sum(isinstance(r, int) for r in responses) == 2
            assert sum(isinstance(r, LimitReached) for r in responses) == 6
            # Different banks still share the same daily client budget.
            reports = [OutcomeReport(f'bank-{i}', Outcome.REFUSED, 10, Decimal('.09'), None) for i in range(12)]
            responses = await asyncio.gather(*(stores[i % len(stores)].add(report, '192.0.2.1')
                                               for i, report in enumerate(reports)), return_exceptions=True)
            assert sum(isinstance(r, int) for r in responses) == 8
            assert sum(isinstance(r, LimitReached) for r in responses) == 4
    asyncio.run(run())


def test_persisted_rate_buckets_count_exactly_under_concurrency(test_url):
    """Grill #59: the Postgres counter is one atomic upsert, so concurrent
    requests from one address can't slip past the hourly limit."""
    from datetime import datetime, timezone
    from api.rate_buckets import DbRateCounter, WindowLimit

    async def run():
        async with database(test_url) as (client, sessions, engine):
            counter = DbRateCounter(sessions, key=b'k', limits=[('/api/auth/request-otp', WindowLimit(limit=10))])
            now = datetime(2026, 10, 12, 10, 0, tzinfo=timezone.utc)
            results = await asyncio.gather(*(counter.hit('198.51.100.1', '/api/auth/request-otp', now) for _ in range(25)))
            assert sum(r is None for r in results) == 10
    asyncio.run(run())


def test_concurrent_requests_cannot_pass_the_global_daily_cap(test_url, monkeypatch):
    monkeypatch.setattr(auth, 'send_otp_email', lambda email, code: None)
    monkeypatch.setattr(auth, 'OTP_GLOBAL_DAILY_CAP', 3)

    async def run():
        async with database(test_url) as (client, sessions, engine):
            # Different emails take different advisory locks, so a few may
            # race past the count; the cap is a budget guard, and the
            # overshoot is bounded by concurrency, not by an attacker's rate.
            responses = [await client.post('/api/auth/request-otp', json={'email': f'g{i}@example.com'}) for i in range(5)]
            assert [r.status_code for r in responses] == [204, 204, 204, 503, 503]
    asyncio.run(run())
