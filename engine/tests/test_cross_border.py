"""Tests for engine.cross_border — NRI prepay-vs-invest with FX drift."""
from decimal import Decimal
from engine.cross_border import (
    CrossBorderInputs, evaluate_cross_border, historical_drift_default,
)

D = Decimal


def test_nri_with_india_home_loan_should_prepay_from_usd_savings():
    """Classic NRI: 8.5% INR home loan, 5% USD HYSA, 24% US tax, INR depreciates 3%/yr.
    Loan FX-adjusted cost ≈ (1.085)(0.97) − 1 ≈ 5.24%. Post-tax yield = 3.8%.
    Spread ≈ 1.4pp → prepay."""
    inp = CrossBorderInputs(
        loan_balance=D("3500000"),         # ₹35L
        loan_nominal_rate=D("0.085"),
        loan_tenure_months=180,
        fx_rate=D("0.012"),                # 1 INR = $0.012
        user_savings_yield=D("0.05"),      # HYSA
        user_marginal_tax=D("0.24"),       # US fed marginal
        expected_fx_drift_annual=D("-0.03"),
        inflation_user_country=D("0.025"),
    )
    v = evaluate_cross_border(inp)
    assert v.verdict == "prepay"
    assert v.spread > D("0.01")


def test_nri_with_low_loan_rate_and_high_yield_should_invest():
    """Cheap loan + high yield + strengthening loan currency → invest, don't prepay."""
    inp = CrossBorderInputs(
        loan_balance=D("3500000"),
        loan_nominal_rate=D("0.04"),       # cheap loan
        loan_tenure_months=180,
        fx_rate=D("0.012"),
        user_savings_yield=D("0.08"),      # equities
        user_marginal_tax=D("0.15"),       # LTCG
        expected_fx_drift_annual=D("-0.02"),
        inflation_user_country=D("0.025"),
    )
    v = evaluate_cross_border(inp)
    assert v.verdict == "invest"


def test_emi_grows_over_5y_when_loan_currency_strengthens():
    """If loan currency strengthens vs user currency, the user pays more in 5 years."""
    inp = CrossBorderInputs(
        loan_balance=D("3500000"),
        loan_nominal_rate=D("0.085"),
        loan_tenure_months=180,
        fx_rate=D("0.012"),
        user_savings_yield=D("0.05"),
        user_marginal_tax=D("0.24"),
        expected_fx_drift_annual=D("0.03"),   # loan ccy strengthens
        inflation_user_country=D("0.025"),
    )
    v = evaluate_cross_border(inp)
    assert v.loan_emi_user_currency_y5 > v.loan_emi_user_currency


def test_historical_drift_inr_usd_pair():
    assert historical_drift_default("INR", "USD") == D("-0.030")
    assert historical_drift_default("USD", "INR") == D("0.030")
    assert historical_drift_default("EUR", "GBP") == D("0")     # unknown pair → 0
