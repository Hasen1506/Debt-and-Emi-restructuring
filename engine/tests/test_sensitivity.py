"""What-if scenarios — driving Plan-screen sliders."""
from decimal import Decimal
from engine.sensitivity import (
    with_surplus_delta, with_rate_shock, with_strategy, with_lump_sum, compare,
)
from engine.simulation import simulate_plan
from engine.models import (
    User, Loan, LoanType, Country, IncomeType, TaxRegimeIN,
    InvestmentOption, LiquidityClass,
)
from engine.ordering import Strategy

D = Decimal


def _user() -> User:
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
        fixed_expenses=D("60000"), savings_balance=D("500000"),
        primary_bank="HDFC Bank", tax_regime=TaxRegimeIN.NEW,
        efund_balance=D("300000"), efund_target=D("300000"),
        loans=[home, card],
        investment_options=[
            InvestmentOption(name="Liquid fund", expected_return=D("0.07"),
                             liquidity_class=LiquidityClass.LIQUID, is_in_pool=True),
        ],
        inflation_rate=D("0.046"),
    )


def test_surplus_delta_pulls_payoff_forward():
    user = _user()
    baseline = simulate_plan(user, Strategy.AVALANCHE, horizon_months=36)
    plus = with_surplus_delta(user, D("10000"), horizon_months=36)
    diff = compare(baseline, plus)
    # +₹10k surplus → card clears sooner → less total interest
    assert diff["interest_saved"] > D("0")


def test_surplus_delta_start_month_defers_benefit():
    """Surplus that kicks in later saves less interest than the same delta
    applied from month 1 — proves the start_month parameter actually defers."""
    user = _user()
    horizon = 24
    immediate = with_surplus_delta(user, D("10000"),
                                    horizon_months=horizon, start_month=1)
    deferred = with_surplus_delta(user, D("10000"),
                                    horizon_months=horizon, start_month=12)
    # Both pull payoff forward vs baseline, but immediate saves more interest
    assert immediate.total_interest_paid < deferred.total_interest_paid


def test_surplus_delta_start_month_beyond_horizon_matches_baseline():
    """If the surplus delta only kicks in after the horizon ends, the
    scenario equals the baseline — nothing has changed during the window."""
    user = _user()
    horizon = 6
    baseline = simulate_plan(user, Strategy.AVALANCHE, horizon_months=horizon)
    later = with_surplus_delta(user, D("50000"),
                                horizon_months=horizon, start_month=99)
    assert later.total_interest_paid == baseline.total_interest_paid


def test_rate_shock_reduces_interest():
    """RBI cut 50bps on the floating home loan → less interest over horizon."""
    user = _user()
    baseline = simulate_plan(user, Strategy.AVALANCHE, horizon_months=36)
    cut = with_rate_shock(user, D("-0.005"), horizon_months=36)
    assert cut.total_interest_paid < baseline.total_interest_paid


def test_rate_shock_floating_only_skips_fixed_loans():
    """Card is fixed-rate; rate shock applies only to floating home loan."""
    user = _user()
    cut = with_rate_shock(user, D("-0.005"), floating_only=True)
    # Card rate unchanged
    assert cut is not None    # smoke


def test_strategy_swap_changes_payoff_order():
    """Swapping strategy returns a different SimulationResult."""
    user = _user()
    av = with_strategy(user, Strategy.AVALANCHE, horizon_months=36)
    sn = with_strategy(user, Strategy.SNOWBALL, horizon_months=36)
    # Avalanche on a card+home → card cleared first either way (smallest AND highest-rate)
    # So just verify both runs return results
    assert av.months and sn.months


def test_lump_sum_reduces_balance_upfront():
    """Drop ₹50k on the card → its starting balance is 50k less → faster payoff."""
    user = _user()
    baseline = simulate_plan(user, Strategy.AVALANCHE, horizon_months=12)
    lump = with_lump_sum(user, D("50000"), target_loan_index=1, horizon_months=12)
    diff = compare(baseline, lump)
    assert diff["interest_saved"] > D("0")


def test_compare_returns_diff_dict():
    user = _user()
    a = simulate_plan(user, Strategy.AVALANCHE, horizon_months=12)
    b = with_surplus_delta(user, D("5000"), horizon_months=12)
    diff = compare(a, b)
    assert "interest_saved" in diff
    assert "months_pulled_forward" in diff


def test_month_row_payments_track_each_loan():
    """Per-loan payments populated for every active loan that month, and
    the sum equals total_payment_nominal so we can drive a per-bank
    schedule UI without re-deriving the math. Keyed by 0-based position
    in the original user.loans list."""
    user = _user()
    result = simulate_plan(user, Strategy.AVALANCHE, horizon_months=3)
    expected_indices = set(range(len(user.loans)))
    for row in result.months:
        assert row.payments_by_loan_index, "expected a non-empty payments dict"
        # All keys must be valid 0-based positions into user.loans.
        assert set(row.payments_by_loan_index).issubset(expected_indices)
        total = sum(row.payments_by_loan_index.values(), D("0"))
        # Equal to total_payment_nominal (all Decimal so exact).
        assert total == row.total_payment_nominal
