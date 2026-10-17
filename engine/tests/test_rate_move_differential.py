"""One rate-move arithmetic: the A13 email (engine/rate_move.py, W5) and Loan
Check (engine/rate_reset.rate_move_impact, W4 A11) must show the same numbers
for the same loan and move. rate_move rounds to paise, Loan Check to whole
rupees, both from rate_reset.rate_move_exact, so: months identical, and every
money figure within half a rupee (the rupee rounding of the same value).

Golden (hand-checked, see test_a80_rate_move.py and test_loan_check_hike_cycle.py):
₹50,00,000 at 8.50% for 240 months, repo +25 bp (8.75%):
  EMI ₹43,391.16 -> ₹44,185.54 (same end date) or the same EMI for 253 months (+13).
"""
from datetime import date
from decimal import Decimal as D

import pytest
from hypothesis import given, settings, strategies as st

from engine.rate_move import MAX_MONTHS, rate_move
from engine.rate_reset import rate_move_impact

DAY = date(2026, 10, 7)
HALF = D("0.5")


def _both(P, rate, move, months=None, emi=None):
    m = rate_move(name="x", outstanding=P, rate=rate, decision_day=DAY, repo_from=D("0.055"),
                  repo_to=D("0.055") + move, months_left=months, emi_now=emi)
    i = rate_move_impact(P, rate, rate + move, months or 1, emi)
    return m, i


def _same(m, i):
    assert m.months_now == i.months_before
    assert abs(m.emi_now - i.emi_before) <= HALF
    assert abs(m.emi_new - i.emi_after) <= HALF
    assert abs(m.interest_now - i.interest_before) <= HALF
    assert abs(m.interest_keep_tenure - i.interest_emi_option) <= HALF
    if i.months_after is not None and i.months_after <= MAX_MONTHS:
        assert m.months_keep_emi == i.months_after
        assert m.months_change == i.months_change
        assert abs(m.interest_keep_emi - i.interest_tenure_option) <= HALF
        assert abs(m.tenure_route_extra_interest - i.tenure_premium) <= D("1")  # two roundings of one difference
    else:
        assert m.months_keep_emi is None


def test_golden_50_lakh_8_5_pct_240_months_plus_25bp_identical():
    m, i = _both(D(5_000_000), D("0.085"), D("0.0025"), months=240)
    _same(m, i)
    assert (m.emi_now, m.emi_new) == (D("43391.16"), D("44185.54"))
    assert (i.emi_before, i.emi_after) == (D("43391"), D("44186"))
    assert m.months_keep_emi == i.months_after == 253
    assert m.months_change == i.months_change == 13


@pytest.mark.parametrize("P,rate,move,months,emi", [
    (D(5_000_000), D("0.085"), D("-0.0025"), 240, None),
    (D(3_000_000), D("0.0875"), D("0.0050"), None, D(30000)),
    (D(1_000_000), D("0.085"), D("0.0025"), None, D(7400)),      # keep-EMI past 40 years
    (D(800_000), D("0.11"), D("0.0025"), 60, None),
])
def test_grid_identical(P, rate, move, months, emi):
    _same(*_both(P, rate, move, months, emi))


@settings(max_examples=60, deadline=None)
@given(P=st.integers(200_000, 20_000_000), rate_bp=st.integers(600, 1400), n=st.integers(24, 360),
       move_bp=st.sampled_from([-50, -25, 25, 50]))
def test_property_identical(P, rate_bp, n, move_bp):
    _same(*_both(D(P), D(rate_bp) / 10000, D(move_bp) / 10000, months=n))
