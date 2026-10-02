"""Real SQL storage round-trips with independent request sessions.

SQLite is only a local test adapter; Render continues to use Postgres JSONB.
The authenticated identity dependency is controlled here, not OTP delivery.
"""
import uuid
from contextlib import asynccontextmanager
import pytest
from fastapi import FastAPI, HTTPException, Request
from fastapi.testclient import TestClient
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker
from sqlalchemy.ext.compiler import compiles, deregister
from sqlalchemy.dialects.postgresql import JSONB
from api.auth.dependencies import current_user
from api.db.database import Base, get_db
from api.db.models import User
from api.routes.user_state import router


@pytest.fixture
def state_client(tmp_path):
    compiles(JSONB, 'sqlite')(lambda element, compiler, **kw: 'JSON')
    engine = create_async_engine(f'sqlite+aiosqlite:///{tmp_path / "state.sqlite"}')
    sessions = async_sessionmaker(engine, expire_on_commit=False)
    ids = {'A': uuid.uuid4(), 'B': uuid.uuid4()}

    @asynccontextmanager
    async def lifespan(app):
        async with engine.begin() as connection:
            await connection.run_sync(Base.metadata.create_all)
        async with sessions() as db:
            db.add_all([User(id=identifier, email=f'{name}@example.com') for name, identifier in ids.items()])
            await db.commit()
        yield
        await engine.dispose()

    async def database():
        async with sessions() as db:
            yield db

    async def identity(request: Request):
        name = request.headers.get('x-test-user')
        if name not in ids:
            raise HTTPException(401, 'Not authenticated')
        return User(id=ids[name], email=f'{name}@example.com')

    app = FastAPI(lifespan=lifespan)
    app.include_router(router, prefix='/api')
    app.dependency_overrides[get_db] = database
    app.dependency_overrides[current_user] = identity
    try:
        with TestClient(app) as client:
            yield client
    finally:
        deregister(JSONB)


def test_device_saves_preserve_unrelated_slices_in_database(state_client):
    a = {'x-test-user': 'A'}
    assert state_client.get('/api/user/state', headers=a).json()['data'] is None
    for patch in [{'profile': {'income': '100000.25'}}, {'goals': [{'id': 'g'}]}, {'activity': [{'amount': '500.25'}]}]:
        assert state_client.patch('/api/user/state', headers=a, json={'data': patch}).status_code == 200
    # Each HTTP call uses a new SQL session, like a reload or second device.
    data = state_client.get('/api/user/state', headers=a).json()['data']
    assert data == {'profile': {'income': '100000.25'}, 'goals': [{'id': 'g'}], 'activity': [{'amount': '500.25'}]}
    state_client.patch('/api/user/state', headers=a, json={'data': {'goals': []}})
    data = state_client.get('/api/user/state', headers=a).json()['data']
    assert data['goals'] == []
    assert data['activity'][0]['amount'] == '500.25'


def test_state_is_owned_by_signed_in_user_and_unauthenticated_writes_fail(state_client):
    a, b = {'x-test-user': 'A'}, {'x-test-user': 'B'}
    state_client.patch('/api/user/state', headers=a, json={'data': {'profile': {'name': 'A'}}})
    assert state_client.get('/api/user/state', headers=b).json()['data'] is None
    state_client.patch('/api/user/state', headers=b, json={'data': {'profile': {'name': 'B'}}})
    assert state_client.get('/api/user/state', headers=a).json()['data']['profile']['name'] == 'A'
    assert state_client.patch('/api/user/state', json={'data': {'profile': {}}}).status_code == 401
    assert state_client.get('/api/user/state').status_code == 401


@pytest.mark.parametrize('method', ['get', 'patch', 'put'])
def test_stale_browser_account_cannot_write_to_current_cookie_account(state_client, method):
    a = {'x-test-user': 'A'}
    state_client.patch('/api/user/state', headers=a, json={'data': {'profile': {'name': 'A'}}})
    response = getattr(state_client, method)(
        '/api/user/state', headers={**a, 'x-account-id': str(uuid.uuid4())},
        **({} if method == 'get' else {'json': {'data': {'profile': {'name': 'wrong-account'}}}}),
    )
    assert response.status_code == 409
    assert state_client.get('/api/user/state', headers=a).json()['data']['profile']['name'] == 'A'
