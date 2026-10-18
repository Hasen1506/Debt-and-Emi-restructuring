"""Consent record (audit80 D2, D7, D12).

DPDP Act 2023 s.6(10): where consent is the basis of processing, the Data
Fiduciary "shall be obliged to prove that a notice was given by her to the
Data Principal and consent was given". s.6(4): withdrawal must be as easy
as giving. Act text, read on meity.gov.in 14 Oct 2026:
https://www.meity.gov.in/static/uploads/2024/06/2bf1f0e9f04e6fb4f8fef35e82c42aa5.pdf
(in force from mid-May 2027, G.S.R. 843(E) para (c)).

Lifecycle, one row per action in consent_events:
  given      first agreement (the "Agree and send code" button with the
             "I am 18 or older" tick, or the Google button under it)
  re-given   agreement to a newer notice/terms version (one tap after
             sign-in when NOTICE_VERSION or TERMS_VERSION changed)
  withdrawn  account deletion; consent withdrawal and erasure are the same
             act here, since RightDue can't run an account without the data
             (s.6(5): the consequences of withdrawal are the user's; s.6(6),
             s.8(7)(a): we stop and erase).

Rows are kept while the account exists and AUTH_LOG_RETENTION after a
withdrawal (they prove what was agreed, and when it ended), then purged.

  GET  /auth/consent         → current versions, what this account agreed
                               to, and the full history
  POST /auth/consent         { notice_version, terms_version, age_confirmed }
                               → record re-given (or given, for accounts
                               made before the record existed)
"""
from __future__ import annotations

from datetime import datetime
from typing import Annotated, Any, Optional

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from api import access_log
from api.auth.dependencies import current_user
from api.auth.session import utc_now
from api.db.database import get_db
from api.db.models import ConsentEvent, User
from api.privacy_facts import CONSENT_PURPOSE, NOTICE_VERSION, TERMS_VERSION

router = APIRouter(prefix="/auth/consent", tags=["account"])

CHANNELS = {"otp", "google", "account_page"}
AGREEING = ("given", "re-given")


class ConsentIn(BaseModel):
    """What the browser showed and the user agreed to. Sent with the
    sign-in and with the re-consent tap."""
    notice_version: str = Field(min_length=1, max_length=32, pattern=r"^[0-9A-Za-z.\-]+$")
    terms_version: str = Field(min_length=1, max_length=32, pattern=r"^[0-9A-Za-z.\-]+$")
    age_confirmed: bool = False


def _iso(value: Optional[datetime]) -> Optional[str]:
    return value.isoformat() if value else None


async def history(db: AsyncSession, user: User) -> list[ConsentEvent]:
    return list((await db.execute(
        select(ConsentEvent).where(ConsentEvent.user_id == user.id).order_by(ConsentEvent.at, ConsentEvent.id)
    )).scalars())


def latest_agreement(events: list[ConsentEvent]) -> Optional[ConsentEvent]:
    """The newest given/re-given row, unless a withdrawal came after it."""
    latest = None
    for ev in events:
        if ev.action in AGREEING:
            latest = ev
        elif ev.action == "withdrawn":
            latest = None
    return latest


def is_current(ev: Optional[ConsentEvent]) -> bool:
    return bool(ev and ev.notice_version == NOTICE_VERSION and ev.terms_version == TERMS_VERSION
                and ev.age_confirmed)


async def consent_required(db: AsyncSession, user: User) -> bool:
    return not is_current(latest_agreement(await history(db, user)))


def check(payload: ConsentIn) -> None:
    """The agreement must be to the versions in force, with the age tick
    (D7: DPDP Act s.9 and Rules r.10 cover anyone under 18)."""
    if not payload.age_confirmed:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, {
            "code": "age_required", "field": "age_confirmed",
            "message": "RightDue is for adults. Tick \u201cI am 18 or older\u201d to continue.",
        })
    if payload.notice_version != NOTICE_VERSION or payload.terms_version != TERMS_VERSION:
        raise HTTPException(status.HTTP_409_CONFLICT, {
            "code": "notice_changed", "field": "notice_version",
            "message": "The privacy notice or terms changed since this page loaded. Reload the page, read them, and agree again.",
            "notice_version": NOTICE_VERSION, "terms_version": TERMS_VERSION,
        })


async def record(db: AsyncSession, user: User, payload: ConsentIn, channel: str,
                 *, events: Optional[list[ConsentEvent]] = None) -> Optional[ConsentEvent]:
    """Add a given/re-given row (caller commits). No row when the account's
    current agreement is already for these versions."""
    if channel not in CHANNELS:
        raise ValueError(channel)
    events = await history(db, user) if events is None else events
    latest = latest_agreement(events)
    if is_current(latest):
        return None
    ev = ConsentEvent(
        user_id=user.id, email=user.email,
        action="re-given" if any(e.action in AGREEING for e in events) else "given",
        notice_version=payload.notice_version, terms_version=payload.terms_version,
        purpose=CONSENT_PURPOSE, age_confirmed=bool(payload.age_confirmed), channel=channel, at=utc_now(),
    )
    db.add(ev)
    return ev


def withdrawal(user: User) -> ConsentEvent:
    """The row written when the account is deleted (caller commits). It keeps
    the email but no user link that a new account could inherit."""
    return ConsentEvent(
        user_id=user.id, email=user.email, action="withdrawn",
        notice_version=NOTICE_VERSION, terms_version=TERMS_VERSION, purpose=CONSENT_PURPOSE,
        age_confirmed=False, channel="account_page", at=utc_now(),
    )


def event_out(ev: ConsentEvent) -> dict[str, Any]:
    return {"action": ev.action, "notice_version": ev.notice_version, "terms_version": ev.terms_version,
            "purpose": ev.purpose, "age_confirmed": ev.age_confirmed, "channel": ev.channel, "at": _iso(ev.at)}


@router.get("")
async def get_consent(
    db: Annotated[AsyncSession, Depends(get_db)],
    user: Annotated[User, Depends(current_user)],
) -> dict[str, Any]:
    events = await history(db, user)
    latest = latest_agreement(events)
    return {
        "notice_version": NOTICE_VERSION,
        "terms_version": TERMS_VERSION,
        "agreed": event_out(latest) if latest else None,
        "consent_required": not is_current(latest),
        "history": [event_out(e) for e in events],
    }


@router.post("")
async def give_consent(
    payload: ConsentIn,
    db: Annotated[AsyncSession, Depends(get_db)],
    user: Annotated[User, Depends(current_user)],
) -> dict[str, Any]:
    check(payload)
    ev = await record(db, user, payload, "account_page")
    await access_log.record(db, user.id, "consent", "/api/auth/consent", "ok", commit=False)
    await db.commit()
    return {"recorded": ev is not None, "consent_required": False,
            "notice_version": NOTICE_VERSION, "terms_version": TERMS_VERSION}
