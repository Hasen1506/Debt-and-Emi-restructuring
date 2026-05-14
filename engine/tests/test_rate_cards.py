"""Institution rate cards — §7.1."""
from decimal import Decimal
from engine.rate_cards import (
    ALL_INSTITUTIONS, INDIA_TIER_A, USA_TIER_A,
    INDIA_TIER_B, INDIA_TIER_C, USA_TIER_B, USA_TIER_C,
    lookup_rate, market_median,
)
from engine.models import Country, LoanType

D = Decimal


def test_india_tier_a_has_six_populated_banks():
    assert len(INDIA_TIER_A) == 6
    for card in INDIA_TIER_A:
        assert card.home_loan is not None or card.personal_loan is not None
        assert card.scrape_tier == "A"


def test_usa_tier_a_has_six_populated():
    assert len(USA_TIER_A) == 6
    for card in USA_TIER_A:
        assert card.scrape_tier == "A"


def test_total_institutions_30_india_15_usa():
    """Spec §7.1 requires 30 India + 15 USA tracked institutions."""
    india_count = len(INDIA_TIER_A) + len(INDIA_TIER_B) + len(INDIA_TIER_C)
    usa_count = len(USA_TIER_A) + len(USA_TIER_B) + len(USA_TIER_C)
    assert india_count == 30
    assert usa_count == 15


def test_hdfc_home_loan_range_matches_spec():
    """Spec §7.1 indicative table: HDFC home 7.75-8.15%."""
    r = lookup_rate("HDFC Bank", LoanType.HOME)
    assert r is not None
    assert r.low == D("0.0775") and r.high == D("0.0815")
    assert r.median == D("0.0795")


def test_icici_credit_card_range_matches_spec():
    r = lookup_rate("ICICI Bank", LoanType.CREDIT_CARD)
    assert r is not None
    assert r.low == D("0.2988") and r.high == D("0.45")


def test_chase_mortgage_range_matches_spec():
    r = lookup_rate("JPMorgan Chase", LoanType.HOME)
    assert r is not None
    assert r.low == D("0.0650") and r.high == D("0.0700")


def test_lookup_unknown_bank_returns_none():
    assert lookup_rate("Nonexistent Bank", LoanType.HOME) is None


def test_lookup_tier_b_unpopulated_returns_none():
    """Tier-B banks are scaffolded with no rate ranges yet."""
    assert lookup_rate("Yes Bank", LoanType.HOME) is None


def test_market_median_india_home_loan():
    """Median across Tier-A India home loan medians should be in a reasonable band."""
    m = market_median(Country.IN, LoanType.HOME)
    assert m is not None
    assert m > D("0.075") and m < D("0.090")    # 7.5%-9%


def test_market_median_usa_mortgage():
    m = market_median(Country.US, LoanType.HOME)
    assert m is not None
    assert m > D("0.060") and m < D("0.075")
