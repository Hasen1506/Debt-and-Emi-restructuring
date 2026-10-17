"""A13: the rate-move numbers (keep tenure -> new EMI; keep EMI -> new tenure).

Golden case hand-checked with the closed-form formulas:
  ₹50,00,000 at 8.50% over 240 months: EMI = P·r·(1+r)^n / ((1+r)^n − 1)
  with r = 0.085/12 → ₹43,391.16 (the figure every bank calculator shows).
  After a +25 bp repo hike (8.75%):
    keep tenure: EMI = same formula at r = 0.0875/12, n = 240 → ₹44,185.54
    keep EMI:    n = −ln(1 − P·r/E) / ln(1 + r) = 252.43 → 253 months (+13)
"""
import math
from datetime import date
from decimal import Decimal as D

import pytest
from hypothesis import given, settings, strategies as st

from engine.rate_move import RateMoveError, amortise, check_by, email_lines, rate_move

HIKE = dict(decision_day=date(2026, 10, 7), repo_from=D("0.0525"), repo_to=D("0.0550"))


def test_golden_home_loan_hike_hand_checked():
    m = rate_move(name="SBI home loan", outstanding=D(5_000_000), rate=D("0.085"), months_left=240, **HIKE)
    assert m.emi_now == D("43391.16")
    assert m.months_now == 240
    assert m.rate_to == D("0.0875")
    P, r = 5_000_000, 0.0875 / 12
    assert float(m.emi_new) == pytest.approx(P * r * (1 + r) ** 240 / ((1 + r) ** 240 - 1), abs=0.01)
    n_float = -math.log(1 - P * r / float(m.emi_now)) / math.log(1 + r)
    assert m.months_keep_emi == math.ceil(n_float) == 253
    assert m.months_change == 13
    assert m.best == "raise_emi"
    assert m.tenure_route_extra_interest > 0
    assert m.check_by == date(2027, 1, 6)       # same 91-day window as loan_check.reset_watch


def test_cut_recommends_keeping_the_emi():
    m = rate_move(name="x", outstanding=D(5_000_000), rate=D("0.085"), months_left=240,
                  decision_day=date(2025, 12, 5), repo_from=D("0.0550"), repo_to=D("0.0525"))
    assert m.best == "keep_emi" and m.months_change < 0 and m.emi_change < 0


def test_rate_already_moved_means_the_entered_rate_is_the_new_one():
    a = rate_move(name="x", outstanding=D(3_000_000), rate=D("0.0875"), emi_now=D(30000), rate_already_moved=True, **HIKE)
    assert a.rate_from == D("0.0850") and a.rate_to == D("0.0875")


def test_emi_that_stops_covering_interest_forces_emi_route():
    # ₹10L at 8.5%, EMI ₹7,400 (month's interest ₹7,083, ~446 months left). At
    # 8.75% the interest is ₹7,292: n = -ln(1 - 7292/7400)/ln(1.00729) ≈ 581 > 480.
    m = rate_move(name="x", outstanding=D(1_000_000), rate=D("0.085"), emi_now=D(7400), **HIKE)
    assert m.months_keep_emi is None and m.best == "raise_emi"
    assert any("past 40 years" in line for line in email_lines(m))


@pytest.mark.parametrize("bad", [dict(outstanding=D(0), rate=D("0.08"), months_left=10),
                                 dict(outstanding=D(100), rate=D("8.5"), months_left=10),
                                 dict(outstanding=D(100000), rate=D("0.08"))])
def test_bad_inputs_raise_a_plain_error(bad):
    with pytest.raises(RateMoveError):
        rate_move(name="x", **bad, **HIKE)


@settings(max_examples=60, deadline=None)
@given(P=st.integers(200_000, 20_000_000), rate_bp=st.integers(600, 1400), n=st.integers(24, 360),
       move_bp=st.sampled_from([-50, -25, 25, 50]))
def test_invariant_direction_of_both_options(P, rate_bp, n, move_bp):
    """For every loan: a hike never shortens either route and the tenure route
    never costs less interest; a cut is the mirror image."""
    rate = D(rate_bp) / 10000
    m = rate_move(name="x", outstanding=D(P), rate=rate, months_left=n, decision_day=date(2026, 10, 7),
                  repo_from=D("0.055"), repo_to=D("0.055") + D(move_bp) / 10000)
    if move_bp > 0:
        assert m.emi_new >= m.emi_now
        assert m.months_keep_emi is None or m.months_keep_emi >= m.months_now
        assert m.tenure_route_extra_interest is None or m.tenure_route_extra_interest >= 0
    else:
        assert m.emi_new <= m.emi_now
        assert m.months_keep_emi <= m.months_now
        assert m.tenure_route_extra_interest <= 0
    # keeping the tenure means the same number of months (± one for paisa rounding)
    keep = amortise(D(P), m.rate_to, m.emi_new)
    assert keep.months is not None and abs(keep.months - m.months_now) <= 1


def test_check_by_is_three_months_window():
    assert check_by(date(2026, 12, 4)) == date(2027, 3, 5)
