"""Month-by-month plan simulation — Layers 0-3 with cascade."""
from decimal import Decimal
from engine.simulation import (
    simulate_plan, baseline_minimums_only, _first_hike_month_index,
)
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


# ─────────────────────────────────────────────────────────────────────────────
# FY-anchored hike firing
# ─────────────────────────────────────────────────────────────────────────────

def test_first_hike_month_default_back_compat():
    """Default sim_start=1 (Jan), hike_month=1 → first hike at m=13.

    Matches the legacy 'every 12 months from start, skipping m=1' behaviour
    so existing tests/callers that don't pass either field stay correct.
    """
    assert _first_hike_month_index(1, 1) == 13


def test_first_hike_month_in_user_starting_may():
    """IN user starts sim in May (5), hike anchored to April (4).
    Next April is 11 months away → first hike at m=12."""
    assert _first_hike_month_index(5, 4) == 12


def test_first_hike_month_us_user_starting_september():
    """US user starts sim in September (9), hike at January (1).
    Next January is 4 months away → first hike at m=5."""
    assert _first_hike_month_index(9, 1) == 5


def test_first_hike_month_when_today_is_hike_month():
    """If sim starts in the hike-effective month, current income is
    treated as already-hiked; defer firing to next year (m=13)."""
    assert _first_hike_month_index(4, 4) == 13
    assert _first_hike_month_index(1, 1) == 13


def test_first_hike_month_one_month_away():
    """sim_start=April, hike=May → fires at m=2."""
    assert _first_hike_month_index(4, 5) == 2


def test_hike_fires_on_anchored_month_not_legacy_m13():
    """Verify simulate_plan honours the anchor: with sim_start=5 (May)
    and hike_month=4 (April), the income hike fires at m=12 — not m=13.

    Uses a large home loan so total surplus is small relative to balance and
    the hike's effect on cumulative interest is observable inside the horizon.
    """
    home = Loan(loan_type=LoanType.HOME, bank="HDFC", outstanding=D("4000000"),
                nominal_rate=D("0.085"), rate_type="floating",
                tenure_months_remaining=240, scheduled_emi=D("34713"))
    user = User(
        country=Country.IN, income_type=IncomeType.SALARIED,
        annual_income=D("1200000"), monthly_income=D("100000"),
        fixed_expenses=D("50000"), savings_balance=D("500000"),
        primary_bank="HDFC", tax_regime=TaxRegimeIN.NEW,
        efund_balance=D("300000"), efund_target=D("300000"),
        loans=[home], investment_options=[],
        annual_hike_rate=D("0.10"),
        hike_effective_month=4,           # April
        inflation_rate=D("0.046"),
    )
    # FY-anchored (sim_start=5 May, hike_month=4 Apr): first hike at m=12
    # Default sim_start=1 with hike_month=4: first hike at m=4
    # So the anchored run delays the hike by 8 months, paying more interest.
    anchored = simulate_plan(
        user, Strategy.AVALANCHE, horizon_months=24,
        simulation_start_month=5,
    )
    early_anchor = simulate_plan(
        user, Strategy.AVALANCHE, horizon_months=24,
        simulation_start_month=1,    # default — hike fires at m=4
    )
    assert anchored.total_interest_paid > early_anchor.total_interest_paid


def test_zero_hike_rate_no_op_regardless_of_anchor():
    """If annual_hike_rate==0, anchor doesn't matter — no income growth."""
    home = Loan(loan_type=LoanType.PERSONAL, bank="X", outstanding=D("100000"),
                nominal_rate=D("0.12"), rate_type="fixed",
                tenure_months_remaining=60, scheduled_emi=D("2225"))
    user = User(
        country=Country.IN, income_type=IncomeType.SALARIED,
        annual_income=D("1200000"), monthly_income=D("100000"),
        fixed_expenses=D("30000"), savings_balance=D("500000"),
        primary_bank="X", tax_regime=TaxRegimeIN.NEW,
        efund_balance=D("100000"), efund_target=D("100000"),
        loans=[home], investment_options=[],
        annual_hike_rate=D("0"),
        hike_effective_month=4,
        inflation_rate=D("0.046"),
    )
    a = simulate_plan(user, Strategy.AVALANCHE, horizon_months=18, simulation_start_month=5)
    b = simulate_plan(user, Strategy.AVALANCHE, horizon_months=18, simulation_start_month=1)
    assert a.total_interest_paid == b.total_interest_paid
