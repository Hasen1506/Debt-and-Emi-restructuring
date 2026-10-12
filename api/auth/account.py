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
the saved plan (user_state), every session on every device, every sign-in
code record for its email (new and legacy tables) and the users row.
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

from api.auth.dependencies import current_user, session_token_condition
from api.auth.session import SESSION_COOKIE_NAME, utc_now
from api.db.database import get_db
from api.db.models import OtpChallenge, OtpCode, Session, User, UserState

router = APIRouter(prefix="/auth/account", tags=["account"])

EXPORT_FORMAT_VERSION = 1


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
            {"started_at": _iso(s.created_at), "expires_at": _iso(s.expires_at),
             "signed_out_at": _iso(s.revoked_at), "this_device": s.token in current}
            for s in sessions
        ],
        # DPDP Act s.11(1)(b): who else handles the data, on our behalf.
        "shared_with": [
            {"who": "Neon", "role": "database host (AWS Singapore)", "data": "everything above"},
            {"who": "Render", "role": "app server (Oregon, USA)", "data": "requests while they are processed"},
            {"who": "Cloudflare", "role": "network in front of rightdue.app", "data": "requests in transit"},
            {"who": "Resend", "role": "email delivery (USA)", "data": "your email address and sign-in codes"},
        ],
        "sign_in_codes_sent": [
            {"sent_at": _iso(c.created_at), "expired_at": _iso(c.expires_at),
             "used_at": _iso(c.used_at), "wrong_guesses": c.attempts}
            for c in [*legacy, *codes]
        ],
    }
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
    # Explicit deletes, child tables first. Postgres would cascade from
    # users (ON DELETE CASCADE), but this does not depend on that.
    removed = {
        "saved_plan": (await db.execute(delete(UserState).where(UserState.user_id == user.id))).rowcount or 0,
        "sessions": (await db.execute(delete(Session).where(Session.user_id == user.id))).rowcount or 0,
        "sign_in_codes": (
            ((await db.execute(delete(OtpCode).where(OtpCode.user_id == user.id))).rowcount or 0)
            + ((await db.execute(delete(OtpChallenge).where(OtpChallenge.email == user.email))).rowcount or 0)
        ),
    }
    await db.execute(delete(User).where(User.id == user.id))
    await db.commit()
    response.delete_cookie(SESSION_COOKIE_NAME, path="/")
    return {"deleted": True, "deleted_at": utc_now().isoformat(), "removed": removed}
