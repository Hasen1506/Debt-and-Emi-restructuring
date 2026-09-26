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
    return RestructuringResponse(
        opportunities=[_out(o) for o in opps],
        total_annual_saving=_non_overlapping_total(opps),
    )


def _non_overlapping_total(opps) -> Decimal:
    """First-year saving of the moves that can be taken together.

    A card can be both balance-transferred and folded into a consolidation
    loan, but not both at once, so adding every opportunity counted it
    twice. Take the biggest saving first and skip any move that touches a
    loan already counted.
    """
    used: set[int] = set()
    total = D("0")
    for o in sorted(opps, key=lambda o: o.estimated_annual_saving, reverse=True):
        idx = set(o.affected_loan_indices)
        if idx & used or o.estimated_annual_saving <= 0:
            continue
        used |= idx
        total += o.estimated_annual_saving
    return total


def _out(o) -> RestructuringOpportunityOut:
    return RestructuringOpportunityOut(
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
        target_rate_as_of=o.target_rate_as_of,
        affected_loan_indices=o.affected_loan_indices,
        one_time_cost=o.one_time_cost,
        breakeven_months=o.breakeven_months,
        lifetime_net_saving=o.lifetime_net_saving,
    )
