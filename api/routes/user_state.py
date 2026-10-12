"""Per-user state: opaque JSON blob, owned by the signed-in user.

GET  /api/user/state  → { data: object | null, updated_at: ISO | null, version: int }
PUT  /api/user/state  → { data, base_version? } replaces the blob wholesale
PATCH /api/user/state → { data, base_version?, force? } atomically merges top-level slices

Writes carrying `base_version` are refused with 412 (detail.code
"stale_state", with the current data and version) when a slice they touch
changed on another device after that version (critique #63).

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
    # Critique #63: the row's write counter. Send it back as `base_version`.
    version: int = 0


class UserStateIn(BaseModel):
    data: dict[str, Any]
    # The `version` this device last read or wrote. When given, a write to a
    # slice another device changed after that is refused with 412 and the
    # current state, so the device re-hydrates instead of overwriting it.
    # Omitted by clients older than this release: they merge as before.
    base_version: Optional[int] = None
    # The person chose to keep this device's copy of the conflicting slices.
    force: bool = False


# ── Blob-shape migrations (critique #63) ─────────────────────────────────────
# The blob's shape belongs to the web app, but a shape change must not wait
# for every device to run new client code. Each step takes a stored blob and
# returns it in the newer shape. GET answers with the upgraded blob and the
# next write stores it. Every step must be idempotent (safe to run on a blob
# already in the new shape), so no shape number is stored.


def _retire_hybrid(data: dict[str, Any]) -> dict[str, Any]:
    # Roadmap PR E retired the 'hybrid' payoff order: an account saved with it
    # gets 'rules', whose default rule is Hybrid's. Was done only on the
    # client (server-sync.ts hydrateLocalStores).
    if data.get("strategy") == "hybrid":
        return {**data, "strategy": "rules"}
    return data


SHAPE_STEPS = (_retire_hybrid,)


def migrate_state_shape(data: dict[str, Any]) -> dict[str, Any]:
    for step in SHAPE_STEPS:
        data = step(data)
    return data


def _out(row: UserState) -> UserStateOut:
    return UserStateOut(
        data=migrate_state_shape(dict(row.data or {})),
        updated_at=row.updated_at.isoformat() if row.updated_at else None,
        version=row.version or 0,
    )


def _stale_slices(row: UserState, payload: UserStateIn, whole: bool) -> list[str]:
    """Slices this write would overwrite that changed after `base_version`."""
    if payload.base_version is None or payload.force:
        return []
    versions = row.slice_versions or {}
    if whole:
        # PUT replaces every slice: any write after base_version is a conflict.
        if (row.version or 0) <= payload.base_version:
            return []
        current = row.data or {}
        incoming = migrate_state_shape(dict(payload.data))
        if current == incoming:
            return []  # the same blob again (a retried write): nothing to lose
        return sorted(versions)
    current = row.data or {}
    incoming = migrate_state_shape(dict(payload.data))
    # A slice that already holds exactly this value is not a conflict: it is
    # this device's own earlier write whose answer never reached it (a full
    # page navigation cancels the fetch after the server committed it), sent
    # again from the pending queue. Refusing it showed "changed on another
    # device" to someone using one device.
    return sorted(
        k for k in payload.data
        if int(versions.get(k, 0)) > payload.base_version and current.get(k) != incoming.get(k)
    )


def _conflict(row: UserState, stale: list[str]) -> HTTPException:
    current = _out(row)
    return HTTPException(412, {
        "code": "stale_state",
        "message": "This changed on another device after this one last loaded it.",
        "slices": stale,
        "data": current.data,
        "version": current.version,
        "updated_at": current.updated_at,
    })


def _check_account(user: User, x_account_id: str | None) -> None:
    if x_account_id is not None and x_account_id != str(user.id):
        raise HTTPException(409, 'The signed-in account changed. Reload before saving.')


@router.get("/state", response_model=UserStateOut)
async def get_state(
    db: Annotated[AsyncSession, Depends(get_db)],
    user: Annotated[User, Depends(current_user)],
    x_account_id: Annotated[str | None, Header()] = None,
) -> UserStateOut:
    _check_account(user, x_account_id)
    res = await db.execute(select(UserState).where(UserState.user_id == user.id))
    row = res.scalar_one_or_none()
    if row is None:
        return UserStateOut(data=None, updated_at=None, version=0)
    return _out(row)


async def _locked_row(db: AsyncSession, user: User) -> UserState | None:
    # Lock the user even when no state row exists yet. Two devices saving
    # different slices must merge against the latest committed state.
    await db.execute(select(User).where(User.id == user.id).with_for_update())
    res = await db.execute(select(UserState).where(UserState.user_id == user.id))
    return res.scalar_one_or_none()


@router.patch("/state", response_model=UserStateOut)
async def patch_state(
    payload: UserStateIn,
    db: Annotated[AsyncSession, Depends(get_db)],
    user: Annotated[User, Depends(current_user)],
    x_account_id: Annotated[str | None, Header()] = None,
) -> UserStateOut:
    _check_account(user, x_account_id)
    row = await _locked_row(db, user)
    incoming = payload.data
    if row is None:
        data = migrate_state_shape(incoming)
        _check_total_size(data)
        row = UserState(user_id=user.id, data=data, version=1, slice_versions={k: 1 for k in incoming})
        db.add(row)
    else:
        stale = _stale_slices(row, payload, whole=False)
        if stale:
            raise _conflict(row, stale)
        merged = migrate_state_shape({**(row.data or {}), **incoming})
        _check_total_size(merged)
        version = (row.version or 0) + 1
        row.data = merged
        row.version = version
        row.slice_versions = {**(row.slice_versions or {}), **{k: version for k in incoming}}
    await db.commit()
    await db.refresh(row)
    return _out(row)


@router.put("/state", response_model=UserStateOut)
async def put_state(
    payload: UserStateIn,
    db: Annotated[AsyncSession, Depends(get_db)],
    user: Annotated[User, Depends(current_user)],
    x_account_id: Annotated[str | None, Header()] = None,
) -> UserStateOut:
    _check_account(user, x_account_id)
    row = await _locked_row(db, user)
    incoming = payload.data
    data = migrate_state_shape(incoming)
    _check_total_size(data)
    if row is None:
        row = UserState(user_id=user.id, data=data, version=1, slice_versions={k: 1 for k in incoming})
        db.add(row)
    else:
        stale = _stale_slices(row, payload, whole=True)
        if stale:
            raise _conflict(row, stale)
        version = (row.version or 0) + 1
        row.data = data
        row.version = version
        row.slice_versions = {k: version for k in incoming}
    await db.commit()
    await db.refresh(row)
    return _out(row)
