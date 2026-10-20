"""POST /api/closure-letter: the "loan cleared" letter (engine/closure_letter.py).

No sign-in, nothing stored: the app sends the loan type, the lender's name
and the closure date and gets the draft letter and its dates back.
"""
from __future__ import annotations

from api.schemas import today_ist

from datetime import date
from typing import Literal, Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from engine import closure_letter as cl

router = APIRouter(tags=["celebrate"])


class ClosureIn(BaseModel):
    market: Literal["IN", "US"]
    loan_type: str = Field(max_length=32)
    lender: str = Field(default="", max_length=80)
    closed_on: date
    today: Optional[date] = None
    lender_kind: str = Field(default="unknown", max_length=24)
    business_purpose: bool = False
    docs_lost: bool = False
    secured: Optional[bool] = None


@router.post("/closure-letter")
def closure_letter(body: ClosureIn) -> dict:
    today = body.today or today_ist()
    try:
        r = cl.closure_letter(
            market=body.market, loan_type=body.loan_type, lender=body.lender, closed_on=body.closed_on,
            today=today, lender_kind=body.lender_kind, business_purpose=body.business_purpose,
            docs_lost=body.docs_lost, secured=body.secured,
        )
    except cl.ClosureInputError as e:
        raise HTTPException(422, {"field": "", "message": str(e)}) from None
    return {
        "market": r.market,
        "subject": r.subject,
        "body": r.body,
        "draft": r.draft,
        "key_dates": [{"key": k.key, "label": k.label, "day": k.day.isoformat(), "note": k.note} for k in r.key_dates],
        "checklist": r.checklist,
        "citations": r.citations,
        "notes": r.notes,
        "as_of": cl.AS_OF,
    }
