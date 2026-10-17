"""Round 3 part B (#10): new loan kinds keep their own labels and tax rule.

A loan against property or a home-loan top-up is a home loan for tax only
when the money bought, built or repaired a house; a top-up's principal never
counts in 80C (conservative), and repair interest is capped at ₹30,000.
Two-wheeler and medical loans get no tax relief and their own names.
"""
from decimal import Decimal as D

import pytest

from engine.formulas import tax_shield_fraction
from engine.models import Country, Loan, LoanType, TaxRegimeIN, tax_type
from engine.penalties import estimate_late_fee
from engine.plan_insights import LOAN_NAME


def _loan(t, use=None, **kw):
    return Loan(loan_type=t, bank="X", outstanding=D("2000000"), nominal_rate=D("0.09"), rate_type="floating",
                tenure_months_remaining=120, scheduled_emi=D("25000"), house_use=use, **kw)


def _shield(loan, regime=TaxRegimeIN.OLD):
    return tax_shield_fraction(loan, D("0.3"), Country.IN, regime)


def test_lap_has_no_tax_break_unless_used_for_a_house():
    assert tax_type(_loan(LoanType.LAP)) == LoanType.LAP
    assert _shield(_loan(LoanType.LAP)) == 0
    assert _shield(_loan(LoanType.LAP, "other")) == 0
    lap = _loan(LoanType.LAP, "buy_build")
    assert tax_type(lap) == LoanType.HOME
    assert _shield(lap) == _shield(_loan(LoanType.HOME))
    assert lap.principal_80c_eligible and lap.sec24_full_cap


def test_top_up_gets_24b_only_when_used_for_a_house_and_never_80c():
    assert _shield(_loan(LoanType.HOME_TOPUP)) == 0
    up = _loan(LoanType.HOME_TOPUP, "buy_build")
    assert _shield(up) == D("0.3")       # ₹1.8L interest under the ₹2L cap
    assert up.principal_80c_eligible is False


def test_repair_use_caps_interest_at_30000():
    rep = _loan(LoanType.HOME_TOPUP, "repair")
    assert rep.sec24_full_cap is False and rep.principal_80c_eligible is False
    # ₹30,000 of ₹1,80,000 interest at 30%
    assert _shield(rep).quantize(D("0.0001")) == D("0.0500")


def test_new_regime_gives_lap_nothing_even_for_a_house():
    assert _shield(_loan(LoanType.LAP, "buy_build"), TaxRegimeIN.NEW) == 0


def test_house_use_ignored_on_other_kinds():
    home = _loan(LoanType.HOME, "repair")
    assert home.sec24_full_cap and home.principal_80c_eligible
    assert tax_type(_loan(LoanType.PERSONAL, "buy_build")) == LoanType.PERSONAL


@pytest.mark.parametrize("t", [LoanType.TWO_WHEELER, LoanType.MEDICAL])
def test_two_wheeler_and_medical_have_no_tax_break(t):
    assert _shield(_loan(t)) == 0
    assert tax_shield_fraction(_loan(t), D("0.3"), Country.US) == 0


def test_own_labels_not_car_or_personal():
    assert LOAN_NAME[LoanType.TWO_WHEELER] == "two-wheeler loan"
    assert LOAN_NAME[LoanType.MEDICAL] == "medical loan"
    assert LOAN_NAME[LoanType.LAP] == "loan against property"
    assert LOAN_NAME[LoanType.HOME_TOPUP] == "home loan top-up"


@pytest.mark.parametrize("t", [LoanType.LAP, LoanType.HOME_TOPUP, LoanType.TWO_WHEELER, LoanType.MEDICAL])
@pytest.mark.parametrize("c", [Country.IN, Country.US])
def test_penalty_defaults_exist_for_new_kinds(t, c):
    assert estimate_late_fee(loan_type=t, country=c, overdue_amount=D("1000"), days_late=10).total >= 0
