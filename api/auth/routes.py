"""Auth routes: email-OTP sign-in flow.

Flow:
  POST /auth/request-otp { email }       → 204, OTP emailed
  POST /auth/verify-otp  { email, code } → 200 + Set-Cookie session
  POST /auth/logout                      → 204, session revoked + cookie cleared
  GET  /auth/me                          → current user JSON or 401
"""
from __future__ import annotations

import os
from datetime import timedelta
from typing import Annotated, Optional

from fastapi import APIRouter, Depends, HTTPException, Response, status
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from api.auth.dependencies import current_user, current_user_optional
from api.auth.email import send_otp_email
from api.auth.session import (
    OTP_MAX_ATTEMPTS,
    SESSION_COOKIE_NAME,
    SESSION_TTL,
    generate_otp,
    generate_session_token,
    hash_otp,
    otp_expiry,
    session_expiry,
    utc_now,
)
from api.db.database import get_db
from api.db.models import OtpCode, Session, User

router = APIRouter(prefix="/auth", tags=["auth"])

# Cookie security toggles based on environment. Set COOKIE_SECURE=1 in prod.
_COOKIE_SECURE = os.environ.get("COOKIE_SECURE", "0") == "1"
_COOKIE_SAMESITE = os.environ.get("COOKIE_SAMESITE", "lax")


class RequestOtpIn(BaseModel):
    email: EmailStr


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


@router.post("/request-otp", status_code=status.HTTP_204_NO_CONTENT)
async def request_otp(
    payload: RequestOtpIn,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> Response:
    email = payload.email.lower().strip()

    # Upsert user.
    res = await db.execute(select(User).where(User.email == email))
    user = res.scalar_one_or_none()
    if user is None:
        user = User(email=email)
        db.add(user)
        await db.flush()

    code = generate_otp()
    db.add(
        OtpCode(
            user_id=user.id,
            code_hash=hash_otp(code),
            expires_at=otp_expiry(),
        )
    )
    await db.commit()

    # Send email after commit so we don't deliver an OTP we then fail to persist.
    try:
        send_otp_email(email, code)
    except Exception:
        # Never claim an email was sent, expose provider credentials/errors,
        # or publish a production sign-in code to deployment logs.
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "Email sign-in is unavailable. Please try again later.") from None
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/verify-otp")
async def verify_otp(
    payload: VerifyOtpIn,
    response: Response,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> UserOut:
    email = payload.email.lower().strip()

    res = await db.execute(select(User).where(User.email == email))
    user = res.scalar_one_or_none()
    if user is None:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "No code requested for this email.")

    # Most-recent unused, unexpired OTP for this user.
    now = utc_now()
    res = await db.execute(
        select(OtpCode)
        .where(OtpCode.user_id == user.id)
        .where(OtpCode.used_at.is_(None))
        .where(OtpCode.expires_at > now)
        .order_by(OtpCode.created_at.desc())
        .limit(1)
    )
    otp = res.scalar_one_or_none()
    if otp is None:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Code expired — request a new one.")

    if otp.attempts >= OTP_MAX_ATTEMPTS:
        raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, "Too many attempts — request a new code.")

    if otp.code_hash != hash_otp(payload.code):
        otp.attempts += 1
        await db.commit()
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Incorrect code.")

    # Success: mark used, mint a session.
    otp.used_at = now
    user.last_login_at = now
    token = generate_session_token()
    db.add(Session(token=token, user_id=user.id, expires_at=session_expiry()))
    await db.commit()

    _set_session_cookie(response, token)
    return _user_out(user)


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
async def logout(
    response: Response,
    db: Annotated[AsyncSession, Depends(get_db)],
    user: Annotated[Optional[User], Depends(current_user_optional)],
) -> Response:
    if user is not None:
        # Revoke all active sessions for this user. Cheap and reliable;
        # we don't know which token the browser is holding without extra
        # plumbing, and global logout is the user's mental model anyway.
        res = await db.execute(
            select(Session).where(Session.user_id == user.id).where(Session.revoked_at.is_(None))
        )
        for sess in res.scalars():
            sess.revoked_at = utc_now()
        await db.commit()
    _clear_session_cookie(response)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/me")
async def me(user: Annotated[User, Depends(current_user)]) -> UserOut:
    return _user_out(user)
