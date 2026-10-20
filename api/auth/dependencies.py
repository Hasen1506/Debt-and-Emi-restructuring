"""FastAPI dependencies for resolving the current user from a session cookie."""
from __future__ import annotations

from datetime import timedelta
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
    now = utc_now()
    if sess.expires_at <= now:
        return None
    user_id = sess.user_id   # read before a rollback expires the instance
    # audit80 D21: "last used" on the device list, written at most hourly.
    if sess.last_seen_at is None or now - _naive_like(sess.last_seen_at, now) > LAST_SEEN_EVERY:
        try:
            sess.last_seen_at = now
            await db.commit()
        except Exception:  # never fail a request over a timestamp
            await db.rollback()
    res = await db.execute(select(User).where(User.id == user_id))
    return res.scalar_one_or_none()


LAST_SEEN_EVERY = timedelta(hours=1)


def _naive_like(value, ref):
    """SQLite hands back naive datetimes; compare like with like."""
    if (value.tzinfo is None) != (ref.tzinfo is None):
        return value.replace(tzinfo=ref.tzinfo)
    return value


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
