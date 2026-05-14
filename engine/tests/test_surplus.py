"""§4.23 — available surplus + one-time buffer."""
from decimal import Decimal
from engine.surplus import (
    compute_available_surplus, compute_available_buffer,
    compute_efund_monthly, compute_total_minimums,
)
from engine.models import (
    User, Loan, LoanType, Country, IncomeType, TaxRegimeIN,
)

D = Decimal


def _user(country=Country.IN, savings=D("200000"), efund_balance=D("50000"),
          efund_target=D("300000"), income_type=IncomeType.SALARIED,
          bank="HDFC Bank") -> User:
    return User(
        country=country, income_type=income_type,
        annual_income=D("1500000"), monthly_income=D("125000"),
        fixed_expenses=D("60000"), savings_balance=savings,
        primary_bank=bank, tax_regime=TaxRegimeIN.NEW,
        efund_balance=efund_balance, efund_target=efund_target,
    )


def _loan(loan_type=LoanType.CREDIT_CARD, outstanding=D("50000"),
          emi=D("0"), bank="HDFC Bank") -> Loan:
    return Loan(loan_type=loan_type, bank=bank, outstanding=outstanding,
                nominal_rate=D("0.36"), rate_type="fixed",
                tenure_months_remaining=12, scheduled_emi=emi)


def test_efund_monthly_zero_when_target_reached():
    user = _user(efund_balance=D("400000"), efund_target=D("300000"))
    assert compute_efund_monthly(user) == D("0")


def test_efund_monthly_amortised_over_12_months():
    user = _user(efund_balance=D("100000"), efund_target=D("300000"))
    # gap = 200000 / 12 ≈ 16,666.67
    assert compute_efund_monthly(user) == D("200000") / D("12")


def test_total_minimums_sums_across_loans():
    user = _user()
    card = _loan(LoanType.CREDIT_CARD, D("50000"))
    home = Loan(loan_type=LoanType.HOME, bank="HDFC Bank",
                outstanding=D("4000000"), nominal_rate=D("0.085"),
                rate_type="floating", tenure_months_remaining=240,
                scheduled_emi=D("34713"))
    # Card min (HDFC compound base) = 2500; home = 34713
    total = compute_total_minimums(user, [card, home])
    assert total == D("2500") + D("34713")


def test_available_surplus_basic():
    """Income 125k − expenses 60k − card_min 2500 − efund_monthly ~16667 = ~45833."""
    user = _user(efund_balance=D("100000"), efund_target=D("300000"))
    card = _loan(LoanType.CREDIT_CARD, D("50000"))
    surplus = compute_available_surplus(user, [card])
    expected = D("125000") - D("60000") - D("2500") - (D("200000") / D("12"))
    assert surplus == expected


def test_available_surplus_floored_at_zero():
    """If minimums exceed income, surplus floors at zero (never negative)."""
    user = _user()
    user.monthly_income = D("10000")
    user.fixed_expenses = D("8000")
    card = _loan(LoanType.CREDIT_CARD, D("500000"))   # min 5%×500k = 25000
    assert compute_available_surplus(user, [card]) == D("0")


def test_available_surplus_subtracts_match():
    user = _user(efund_balance=D("400000"))
    card = _loan(LoanType.CREDIT_CARD, D("50000"))
    s0 = compute_available_surplus(user, [card])
    s1 = compute_available_surplus(user, [card], matched_contribution=D("5000"))
    assert s0 - s1 == D("5000")


def test_buffer_subtracts_mab_india():
    """HDFC urban MAB ₹10k → 200k − 10k − efund 300k = floor at 0."""
    user = _user(savings=D("200000"), efund_target=D("300000"))
    buf = compute_available_buffer(user, total_monthly_emis=D("30000"))
    assert buf == D("0")


def test_buffer_positive_when_savings_exceed_floors():
    user = _user(savings=D("500000"), efund_target=D("100000"), bank="HDFC Bank")
    # 500k − 10k MAB − 100k efund = 390k
    buf = compute_available_buffer(user, total_monthly_emis=D("30000"))
    assert buf == D("390000")


def test_buffer_business_owner_subtracts_dsr():
    """Business owner: 3× monthly EMIs reserve. ₹30k EMIs → 90k reserve."""
    user = _user(savings=D("500000"), efund_target=D("100000"),
                 income_type=IncomeType.BUSINESS_OWNER)
    buf = compute_available_buffer(user, total_monthly_emis=D("30000"))
    # 500k − 10k MAB − 100k efund − 90k DSR = 300k
    assert buf == D("300000")


def test_buffer_no_mab_for_us():
    """US: no MAB. 500k − 100k efund = 400k."""
    user = _user(country=Country.US, savings=D("500000"), efund_target=D("100000"))
    buf = compute_available_buffer(user, total_monthly_emis=D("30000"))
    assert buf == D("400000")
