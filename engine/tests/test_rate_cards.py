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


def test_lookup_tier_b_indicative_returns_range():
    """Tier-B banks are populated with extrapolated indicative ranges."""
    r = lookup_rate("Yes Bank", LoanType.HOME)
    assert r is not None
    assert r.low > D("0.07") and r.high < D("0.12")


def test_tier_b_and_c_all_flagged_indicative():
    """Every Tier-B/C card must carry is_indicative=True so data ops can target them."""
    for card in INDIA_TIER_B + INDIA_TIER_C + USA_TIER_B + USA_TIER_C:
        assert card.is_indicative is True, f"{card.name} missing is_indicative flag"
    for card in INDIA_TIER_A + USA_TIER_A:
        assert card.is_indicative is False, f"{card.name} should not be indicative"


def test_tier_b_india_covers_main_psu_and_private_mid():
    names = {c.name for c in INDIA_TIER_B}
    assert {"Bank of Baroda", "Canara Bank", "Yes Bank", "IDFC First"} <= names


def test_navy_federal_auto_loan_competitive():
    """Member-only credit unions undercut large-bank auto rates."""
    nfcu = lookup_rate("Navy Federal Credit Union", LoanType.AUTO)
    chase = lookup_rate("JPMorgan Chase", LoanType.AUTO)
    assert nfcu is not None and chase is not None
    assert nfcu.low < chase.low


def test_market_median_india_home_loan():
    """Median across Tier-A India home loan medians should be in a reasonable band."""
    m = market_median(Country.IN, LoanType.HOME)
    assert m is not None
    assert m > D("0.075") and m < D("0.090")    # 7.5%-9%


def test_market_median_usa_mortgage():
    m = market_median(Country.US, LoanType.HOME)
    assert m is not None
    assert m > D("0.060") and m < D("0.075")


def test_no_us_personal_loan_or_mortgage_from_lenders_that_stopped_offering_them():
    """Chase and Bank of America make no personal loans, Goldman stopped in
    2023, Ally sold its lending arm in 2024 and stopped mortgages in 2025: a
    refinance suggestion naming one would send the user to a dead end."""
    for bank in ("JPMorgan Chase", "Bank of America", "Goldman Sachs", "Ally Financial"):
        assert lookup_rate(bank, LoanType.PERSONAL) is None, bank
    assert lookup_rate("Ally Financial", LoanType.HOME) is None


def test_us_consolidation_target_is_a_lender_that_makes_personal_loans():
    from engine.restructuring_scan import _best_market_rate
    bank, _ = _best_market_rate(Country.US, LoanType.PERSONAL)
    assert bank not in ("JPMorgan Chase", "Bank of America", "Goldman Sachs", "Ally Financial")
