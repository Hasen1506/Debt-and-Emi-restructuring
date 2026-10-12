"""Auth routes: email-OTP sign-in flow.

Flow:
  POST /auth/request-otp { email }       → 204, OTP emailed (no account yet)
  POST /auth/verify-otp  { email, code } → 200 + Set-Cookie session; the
                                           account is created here, on first proof
  POST /auth/logout                      → 204, session revoked + cookie cleared
  GET  /auth/me                          → current user JSON or 401
"""
from __future__ import annotations

import hmac
import logging
import os
from datetime import timedelta
from typing import Annotated, Optional

from fastapi import APIRouter, Cookie, Depends, HTTPException, Request, Response, status
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy import func, select, text, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.concurrency import run_in_threadpool

from api import client_ip
from api.auth import retention, turnstile
from api.auth.dependencies import current_user, current_user_optional, session_token_condition
from api.auth.email import send_otp_email
from api.auth.session import (
    OTP_DAILY_WINDOW,
    OTP_GLOBAL_DAILY_CAP,
    OTP_MAX_ATTEMPTS,
    OTP_MAX_FAILED_DAILY,
    OTP_MAX_REQUESTS,
    OTP_MAX_REQUESTS_DAILY,
    OTP_TTL,
    SESSION_COOKIE_NAME,
    SESSION_TTL,
    generate_otp,
    generate_session_token,
    hash_otp,
    hash_session_token,
    otp_expiry,
    session_expiry,
    utc_now,
)
from api.db.database import get_db
from api.db.models import OtpChallenge, Session, User

log = logging.getLogger(__name__)

router = APIRouter(prefix="/auth", tags=["auth"])

# Cookie security toggles based on environment. Set COOKIE_SECURE=1 in prod.
_COOKIE_SECURE = os.environ.get("COOKIE_SECURE", "0") == "1"
_COOKIE_SAMESITE = os.environ.get("COOKIE_SAMESITE", "lax")


class RequestOtpIn(BaseModel):
    email: EmailStr
    # Cloudflare Turnstile token; required only when TURNSTILE_SECRET_KEY is set.
    turnstile_token: Optional[str] = Field(default=None, max_length=2048)


class VerifyOtpIn(BaseModel):
    email: EmailStr
    code: str = Field(min_length=6, max_length=6, pattern=r"^\d{6}$")


class UserOut(BaseModel):
    id: str
    email: str
    display_name: Optional[str] = None


def _user_out(user: User) -> UserOut:
    return UserOut(id=str(user.id), email=user.email, display_name=user.display_name)


def _set_session_cookie(response: Response, token: str) -> None:
    response.set_cookie(
        key=SESSION_COOKIE_NAME,
        value=token,
        max_age=int(SESSION_TTL.total_seconds()),
        httponly=True,
        secure=_COOKIE_SECURE,
        samesite=_COOKIE_SAMESITE,
        path="/",
    )


def _clear_session_cookie(response: Response) -> None:
    response.delete_cookie(SESSION_COOKIE_NAME, path="/")


async def _lock_email(db: AsyncSession, email: str) -> None:
    """Serialize everything that issues or consumes a code for one email.

    Before grill #59 the users row was the lock; an unverified email has no
    row now, so Postgres takes a transaction-scoped advisory lock on the
    address instead (released at commit or rollback). SQLite, the local
    test adapter, already allows one writer at a time.
    """
    if db.bind.dialect.name == "postgresql":
        await db.execute(text("SELECT pg_advisory_xact_lock(hashtextextended(:k, 0))"), {"k": "otp:" + email})


def _too_many(message: str, retry_after: timedelta) -> HTTPException:
    return HTTPException(
        status.HTTP_429_TOO_MANY_REQUESTS, message,
        headers={"Retry-After": str(int(retry_after.total_seconds()))},
    )


@router.post("/request-otp", status_code=status.HTTP_204_NO_CONTENT)
async def request_otp(
    payload: RequestOtpIn,
    request: Request,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> Response:
    email = payload.email.lower().strip()

    # Turnstile (off unless TURNSTILE_SECRET_KEY is set): checked before any
    # database work, so a script without a real browser costs us nothing.
    if turnstile.enabled():
        ok = await run_in_threadpool(turnstile.verify, payload.turnstile_token, client_ip.from_request(request))
        if not ok:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, {
                "code": "turnstile_failed", "field": "turnstile_token",
                "message": "Please complete the check above the button, then send the code again.",
            })

    # No users row here (grill #59): an address becomes an account only when
    # its owner proves it by entering the code.
    await _lock_email(db, email)
    now = utc_now()
    recent_requests = (await db.execute(
        select(func.count()).select_from(OtpChallenge)
        .where(OtpChallenge.email == email).where(OtpChallenge.created_at > now - OTP_TTL)
    )).scalar_one()
    if recent_requests >= OTP_MAX_REQUESTS:
        raise _too_many("Too many codes requested for this email. Try again in ten minutes.", OTP_TTL)
    daily_requests = (await db.execute(
        select(func.count()).select_from(OtpChallenge)
        .where(OtpChallenge.email == email).where(OtpChallenge.created_at > now - OTP_DAILY_WINDOW)
    )).scalar_one()
    if daily_requests >= OTP_MAX_REQUESTS_DAILY:
        raise _too_many("Too many codes requested for this email today. Try again tomorrow.", OTP_DAILY_WINDOW)
    # One cap across every address, below the email provider's daily quota.
    sent_today = (await db.execute(
        select(func.count()).select_from(OtpChallenge).where(OtpChallenge.created_at > now - OTP_DAILY_WINDOW)
    )).scalar_one()
    if sent_today >= OTP_GLOBAL_DAILY_CAP:
        log.warning("Global daily sign-in code cap (%s) reached.", OTP_GLOBAL_DAILY_CAP)
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, {
            "code": "sign_in_paused", "field": "",
            "message": "New sign-in codes are paused for today because of unusually many requests. "
                       "Your saved data is safe. Please try again tomorrow.",
        }, headers={"Retry-After": str(int(OTP_DAILY_WINDOW.total_seconds()))})

    await db.execute(
        update(OtpChallenge).where(OtpChallenge.email == email).where(OtpChallenge.used_at.is_(None))
        .values(used_at=now, code_hash="")
    )
    code = generate_otp()
    otp = OtpChallenge(email=email, code_hash=hash_otp(code), expires_at=otp_expiry(), created_at=now)
    db.add(otp)
    await db.commit()

    # Send email after commit so we don't deliver an OTP we then fail to persist.
    try:
        await run_in_threadpool(send_otp_email, email, code)
    except Exception:
        # Invalidate only this issuance; a newer request may already exist.
        await db.execute(update(OtpChallenge).where(OtpChallenge.id == otp.id).values(used_at=utc_now(), code_hash=""))
        await db.commit()
        # Never claim an email was sent, expose provider credentials/errors,
        # or publish a production sign-in code to deployment logs.
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "Email sign-in is unavailable. Please try again later.") from None
    await retention.maybe_purge(db)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/verify-otp")
async def verify_otp(
    payload: VerifyOtpIn,
    response: Response,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> UserOut:
    email = payload.email.lower().strip()

    # Serialize verification attempts so one code cannot mint two sessions
    # or lose failed-attempt increments during concurrent requests.
    await _lock_email(db, email)

    # Most-recent unused, unexpired code for this email.
    now = utc_now()
    res = await db.execute(
        select(OtpChallenge)
        .where(OtpChallenge.email == email)
        .where(OtpChallenge.used_at.is_(None))
        .where(OtpChallenge.expires_at > now)
        .order_by(OtpChallenge.created_at.desc())
        .limit(1)
    )
    otp = res.scalar_one_or_none()
    if otp is None:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Code expired or not requested. Request a new one.")

    if otp.attempts >= OTP_MAX_ATTEMPTS:
        raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, "Too many attempts. Request a new code.")

    # Wrong guesses count across codes for this email (M7), so requesting a
    # new code doesn't reset the budget.
    failed_today = (await db.execute(
        select(func.coalesce(func.sum(OtpChallenge.attempts), 0))
        .where(OtpChallenge.email == email).where(OtpChallenge.created_at > now - OTP_DAILY_WINDOW)
    )).scalar_one()
    if failed_today >= OTP_MAX_FAILED_DAILY:
        raise _too_many("Too many wrong codes for this email today. Try again tomorrow.", OTP_DAILY_WINDOW)

    if not hmac.compare_digest(otp.code_hash, hash_otp(payload.code)):
        otp.attempts += 1
        await db.commit()
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Incorrect code.")

    # Success: the email is proven, so this is where an account is created.
    otp.used_at = now
    otp.code_hash = ""
    res = await db.execute(select(User).where(User.email == email).with_for_update())
    user = res.scalar_one_or_none()
    if user is None:
        try:
            async with db.begin_nested():
                user = User(email=email)
                db.add(user)
                await db.flush()
        except IntegrityError:
            res = await db.execute(select(User).where(User.email == email).with_for_update())
            user = res.scalar_one()
    user.last_login_at = now
    token = generate_session_token()
    db.add(Session(token=hash_session_token(token), user_id=user.id, expires_at=session_expiry()))
    await db.commit()

    _set_session_cookie(response, token)
    return _user_out(user)


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
async def logout(
    response: Response,
    db: Annotated[AsyncSession, Depends(get_db)],
    user: Annotated[Optional[User], Depends(current_user_optional)],
    session_cookie: Annotated[Optional[str], Cookie(alias=SESSION_COOKIE_NAME)] = None,
) -> Response:
    if user is not None and session_cookie:
        # Sign out this browser only; other devices retain their sessions.
        res = await db.execute(
            select(Session).where(Session.user_id == user.id).where(session_token_condition(session_cookie)).where(Session.revoked_at.is_(None))
        )
        for sess in res.scalars():
            sess.revoked_at = utc_now()
        await db.commit()
    _clear_session_cookie(response)
    response.status_code = status.HTTP_204_NO_CONTENT
    return response


@router.get("/me")
async def me(user: Annotated[User, Depends(current_user)]) -> UserOut:
    return _user_out(user)
