"""Real SQL session revocation and cookie expiry; SQLite is a local adapter."""
from contextlib import asynccontextmanager
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker
from sqlalchemy.ext.compiler import compiles, deregister
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy import select
from api.auth import dependencies
from api.auth.routes import router
from api.auth.session import utc_now
from api.db.database import Base, get_db
from api.db.models import Session


@pytest.fixture
def auth_client(tmp_path, monkeypatch):
    compiles(JSONB, 'sqlite')(lambda element, compiler, **kw: 'JSON')
    engine = create_async_engine(f'sqlite+aiosqlite:///{tmp_path / "auth.sqlite"}')
    sessions = async_sessionmaker(engine, expire_on_commit=False)
    # SQLite strips timezone offsets from SQL timestamps; production Postgres
    # returns aware timestamps and uses the unmodified clock.
    monkeypatch.setattr(dependencies, 'utc_now', lambda: utc_now().replace(tzinfo=None))
    codes = []
    issued_codes = iter(f'{i:06d}' for i in range(1, 100))
    monkeypatch.setattr('api.auth.routes.generate_otp', lambda: next(issued_codes))
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
    app.state.sessions = sessions
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


def test_requesting_a_new_code_invalidates_all_earlier_codes(auth_client):
    client, codes = auth_client
    email = 'replacement@example.com'
    for _ in range(2):
        assert client.post('/api/auth/request-otp', json={'email': email}).status_code == 204
    assert client.post('/api/auth/verify-otp', json={'email': email, 'code': codes[-1]}).status_code == 200
    # An older unused code must not become valid after consuming its successor.
    assert client.post('/api/auth/verify-otp', json={'email': email, 'code': codes[0]}).status_code == 400


def test_failed_email_delivery_does_not_leave_a_usable_code(auth_client, monkeypatch):
    client, codes = auth_client
    email = 'delivery-failure@example.com'

    def fail_delivery(email, code):
        codes.append(code)
        raise RuntimeError('provider failure')

    monkeypatch.setattr('api.auth.routes.send_otp_email', fail_delivery)
    response = client.post('/api/auth/request-otp', json={'email': email})
    assert response.status_code == 503
    assert client.post('/api/auth/verify-otp', json={'email': email, 'code': codes[-1]}).status_code == 400


def test_code_requests_are_limited_per_email_even_across_client_addresses(auth_client):
    client, codes = auth_client
    for i in range(5):
        assert client.post('/api/auth/request-otp', headers={'x-forwarded-for': f'192.0.2.{i}'},
                           json={'email': 'mail-limit@example.com'}).status_code == 204
    response = client.post('/api/auth/request-otp', headers={'x-forwarded-for': '192.0.2.99'},
                           json={'email': 'MAIL-LIMIT@example.com'})
    assert response.status_code == 429
    assert int(response.headers['retry-after']) > 0
    assert len(codes) == 5


def test_database_session_digest_is_not_a_bearer_credential(auth_client):
    client, codes = auth_client
    token = login(client, codes)

    async def stored_session():
        async with client.app.state.sessions() as db:
            return (await db.execute(select(Session))).scalar_one()

    stored = client.portal.call(stored_session)
    assert stored.token != token
    assert stored.token.startswith('sha256:')
    assert client.get('/api/auth/me', headers={'Cookie': f'finoptima_session={stored.token}'}).status_code == 401
    assert client.get('/api/auth/me', headers={'Cookie': f'finoptima_session={token}'}).status_code == 200


def test_legacy_sessions_remain_usable_but_expire_at_the_exact_deadline(auth_client, monkeypatch):
    client, codes = auth_client
    login(client, codes)

    async def add_legacy_session():
        async with client.app.state.sessions() as db:
            existing = (await db.execute(select(Session))).scalar_one()
            db.add(Session(token='legacy-cookie', user_id=existing.user_id, expires_at=existing.expires_at))
            await db.commit()
            return existing.expires_at

    expiry = client.portal.call(add_legacy_session)
    headers = {'Cookie': 'finoptima_session=legacy-cookie'}
    assert client.get('/api/auth/me', headers=headers).status_code == 200
    monkeypatch.setattr(dependencies, 'utc_now', lambda: expiry)
    assert client.get('/api/auth/me', headers=headers).status_code == 401
