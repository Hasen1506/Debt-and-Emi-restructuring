"""POST /api/offers/compare — keep, pay the bank's fee to reset, or refinance.

Takes the same loan facts as /api/loan-check plus the offers, and re-runs
the check here: when it finds a rate cut the bank owes, the comparison is
measured against the loan at that rate, using the server's own figure.
"""
from decimal import Decimal
from typing import Optional

from fastapi import APIRouter
from pydantic import Field

from api.routes.loan_check import CitationOut, LoanCheckRequest, bad, citation_out, run_loan_check
from api.schemas import _Base
from engine.offer_compare import (
    Mode, OfferInput, OfferInputError, RefinanceOffer, ResetOffer, compare_offers,
)

D = Decimal
router = APIRouter(tags=["offers"])


class ResetOfferIn(_Base):
    rate: Decimal
    fee: Decimal = D("0")
    fee_percent: Optional[Decimal] = None
    fee_plus_gst: bool = False


class RefinanceOfferIn(_Base):
    rate: Decimal
    lender: Optional[str] = Field(None, max_length=80)
    processing_fee: Decimal = D("0")
    processing_fee_percent: Optional[Decimal] = None
    fee_plus_gst: bool = False
    stamp_duty: Decimal = D("0")
    legal_and_valuation: Decimal = D("0")
    prepayment_charge: Decimal = D("0")
    months: Optional[int] = None


class OfferCompareRequest(LoanCheckRequest):
    reset: Optional[ResetOfferIn] = None
    refinance: Optional[RefinanceOfferIn] = None
    mode: Mode = Mode.LOWER_EMI
    horizon_months: Optional[int] = None


class CostLineOut(_Base):
    label: str
    amount: Decimal


class OptionOut(_Base):
    key: str
    label: str
    rate: Decimal
    emi: Decimal
    months: int
    last_payment: Decimal
    upfront: list[CostLineOut]
    upfront_total: Decimal
    interest_total: Decimal
    cost_to_horizon: Decimal
    saving: Decimal
    break_even_month: Optional[int]
    break_even_on: Optional[str]


class OfferCompareResponse(_Base):
    options: list[OptionOut]
    baseline: str
    horizon_months: int
    verdict: str
    headline: str
    reason: str
    next_step: str
    warnings: list[str]
    notes: list[str]
    citations: list[CitationOut]
    entitled_rate: Optional[Decimal]


@router.post("/offers/compare", response_model=OfferCompareResponse)
def offers_compare(req: OfferCompareRequest) -> OfferCompareResponse:
    inp, result = run_loan_check(req)
    owed = any(f.kind == "missed_rate_cut" and f.claimable for f in result.findings)
    entitled = result.expected_rate if owed else None

    r, f = req.reset, req.refinance
    offer = OfferInput(
        outstanding=inp.outstanding,
        current_rate=inp.current_rate,
        months_left=inp.tenure_months_remaining,
        as_of=inp.as_of,
        lender=inp.lender,
        reset=ResetOffer(**r.model_dump()) if r else None,
        refinance=RefinanceOffer(**f.model_dump()) if f else None,
        mode=req.mode,
        horizon_months=req.horizon_months,
        entitled_rate=entitled,
    )
    try:
        c = compare_offers(offer)
    except OfferInputError as e:
        raise bad(e.field, str(e))

    return OfferCompareResponse(
        options=[
            OptionOut(
                key=o.key, label=o.label, rate=o.rate, emi=o.emi, months=o.months,
                last_payment=o.last_payment,
                upfront=[CostLineOut(label=x.label, amount=x.amount) for x in o.upfront],
                upfront_total=o.upfront_total, interest_total=o.interest_total,
                cost_to_horizon=o.cost_to_horizon, saving=o.saving,
                break_even_month=o.break_even_month,
                break_even_on=o.break_even_on.isoformat() if o.break_even_on else None,
            )
            for o in c.options
        ],
        baseline=c.baseline, horizon_months=c.horizon_months, verdict=c.verdict,
        headline=c.headline, reason=c.reason, next_step=c.next_step,
        warnings=c.warnings, notes=c.notes,
        citations=[citation_out(x) for x in c.citations],
        entitled_rate=entitled,
    )
