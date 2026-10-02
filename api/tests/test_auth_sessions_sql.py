"""Real SQL session revocation and cookie expiry; SQLite is a local adapter."""
from contextlib import asynccontextmanager
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker
from sqlalchemy.ext.compiler import compiles, deregister
from sqlalchemy.dialects.postgresql import JSONB
from api.auth import dependencies
from api.auth.routes import router
from api.auth.session import utc_now
from api.db.database import Base, get_db


@pytest.fixture
def auth_client(tmp_path, monkeypatch):
    compiles(JSONB, 'sqlite')(lambda element, compiler, **kw: 'JSON')
    engine = create_async_engine(f'sqlite+aiosqlite:///{tmp_path / "auth.sqlite"}')
    sessions = async_sessionmaker(engine, expire_on_commit=False)
    # SQLite strips timezone offsets from SQL timestamps; production Postgres
    # returns aware timestamps and uses the unmodified clock.
    monkeypatch.setattr(dependencies, 'utc_now', lambda: utc_now().replace(tzinfo=None))
    codes = []
    monkeypatch.setattr('api.auth.routes.send_otp_email', lambda email, code: codes.append(code))

    @asynccontextmanager
    async def lifespan(app):
        async with engine.begin() as connection:
            await connection.run_sync(Base.metadata.create_all)
        yield
        await engine.dispose()

    async def database():
        async with sessions() as db:
            yield db

    app = FastAPI(lifespan=lifespan)
    app.include_router(router, prefix='/api')
    app.dependency_overrides[get_db] = database
    try:
        with TestClient(app) as client:
            yield client, codes
    finally:
        deregister(JSONB)


def login(client, codes):
    email = 'session-test@example.com'
    assert client.post('/api/auth/request-otp', json={'email': email}).status_code == 204
    response = client.post('/api/auth/verify-otp', json={'email': email, 'code': codes[-1]})
    assert response.status_code == 200
    return response.cookies['finoptima_session']


def test_logout_clears_cookie_and_revokes_only_the_current_session(auth_client):
    client, codes = auth_client
    first, second = login(client, codes), login(client, codes)
    response = client.post('/api/auth/logout', headers={'Cookie': f'finoptima_session={first}'})
    assert response.status_code == 204
    assert response.content == b''
    assert 'Max-Age=0' in response.headers['set-cookie']
    assert client.get('/api/auth/me', headers={'Cookie': f'finoptima_session={first}'}).status_code == 401
    assert client.get('/api/auth/me', headers={'Cookie': f'finoptima_session={second}'}).status_code == 200


def test_code_is_single_use_and_anonymous_logout_also_expires_cookie(auth_client):
    client, codes = auth_client
    login(client, codes)
    response = client.post('/api/auth/verify-otp', json={'email': 'session-test@example.com', 'code': codes[-1]})
    assert response.status_code == 400
    response = client.post('/api/auth/logout', headers={'Cookie': 'finoptima_session=invalid'})
    assert response.status_code == 204
    assert 'Max-Age=0' in response.headers['set-cookie']
