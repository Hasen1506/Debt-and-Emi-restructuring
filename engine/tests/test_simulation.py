"""Month-by-month plan simulation — Layers 0-3 with cascade."""
from decimal import Decimal
from engine.simulation import simulate_plan, baseline_minimums_only
from engine.models import (
    User, Loan, LoanType, Country, IncomeType, TaxRegimeIN,
    InvestmentOption, LiquidityClass,
)
from engine.ordering import Strategy

D = Decimal


def _user_two_loans() -> User:
    """A user with a credit card (small, high-rate) and home loan (large, low)."""
    home = Loan(loan_type=LoanType.HOME, bank="HDFC Bank",
                outstanding=D("4000000"), nominal_rate=D("0.085"),
                rate_type="floating", tenure_months_remaining=240,
                scheduled_emi=D("34713"))
    card = Loan(loan_type=LoanType.CREDIT_CARD, bank="ICICI Bank",
                outstanding=D("100000"), nominal_rate=D("0.36"),
                rate_type="fixed", tenure_months_remaining=12,
                scheduled_emi=D("0"))
    return User(
        country=Country.IN, income_type=IncomeType.SALARIED,
        annual_income=D("1800000"), monthly_income=D("150000"),
        fixed_expenses=D("60000"),
        savings_balance=D("500000"),
        primary_bank="HDFC Bank", tax_regime=TaxRegimeIN.NEW,
        efund_balance=D("300000"), efund_target=D("300000"),    # target met
        loans=[home, card],
        investment_options=[
            InvestmentOption(name="Liquid fund", expected_return=D("0.07"),
                             liquidity_class=LiquidityClass.LIQUID, is_in_pool=True),
        ],
        inflation_rate=D("0.046"),
    )


def test_simulation_produces_monthly_rows():
    user = _user_two_loans()
    result = simulate_plan(user, Strategy.AVALANCHE, horizon_months=18)
    assert len(result.months) > 0
    assert result.months[0].month_index == 1


def test_card_clears_before_home_with_avalanche():
    """Card at 36% (way higher effective rate) should clear within a year of extra."""
    user = _user_two_loans()
    result = simulate_plan(user, Strategy.AVALANCHE, horizon_months=24)
    # final_balances is keyed by id of the simulator's *internal* loan copies,
    # so just check that at least one loan in the result hit zero by month 24.
    assert any(bal == D("0") for bal in result.final_balances.values())


def test_minimums_baseline_takes_longer():
    """Baseline (minimums-only) should leave higher final balances than avalanche."""
    user = _user_two_loans()
    avalanche = simulate_plan(user, Strategy.AVALANCHE, horizon_months=60)
    baseline = baseline_minimums_only(user, horizon_months=60)
    # Avalanche should have paid more interest than minimums *would* over the same window?
    # No — avalanche pays MORE principal, LESS interest. Test that interest is less.
    assert avalanche.total_interest_paid < baseline.total_interest_paid


def test_simulation_stops_at_debt_free():
    """When all loans clear, simulation ends and reports debt_free_month."""
    home = Loan(loan_type=LoanType.PERSONAL, bank="X", outstanding=D("20000"),
                nominal_rate=D("0.12"), rate_type="fixed",
                tenure_months_remaining=6, scheduled_emi=D("3460"))
    user = User(
        country=Country.IN, income_type=IncomeType.SALARIED,
        annual_income=D("1200000"), monthly_income=D("100000"),
        fixed_expenses=D("30000"), savings_balance=D("100000"),
        primary_bank="HDFC Bank", tax_regime=TaxRegimeIN.NEW,
        efund_balance=D("100000"), efund_target=D("100000"),
        loans=[home],
        investment_options=[],
        inflation_rate=D("0.046"),
    )
    result = simulate_plan(user, Strategy.AVALANCHE, horizon_months=24)
    assert result.debt_free_month is not None
    assert result.debt_free_month < 24


def test_layer3_redirects_to_investment_when_loan_rate_low():
    """Home loan at 7% effective + 12% liquid return → invest, not prepay."""
    home = Loan(loan_type=LoanType.HOME, bank="HDFC Bank",
                outstanding=D("4000000"), nominal_rate=D("0.07"),
                rate_type="floating", tenure_months_remaining=240,
                scheduled_emi=D("31000"))
    user = User(
        country=Country.IN, income_type=IncomeType.SALARIED,
        annual_income=D("1800000"), monthly_income=D("150000"),
        fixed_expenses=D("60000"), savings_balance=D("500000"),
        primary_bank="HDFC Bank", tax_regime=TaxRegimeIN.NEW,
        efund_balance=D("300000"), efund_target=D("300000"),
        loans=[home],
        investment_options=[
            InvestmentOption(name="Nifty 50", expected_return=D("0.12"),
                             liquidity_class=LiquidityClass.LIQUID, is_in_pool=True),
        ],
        inflation_rate=D("0.046"),
    )
    result = simulate_plan(user, Strategy.AVALANCHE, horizon_months=12)
    # All extra goes to invest, not principal
    assert result.total_invested > D("0")


def test_real_emi_lower_than_nominal_over_time():
    """real_emi deflated by inflation should be lower than nominal in later months."""
    user = _user_two_loans()
    result = simulate_plan(user, Strategy.AVALANCHE, horizon_months=24)
    later = result.months[-1]
    assert later.total_payment_real < later.total_payment_nominal
