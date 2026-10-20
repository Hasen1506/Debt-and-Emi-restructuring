"""A read-only link to the plan, for a spouse or family member.

The owner creates one link, can hide individual loans, and can revoke it.
GET /api/share/{token} needs no sign-in. Everything else needs the session.
The snapshot is built here from the saved plan. The browser cannot put an
email, an account number or a UPI id into it.
"""
from __future__ import annotations

import secrets
import uuid
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from api import access_log
from api.auth.dependencies import current_user
from api.auth.session import utc_now
from api.db.database import get_db
from api.db.models import ShareLink, User, UserState

router = APIRouter(tags=["share"])

_NOTE = "Read only. This is a plan someone shared with you. It has no account numbers and nothing here can be changed."

_TYPE_WORDS = {
    "home_loan": "Home loan",
    "auto_loan": "Auto loan",
    "personal_loan": "Personal loan",
    "credit_card": "Credit card",
    "education_loan": "Education loan",
    "gold_loan": "Gold loan",
    "bnpl": "Pay-later",
    "home_topup": "Home loan top-up",
    "loan_against_property": "Loan against property",
    "two_wheeler_loan": "Two-wheeler loan",
    "medical_loan": "Medical loan",
    "people_loan": "Loan from a person",
}


def _loan_name(loan: dict[str, Any]) -> str:
    """The kind of loan only. A nickname is the owner's own label and can
    hold a person's name ("Loan from Ravi"), and the lender's name was never
    shared, so neither leaves the account."""
    return _TYPE_WORDS.get(str(loan.get("loan_type") or ""), "Loan")


class ShareIn(BaseModel):
    hide_loans: bool = False


def _num(value: Any) -> float:
    try:
        n = float(value)
    except (TypeError, ValueError):
        return 0.0
    return n if n == n and n > 0 else 0.0


def _latest(entries: Any, what: str) -> Optional[str]:
    if not isinstance(entries, list):
        return None
    for entry in entries:
        if isinstance(entry, dict) and entry.get("what") == what and entry.get("after"):
            return str(entry["after"])[:80]
    return None


def public_snapshot(data: Optional[dict[str, Any]], hide_loans: bool) -> dict[str, Any]:
    """Figures a family member may see. No email, PAN, account number or UPI id.
    With hide_loans, no lender name and no balance either."""
    blob = data or {}
    profile = blob.get("profile") if isinstance(blob.get("profile"), dict) else {}
    user = profile.get("user") if isinstance(profile.get("user"), dict) else {}
    country = user.get("country") if user.get("country") in ("IN", "US") else None
    loans = user.get("loans") if isinstance(user.get("loans"), list) else []
    open_loans = [l for l in loans if isinstance(l, dict) and _num(l.get("outstanding")) > 0]
    out: dict[str, Any] = {
        "country": country,
        "currency": "INR" if country == "IN" else "USD" if country == "US" else None,
        "loan_count": len(open_loans),
        "debt_free": _latest(blob.get("change_log"), "Debt-free date"),
        "interest": _latest(blob.get("change_log"), "Interest on the plan"),
        "hide_loans": hide_loans,
        "note": _NOTE,
    }
    if hide_loans:
        return out
    shown = []
    for loan in open_loans:
        shown.append({
            "name": _loan_name(loan),
            "balance": str(_num(loan.get("outstanding"))),
            "emi": str(_num(loan.get("scheduled_emi"))),
            "rate": str(loan.get("nominal_rate") or "0")[:16],
            "type": str(loan.get("loan_type") or "")[:40],
        })
    out["loans"] = shown
    return out


def _view(row: ShareLink) -> dict[str, Any]:
    return {"active": True, "token": row.token, "hide_loans": row.hide_loans, "path": f"/share/{row.token}"}


async def _state(db: AsyncSession, user_id: uuid.UUID) -> Optional[dict[str, Any]]:
    row = (await db.execute(select(UserState).where(UserState.user_id == user_id))).scalar_one_or_none()
    return row.data if row and isinstance(row.data, dict) else None


async def _active(db: AsyncSession, user_id: uuid.UUID) -> Optional[ShareLink]:
    return (
        await db.execute(
            select(ShareLink).where(ShareLink.user_id == user_id, ShareLink.revoked.is_(False)).order_by(ShareLink.created_at.desc())
        )
    ).scalars().first()


@router.get("/user/share")
async def owner_share(user: User = Depends(current_user), db: AsyncSession = Depends(get_db)) -> dict[str, Any]:
    row = await _active(db, user.id)
    return _view(row) if row else {"active": False}


@router.post("/user/share")
async def save_share(body: ShareIn, user: User = Depends(current_user), db: AsyncSession = Depends(get_db)) -> dict[str, Any]:
    data = await _state(db, user.id)
    snap = public_snapshot(data, body.hide_loans)
    row = await _active(db, user.id)
    if row is None:
        row = ShareLink(token=secrets.token_urlsafe(24), user_id=user.id, hide_loans=body.hide_loans, snapshot=snap, revoked=False)
        db.add(row)
    else:
        row.hide_loans = body.hide_loans
        row.snapshot = snap
        row.updated_at = utc_now()
    await access_log.record(db, user.id, "write", "/api/user/share", "ok", commit=False)
    await db.commit()
    return _view(row)


@router.post("/user/share/revoke")
async def revoke_share(user: User = Depends(current_user), db: AsyncSession = Depends(get_db)) -> dict[str, Any]:
    row = await _active(db, user.id)
    if row is not None:
        row.revoked = True
        row.updated_at = utc_now()
        row.snapshot = {"note": _NOTE, "hide_loans": True, "loan_count": 0}
    await access_log.record(db, user.id, "revoke", "/api/user/share", "ok", commit=False)
    await db.commit()
    return {"active": False}


@router.get("/share/{token}")
async def public_share(token: str, db: AsyncSession = Depends(get_db)) -> dict[str, Any]:
    if not token or len(token) > 64:
        raise HTTPException(404, "This link is not active.")
    row = (await db.execute(select(ShareLink).where(ShareLink.token == token))).scalar_one_or_none()
    if row is None or row.revoked:
        raise HTTPException(404, "This link is not active.")
    data = await _state(db, row.user_id)
    snap = public_snapshot(data, row.hide_loans)
    # Built live on every view; not written back, so an anonymous reader
    # cannot cause a row update per request.
    await access_log.record(db, None, "read", "/api/share/{token}", "ok", commit=False)
    await db.commit()
    return snap
