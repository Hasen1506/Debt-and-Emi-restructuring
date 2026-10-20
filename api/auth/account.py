"""Your data: download it, or delete the account (grill #51).

  GET  /auth/account/export  → every record we hold for the signed-in
                                account, as a JSON file download
  POST /auth/account/delete  { confirm_email } → erases the account and
                                everything linked to it, signs out

These back the rights in the DPDP Act 2023: s.11 (a summary of the
personal data being processed) and s.12 (correction and erasure). They
are wired to the "Your data" page (web/src/app/account) and described in
the privacy notice (web/src/app/privacy). docs/privacy-and-retention.md
lists what each table holds.

Deletion is immediate and cannot be undone. It removes, for this account:
the saved plan (user_state), every session on every device, the payday-email
settings and answers, and the users row. It is also the withdrawal of
consent (DPDP Act s.6(4)-(6)), recorded as a "withdrawn" consent event.

What is kept, by founder decision (Founder-Answers rank 12, audit80 D6) and
DPDP Rules 2025 r.6(1)(e) / r.8(3) (one year of processing logs): the
sign-in records (email, when each code was sent/used, wrong guesses, when
each session started/ended) move to auth_log_tombstones, the consent events
and the access log stay; all three are purged AUTH_LOG_RETENTION (365 days)
later (api/auth/retention.py). Nothing in them is usable to sign in or holds
any figure from the plan. The privacy notice says so.
Anonymous lender outcome reports (api/outcomes_store.py) are not linked
to an account (they keep only a keyed hash of the sender's address for a
daily limit), so there is nothing of the account's in them to delete.
"""
from __future__ import annotations

import json
from datetime import datetime
from typing import Annotated, Any, Optional

from fastapi import APIRouter, Cookie, Depends, HTTPException, Response, status
from pydantic import BaseModel, EmailStr
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from api import access_log
from api.auth import consent
from api.auth.dependencies import current_user, session_token_condition
from api.auth.devices import public_session_id
from api.auth.session import AUTH_LOG_RETENTION, LEGACY_SESSION_COOKIE_NAME, SESSION_COOKIE_NAME, utc_now
from api.db.database import get_db
from api.db.models import AccessLog, AuthLogTombstone, OtpChallenge, OtpCode, Session, ShareLink, User, UserState
from api.privacy_facts import NOTICE_VERSION, TERMS_VERSION, shared_with

router = APIRouter(prefix="/auth/account", tags=["account"])

EXPORT_FORMAT_VERSION = 3  # 3: family share links. 2: 2: consent, devices, access log, payday email, live processor list (audit80 D5)


def _iso(value: Optional[datetime]) -> Optional[str]:
    return value.isoformat() if value else None


class DeleteIn(BaseModel):
    # Typing the address back guards against a stray click or a forged form.
    confirm_email: EmailStr


@router.get("/export")
async def export_my_data(
    db: Annotated[AsyncSession, Depends(get_db)],
    user: Annotated[User, Depends(current_user)],
    session_cookie: Annotated[Optional[str], Cookie(alias=SESSION_COOKIE_NAME)] = None,
) -> Response:
    state = (await db.execute(select(UserState).where(UserState.user_id == user.id))).scalar_one_or_none()
    sessions = (await db.execute(
        select(Session).where(Session.user_id == user.id).order_by(Session.created_at)
    )).scalars().all()
    current = set()
    if session_cookie:
        current = {s.token for s in (await db.execute(
            select(Session).where(Session.user_id == user.id).where(session_token_condition(session_cookie))
        )).scalars()}
    codes = (await db.execute(
        select(OtpChallenge).where(OtpChallenge.email == user.email).order_by(OtpChallenge.created_at)
    )).scalars().all()
    legacy = (await db.execute(
        select(OtpCode).where(OtpCode.user_id == user.id).order_by(OtpCode.created_at)
    )).scalars().all()
    consents = await consent.history(db, user)
    accesses = (await db.execute(
        select(AccessLog).where(AccessLog.user_id == user.id).order_by(AccessLog.at)
    )).scalars().all()
    payday = await _notify_records(str(user.id))
    shares = (await db.execute(
        select(ShareLink).where(ShareLink.user_id == user.id).order_by(ShareLink.created_at)
    )).scalars().all()
    body: dict[str, Any] = {
        "format_version": EXPORT_FORMAT_VERSION,
        "exported_at": utc_now().isoformat(),
        "about": (
            "Everything RightDue's server holds for this account. 'saved_plan' is the "
            "data you entered (loans, income, goals, activity) exactly as stored. "
            "Session and sign-in code entries are records only: no codes or session "
            "keys are included. Data kept only in this browser is not on the server; "
            "it is listed on the Your data page."
        ),
        "account": {
            "id": str(user.id),
            "email": user.email,
            "display_name": user.display_name,
            "created_at": _iso(user.created_at),
            "last_sign_in_at": _iso(user.last_login_at),
        },
        "saved_plan": state.data if state else None,
        "saved_plan_updated_at": _iso(state.updated_at) if state else None,
        "sign_in_sessions": [
            {"id": public_session_id(s.token), "device": s.device_label, "started_at": _iso(s.created_at),
             "last_seen_at": _iso(s.last_seen_at), "expires_at": _iso(s.expires_at),
             "signed_out_at": _iso(s.revoked_at), "this_device": s.token in current}
            for s in sessions
        ],
        # DPDP Act s.6(10): what you agreed to, and when (audit80 D2).
        "consent": {
            "current_notice_version": NOTICE_VERSION,
            "current_terms_version": TERMS_VERSION,
            "history": [consent.event_out(e) for e in consents],
        },
        # Payday and deadline emails you switched on (audit80 D5).
        "payday_email": payday,
        # Read-only family links: what each one shows (the link secret is left out).
        "share_links": [
            {"active": not s.revoked, "hide_loans": s.hide_loans, "snapshot": s.snapshot,
             "created_at": s.created_at.isoformat() if s.created_at else None,
             "updated_at": s.updated_at.isoformat() if s.updated_at else None}
            for s in shares
        ],
        # DPDP Rules r.6(1)(c): every read or change of your saved data.
        "access_log": [
            {"action": a.action, "route": a.route, "outcome": a.outcome, "at": _iso(a.at)} for a in accesses
        ],
        # DPDP Act s.11(1)(b): who else handles the data, on our behalf, as
        # switched on right now (api/privacy_facts.py, same list as the notice).
        "shared_with": shared_with(),
        "sign_in_codes_sent": [
            {"sent_at": _iso(c.created_at), "expired_at": _iso(c.expires_at),
             "used_at": _iso(c.used_at), "wrong_guesses": c.attempts}
            for c in [*legacy, *codes]
        ],
    }
    await access_log.record(db, user.id, "export", "/api/auth/account/export")
    stamp = utc_now().strftime("%Y-%m-%d")
    return Response(
        content=json.dumps(body, indent=2, default=str, ensure_ascii=False),
        media_type="application/json",
        headers={
            "Content-Disposition": f'attachment; filename="rightdue-my-data-{stamp}.json"',
            "Cache-Control": "no-store",
        },
    )


@router.post("/delete")
async def delete_my_account(
    payload: DeleteIn,
    response: Response,
    db: Annotated[AsyncSession, Depends(get_db)],
    user: Annotated[User, Depends(current_user)],
) -> dict[str, Any]:
    if payload.confirm_email.lower().strip() != user.email:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, {
            "field": "confirm_email",
            "message": "That is not the email of the signed-in account. Nothing was deleted.",
        })
    # Lock the account so a save from another device can't land mid-delete.
    await db.execute(select(User).where(User.id == user.id).with_for_update())
    now = utc_now()
    # D6: keep the sign-in records (email + timestamps + wrong guesses, never
    # a code or session key) for the retention period, then purge.
    codes = (await db.execute(select(OtpChallenge).where(OtpChallenge.email == user.email))).scalars().all()
    legacy = (await db.execute(select(OtpCode).where(OtpCode.user_id == user.id))).scalars().all()
    sessions = (await db.execute(select(Session).where(Session.user_id == user.id))).scalars().all()
    for c in [*legacy, *codes]:
        db.add(AuthLogTombstone(email=user.email, kind="code", started_at=c.created_at, used_at=c.used_at,
                                ended_at=c.expires_at, wrong_guesses=c.attempts or 0, deleted_at=now))
    for s in sessions:
        db.add(AuthLogTombstone(email=user.email, kind="session", started_at=s.created_at, used_at=s.last_seen_at,
                                ended_at=min(_aware(s.expires_at, now), now) if s.revoked_at is None else s.revoked_at,
                                wrong_guesses=0, deleted_at=now))
    db.add(consent.withdrawal(user))
    db.add(access_log.entry(user.id, "delete", "/api/auth/account/delete"))
    # Explicit deletes, child tables first. Postgres would cascade from
    # users (ON DELETE CASCADE), but this does not depend on that.
    removed = {
        "saved_plan": (await db.execute(delete(UserState).where(UserState.user_id == user.id))).rowcount or 0,
        "share_links": (await db.execute(delete(ShareLink).where(ShareLink.user_id == user.id))).rowcount or 0,
        "sessions": (await db.execute(delete(Session).where(Session.user_id == user.id))).rowcount or 0,
        "sign_in_codes": (
            ((await db.execute(delete(OtpCode).where(OtpCode.user_id == user.id))).rowcount or 0)
            + ((await db.execute(delete(OtpChallenge).where(OtpChallenge.email == user.email))).rowcount or 0)
        ),
    }
    await db.execute(delete(User).where(User.id == user.id))
    await db.commit()
    # Payday-email settings and answers (sprint G7) live in their own tables.
    from api.notify.store import store as notify_store
    await notify_store().forget(str(user.id))
    response.delete_cookie(SESSION_COOKIE_NAME, path="/")
    response.delete_cookie(LEGACY_SESSION_COOKIE_NAME, path="/")
    return {
        "deleted": True, "deleted_at": now.isoformat(), "removed": removed,
        # Said plainly, as the notice does (D6).
        "kept_for_a_year": {
            "what": "sign-in records (email, times, wrong-guess counts), the consent record and the access log",
            "days": AUTH_LOG_RETENTION.days,
            "why": "DPDP Rules 2025 r.6(1)(e) and r.8(3): one year of processing logs to investigate misuse",
        },
    }


def _aware(value: datetime, ref: datetime) -> datetime:
    if (value.tzinfo is None) != (ref.tzinfo is None):
        return value.replace(tzinfo=ref.tzinfo)
    return value


async def _notify_records(user_id: str) -> dict[str, Any]:
    """The payday-email settings, rate-move watch and answers kept for this account
    (api/notify/store.py tables; read here so the export is complete)."""
    try:
        from sqlalchemy import select as _select
        from api.notify.store import events, store as notify_store
        st = notify_store()
        sub = await st.get(user_id)
        watch = await st.get_rate_watch(user_id)
        async with st.engine.connect() as conn:
            rows = (await conn.execute(
                _select(events.c.kind, events.c.month, events.c.day, events.c.applied, events.c.created_at)
                .where(events.c.user_id == user_id).order_by(events.c.id)
            )).mappings().all()
    except Exception:
        return {"settings": None, "events": [], "rate_move_watch": None,
                "note": "could not be read just now; try again"}
    settings = None
    if sub:
        settings = {k: (v.isoformat() if hasattr(v, "isoformat") else v) for k, v in sub.items() if k != "user_id"}
    # Rate-move email watch (A13, notify_rate_watch): which loans, on/off.
    rate_move_watch = None
    if watch:
        rate_move_watch = {k: (v.isoformat() if hasattr(v, "isoformat") else v)
                           for k, v in watch.items() if k != "user_id"}
    return {"settings": settings, "rate_move_watch": rate_move_watch, "events": [
        {"kind": r["kind"], "month": r["month"], "day": _iso_any(r["day"]), "applied": r["applied"],
         "at": _iso_any(r["created_at"])} for r in rows
    ]}


def _iso_any(v: Any) -> Any:
    return v.isoformat() if hasattr(v, "isoformat") else v
