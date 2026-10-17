"""Country data store — MAB, stamp duty, CII, institution tiers."""
from decimal import Decimal
import pytest
from engine.country_data import (
    lookup_mab, lookup_stamp_duty, india_selling_cost_pct,
    lookup_cii, INSTITUTION_TIER,
)
from engine.models import Country

D = Decimal


def test_mab_lookup_known_bank():
    assert lookup_mab("HDFC Bank", "urban") == D("10000")
    assert lookup_mab("HDFC Bank", "rural") == D("2500")
    assert lookup_mab("Kotak 811", "urban") == D("0")    # zero-balance account


def test_mab_unknown_bank_defaults_zero():
    assert lookup_mab("Nonexistent", "urban") == D("0")


def test_stamp_duty_known_state():
    assert lookup_stamp_duty("Maharashtra") == D("0.06")
    assert lookup_stamp_duty("Tamil Nadu") == D("0.07")


def test_stamp_duty_unknown_state_default():
    assert lookup_stamp_duty("Unknown State") == D("0.06")


def test_india_selling_cost_is_brokerage_only():
    """The seller pays the broker; stamp duty + registration are the buyer's
    (Indian Stamp Act s.29(c)). The old 8.5% cut ₹7L off a ₹1 crore sale."""
    assert india_selling_cost_pct("Maharashtra") == D("0.015")
    assert india_selling_cost_pct("Tamil Nadu") == D("0.015")


def test_india_selling_cost_custom_brokerage():
    """Custom 2% brokerage."""
    assert india_selling_cost_pct("Maharashtra", D("0.02")) == D("0.02")


def test_cii_lookup_known_fy():
    assert lookup_cii("2024-25") == 363
    assert lookup_cii("2015-16") == 254


def test_cii_unknown_fy_raises():
    """Unknown FY should fail loudly, not return 0 or a default."""
    with pytest.raises(KeyError):
        lookup_cii("2030-31")


def test_institution_tier_india_a_has_six_banks():
    assert len(INSTITUTION_TIER[Country.IN]["A"]) == 6
    assert "HDFC Bank" in INSTITUTION_TIER[Country.IN]["A"]


def test_institution_tier_usa_a_has_six():
    assert len(INSTITUTION_TIER[Country.US]["A"]) == 6
    assert "JPMorgan Chase" in INSTITUTION_TIER[Country.US]["A"]


# ─────────────────────────────────────────────────────────────────────────────
# CII provisional fallback (May 2026 backlog refinement)
# ─────────────────────────────────────────────────────────────────────────────


def test_cii_provisional_returns_extrapolated_value():
    """FY 2027-28 isn't in the verified CBDT table yet — lookup should return
    an extrapolated provisional value instead of raising, so LTCG math keeps
    running while we wait for the annual notification."""
    from engine.country_data import lookup_cii, cii_is_provisional

    val = lookup_cii("2027-28")
    assert val > 384  # Must exceed FY26-27's verified 384
    assert val < 500  # Sanity bound
    assert cii_is_provisional("2027-28")


def test_cii_provisional_can_be_disabled():
    """Callers can opt out of provisional fallback when they need
    authoritative-only data (e.g. for audit-grade reporting)."""
    from engine.country_data import lookup_cii
    import pytest

    with pytest.raises(KeyError):
        lookup_cii("2027-28", allow_provisional=False)


def test_cii_verified_not_provisional():
    """Verified FYs (CBDT-published) must not be flagged as provisional."""
    from engine.country_data import cii_is_provisional

    assert not cii_is_provisional("2024-25")
    # Notified by CBDT: 376 (1 Jul 2025) and 384 (15 Jul 2026).
    assert not cii_is_provisional("2026-27")
    from engine.country_data import lookup_cii
    assert lookup_cii("2025-26") == 376
    assert lookup_cii("2026-27") == 384
    assert not cii_is_provisional("2001-02")
