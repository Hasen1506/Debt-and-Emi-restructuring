"""POST /api/restructuring — scan a user's loan book for balance-transfer,
consolidation, and refinance opportunities (§4.7 Layer 1)."""
from decimal import Decimal

from fastapi import APIRouter

from engine.restructuring_scan import scan_all
from api.schemas import (
    RestructuringRequest, RestructuringResponse, RestructuringOpportunityOut,
)

D = Decimal
router = APIRouter(tags=["restructuring"])


@router.post("/restructuring", response_model=RestructuringResponse)
def restructuring(req: RestructuringRequest) -> RestructuringResponse:
    user = req.user.to_engine()
    marg = req.marginal_rate if req.marginal_rate is not None else D("0")
    opps = scan_all(user, marginal_rate=marg)
    total = sum((o.estimated_annual_saving for o in opps), D("0"))
    return RestructuringResponse(
        opportunities=[
            RestructuringOpportunityOut(
                kind=o.kind,
                headline=o.headline,
                rationale=o.rationale,
                estimated_annual_saving=o.estimated_annual_saving,
                affected_loan_banks=o.affected_loan_banks,
                target_bank=o.target_bank,
                target_rate=o.target_rate,
                current_rate=o.current_rate,
                detail=o.detail,
                alternative_target_bank=o.alternative_target_bank,
                alternative_target_rate=o.alternative_target_rate,
                alternative_annual_saving=o.alternative_annual_saving,
                target_is_existing_relationship=o.target_is_existing_relationship,
            )
            for o in opps
        ],
        total_annual_saving=total,
    )
