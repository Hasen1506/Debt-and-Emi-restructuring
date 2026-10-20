"""The plan chart starts at what's owed today (20 Oct 2026 screenshot).

One card, statement ₹2,00,000 at 36%, minimum ₹10,000. ₹1,01,519 has
already gone out this month, so ₹98,481 is owed now. The plan puts
₹98,646 a month toward it.

Leaving the payment only on the owed-today figure made the chart start
at ₹98,481 and the first projected month start again from the statement:
minimums landed on exactly ₹1,96,962 (double), and the plan rose to
about ₹1,07,270 before falling through November to zero in December.
"""
from decimal import Decimal

from engine.models import Country, IncomeType, Loan, LoanType, TaxRegimeIN, User
from engine.ordering import Strategy
from engine.simulation import baseline_minimums_only, simulate_plan

D = Decimal
PAISA = D("0.01")
OWED_NOW = D("98481")
PAID = D("101519")  # 2,00,000 − 98,481
BUDGET = D("98646")


def _card(**overrides) -> User:
    loan = dict(
        loan_type=LoanType.CREDIT_CARD, bank="HDFC Bank", outstanding=D("200000"),
        nominal_rate=D("0.36"), rate_type="fixed", tenure_months_remaining=0,
        scheduled_emi=D("10000"), min_payment_override=D("10000"),
    )
    loan.update(overrides)
    return User(
        country=Country.IN, income_type=IncomeType.SALARIED,
        annual_income=D("1800000"), monthly_income=D("150000"),
        fixed_expenses=D("0"), variable_expenses=D("0"),
        savings_balance=D("0"), primary_bank="HDFC Bank", tax_regime=TaxRegimeIN.NEW,
        efund_balance=D("0"), efund_target=D("0"),
        loans=[Loan(**loan)],
    )


def _paisa(x: Decimal) -> Decimal:
    return x.quantize(PAISA)


def test_statement_minimums_are_the_doubled_tick_the_chart_showed():
    """Without the payment, month 1 of minimums is the screenshot's top tick."""
    user = _card()
    mins = baseline_minimums_only(user, horizon_months=4)
    assert _paisa(mins.months[0].balance_in_user_currency) == D("196962.00")
    plan = simulate_plan(user, Strategy.SNOWBALL, horizon_months=6, debt_budget=BUDGET)
    # Paying ₹98,646 against the ₹2,00,000 statement leaves more than
    # today's ₹98,481, then a small balance, then zero in month 3.
    assert _paisa(plan.months[0].balance_in_user_currency) == D("107269.98")
    assert plan.months[0].balance_in_user_currency > OWED_NOW
    assert _paisa(plan.months[1].balance_in_user_currency) == D("11257.31")
    assert plan.months[2].balance_in_user_currency == 0
    assert plan.debt_free_month == 3


def test_logged_payment_starts_both_lines_at_todays_balance():
    user = _card()
    off = {0: PAID}
    plan = simulate_plan(user, Strategy.SNOWBALL, horizon_months=6, debt_budget=BUDGET, paid_off_this_month=off)
    mins = baseline_minimums_only(user, horizon_months=6, paid_off_this_month=off)
    # The stored statement is unchanged; only the run's opening moves.
    assert user.loans[0].outstanding == D("200000")

    # One month of card interest (average daily balance, GST included) on
    # ₹98,481 is ₹2,324.15. ₹98,646 covers the balance and leaves ₹2,159.15,
    # which the next month clears. That is about one month from 20 Oct,
    # not December.
    assert _paisa(plan.months[0].total_payment_nominal) == BUDGET
    assert _paisa(plan.months[0].balance_in_user_currency) == D("2159.15")
    assert plan.months[1].balance_in_user_currency == 0
    assert plan.debt_free_month == 2
    assert _paisa(mins.months[0].balance_in_user_currency) == D("91849.23")
    assert mins.months[0].balance_in_user_currency != D("196962")

    for row in plan.months:
        assert row.balance_in_user_currency <= OWED_NOW
    for row in mins.months:
        assert row.balance_in_user_currency <= OWED_NOW
        if row.month_index > 1:
            assert row.balance_in_user_currency < mins.months[row.month_index - 2].balance_in_user_currency

    # One debt: the order doesn't change the date.
    for strategy in (Strategy.AVALANCHE, Strategy.RULES, Strategy.SNOWBALL):
        other = simulate_plan(user, strategy, horizon_months=6, debt_budget=BUDGET, paid_off_this_month=off)
        assert other.debt_free_month == 2


def test_new_card_spend_may_raise_the_balance():
    """New borrowing is the one reason a later month sits above today."""
    user = _card(expected_monthly_spend=D("50000"))
    mins = baseline_minimums_only(user, horizon_months=2, paid_off_this_month={0: PAID})
    assert mins.months[0].balance_in_user_currency > OWED_NOW
