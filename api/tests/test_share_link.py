"""A family share link is read-only, revocable, and never carries an account number."""
import uuid
from contextlib import asynccontextmanager

import pytest
from fastapi import FastAPI, HTTPException, Request
from fastapi.testclient import TestClient
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.ext.compiler import compiles, deregister
from sqlalchemy.dialects.postgresql import JSONB

from api.auth.dependencies import current_user
from api.db.database import Base, get_db
from api.db.models import User, UserState
from api.routes.share import public_snapshot, router


BLOB = {
    "profile": {
        "user": {
            "country": "IN",
            "email": "secret@example.com",
            "loans": [
                {
                    "bank": "Secret Bank",
                    "nickname": "Home",
                    "loan_type": "home_loan",
                    "outstanding": "2500000",
                    "scheduled_emi": "21696",
                    "nominal_rate": "0.085",
                    "account_last4": "4321",
                    "upi_vpa": "secret@upi",
                },
            ],
        },
    },
    "change_log": [
        {"what": "Debt-free date", "after": "Mar 2031"},
        {"what": "Interest on the plan", "after": "₹12,40,000"},
    ],
}


def test_snapshot_drops_email_account_and_upi_and_can_hide_the_loan():
    shown = public_snapshot(BLOB, False)
    text = str(shown)
    assert "secret@example.com" not in text
    assert "4321" not in text
    assert "secret@upi" not in text
    assert shown["loans"][0]["name"] == "Home loan"
    unnamed = public_snapshot(
        {"profile": {"user": {"country": "IN", "loans": [{"loan_type": "home_loan", "outstanding": "1000"}]}}},
        False,
    )
    assert unnamed["loans"][0]["name"] == "Home loan"
    assert shown["loans"][0]["balance"] == "2500000.0" or shown["loans"][0]["balance"].startswith("2500000")
    assert shown["debt_free"] == "Mar 2031"
    hidden = public_snapshot(BLOB, True)
    hidden_text = str(hidden)
    assert "Secret Bank" not in hidden_text
    assert "2500000" not in hidden_text
    assert "4321" not in hidden_text
    assert "loans" not in hidden
    assert hidden["loan_count"] == 1


@pytest.fixture
def share_client(tmp_path):
    compiles(JSONB, "sqlite")(lambda element, compiler, **kw: "JSON")
    engine = create_async_engine(f"sqlite+aiosqlite:///{tmp_path / 'share.sqlite'}")
    sessions = async_sessionmaker(engine, expire_on_commit=False)
    user_id = uuid.uuid4()

    @asynccontextmanager
    async def lifespan(app):
        async with engine.begin() as connection:
            await connection.run_sync(Base.metadata.create_all)
        async with sessions() as db:
            db.add(User(id=user_id, email="owner@example.com"))
            db.add(UserState(user_id=user_id, data=BLOB))
            await db.commit()
        yield
        await engine.dispose()

    async def database():
        async with sessions() as db:
            yield db

    async def identity(request: Request):
        if request.headers.get("x-test-user") != "owner":
            raise HTTPException(401, "Not authenticated")
        return User(id=user_id, email="owner@example.com")

    app = FastAPI(lifespan=lifespan)
    app.include_router(router, prefix="/api")
    app.dependency_overrides[get_db] = database
    app.dependency_overrides[current_user] = identity
    try:
        with TestClient(app) as client:
            yield client
    finally:
        deregister(JSONB)


def test_link_is_public_until_revoked_and_stays_hidden(share_client):
    owner = {"x-test-user": "owner"}
    assert share_client.get("/api/user/share").status_code == 401
    assert share_client.get("/api/user/share", headers=owner).json()["active"] is False
    made = share_client.post("/api/user/share", headers=owner, json={"hide_loans": True})
    assert made.status_code == 200
    token = made.json()["token"]
    body = share_client.get(f"/api/share/{token}").json()
    assert "Secret Bank" not in str(body)
    assert "4321" not in str(body)
    assert body["hide_loans"] is True
    share_client.post("/api/user/share", headers=owner, json={"hide_loans": False})
    shown = share_client.get(f"/api/share/{token}").json()
    assert shown["loans"][0]["name"] == "Home loan"
    assert "4321" not in str(shown)
    assert share_client.post("/api/user/share/revoke", headers=owner).json()["active"] is False
    assert share_client.get(f"/api/share/{token}").status_code == 404
