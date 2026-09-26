"""Offer comparison: keep, pay the fee to reset, or refinance."""
from dataclasses import replace
from datetime import date
from decimal import Decimal

import pytest

from engine.citations import PREPAYMENT_NO_CHARGE
from engine.formulas import emi as formula_emi
from engine.offer_compare import (
    REFINANCE_MARGIN, Mode, OfferInput, OfferInputError, RefinanceOffer, ResetOffer,
    bank_schedule, compare_offers, rounded_emi,
)

D = Decimal
TODAY = date(2026, 9, 26)
BASE = OfferInput(
    outstanding=D("4000000"), current_rate=D("0.0890"), months_left=200, as_of=TODAY,
    lender="HDFC Bank",
)


def test_emi_is_rounded_up_to_the_rupee():
    exact = formula_emi(D("4000000"), D("0.089"), 200)
    assert exact == pytest.approx(D("38434.569"), abs=D("0.001"))
    assert rounded_emi(D("4000000"), D("0.089"), 200) == D("38435")


@pytest.mark.parametrize("P, rate, n", [
    (D("4000000"), D("0.089"), 200), (D("100000"), D("0.09"), 360),
    (D("2500000"), D("0.12"), 12), (D("50000"), D("0.075"), 1),
])
def test_schedule_clears_the_loan_on_time(P, rate, n):
    s = bank_schedule(P, rate, months=n)
    assert s.months == n
    assert D("0") < s.last_payment <= s.emi
    paid = s.emi * (n - 1) + s.last_payment
    assert paid - s.total_interest == P          # every rupee of principal, no more
    assert all(i == i.quantize(D("0.01")) for i in s.interest)


def test_worked_example():
    c = compare_offers(replace(
        BASE,
        reset=ResetOffer(rate=D("0.0790"), fee=D("25000"), fee_plus_gst=True),
        refinance=RefinanceOffer(
            rate=D("0.0760"), lender="SBI", processing_fee=D("10000"), fee_plus_gst=True,
            stamp_duty=D("20000"), legal_and_valuation=D("8000"),
        ),
    ))
    keep, reset, refi = c.option("keep"), c.option("reset"), c.option("refinance")
    assert keep.emi == D("38435") and keep.saving == 0 and keep.break_even_month is None
    assert [x.amount for x in reset.upfront] == [D("25000"), D("4500")]
    assert reset.upfront_total == D("29500")
    assert refi.upfront_total == D("10000") + D("1800") + D("20000") + D("8000")
    assert reset.saving == keep.interest_total - reset.interest_total - reset.upfront_total
    assert refi.saving - reset.saving >= REFINANCE_MARGIN
    assert c.verdict == "refinance"
    assert refi.break_even_on == date(2027, 7, 1)          # month 10 after Sep 2026
    assert "SBI" in refi.label and "HDFC Bank" in c.next_step
    assert c.warnings == [] and c.citations == []


def test_no_fee_reset_saves_from_the_first_emi():
    c = compare_offers(replace(BASE, reset=ResetOffer(rate=D("0.0850"))))
    assert c.verdict == "reset"
    assert c.option("reset").break_even_month == 0
    assert "from the first EMI" in c.reason


def test_fee_as_percentage_of_outstanding():
    c = compare_offers(replace(BASE, reset=ResetOffer(rate=D("0.085"), fee_percent=D("0.0035"))))
    assert [x.amount for x in c.option("reset").upfront] == [D("14000")]


def test_refinance_must_beat_the_reset_by_the_margin():
    reset = ResetOffer(rate=D("0.0800"), fee=D("5000"))
    c = compare_offers(replace(BASE, reset=reset, refinance=RefinanceOffer(rate=D("0.0799"), processing_fee=D("5000"))))
    assert 0 < c.option("refinance").saving - c.option("reset").saving < REFINANCE_MARGIN
    assert c.verdict == "reset"
    assert "not enough more" in c.reason


def test_short_horizon_turns_the_fee_down():
    offer = ResetOffer(rate=D("0.0870"), fee=D("30000"), fee_plus_gst=True)
    long_run = compare_offers(replace(BASE, reset=offer))
    assert long_run.verdict == "reset"
    be = long_run.option("reset").break_even_month
    short = compare_offers(replace(BASE, reset=offer, horizon_months=be - 1))
    assert short.verdict == "keep"
    assert short.option("reset").saving <= 0
    assert f"(month {be})" in short.reason
    just_enough = compare_offers(replace(BASE, reset=offer, horizon_months=be))
    assert just_enough.verdict == "reset"


def test_fee_that_only_buys_the_owed_cut():
    c = compare_offers(replace(
        BASE, entitled_rate=D("0.0815"),
        reset=ResetOffer(rate=D("0.0815"), fee=D("20000"), fee_plus_gst=True),
    ))
    assert c.baseline == "keep_owed"
    assert c.option("keep").saving < 0            # keeping the overcharge costs money
    assert c.option("reset").saving == -D("23600")
    assert c.verdict == "keep"
    assert c.headline.startswith("Don't pay")
    assert any("passed on free" in w for w in c.warnings)
    assert "Ombudsman" in c.next_step


def test_fee_below_the_owed_rate_counts_only_the_extra_cut():
    offer = ResetOffer(rate=D("0.0790"), fee=D("25000"))
    plain = compare_offers(replace(BASE, reset=offer))
    owed = compare_offers(replace(BASE, reset=offer, entitled_rate=D("0.0815")))
    assert owed.option("reset").saving < plain.option("reset").saving
    assert not any("passed on free" in w for w in owed.warnings)


def test_longer_new_term_can_cost_more():
    c = compare_offers(replace(BASE, months_left=120, refinance=RefinanceOffer(
        rate=D("0.0850"), months=360,
    )))
    refi = c.option("refinance")
    assert refi.months == 360 and refi.saving < 0  # lower rate, far more interest
    assert refi.break_even_month == 0              # nothing paid up front
    assert "longer term" in c.reason
    assert c.verdict == "keep"


def test_prepayment_charge_is_flagged():
    c = compare_offers(replace(BASE, refinance=RefinanceOffer(
        rate=D("0.0760"), prepayment_charge=D("40000"),
    )))
    assert any("should not charge" in w for w in c.warnings)
    assert c.citations == [PREPAYMENT_NO_CHARGE]
    assert "Prepayment charge from HDFC Bank" in [x.label for x in c.option("refinance").upfront]


def test_same_emi_mode_finishes_sooner():
    c = compare_offers(replace(BASE, mode=Mode.SAME_EMI, reset=ResetOffer(rate=D("0.0790"), fee=D("25000"))))
    keep, reset = c.option("keep"), c.option("reset")
    assert keep.emi == reset.emi == D("38435")
    assert reset.months < keep.months
    assert reset.saving > 0
    assert "keeps today's EMI" in " ".join(c.notes)


def test_same_emi_at_a_much_higher_rate_is_an_error():
    with pytest.raises(OfferInputError) as e:
        compare_offers(replace(BASE, mode=Mode.SAME_EMI, months_left=480,
                               reset=ResetOffer(rate=D("0.20"))))
    assert e.value.field == "mode"


def test_unlabelled_lender():
    c = compare_offers(replace(BASE, lender="  ", refinance=RefinanceOffer(rate=D("0.07"), prepayment_charge=D("1"))))
    assert "The bank should not charge" in c.warnings[0]
    assert "a new lender" in c.option("refinance").label


@pytest.mark.parametrize("change, field", [
    (dict(current_rate=D("8.9")), "current_rate"),
    (dict(current_rate=D("0.005")), "current_rate"),
    (dict(outstanding=D("500")), "outstanding"),
    (dict(months_left=0), "tenure_months_remaining"),
    (dict(months_left=481), "tenure_months_remaining"),
    (dict(horizon_months=0), "horizon_months"),
    (dict(reset=None), "reset"),
    (dict(reset=ResetOffer(rate=D("7.9"))), "reset.rate"),
    (dict(reset=ResetOffer(rate=D("0.079"), fee=D("-1"))), "reset.fee"),
    (dict(reset=ResetOffer(rate=D("0.079"), fee=D("1"), fee_percent=D("0.01"))), "reset.fee"),
    (dict(reset=ResetOffer(rate=D("0.079"), fee_percent=D("0.5"))), "reset.fee_percent"),
    (dict(reset=ResetOffer(rate=D("0.079"), fee_percent=D("5"))), "reset.fee_percent"),
    (dict(refinance=RefinanceOffer(rate=D("0.07"), stamp_duty=D("-5"))), "refinance.stamp_duty"),
    (dict(refinance=RefinanceOffer(rate=D("0.07"), months=0)), "refinance.months"),
    (dict(entitled_rate=D("81.5")), "entitled_rate"),
])
def test_bad_input_is_named(change, field):
    with pytest.raises(OfferInputError) as e:
        compare_offers(replace(BASE, **{"reset": ResetOffer(rate=D("0.08")), **change}))
    assert e.value.field == field
