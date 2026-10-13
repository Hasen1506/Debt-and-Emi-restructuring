"""FastAPI dependencies for resolving the current user from a session cookie."""
from __future__ import annotations

from typing import Annotated, Optional

from fastapi import Cookie, Depends, HTTPException, status
from sqlalchemy import and_, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from api.auth.session import LEGACY_SESSION_COOKIE_NAME, SESSION_COOKIE_NAME, hash_session_token, utc_now
from api.db.database import get_db
from api.db.models import Session, User


def session_token_condition(token: str):
    # Existing sessions expire normally. A stored digest must never itself
    # be accepted as a legacy cookie (otherwise hashing buys no protection).
    return or_(
        Session.token == hash_session_token(token),
        and_(Session.token == token, ~Session.token.like("sha256:%")),
    )


async def _load_user_from_cookie(
    token: Optional[str], db: AsyncSession
) -> Optional[User]:
    if not token:
        return None
    res = await db.execute(select(Session).where(session_token_condition(token)))
    sess = res.scalar_one_or_none()
    if sess is None or sess.revoked_at is not None:
        return None
    if sess.expires_at <= utc_now():
        return None
    res = await db.execute(select(User).where(User.id == sess.user_id))
    return res.scalar_one_or_none()


async def current_user_optional(
    db: Annotated[AsyncSession, Depends(get_db)],
    session_cookie: Annotated[Optional[str], Cookie(alias=SESSION_COOKIE_NAME)] = None,
    legacy_cookie: Annotated[Optional[str], Cookie(alias=LEGACY_SESSION_COOKIE_NAME)] = None,
) -> Optional[User]:
    return await _load_user_from_cookie(session_cookie or legacy_cookie, db)


async def current_user(
    db: Annotated[AsyncSession, Depends(get_db)],
    session_cookie: Annotated[Optional[str], Cookie(alias=SESSION_COOKIE_NAME)] = None,
    legacy_cookie: Annotated[Optional[str], Cookie(alias=LEGACY_SESSION_COOKIE_NAME)] = None,
) -> User:
    user = await _load_user_from_cookie(session_cookie or legacy_cookie, db)
    if user is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, detail="Not authenticated")
    return user
