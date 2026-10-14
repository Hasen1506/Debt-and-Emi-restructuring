"""Audit 80 E17 (W9): month-by-month laws of the plan, for every generated user.

test_property_invariants.py checks the plan's totals (principal adds up over
the whole plan, balances never negative). These check every single month, so
two wrong months can no longer cancel out, and they check the joins that the
screens read (Setup, Home, Plan and Activity all show the same month's total,
so the per-loan payments must add up to it):

1. Money is conserved each month: what was owed at the start of the month,
   less the principal paid, is what is owed at the end.
2. Each month's payment is its interest plus its principal, and the per-loan
   payments add up to the month's total (the cross-surface join).
3. Months are consecutive (1, 2, 3, ...) and the debt-free month is the first
   month nothing is owed, never earlier, never later. "Owed" includes gap
   debt (the card borrowing that covers a short month, grill #38): a plan
   whose loans are cleared but still carries gap debt is not debt-free yet.
4. No figure is NaN, infinite or negative.

Run in CI by the Hypothesis job (derandomized "ci" profile).
"""
from __future__ import annotations

from decimal import Decimal

import pytest
from hypothesis import given, settings
from hypothesis import strategies as st

from engine.ordering import Strategy
from engine.simulation import baseline_minimums_only, simulate_plan
from engine.tests.strategies import examples, users

D = Decimal
CENT = D("0.01")
# A month's figures are rounded per loan; allow a cent per loan per month.
STRATEGIES = st.sampled_from(list(Strategy))


def _plans(u, s):
    return (("plan", simulate_plan(u, strategy=s)), ("minimums", baseline_minimums_only(u)))


def _owes(row) -> bool:
    """Anything still owed at the end of this month: a loan or gap debt.
    Exact (> 0), the same test the engine uses to stop, so this guard checks
    that the reported month agrees with the schedule, to the last digit."""
    loans = any(b > 0 for b in row.balances_by_loan_index.values())
    return loans or (row.gap_debt or D("0")) > 0


def _finite_non_negative(x: Decimal) -> bool:
    return x.is_finite() and x >= 0


@settings(max_examples=examples(60))
@given(u=users(), s=STRATEGIES)
def test_money_is_conserved_every_month(u, s):
    tol = CENT * max(1, len(u.loans))
    for name, result in _plans(u, s):
        owed = sum((l.outstanding for l in u.loans), D("0"))
        for row in result.months:
            end = sum(row.balances_by_loan_index.values(), D("0")) if row.balances_by_loan_index else row.balance_in_user_currency
            assert abs(owed - row.principal_paid_month - end) <= tol, (
                f"{name} month {row.month_index}: owed {owed} - principal {row.principal_paid_month} != {end}"
            )
            owed = end


@settings(max_examples=examples(60))
@given(u=users(), s=STRATEGIES)
def test_payment_is_interest_plus_principal_and_loans_add_up(u, s):
    tol = CENT * max(1, len(u.loans))
    for name, result in _plans(u, s):
        for row in result.months:
            assert abs(row.total_payment_nominal - row.interest_paid_month - row.principal_paid_month) <= tol, (
                f"{name} month {row.month_index}: paid {row.total_payment_nominal} != "
                f"interest {row.interest_paid_month} + principal {row.principal_paid_month}"
            )
            if row.payments_by_loan_index:
                by_loan = sum(row.payments_by_loan_index.values(), D("0"))
                assert abs(by_loan - row.total_payment_nominal) <= tol, (
                    f"{name} month {row.month_index}: loans add to {by_loan}, month total {row.total_payment_nominal}"
                )


@settings(max_examples=examples(60))
@given(u=users(allow_extras=True), s=STRATEGIES)
def test_months_are_consecutive_and_debt_free_month_is_exact(u, s):
    for name, result in _plans(u, s):
        idx = [row.month_index for row in result.months]
        assert idx == list(range(1, len(idx) + 1)), f"{name}: months {idx[:5]}... not consecutive from 1"
        if result.debt_free_month is not None:
            dfm = result.debt_free_month
            assert 1 <= dfm <= len(result.months)
            row = result.months[dfm - 1]
            assert not _owes(row), f"{name}: debt-free month {dfm} still owes"
            if dfm > 1:
                assert _owes(result.months[dfm - 2]), f"{name}: already clear before the debt-free month {dfm}"
        else:
            assert not result.months or _owes(result.months[-1]), f"{name}: nothing owed at the end but no debt-free month"


@settings(max_examples=examples(60))
@given(u=users(allow_extras=True), s=STRATEGIES)
def test_no_figure_is_nan_infinite_or_negative(u, s):
    for name, result in _plans(u, s):
        assert _finite_non_negative(result.total_interest_paid)
        for row in result.months:
            for field in ("total_payment_nominal", "interest_paid_month", "principal_paid_month", "invested_this_month",
                          "balance_in_user_currency", "extra_paid", "shortfall"):
                v = getattr(row, field)
                assert _finite_non_negative(v), f"{name} month {row.month_index}: {field} = {v}"


@pytest.mark.xfail(strict=True, reason=(
    "W9 finding for W1 (engine/simulation.py): a sub-paisa residue left by a "
    "rounded EMI keeps the loan 'outstanding' one more month, so the debt-free "
    "month is reported a month late and the last month pays ~Rs 0.001. Remove "
    "this marker when the engine clears balances under half a paisa."))
def test_debt_free_month_is_not_late_by_sub_paisa_dust():
    """Hand check: Rs 5,760 at 0.15% p.a. over 12 months. Exact annuity EMI is
    5760*r/(1-(1+r)^-12) with r=0.0015/12 = Rs 480.3901..., the bank rounds to
    Rs 480.39, so after 12 EMIs about Rs 0.001 is left. Nobody owes a bank a
    tenth of a paisa: the loan is closed in month 12, not month 13."""
    from engine.models import Country, IncomeType, Loan, LoanType, User
    u = User(country=Country.IN, income_type=IncomeType.SALARIED, annual_income=D("5772"),
             monthly_income=D("481"), fixed_expenses=D("0"), savings_balance=D("0"), primary_bank="HDFC Bank",
             loans=[Loan(loan_type=LoanType.HOME, bank="HDFC Bank", outstanding=D("5760"), nominal_rate=D("0.0015"),
                         rate_type="fixed", tenure_months_remaining=12, scheduled_emi=D("480.39"))])
    r = simulate_plan(u, strategy=Strategy.AVALANCHE)
    assert r.debt_free_month == 12, f"debt-free month {r.debt_free_month}, last payment {r.months[-1].total_payment_nominal}"
