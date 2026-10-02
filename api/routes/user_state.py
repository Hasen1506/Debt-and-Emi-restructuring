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

from typing import Annotated, Any, Optional

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from api.auth.dependencies import current_user
from api.db.database import get_db
from api.db.models import User, UserState

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
) -> UserStateOut:
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
) -> UserStateOut:
    # Lock the user even when no state row exists yet. Two devices saving
    # different slices must merge against the latest committed state.
    await db.execute(select(User).where(User.id == user.id).with_for_update())
    res = await db.execute(select(UserState).where(UserState.user_id == user.id))
    row = res.scalar_one_or_none()
    if row is None:
        row = UserState(user_id=user.id, data=payload.data)
        db.add(row)
    else:
        row.data = {**row.data, **payload.data}
    await db.commit()
    await db.refresh(row)
    return UserStateOut(data=row.data, updated_at=row.updated_at.isoformat() if row.updated_at else None)


@router.put("/state", response_model=UserStateOut)
async def put_state(
    payload: UserStateIn,
    db: Annotated[AsyncSession, Depends(get_db)],
    user: Annotated[User, Depends(current_user)],
) -> UserStateOut:
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
