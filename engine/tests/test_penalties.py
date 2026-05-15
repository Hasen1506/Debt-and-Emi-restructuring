"""Late/missed payment penalty estimator."""
from decimal import Decimal
from engine.penalties import estimate_late_fee, PenaltyEstimate
from engine.models import Country, LoanType
from engine.rate_cards import InstitutionRateCard

D = Decimal


def test_in_personal_loan_default():
    """IN personal loan: ₹500 flat + 24%/yr penal + 18% GST."""
    est = estimate_late_fee(
        loan_type=LoanType.PERSONAL,
        country=Country.IN,
        overdue_amount=D("10000"),
        days_late=30,
    )
    assert est.flat_fee == D("500")
    # 10000 * 0.24 * 30/365 ≈ 197.26
    assert D("190") < est.penal_interest < D("210")
    # GST 18% on flat + penal_interest
    assert est.gst > D("0")
    assert est.total == est.flat_fee + est.penal_interest + est.gst
    assert est.source == "country_default"


def test_in_home_loan_is_gst_exempt():
    est = estimate_late_fee(
        loan_type=LoanType.HOME,
        country=Country.IN,
        overdue_amount=D("50000"),
        days_late=15,
    )
    assert est.gst == D("0")
    # 50000 * 0.02 * 15/365 ≈ 41.10
    assert D("35") < est.penal_interest < D("50")


def test_us_credit_card_uses_card_act_cap():
    est = estimate_late_fee(
        loan_type=LoanType.CREDIT_CARD,
        country=Country.US,
        overdue_amount=D("1500"),
        days_late=30,
    )
    assert est.flat_fee == D("30")
    assert est.gst == D("0")
    # 1500 * 0.2999 * 30/365 ≈ 36.97
    assert D("30") < est.penal_interest < D("45")


def test_bank_specific_overrides_default():
    """If the institution card has explicit late_payment fields, use them."""
    card = InstitutionRateCard(
        institution_id="IN_TEST",
        country=Country.IN,
        name="Test Bank",
        scrape_tier="A",
        late_payment_flat_fee=D("1200"),
        late_payment_penal_rate=D("0.36"),
    )
    est = estimate_late_fee(
        loan_type=LoanType.PERSONAL,
        country=Country.IN,
        overdue_amount=D("10000"),
        days_late=30,
        bank_card=card,
    )
    assert est.flat_fee == D("1200")
    # Default would have been ~197; bank's higher penal → higher figure
    assert est.penal_interest > D("250")
    assert est.source == "bank_specific"


def test_days_late_floor_is_one():
    """A 0-day 'miss' shouldn't accrue zero penal interest — clamp to 1 day."""
    a = estimate_late_fee(
        loan_type=LoanType.PERSONAL, country=Country.IN,
        overdue_amount=D("10000"), days_late=0,
    )
    b = estimate_late_fee(
        loan_type=LoanType.PERSONAL, country=Country.IN,
        overdue_amount=D("10000"), days_late=1,
    )
    assert a.penal_interest == b.penal_interest


def test_negative_overdue_treated_as_zero():
    est = estimate_late_fee(
        loan_type=LoanType.PERSONAL, country=Country.IN,
        overdue_amount=D("-100"), days_late=30,
    )
    # Flat fee + GST still apply; penal interest is zero on a negative balance
    assert est.penal_interest == D("0")
    assert est.flat_fee == D("500")


def test_returns_penalty_estimate_dataclass():
    est = estimate_late_fee(
        loan_type=LoanType.PERSONAL, country=Country.IN,
        overdue_amount=D("1000"), days_late=10,
    )
    assert isinstance(est, PenaltyEstimate)
