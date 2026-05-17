"""FastAPI dependencies for resolving the current user from a session cookie."""
from __future__ import annotations

from typing import Annotated, Optional

from fastapi import Cookie, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from api.auth.session import SESSION_COOKIE_NAME, utc_now
from api.db.database import get_db
from api.db.models import Session, User


async def _load_user_from_cookie(
    token: Optional[str], db: AsyncSession
) -> Optional[User]:
    if not token:
        return None
    res = await db.execute(select(Session).where(Session.token == token))
    sess = res.scalar_one_or_none()
    if sess is None or sess.revoked_at is not None:
        return None
    if sess.expires_at < utc_now():
        return None
    res = await db.execute(select(User).where(User.id == sess.user_id))
    return res.scalar_one_or_none()


async def current_user_optional(
    db: Annotated[AsyncSession, Depends(get_db)],
    session_cookie: Annotated[Optional[str], Cookie(alias=SESSION_COOKIE_NAME)] = None,
) -> Optional[User]:
    return await _load_user_from_cookie(session_cookie, db)


async def current_user(
    db: Annotated[AsyncSession, Depends(get_db)],
    session_cookie: Annotated[Optional[str], Cookie(alias=SESSION_COOKIE_NAME)] = None,
) -> User:
    user = await _load_user_from_cookie(session_cookie, db)
    if user is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, detail="Not authenticated")
    return user
