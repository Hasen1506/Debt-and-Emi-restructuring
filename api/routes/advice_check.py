"""POST /api/advice-check (A8): check pasted advice against the user's loans.

No sign-in, nothing stored, the text is never logged: the request carries
the pasted text and the loan numbers Home already shows, and the answer is
engine.advice_check's per-claim verdicts. Deterministic: no model is called.
"""
from __future__ import annotations

from datetime import date
from decimal import Decimal
from typing import Any, Literal, Optional

from fastapi import APIRouter
from pydantic import BaseModel, Field

from engine import advice_check as ac

router = APIRouter(tags=["advice-check"])


class LoanIn(BaseModel):
    loan_type: Literal["home_loan", "auto_loan", "personal_loan", "credit_card", "education_loan", "gold_loan", "bnpl"]
    outstanding: Decimal = Field(ge=0, le=Decimal("1e10"))
    rate: Optional[Decimal] = Field(default=None, ge=0, lt=1)      # annual decimal, 0.085
    emi: Optional[Decimal] = Field(default=None, ge=0, le=Decimal("1e9"))
    months_left: Optional[int] = Field(default=None, ge=1, le=600)
    rate_type: Literal["floating", "fixed"] = "floating"
    bank: str = Field(default="", max_length=40)


class AdviceIn(BaseModel):
    text: str = Field(min_length=1, max_length=ac.MAX_TEXT)
    loans: list[LoanIn] = Field(min_length=1, max_length=20)
    extra_target: Optional[int] = Field(default=None, ge=0, le=19)
    strategy: str = Field(default="avalanche", max_length=20)
    country: Literal["IN", "US"] = "IN"
    regime: Optional[Literal["old", "new"]] = None


@router.post("/advice-check")
def advice_check(body: AdviceIn) -> dict[str, Any]:
    loans = [ac.AdviceLoan(l.loan_type, l.outstanding, l.rate, l.emi or None, l.months_left, l.rate_type,
                           " ".join(l.bank.split())) for l in body.loans]
    target = body.extra_target if body.extra_target is not None and body.extra_target < len(loans) else None
    rep = ac.check(body.text, loans, ac.PlanFacts(target, body.strategy, body.country, body.regime, date.today()))
    return {
        "headline": rep.headline,
        "counts": rep.counts,
        "claims": [{"kind": c.kind, "quote": c.quote, "verdict": c.verdict, "why": c.why, "theirs": c.theirs,
                    "ours": c.ours, "loan": c.loan, "source": c.source} for c in rep.claims],
        "not_checked": rep.not_checked,
        "method": "Read with fixed patterns and recomputed from your numbers; no AI model is used.",
    }
