"""Bank-specific minimum payment formulas (§4.22 / brainstorm §24)."""
from decimal import Decimal
from engine.minimum_payments import compute_minimum_payment
from engine.models import Loan, LoanType, Country

D = Decimal


def _card(bank: str, outstanding: Decimal) -> Loan:
    return Loan(
        loan_type=LoanType.CREDIT_CARD,
        bank=bank,
        outstanding=outstanding,
        nominal_rate=D("0.36"),
        rate_type="fixed",
        tenure_months_remaining=12,
        scheduled_emi=D("0"),
    )


def test_sbi_card_5pct_plus_interest_fees():
    """SBI: max(5% TAD, ₹200) + interest + fees. On ₹50k with ₹1k interest: 2500+1000=₹3500."""
    card = _card("SBI Card", D("50000"))
    mp = compute_minimum_payment(card, Country.IN, interest_accrued=D("1000"), fees=D("0"))
    assert mp == D("3500")


def test_axis_5pct_floor_200():
    """Axis: max(5% outstanding, ₹200). ₹50k → ₹2500. ₹1000 → ₹200 (floor)."""
    assert compute_minimum_payment(_card("Axis Bank", D("50000")), Country.IN) == D("2500")
    assert compute_minimum_payment(_card("Axis Bank", D("1000")), Country.IN) == D("200")


def test_icici_three_way_picks_max():
    """ICICI: max(interest+fees+1%principal, 5% outstanding, ₹100).
    On ₹50k with ₹1500 interest and 1% principal = ₹500 → option_a = ₹2000, option_b = ₹2500 → ₹2500."""
    card = _card("ICICI Bank", D("50000"))
    mp = compute_minimum_payment(card, Country.IN, interest_accrued=D("1500"))
    assert mp == D("2500")


def test_icici_three_way_picks_interest_arm():
    """ICICI: if interest is very high, interest+1%principal arm wins."""
    card = _card("ICICI Bank", D("50000"))
    mp = compute_minimum_payment(card, Country.IN, interest_accrued=D("5000"))
    # option_a = 5000 + 0 + 500 = 5500; option_b = 2500 → 5500 wins
    assert mp == D("5500")


def test_hdfc_compound_includes_emi_overlimit_pastdue():
    """HDFC: max(5% TAD, ₹200) + current_emi + over_limit + past_due."""
    card = _card("HDFC Bank", D("50000"))
    mp = compute_minimum_payment(card, Country.IN, current_emi=D("3000"),
                                 over_limit=D("2000"), past_due=D("1000"))
    # base = 2500; total = 2500 + 3000 + 2000 + 1000 = 8500
    assert mp == D("8500")


def test_chase_2pct_floor_35():
    """Chase US: max(2% balance, $35). $1000 → $35 (floor). $5000 → $100."""
    assert compute_minimum_payment(_card("Chase", D("1000")), Country.US) == D("35")
    assert compute_minimum_payment(_card("Chase", D("5000")), Country.US) == D("100")


def test_simple_mode_uses_country_default():
    """Simple Mode ignores bank-specific formula."""
    card = _card("SBI Card", D("50000"))
    # Default India = 5%/₹200; ₹50k → ₹2500 (NOT SBI's +interest+fees rule)
    mp = compute_minimum_payment(card, Country.IN, interest_accrued=D("1000"), simple_mode=True)
    assert mp == D("2500")


def test_unknown_bank_falls_back_to_default():
    """Unknown bank uses country default."""
    card = _card("Nonexistent Bank", D("50000"))
    assert compute_minimum_payment(card, Country.IN) == D("2500")


def test_non_credit_card_returns_scheduled_emi():
    """Home loan etc: minimum = scheduled EMI."""
    home = Loan(loan_type=LoanType.HOME, bank="HDFC Bank",
                outstanding=D("5000000"), nominal_rate=D("0.085"), rate_type="floating",
                tenure_months_remaining=240, scheduled_emi=D("43391"))
    assert compute_minimum_payment(home, Country.IN) == D("43391")
