"""GET /api/institutions · /api/institutions/{name} · /api/market-median"""
from decimal import Decimal
from fastapi import APIRouter, HTTPException

from engine.models import Country, LoanType
from engine.rate_cards import (
    INDIA_TIER_A, INDIA_TIER_B, INDIA_TIER_C,
    USA_TIER_A, USA_TIER_B, USA_TIER_C,
    ALL_INSTITUTIONS, market_median, market_lowest,
)

from api.schemas import (
    InstitutionOut,
    MarketMedianResponse,
    MarketLowestResponse,
    RateRangeOut,
)

router = APIRouter(tags=["institutions"])


def _to_out(card) -> InstitutionOut:
    def rr(r):
        return RateRangeOut(low=r.low, high=r.high, median=r.median) if r else None
    return InstitutionOut(
        institution_id=card.institution_id, country=card.country,
        name=card.name, scrape_tier=card.scrape_tier,
        home_loan=rr(card.home_loan),
        personal_loan=rr(card.personal_loan),
        auto_loan=rr(card.auto_loan),
        education_loan=rr(card.education_loan),
        credit_card_apr_low=card.credit_card.apr_low if card.credit_card else None,
        credit_card_apr_high=card.credit_card.apr_high if card.credit_card else None,
        processing_fee_pct=card.processing_fee_pct,
        last_verified=card.last_verified,
    )


@router.get("/institutions", response_model=list[InstitutionOut])
def list_institutions(
    country: Country | None = None,
    tier: str | None = None,
) -> list[InstitutionOut]:
    """List all institution rate cards. Filterable by country and scrape tier."""
    pool = (
        INDIA_TIER_A + INDIA_TIER_B + INDIA_TIER_C
        + USA_TIER_A + USA_TIER_B + USA_TIER_C
    )
    if country is not None:
        pool = [c for c in pool if c.country == country]
    if tier is not None:
        pool = [c for c in pool if c.scrape_tier == tier]
    return [_to_out(c) for c in pool]


@router.get("/institutions/{name}", response_model=InstitutionOut)
def get_institution(name: str) -> InstitutionOut:
    card = ALL_INSTITUTIONS.get(name)
    if card is None:
        raise HTTPException(status_code=404, detail=f"Unknown institution: {name}")
    return _to_out(card)


@router.get("/market-median", response_model=MarketMedianResponse)
def get_market_median(country: Country, loan_type: LoanType) -> MarketMedianResponse:
    median = market_median(country, loan_type)
    return MarketMedianResponse(country=country, loan_type=loan_type, median=median)


@router.get("/market-lowest", response_model=MarketLowestResponse)
def get_market_lowest(country: Country, loan_type: LoanType) -> MarketLowestResponse:
    """Cheapest Tier-A indicative rate for (country, loan_type) and which
    bank quotes it. Drives the goals achievability T3 "you'd need a new
    loan around this rate" line."""
    found = market_lowest(country, loan_type)
    if found is None:
        return MarketLowestResponse(country=country, loan_type=loan_type, bank=None, low=None)
    return MarketLowestResponse(
        country=country, loan_type=loan_type, bank=found[0], low=found[1],
    )
