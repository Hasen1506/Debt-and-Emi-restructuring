"""POST /api/score-impact · GET /api/score-band · POST /api/rate-offered.

Surfaces engine.credit_score predictions over HTTP. Single-call endpoints —
no engine state, no user object required. The frontend uses these to render
score-impact chips on each tool's verdict.
"""
from decimal import Decimal
from typing import Optional

from fastapi import APIRouter, HTTPException, Query
from pydantic import Field, model_validator

from engine.credit_score import (
    ScoreAction, ScoreBand,
    band, predict_impact, estimated_rate_offered,
)
from api.schemas import Rate, _Base, _In

D = Decimal
router = APIRouter(tags=["credit-score"])


def _check_country_score(country: str, score: int) -> str:
    """CIBIL runs 300–900, FICO 300–850; an 880 FICO isn't a real score."""
    c = country.upper()
    if c not in ("IN", "US"):
        raise ValueError("country must be IN or US")
    if c == "US" and score > 850:
        raise ValueError("US (FICO) scores run 300–850")
    return c


class ScoreImpactRequest(_In):
    action: ScoreAction
    current_score: int = Field(..., ge=300, le=900)
    country: str = "IN"

    @model_validator(mode="after")
    def _score_fits_country(self):
        self.country = _check_country_score(self.country, self.current_score)
        return self
    utilisation_from: Optional[Rate] = None
    utilisation_to: Optional[Rate] = None
    is_only_instalment_loan: bool = False
    has_thin_file: bool = False


class ScoreImpactResponse(_Base):
    action: ScoreAction
    current_score: int
    current_band: ScoreBand
    delta_low: int
    delta_high: int
    projected_score_low: int
    projected_score_high: int
    projected_band_low: ScoreBand
    projected_band_high: ScoreBand
    days_to_realise: int
    source: str
    rationale: str


class ScoreBandResponse(_Base):
    score: int
    country: str
    band: ScoreBand


class RateOfferedRequest(_In):
    advertised_rate: Rate
    score: int = Field(..., ge=300, le=900)
    loan_type: str
    country: str = "IN"

    @model_validator(mode="after")
    def _score_fits_country(self):
        self.country = _check_country_score(self.country, self.score)
        return self


class RateOfferedResponse(_Base):
    advertised_rate: Decimal
    offered_rate: Decimal
    spread: Decimal
    band: ScoreBand


@router.post("/score-impact", response_model=ScoreImpactResponse)
def score_impact(req: ScoreImpactRequest) -> ScoreImpactResponse:
    try:
        r = predict_impact(
            action=req.action,
            current_score=req.current_score,
            country=req.country,
            utilisation_from=req.utilisation_from,
            utilisation_to=req.utilisation_to,
            is_only_instalment_loan=req.is_only_instalment_loan,
            has_thin_file=req.has_thin_file,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return ScoreImpactResponse(**r.__dict__)


@router.get("/score-band", response_model=ScoreBandResponse)
def score_band(
    score: int = Query(..., ge=300, le=900), country: str = "IN",
) -> ScoreBandResponse:
    return ScoreBandResponse(score=score, country=country, band=band(score, country))


@router.post("/rate-offered", response_model=RateOfferedResponse)
def rate_offered(req: RateOfferedRequest) -> RateOfferedResponse:
    offered = estimated_rate_offered(
        advertised_rate=req.advertised_rate,
        score=req.score,
        loan_type=req.loan_type,
        country=req.country,
    )
    return RateOfferedResponse(
        advertised_rate=req.advertised_rate,
        offered_rate=offered,
        spread=offered - req.advertised_rate,
        band=band(req.score, req.country),
    )
