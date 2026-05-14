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


def test_india_selling_cost_maharashtra():
    """MH stamp 6% + 1% reg + 1.5% brokerage = 8.5%."""
    assert india_selling_cost_pct("Maharashtra") == D("0.085")


def test_india_selling_cost_custom_brokerage():
    """Custom 2% brokerage."""
    assert india_selling_cost_pct("Maharashtra", D("0.02")) == D("0.09")


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
