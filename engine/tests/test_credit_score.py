"""Tests for engine.credit_score — bounds, monotonicity, band transitions."""
from decimal import Decimal
import pytest

from engine.credit_score import (
    ScoreAction, ScoreBand,
    band, predict_impact, estimated_rate_offered,
)

D = Decimal


# ─── band classification ────────────────────────────────────────────────────

def test_bands_india():
    assert band(550) == ScoreBand.POOR
    assert band(620) == ScoreBand.FAIR
    assert band(700) == ScoreBand.GOOD
    assert band(770) == ScoreBand.VERY_GOOD
    assert band(820) == ScoreBand.EXCELLENT


def test_bands_us():
    assert band(550, "US") == ScoreBand.POOR
    assert band(820, "US") == ScoreBand.EXCELLENT


# ─── action deltas ──────────────────────────────────────────────────────────

def test_hard_inquiry_always_negative():
    r = predict_impact(ScoreAction.HARD_INQUIRY, current_score=720)
    assert r.delta_low <= r.delta_high <= 0
    assert "CIBIL" in r.source or "FICO" in r.source


def test_utilisation_drop_80_to_30_is_biggest_win():
    """The classic credit-card-paydown case: pays the biggest score dividend."""
    r = predict_impact(
        ScoreAction.UTILISATION_DROP,
        current_score=680,
        utilisation_from=D("0.80"),
        utilisation_to=D("0.30"),
    )
    assert r.delta_low >= 25
    assert r.delta_high >= 40


def test_utilisation_drop_proportional_to_magnitude():
    big = predict_impact(
        ScoreAction.UTILISATION_DROP,
        current_score=680,
        utilisation_from=D("0.60"), utilisation_to=D("0.20"),
    )
    small = predict_impact(
        ScoreAction.UTILISATION_DROP,
        current_score=680,
        utilisation_from=D("0.30"), utilisation_to=D("0.20"),
    )
    assert big.delta_high > small.delta_high


def test_utilisation_drop_requires_args():
    with pytest.raises(ValueError):
        predict_impact(ScoreAction.UTILISATION_DROP, current_score=700)


def test_balance_transfer_has_both_signs():
    r = predict_impact(ScoreAction.BALANCE_TRANSFER, current_score=720)
    assert r.delta_low < 0 < r.delta_high


def test_close_oldest_card_hits_thin_file_harder():
    normal = predict_impact(ScoreAction.CLOSE_OLDEST_CARD, current_score=720)
    thin = predict_impact(
        ScoreAction.CLOSE_OLDEST_CARD, current_score=720, has_thin_file=True,
    )
    assert thin.delta_low < normal.delta_low


def test_loan_paid_off_neutral_when_other_lines_exist():
    r = predict_impact(ScoreAction.LOAN_PAID_OFF, current_score=720,
                       is_only_instalment_loan=False)
    assert r.delta_low >= 0


def test_loan_paid_off_dips_when_only_instalment():
    r = predict_impact(ScoreAction.LOAN_PAID_OFF, current_score=720,
                       is_only_instalment_loan=True)
    assert r.delta_low < 0


def test_projected_score_clamped_to_band_range():
    """Projection never exceeds bureau caps."""
    r = predict_impact(ScoreAction.ON_TIME_STREAK_QUARTER, current_score=895)
    assert r.projected_score_high <= 900


def test_band_transition_visible_in_projection():
    """680 (Good) + 50pt jump should cross into Very Good (740+)."""
    r = predict_impact(
        ScoreAction.UTILISATION_DROP,
        current_score=700,
        utilisation_from=D("0.85"), utilisation_to=D("0.25"),
    )
    assert r.current_band == ScoreBand.GOOD
    assert r.projected_band_high in (ScoreBand.VERY_GOOD, ScoreBand.EXCELLENT)


# ─── rate offered ───────────────────────────────────────────────────────────

def test_rate_offered_monotonic_in_score():
    """Higher score → same-or-lower offered rate."""
    advertised = D("0.105")
    excellent = estimated_rate_offered(advertised, 820, "personal_loan")
    poor = estimated_rate_offered(advertised, 540, "personal_loan")
    assert excellent < poor


def test_home_loan_spread_smaller_than_personal():
    """Collateralised loans price-discriminate less on score."""
    advertised = D("0.085")
    home_fair = estimated_rate_offered(advertised, 620, "home_loan")
    personal_fair = estimated_rate_offered(advertised, 620, "personal_loan")
    home_spread = home_fair - advertised
    personal_spread = personal_fair - advertised
    assert home_spread < personal_spread


# ─── Bugs found 26 Sep 2026 ──────────────────────────────────────────────────

def test_rising_utilisation_costs_points():
    """10% → 70% used to predict 0; it mirrors the same-size drop."""
    up = predict_impact(ScoreAction.UTILISATION_DROP, 760,
                        utilisation_from=D("0.10"), utilisation_to=D("0.70"))
    down = predict_impact(ScoreAction.UTILISATION_DROP, 760,
                          utilisation_from=D("0.70"), utilisation_to=D("0.10"))
    assert up.delta_high < 0
    assert (up.delta_low, up.delta_high) == (-down.delta_high, -down.delta_low)
    assert "rises" in up.rationale


def test_paying_off_an_empty_card_changes_nothing():
    r = predict_impact(ScoreAction.CARD_PAID_OFF, 760, utilisation_from=D("0"))
    assert (r.delta_low, r.delta_high) == (0, 0)
