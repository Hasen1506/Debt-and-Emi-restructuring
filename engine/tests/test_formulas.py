"""Core formulas — EMI, effective_rate, PF pretax_equiv, prepay decision."""
from decimal import Decimal
from engine import formulas
from engine.models import Loan, LoanType, Country, TaxRegimeIN

D = Decimal


def test_emi_standard_50L_home_loan():
    """₹50L @ 8.25% over 20 years (240 months). Known EMI ≈ ₹42,604."""
    e = formulas.emi(D("5000000"), D("0.0825"), 240)
    assert D("42500") < e < D("42700")


def test_emi_zero_rate():
    """Zero-rate loan: EMI = principal / months."""
    assert formulas.emi(D("120000"), D("0"), 12) == D("10000")


def test_remaining_balance_after_one_year():
    """Balance after 12 months of EMI is lower than principal but still substantial."""
    principal = D("5000000")
    bal_12 = formulas.remaining_balance(principal, D("0.0825"), 240, 12)
    assert bal_12 < principal
    assert bal_12 > principal * D("0.95")


def test_pretax_equiv_epf_30pct():
    """EPF 8.25% / 0.70 = 11.785714…%."""
    equiv = formulas.pretax_equiv(formulas.EPF_RATE_FY26, D("0.30"))
    # Round to 4dp for the published 11.79% figure
    assert round(equiv, 4) == round(D("0.0825") / D("0.70"), 4)


def test_pretax_equiv_ppf_30pct():
    """PPF 7.1% / 0.70 = 10.142857…%."""
    equiv = formulas.pretax_equiv(formulas.PPF_RATE_Q1_FY27, D("0.30"))
    assert round(equiv, 4) == round(D("0.071") / D("0.70"), 4)


def test_country_cap_home_loan_new_regime_self_occupied():
    """India new regime self-occupied → zero shield."""
    cap = formulas.country_cap_home_loan(Country.IN, TaxRegimeIN.NEW, "self_occupied")
    assert cap == D("0")


def test_country_cap_home_loan_old_regime_self_occupied():
    """India old regime self-occupied → ₹2L cap."""
    cap = formulas.country_cap_home_loan(Country.IN, TaxRegimeIN.OLD, "self_occupied")
    assert cap == D("200000")


def test_country_cap_let_out_limited_to_loss_set_off():
    """P2-06: without rental income in the engine, a let-out loss lowers tax
    on other income only up to ₹2L (old regime) and not at all (new)."""
    assert formulas.country_cap_home_loan(Country.IN, TaxRegimeIN.NEW, "let_out") == D("0")
    assert formulas.country_cap_home_loan(Country.IN, TaxRegimeIN.OLD, "let_out") == D("200000")


def test_effective_rate_new_regime_home_loan_no_shield():
    """New-regime self-occupied home loan: shield = 0, effective = nominal + GST_on_fees."""
    loan = Loan(
        loan_type=LoanType.HOME,
        bank="HDFC",
        outstanding=D("5000000"),
        nominal_rate=D("0.0850"),
        rate_type="floating",
        tenure_months_remaining=240,
        scheduled_emi=D("43391"),
        property_use="self_occupied",
    )
    eff = formulas.effective_rate(loan, marginal_tax_rate=D("0.30"),
                                   country=Country.IN, tax_regime=TaxRegimeIN.NEW)
    # No shield, no processing fee, no insurance, no GST on home-loan interest
    assert eff == D("0.0850")


def test_effective_rate_old_regime_home_loan_shielded():
    """Old regime ₹50L @ 8.5%: annual interest = ₹4,25,000; cap ₹2L;
    shield_pct = 2L/4.25L × 30% ≈ 14.12%; effective ≈ 8.5% × (1 − 0.1412) ≈ 7.30%."""
    loan = Loan(
        loan_type=LoanType.HOME,
        bank="HDFC",
        outstanding=D("5000000"),
        nominal_rate=D("0.0850"),
        rate_type="floating",
        tenure_months_remaining=240,
        scheduled_emi=D("43391"),
        property_use="self_occupied",
    )
    eff = formulas.effective_rate(loan, marginal_tax_rate=D("0.30"),
                                   country=Country.IN, tax_regime=TaxRegimeIN.OLD)
    assert D("0.0725") < eff < D("0.0735")


def test_credit_card_gst_adds_18pct_of_interest():
    """Credit card: GST component = nominal × 0.18."""
    loan = Loan(
        loan_type=LoanType.CREDIT_CARD,
        bank="ICICI",
        outstanding=D("100000"),
        nominal_rate=D("0.36"),
        rate_type="fixed",
        tenure_months_remaining=12,
        scheduled_emi=D("0"),
    )
    eff = formulas.effective_rate(loan, marginal_tax_rate=D("0.30"), country=Country.IN)
    # No tax shield on credit card; GST adds 36% × 18% = 6.48%
    assert eff == D("0.36") + D("0.36") * D("0.18")


def test_prepay_recommended_high_rate_loan_beats_FD():
    """24% credit card vs 6.5% FD: prepay clearly recommended."""
    assert formulas.prepay_recommended(D("0.24"), D("0.065"), D("0.046")) is True


def test_prepay_NOT_recommended_low_rate_home_loan_vs_equity():
    """7% home loan vs 12% equity: invest (do not prepay)."""
    assert formulas.prepay_recommended(D("0.07"), D("0.12"), D("0.046")) is False


def test_prepay_recommended_within_risk_premium():
    """Loan real = invest real + 0.4pp: below 0.5pp hurdle → invest, not prepay."""
    # loan_real = 0.08 - 0.046 = 0.034; invest_real = 0.076 - 0.046 = 0.030
    # diff = 0.004 < 0.005 → False
    assert formulas.prepay_recommended(D("0.080"), D("0.076"), D("0.046")) is False
