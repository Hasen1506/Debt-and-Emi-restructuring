"""UX2 #20: after a lump sum, "lower your EMI or finish sooner?" is the
borrower's answer, and the engine runs each answer correctly."""
import math
from decimal import Decimal

import pytest
from hypothesis import given, settings, strategies as st

from engine.prepay_choice import REDUCE_EMI, REDUCE_TENURE, months_to_clear, prepay_effect
from engine.sensitivity import with_lump_sum
from engine.tests.test_sensitivity import _user

D = Decimal


def _nper(balance: float, annual: float, payment: float) -> int:
    """Independent closed form: months for `payment` to clear `balance`."""
    r = annual / 12
    return math.ceil(-math.log(1 - r * balance / payment) / math.log(1 + r))


def _pmt(balance: float, annual: float, n: int) -> float:
    r = annual / 12
    return balance * r / (1 - (1 + r) ** -n)


def test_golden_home_loan_5_lakh_prepayment_hand_check():
    """₹40,00,000 at 8.5% with 240 months and a ₹34,713 EMI; ₹5,00,000 prepaid.
    Hand check (closed forms above): finishing sooner keeps ₹34,713 and takes
    nper(35L) months; a lower EMI is pmt(35L, 240) = ₹30,374 over 240 months."""
    tenure = prepay_effect(D("4000000"), D("0.085"), D("34713"), 240, D("500000"), REDUCE_TENURE)
    lower = prepay_effect(D("4000000"), D("0.085"), D("34713"), 240, D("500000"), REDUCE_EMI)
    assert tenure.new_emi == D("34713.00")
    assert tenure.new_months == _nper(3_500_000, 0.085, 34713)
    assert tenure.new_months < tenure.old_months
    assert abs(float(lower.new_emi) - _pmt(3_500_000, 0.085, 240)) < 0.01
    assert round(float(lower.new_emi)) == 30374
    assert lower.new_months in (239, 240)
    # Finishing sooner saves more interest than a lower EMI (same money in).
    assert tenure.interest_saved > lower.interest_saved > 0


@settings(max_examples=60, deadline=None)
@given(
    balance=st.integers(50_000, 20_000_000),
    rate_bp=st.integers(100, 2400),
    months=st.integers(12, 360),
    share=st.floats(0.01, 0.9),
)
def test_each_answer_moves_only_its_own_lever(balance, rate_bp, months, share):
    """The invariant behind the question, for any loan: finish sooner keeps
    the EMI and shortens the loan; lower EMI keeps the end and lowers the
    EMI; and finishing sooner never saves less interest."""
    rate = D(rate_bp) / D(10_000)
    emi = D(str(round(_pmt(balance, float(rate), months), 2))) + D("0.01")
    paid = (D(balance) * D(str(share))).quantize(D("1"))
    if paid <= 0:
        return
    t = prepay_effect(D(balance), rate, emi, months, paid, REDUCE_TENURE)
    e = prepay_effect(D(balance), rate, emi, months, paid, REDUCE_EMI)
    assert t.new_emi == t.old_emi and t.new_months <= t.old_months
    assert e.new_emi < e.old_emi and abs(e.new_months - months) <= 1
    assert t.interest_saved >= e.interest_saved - D("1")
    assert e.interest_saved >= 0


def test_unknown_mode_and_nothing_to_prepay_are_refused():
    with pytest.raises(ValueError):
        prepay_effect(D("100000"), D("0.1"), D("5000"), 24, D("1000"), "both")
    with pytest.raises(ValueError):
        prepay_effect(D("100000"), D("0.1"), D("5000"), 24, D("0"), REDUCE_EMI)


def test_a_payment_that_never_covers_interest_has_no_end():
    assert months_to_clear(D("100000"), D("0.24"), D("2000")) is None


def test_plan_with_lower_emi_keeps_the_loans_end_and_lowers_its_emi():
    """with_lump_sum(mode=reduce_emi) re-works the loan's EMI in the plan; the
    default (no answer) keeps the EMI, as a bank does with no instruction."""
    u = _user()
    keep = with_lump_sum(u, D("500000"), 0, horizon_months=360)
    lower = with_lump_sum(u, D("500000"), 0, horizon_months=360, mode=REDUCE_EMI)
    sooner = with_lump_sum(u, D("500000"), 0, horizon_months=360, mode=REDUCE_TENURE)
    assert keep.total_interest_paid == sooner.total_interest_paid
    # A lower EMI frees cash each month, which the plan sends to the dearest
    # debt (here the 36% card), so the two answers give different plans.
    assert lower.months[0].available_surplus > sooner.months[0].available_surplus
    assert lower.total_interest_paid != sooner.total_interest_paid
    # The caller's user is untouched.
    assert u.loans[0].scheduled_emi == D("34713") and u.loans[0].outstanding == D("4000000")
