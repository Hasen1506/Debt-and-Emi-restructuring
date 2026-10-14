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
    """SBI Card MITC (C14, read 14 Oct 2026): 100% of GST, EMI, fees and
    finance charges + 2% of the remaining balance, ₹200 at least. On ₹50k
    with ₹1k interest (GST in): 1,000 + 1,000 = ₹2,000."""
    card = _card("SBI Card", D("50000"))
    mp = compute_minimum_payment(card, Country.IN, interest_accrued=D("1000"), fees=D("0"))
    assert mp == D("2000")


def test_axis_5pct_floor_200():
    """Axis MITC (C14): interest, fees, taxes, instalments + 2% of the
    balance, ₹100 at least. ₹50k → ₹1,000. ₹1,000 → ₹100 (floor)."""
    assert compute_minimum_payment(_card("Axis Bank", D("50000")), Country.IN) == D("1000")
    assert compute_minimum_payment(_card("Axis Bank", D("1000")), Country.IN) == D("100")


def test_icici_three_way_picks_max():
    """ICICI: max(interest+fees+1%principal, 5% outstanding, ₹100).
    On ₹50k with ₹1500 interest and 1% principal = ₹500 → option_a = ₹2000, option_b = ₹2500 → ₹2500."""
    # C14: ICICI MITC from 1 Mar 2026 (HDFC's rule). ₹1,500 interest incl.
    # GST = 1,271.19 finance charge + 228.81 GST; 5% of (FC + 50k) = 2,563.56
    # < FC + 5% of 50k = 3,771.19; + GST = ₹4,000.00.
    card = _card("ICICI Bank", D("50000"))
    mp = compute_minimum_payment(card, Country.IN, interest_accrued=D("1500"))
    assert mp.quantize(D("0.01")) == D("4000.00")


def test_icici_three_way_picks_interest_arm():
    """ICICI: if interest is very high, interest+1%principal arm wins."""
    card = _card("ICICI Bank", D("50000"))
    mp = compute_minimum_payment(card, Country.IN, interest_accrued=D("5000"))
    # FC 4,237.29 + 2,500 + GST 762.71 = 7,500
    assert mp.quantize(D("0.01")) == D("7500.00")


def test_hdfc_compound_includes_emi_overlimit_pastdue():
    """HDFC: max(5% TAD, ₹200) + current_emi + over_limit + past_due."""
    card = _card("HDFC Bank", D("50000"))
    mp = compute_minimum_payment(card, Country.IN, current_emi=D("3000"),
                                 over_limit=D("2000"), past_due=D("1000"))
    # base = 2500; total = 2500 + 3000 + 2000 + 1000 = 8500
    assert mp == D("8500")


def test_chase_1pct_plus_interest_floor_40():
    """Chase US: max(1% + interest + fees, $40). $1,000 with $20 interest → $40
    (floor). $5,000 with $100 interest → $150."""
    assert compute_minimum_payment(_card("Chase", D("1000")), Country.US, interest_accrued=D("20")) == D("40")
    assert compute_minimum_payment(_card("Chase", D("5000")), Country.US, interest_accrued=D("100")) == D("150")


def test_us_default_pays_principal_at_high_apr():
    """Unknown US bank: 1% + interest + fees, floor $35. At 29.99% the old
    "2% of the balance" ($160 on $8,000) was below the $200 of interest, so
    the card grew forever on minimums; now $80 of principal is paid."""
    card = _card("Some Credit Union", D("8000"))
    interest = D("8000") * D("0.2999") / 12
    mp = compute_minimum_payment(card, Country.US, interest_accrued=interest)
    assert mp == interest + D("80")


def test_discover_greatest_of_three():
    """Discover: max(2% balance, $20 + interest + fees, $35)."""
    # $5,000, $100 interest → max(100, 120, 35) = 120
    assert compute_minimum_payment(_card("Discover", D("5000")), Country.US, interest_accrued=D("100")) == D("120")
    # $5,000, no interest (0% promo) → max(100, 20, 35) = 100
    assert compute_minimum_payment(_card("Discover", D("5000")), Country.US) == D("100")
    # $500, $10 interest → max(10, 30, 35) = 35
    assert compute_minimum_payment(_card("Discover", D("500")), Country.US, interest_accrued=D("10")) == D("35")


def test_synchrony_greatest_of_three():
    """Synchrony: max(3.5% balance, 1% + interest + fees, $25)."""
    # $2,000, $50 interest → max(70, 70, 25) = 70
    assert compute_minimum_payment(_card("Synchrony", D("2000")), Country.US, interest_accrued=D("50")) == D("70")
    # $2,000, $80 interest → max(70, 100, 25) = 100
    assert compute_minimum_payment(_card("Synchrony", D("2000")), Country.US, interest_accrued=D("80")) == D("100")


def test_floor_never_exceeds_what_is_owed():
    """A $35 floor on a $20 balance is a bill for the $20 and its interest."""
    assert compute_minimum_payment(_card("Chase", D("20")), Country.US, interest_accrued=D("0.40")) == D("20.40")
    assert compute_minimum_payment(_card("Axis Bank", D("80")), Country.IN) == D("80")


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
