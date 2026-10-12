"""POST /api/sensitivity/range (grill #24, sprint G4).

The exact debt-free month and a range, with the reason for each edge
(floating rates ±1 point, ±1 month of pay): engine/sensitivity.debt_free_range.
Takes the same body as /sensitivity/compare (its what-if knobs are ignored),
so the range is around the plan /plan shows. Its own module so it doesn't
collide with the shortfall work in routes/simulation.py.
"""
from fastapi import APIRouter

from api.routes.simulation import _plan_kwargs
from api.schemas import CompareRequest, RangeResponse
from engine.sensitivity import debt_free_range

router = APIRouter(tags=["simulation"])


@router.post("/sensitivity/range", response_model=RangeResponse)
def sensitivity_range(req: CompareRequest) -> RangeResponse:
    user = req.user.to_engine()
    plan = _plan_kwargs(req)
    sm = plan.pop("simulation_start_month")
    r = debt_free_range(
        user, strategy=req.strategy, horizon_months=req.horizon_months,
        marginal_rate=req.marginal_rate, simulation_start_month=sm, plan=plan,
    )
    return RangeResponse(**r)
