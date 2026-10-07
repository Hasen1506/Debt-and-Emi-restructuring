"""Per-user state: opaque JSON blob, owned by the signed-in user.

GET  /api/user/state  → { data: object | null, updated_at: ISO | null }
PUT  /api/user/state  → { data: object } replaces the blob wholesale
PATCH /api/user/state → { data: object } atomically merges top-level slices

The blob is intentionally untyped server-side. The engine consumes a
typed UserPayload from the simulation endpoints; this store just gives
us a place to hang everything the frontend wants to persist across
devices (profile + lifecycle events + activity ledger + assets + plan
toggles + advance-tax). Schema lives in the frontend; backend is the
post office.
"""
from __future__ import annotations

import json

from typing import Annotated, Any, Optional

from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from api.auth.dependencies import current_user
from api.db.database import get_db
from api.db.models import User, UserState

# P2-28: each PATCH is capped at 256 KB, but new keys merged in without
# limit, so a row could grow forever and every app boot GETs all of it.
MAX_STATE_BYTES = 2 * 1024 * 1024


def _check_total_size(data: dict) -> None:
    size = len(json.dumps(data, separators=(",", ":"), default=str).encode("utf-8"))
    if size > MAX_STATE_BYTES:
        raise HTTPException(413, "Your saved data is too large. Remove old entries and try again.")


router = APIRouter(prefix="/user", tags=["user"])


class UserStateOut(BaseModel):
    data: Optional[dict[str, Any]] = None
    updated_at: Optional[str] = None


class UserStateIn(BaseModel):
    data: dict[str, Any]


@router.get("/state", response_model=UserStateOut)
async def get_state(
    db: Annotated[AsyncSession, Depends(get_db)],
    user: Annotated[User, Depends(current_user)],
    x_account_id: Annotated[str | None, Header()] = None,
) -> UserStateOut:
    if x_account_id is not None and x_account_id != str(user.id):
        raise HTTPException(409, 'The signed-in account changed. Reload before saving.')
    res = await db.execute(select(UserState).where(UserState.user_id == user.id))
    row = res.scalar_one_or_none()
    if row is None:
        return UserStateOut(data=None, updated_at=None)
    return UserStateOut(
        data=row.data,
        updated_at=row.updated_at.isoformat() if row.updated_at else None,
    )


@router.patch("/state", response_model=UserStateOut)
async def patch_state(
    payload: UserStateIn,
    db: Annotated[AsyncSession, Depends(get_db)],
    user: Annotated[User, Depends(current_user)],
    x_account_id: Annotated[str | None, Header()] = None,
) -> UserStateOut:
    if x_account_id is not None and x_account_id != str(user.id):
        raise HTTPException(409, 'The signed-in account changed. Reload before saving.')
    # Lock the user even when no state row exists yet. Two devices saving
    # different slices must merge against the latest committed state.
    await db.execute(select(User).where(User.id == user.id).with_for_update())
    res = await db.execute(select(UserState).where(UserState.user_id == user.id))
    row = res.scalar_one_or_none()
    if row is None:
        row = UserState(user_id=user.id, data=payload.data)
        db.add(row)
    else:
        merged = {**row.data, **payload.data}
        _check_total_size(merged)
        row.data = merged
    await db.commit()
    await db.refresh(row)
    return UserStateOut(data=row.data, updated_at=row.updated_at.isoformat() if row.updated_at else None)


@router.put("/state", response_model=UserStateOut)
async def put_state(
    payload: UserStateIn,
    db: Annotated[AsyncSession, Depends(get_db)],
    user: Annotated[User, Depends(current_user)],
    x_account_id: Annotated[str | None, Header()] = None,
) -> UserStateOut:
    if x_account_id is not None and x_account_id != str(user.id):
        raise HTTPException(409, 'The signed-in account changed. Reload before saving.')
    await db.execute(select(User).where(User.id == user.id).with_for_update())
    res = await db.execute(select(UserState).where(UserState.user_id == user.id))
    row = res.scalar_one_or_none()
    if row is None:
        row = UserState(user_id=user.id, data=payload.data)
        db.add(row)
    else:
        row.data = payload.data
    await db.commit()
    await db.refresh(row)
    return UserStateOut(
        data=row.data,
        updated_at=row.updated_at.isoformat() if row.updated_at else None,
    )
