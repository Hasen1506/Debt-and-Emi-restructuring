"""Auth routes: email-OTP sign-in flow.

Flow:
  POST /auth/request-otp { email }       → 204, OTP emailed (no account yet)
  POST /auth/verify-otp  { email, code, notice_version, terms_version,
                           age_confirmed }
                                         → 200 + Set-Cookie session; the
                                           account is created here, on first
                                           proof, with its consent record (D2)
  POST /auth/logout                      → 204, session revoked + cookie cleared
  GET  /auth/me                          → current user JSON (+ consent_required) or 401
  GET  /auth/sessions                    → this account's signed-in devices (D21)
  POST /auth/sessions/{id}/revoke        → sign one device out
  POST /auth/sessions/revoke-all         → sign every device out (optionally
                                           keeping this one)

Sign-in code limits (audit80 D13). The old single cap on codes per day across
ALL addresses was a kill switch: anyone could spend it from a few IPs and
lock every user out for 24 hours. Now:
  * per address: 5 codes per 10 minutes, 20 a day (unchanged); an address
    that already has an account: OTP_ACCOUNT_DAILY_CAP a day (default 5);
  * per network (api/netkey.py: IPv4 address, IPv6 /64): at most
    OTP_NEW_PER_NETWORK_DAILY codes a day to addresses WITHOUT an account
    (default 5), so one network can't spend the new-sign-up budget;
  * the global circuit, OTP_GLOBAL_DAILY_CAP (default 60, under Resend's free
    100 a day), counts and blocks only codes to addresses WITHOUT an
    account. Existing accounts are never blocked by it, so the worst an
    attacker can do is pause new sign-ups for a day; nobody is locked out.
  * a warning (and a Sentry message when SENTRY_DSN is set) at half the cap.
  * Turnstile (api/auth/turnstile.py), when its two env vars are set, before
    any of this.
"""
from __future__ import annotations

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

from api import access_log, client_ip, netkey, observability
from api.auth import consent, retention, turnstile
from api.auth.dependencies import current_user, current_user_optional, session_token_condition
from api.auth.devices import device_label, public_session_id
from api.auth.email import send_otp_email
from api.auth.session import (
    OTP_ACCOUNT_DAILY_CAP,
    OTP_DAILY_WINDOW,
    OTP_GLOBAL_DAILY_CAP,
    OTP_NEW_PER_NETWORK_DAILY,
    OTP_MAX_ATTEMPTS,
    OTP_MAX_FAILED_DAILY,
    OTP_MAX_REQUESTS,
    OTP_MAX_REQUESTS_DAILY,
    OTP_TTL,
    LEGACY_SESSION_COOKIE_NAME,
    SESSION_COOKIE_NAME,
    SESSION_TTL,
    generate_otp,
    generate_session_token,
    hash_otp,
    hash_session_token,
    otp_expiry,
    otp_matches,
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
    # audit80 D2/D7: what the sign-in page showed and the user agreed to.
    # The web client always sends them; a client that doesn't still signs
    # in, and /auth/me then reports consent_required so the page asks.
    notice_version: Optional[str] = Field(default=None, max_length=32, pattern=r"^[0-9A-Za-z.\-]+$")
    terms_version: Optional[str] = Field(default=None, max_length=32, pattern=r"^[0-9A-Za-z.\-]+$")
    age_confirmed: Optional[bool] = None


class UserOut(BaseModel):
    id: str
    email: str
    display_name: Optional[str] = None
    # audit80 D2: true when this account has not agreed to the current
    # privacy notice and terms (new versions, or an account made before the
    # consent record existed). The web app then shows a one-tap re-consent.
    consent_required: bool = False


def _user_out(user: User, consent_required: bool = False) -> UserOut:
    return UserOut(id=str(user.id), email=user.email, display_name=user.display_name,
                   consent_required=consent_required)


_alerted_day: Optional[str] = None


def _maybe_alert(sent_new_today: int) -> None:
    """Once a day per process, when new-sign-up codes reach half the cap."""
    global _alerted_day
    if sent_new_today * 2 < OTP_GLOBAL_DAILY_CAP:
        return
    day = utc_now().strftime("%Y-%m-%d")
    if _alerted_day == day:
        return
    _alerted_day = day
    message = f"New-sign-up codes reached {sent_new_today} of the daily cap {OTP_GLOBAL_DAILY_CAP}."
    log.warning(message)
    observability.capture_message(message, level="warning", route="/api/auth/request-otp")


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
    response.delete_cookie(LEGACY_SESSION_COOKIE_NAME, path="/")


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
    has_account = (await db.execute(select(User.id).where(User.email == email))).first() is not None
    per_address = min(OTP_MAX_REQUESTS_DAILY, OTP_ACCOUNT_DAILY_CAP) if has_account else OTP_MAX_REQUESTS_DAILY
    if daily_requests >= per_address:
        raise _too_many("Too many codes requested for this email today. Try again tomorrow.", OTP_DAILY_WINDOW)
    network = netkey.network_key(client_ip.from_request(request))
    if not has_account:
        # D13: only codes for NEW addresses share a budget. An existing
        # account is never refused because strangers spent it.
        from_network = (await db.execute(
            select(func.count()).select_from(OtpChallenge)
            .where(OtpChallenge.network_key == network).where(OtpChallenge.for_account.is_(False))
            .where(OtpChallenge.created_at > now - OTP_DAILY_WINDOW)
        )).scalar_one()
        if from_network >= OTP_NEW_PER_NETWORK_DAILY:
            raise _too_many("Too many new sign-ups from this connection today. Try again tomorrow, "
                            "or from another connection.", OTP_DAILY_WINDOW)
        sent_new_today = (await db.execute(
            select(func.count()).select_from(OtpChallenge)
            .where(OtpChallenge.for_account.is_(False)).where(OtpChallenge.created_at > now - OTP_DAILY_WINDOW)
        )).scalar_one()
        if sent_new_today >= OTP_GLOBAL_DAILY_CAP:
            log.warning("Daily new-sign-up code cap (%s) reached; existing accounts can still sign in.", OTP_GLOBAL_DAILY_CAP)
            raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, {
                "code": "sign_up_paused", "field": "",
                "message": "New sign-ups are paused for today because of unusually many requests. "
                           "If you already have an account, check the email address. Otherwise please try again tomorrow.",
            }, headers={"Retry-After": str(int(OTP_DAILY_WINDOW.total_seconds()))})
        _maybe_alert(sent_new_today + 1)

    await db.execute(
        update(OtpChallenge).where(OtpChallenge.email == email).where(OtpChallenge.used_at.is_(None))
        .values(used_at=now, code_hash="")
    )
    code = generate_otp()
    otp = OtpChallenge(email=email, code_hash=hash_otp(code, email), expires_at=otp_expiry(), created_at=now,
                       network_key=network, for_account=has_account)
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
    request: Request,
    response: Response,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> UserOut:
    email = payload.email.lower().strip()
    agreement: Optional[consent.ConsentIn] = None
    if payload.notice_version is not None or payload.terms_version is not None or payload.age_confirmed is not None:
        if not (payload.notice_version and payload.terms_version):
            raise HTTPException(status.HTTP_400_BAD_REQUEST, {
                "code": "consent_incomplete", "field": "notice_version",
                "message": "The sign-in page sent an incomplete agreement. Reload the page and try again.",
            })
        agreement = consent.ConsentIn(notice_version=payload.notice_version, terms_version=payload.terms_version,
                                      age_confirmed=bool(payload.age_confirmed))
        # Checked before the code is spent, so the user can fix it and retry.
        consent.check(agreement)

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

    if not otp_matches(otp.code_hash, payload.code, email):
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
    events = await consent.history(db, user)
    if agreement is not None:
        await consent.record(db, user, agreement, "otp", events=events)
    token = generate_session_token()
    db.add(Session(token=hash_session_token(token), user_id=user.id, expires_at=session_expiry(),
                   device_label=device_label(request.headers.get("user-agent")), last_seen_at=now))
    await db.commit()

    _set_session_cookie(response, token)
    required = agreement is None and not consent.is_current(consent.latest_agreement(events))
    return _user_out(user, consent_required=required)


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
async def logout(
    response: Response,
    db: Annotated[AsyncSession, Depends(get_db)],
    user: Annotated[Optional[User], Depends(current_user_optional)],
    session_cookie: Annotated[Optional[str], Cookie(alias=SESSION_COOKIE_NAME)] = None,
    legacy_cookie: Annotated[Optional[str], Cookie(alias=LEGACY_SESSION_COOKIE_NAME)] = None,
) -> Response:
    session_cookie = session_cookie or legacy_cookie
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
async def me(
    db: Annotated[AsyncSession, Depends(get_db)],
    user: Annotated[User, Depends(current_user)],
) -> UserOut:
    return _user_out(user, consent_required=await consent.consent_required(db, user))


# ── Devices (audit80 D21) ─────────────────────────────────────────────────

async def _this_session_tokens(db: AsyncSession, user: User, cookie: Optional[str]) -> set[str]:
    if not cookie:
        return set()
    return {s.token for s in (await db.execute(
        select(Session).where(Session.user_id == user.id).where(session_token_condition(cookie))
    )).scalars()}


async def _active_sessions(db: AsyncSession, user: User) -> list[Session]:
    return list((await db.execute(
        select(Session).where(Session.user_id == user.id).where(Session.revoked_at.is_(None))
        .where(Session.expires_at > utc_now()).order_by(Session.created_at.desc())
    )).scalars())


@router.get("/sessions")
async def list_sessions(
    db: Annotated[AsyncSession, Depends(get_db)],
    user: Annotated[User, Depends(current_user)],
    session_cookie: Annotated[Optional[str], Cookie(alias=SESSION_COOKIE_NAME)] = None,
    legacy_cookie: Annotated[Optional[str], Cookie(alias=LEGACY_SESSION_COOKIE_NAME)] = None,
) -> dict:
    mine = await _this_session_tokens(db, user, session_cookie or legacy_cookie)
    def iso(v):
        return v.isoformat() if v else None
    return {"sessions": [
        {"id": public_session_id(s.token), "device": s.device_label or "A browser (signed in before device names)",
         "started_at": iso(s.created_at), "last_seen_at": iso(s.last_seen_at), "expires_at": iso(s.expires_at),
         "this_device": s.token in mine}
        for s in await _active_sessions(db, user)
    ]}


@router.post("/sessions/{session_id}/revoke", status_code=status.HTTP_204_NO_CONTENT)
async def revoke_session(
    session_id: str,
    response: Response,
    db: Annotated[AsyncSession, Depends(get_db)],
    user: Annotated[User, Depends(current_user)],
    session_cookie: Annotated[Optional[str], Cookie(alias=SESSION_COOKIE_NAME)] = None,
    legacy_cookie: Annotated[Optional[str], Cookie(alias=LEGACY_SESSION_COOKIE_NAME)] = None,
) -> Response:
    mine = await _this_session_tokens(db, user, session_cookie or legacy_cookie)
    target = next((s for s in await _active_sessions(db, user) if public_session_id(s.token) == session_id), None)
    if target is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "That device is not signed in.")
    target.revoked_at = utc_now()
    await access_log.record(db, user.id, "revoke", "/api/auth/sessions/{id}/revoke", "ok", commit=False)
    await db.commit()
    if target.token in mine:
        _clear_session_cookie(response)
    response.status_code = status.HTTP_204_NO_CONTENT
    return response


class RevokeAllIn(BaseModel):
    keep_this_device: bool = True


@router.post("/sessions/revoke-all")
async def revoke_all_sessions(
    payload: RevokeAllIn,
    response: Response,
    db: Annotated[AsyncSession, Depends(get_db)],
    user: Annotated[User, Depends(current_user)],
    session_cookie: Annotated[Optional[str], Cookie(alias=SESSION_COOKIE_NAME)] = None,
    legacy_cookie: Annotated[Optional[str], Cookie(alias=LEGACY_SESSION_COOKIE_NAME)] = None,
) -> dict:
    mine = await _this_session_tokens(db, user, session_cookie or legacy_cookie) if payload.keep_this_device else set()
    now = utc_now()
    signed_out = 0
    for s in await _active_sessions(db, user):
        if s.token not in mine:
            s.revoked_at = now
            signed_out += 1
    await access_log.record(db, user.id, "revoke", "/api/auth/sessions/revoke-all", "ok", commit=False)
    await db.commit()
    if not payload.keep_this_device:
        _clear_session_cookie(response)
    return {"signed_out": signed_out, "kept_this_device": payload.keep_this_device}
