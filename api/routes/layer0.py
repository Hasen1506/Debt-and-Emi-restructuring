"""POST /api/employer-match — Layer 0 (§4.3)."""
from fastapi import APIRouter

from engine.layer0 import (
    matched_monthly_contribution, match_pv_at_retirement, has_unmet_match,
)
from api.schemas import EmployerMatchIn, EmployerMatchResponse

router = APIRouter(tags=["layer0"])


@router.post("/employer-match", response_model=EmployerMatchResponse)
def employer_match(req: EmployerMatchIn) -> EmployerMatchResponse:
    match = req.to_engine()
    return EmployerMatchResponse(
        monthly_contribution_needed=matched_monthly_contribution(match),
        pv_at_retirement=match_pv_at_retirement(match),
        has_unmet_match=has_unmet_match(match),
    )
