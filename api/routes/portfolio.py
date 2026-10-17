"""POST /api/portfolio/liquidation-rankings — rank "sell asset X → clear debt Y"
moves across the user's full portfolio (§4.18 ranker).

Thin wrapper over engine.asset_liquidation.rank_liquidations: parses the
profile, dispatches to per-asset proceeds math (IN or US tax path), runs the
pre-filter + Gates 0-3, returns the ranked list plus the "considered but
skipped" bucket so the UI can show what was rejected and why.
"""
import os
from decimal import Decimal

from fastapi import APIRouter, HTTPException

from engine.asset_liquidation import rank_liquidations
from api.schemas import (
    LiquidationRankingsRequest,
    LiquidationRankingsResponse,
    LiquidationRecommendationOut,
    ProceedsResultOut,
)

D = Decimal
router = APIRouter(tags=["portfolio"])


def _proceeds_to_out(p) -> ProceedsResultOut:
    return ProceedsResultOut(
        asset_label=p.asset_label,
        asset_type=p.asset_type,
        gross_proceeds=p.gross_proceeds,
        tax_owed=p.tax_owed,
        penalty=p.penalty,
        transaction_costs=p.transaction_costs,
        net_proceeds=p.net_proceeds,
        explanation=p.explanation,
        is_blocked=p.is_blocked,
        block_reason=p.block_reason,
        caveats=list(p.caveats),
    )


def _rec_to_out(r) -> LiquidationRecommendationOut:
    return LiquidationRecommendationOut(
        asset_index=r.asset_index,
        asset_label=r.asset_label,
        asset_type=r.asset_type,
        target_loan_index=r.target_loan_index,
        target_loan_label=r.target_loan_label,
        proceeds=_proceeds_to_out(r.proceeds),
        debt_balance=r.debt_balance,
        debt_effective_rate=r.debt_effective_rate,
        debt_cleared_amount=r.debt_cleared_amount,
        interest_saved_yr1_nominal=r.interest_saved_yr1_nominal,
        asset_return_pct=r.asset_return_pct,
        holding_cost_given_up_yr1=r.holding_cost_given_up_yr1,
        net_annual_benefit_nominal=r.net_annual_benefit_nominal,
        net_annual_benefit_real=r.net_annual_benefit_real,
        verdict=r.verdict,
        skip_reason=r.skip_reason,
    )


@router.post(
    "/portfolio/liquidation-rankings",
    response_model=LiquidationRankingsResponse,
)
def liquidation_rankings(
    req: LiquidationRankingsRequest,
) -> LiquidationRankingsResponse:
    # Audit 80 W10 (founder's cut-list answer 4): ranking the user's own
    # holdings by "sell this one" is advice under SEBI's Investment Advisers
    # Regulations; Sell to repay stays a calculator of one sale the user
    # picks (/api/asset-liquidation). No page calls this route; it is off
    # unless LIQUIDATION_RANKER=on (frozen, not deleted, per the cut list).
    if os.environ.get("LIQUIDATION_RANKER", "off").lower() != "on":
        raise HTTPException(status_code=404, detail="Not available.")
    user = req.user.to_engine()
    # Pydantic deserialises dict keys as strings; the engine wants ints.
    debt_rates = {int(k): v for k, v in req.debt_effective_rates.items()}
    result = rank_liquidations(
        user=user,
        debt_effective_rates=debt_rates,
        marginal_rate=req.marginal_rate,
        high_rate_threshold=req.high_rate_threshold,
        horizon_years=req.horizon_years,
        surplus_reinvestment_yield=req.surplus_reinvestment_yield,
        pre_filter_margin=req.pre_filter_margin,
    )
    return LiquidationRankingsResponse(
        recommendations=[_rec_to_out(r) for r in result["recommendations"]],
        considered_but_skipped=[
            _rec_to_out(r) for r in result["considered_but_skipped"]
        ],
    )
