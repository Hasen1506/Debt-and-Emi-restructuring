"""Shared lender outcomes (ROADMAP Phase 4).

POST /api/outcomes              share one anonymous report
GET  /api/outcomes/scorecard    every bank with reports, or ?lender=
GET  /api/outcomes/lenders      the banks a report can name

Limits: 10 reports a day per client address and 2 per bank
(api/outcomes_store.py), on top of the per-minute write limit
(api/security.py). Figures appear only from 5 reports and are labelled
unverified. SCORECARD_MODE decides what the scorecard shows:
- hidden (the default since Oct 2026, critique #55): no lender figures;
- verified: figures from reports checked against the bank's reply only;
- labelled: figures from every report, marked unverified.
"""
from __future__ import annotations

import os
from decimal import Decimal
from typing import Literal, Optional

from fastapi import APIRouter, HTTPException, Request
from pydantic import Field

from api import client_ip
from api.outcomes_store import LimitReached, store
from api.schemas import Rate, _Base, _In
from engine import lenders
from engine.outcomes import MIN_REPORTS, LenderScore, Outcome, OutcomeInputError, headline, make_report

router = APIRouter(tags=["outcomes"])

UNVERIFIED = ("Shared anonymously by borrowers and not checked against the banks' replies. "
              "Someone determined could fake reports.")


VERIFIED = ("Counted only from reports whose bank reply named the bank and the new rate. "
            "The reply is checked for consistency, not authenticated.")


def _mode() -> str:
    mode = os.environ.get("SCORECARD_MODE", "hidden").lower()
    return mode if mode in ("labelled", "verified") else "hidden"


class OutcomeReportRequest(_In):
    lender: str = Field(max_length=120)
    outcome: Literal["fixed_full", "fixed_part", "refused", "no_reply"]
    days_taken: Optional[int] = None
    rate_before: Rate
    rate_after: Optional[Rate] = None
    # Text of the bank's reply, read in the browser. Checked, never stored.
    bank_reply_text: Optional[str] = Field(None, max_length=20000)


class OutcomeReportResponse(_Base):
    lender: str
    reports_for_lender: int
    min_reports: int
    message: str
    verified: bool = False


class LenderScoreOut(_Base):
    known: bool
    lender_id: Optional[str] = None
    lender: Optional[str] = None
    reports: int = 0
    min_reports: int = MIN_REPORTS
    shown: bool = False
    hidden_reason: Optional[str] = None
    headline: Optional[str] = None
    fixed_in_full_pct: Optional[Decimal] = None
    fixed_any_pct: Optional[Decimal] = None
    median_days: Optional[Decimal] = None
    median_rate_cut: Optional[Decimal] = None
    counts: dict[str, int] = {}
    verified_reports: int = 0
    label: str = "unverified"
    label_detail: str = UNVERIFIED


class LenderOut(_Base):
    id: str
    name: str


def _out(s: LenderScore) -> LenderScoreOut:
    base = dict(known=True, lender_id=s.lender_id, lender=s.lender, reports=s.reports,
                verified_reports=s.verified_reports)
    if not s.shown:
        more = MIN_REPORTS - s.reports
        return LenderScoreOut(
            **base, hidden_reason=f"Shown once {MIN_REPORTS} borrowers have shared a report "
                                  f"({more} more needed).")
    if _mode() == "hidden":
        return LenderScoreOut(**base, hidden_reason="Kept back until reports can be verified.")
    label = ("verified", VERIFIED) if _mode() == "verified" else ("unverified", UNVERIFIED)
    return LenderScoreOut(
        **base, shown=True, headline=headline(s), counts=s.counts,
        fixed_in_full_pct=s.fixed_in_full_pct, fixed_any_pct=s.fixed_any_pct,
        median_days=s.median_days, median_rate_cut=s.median_rate_cut,
        label=label[0], label_detail=label[1],
    )


async def _scores() -> dict[str, LenderScore]:
    if _mode() != "verified":
        return await store().scorecard()
    from engine.outcomes import scorecard
    return scorecard([r for r in await store().reports() if r.verified])


@router.post("/outcomes", response_model=OutcomeReportResponse)
async def share_outcome(req: OutcomeReportRequest, request: Request) -> OutcomeReportResponse:
    try:
        report = make_report(req.lender, Outcome(req.outcome), req.days_taken, req.rate_before,
                             req.rate_after, req.bank_reply_text)
    except OutcomeInputError as e:
        raise HTTPException(status_code=422, detail={"field": e.field, "message": e.message})
    try:
        total = await store().add(report, client_ip.from_request(request))
    except LimitReached as e:
        raise HTTPException(status_code=429, detail={"field": "", "message": e.message},
                            headers={"Retry-After": "86400"})
    name = lenders.by_id(report.lender_id).name
    if total >= MIN_REPORTS:
        message = f"Thank you. {name} now has {total} shared reports."
    else:
        message = (f"Thank you. {name} has {total} shared report{'s' if total != 1 else ''}; "
                   f"figures appear from {MIN_REPORTS}.")
    if report.verified:
        message += " Your bank's reply matched the bank and the new rate, so the report counts as checked."
    return OutcomeReportResponse(lender=name, reports_for_lender=total, min_reports=MIN_REPORTS,
                                 message=message, verified=report.verified)


@router.get("/outcomes/scorecard", response_model=list[LenderScoreOut])
async def all_scores() -> list[LenderScoreOut]:
    card = await _scores()
    return sorted((_out(s) for s in card.values()), key=lambda s: (-s.reports, s.lender or ""))


@router.get("/outcomes/scorecard/lender", response_model=LenderScoreOut)
async def lender_score(name: str = "") -> LenderScoreOut:
    found = lenders.resolve_bank(name[:120])
    if found is None:
        return LenderScoreOut(known=False)
    card = await _scores()
    s = card.get(found.id) or LenderScore(lender_id=found.id, lender=found.name, reports=0, shown=False)
    return _out(s)


@router.get("/outcomes/lenders", response_model=list[LenderOut])
def list_lenders() -> list[LenderOut]:
    return [LenderOut(id=x.id, name=x.name) for x in lenders.banks()]
