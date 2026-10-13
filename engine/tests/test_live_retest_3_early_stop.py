"""Live re-test 3 NEW-19: `stop_owed_multiple` ends a runaway plan early
without changing any month it keeps (differential-safe), and is off by
default. With it on, a plan that clears is identical to a full run."""
from __future__ import annotations

from decimal import Decimal

from hypothesis import given, settings
from hypothesis import strategies as st

from engine.simulation import baseline_minimums_only, simulate_plan
from engine.tests.strategies import examples, users
from engine.ordering import Strategy

D = Decimal
STOP = D("200")


def _row(r):
    return (r.month_index, r.balance_in_user_currency, r.gap_debt, r.interest_paid_month,
            r.total_payment_nominal, dict(r.balances_by_loan_index), dict(r.payments_by_loan_index))


def _same_prefix(full, stopped):
    assert len(stopped.months) <= len(full.months)
    for a, b in zip(full.months, stopped.months):
        assert _row(a) == _row(b)
    if full.debt_free_month is not None:
        assert stopped.debt_free_month == full.debt_free_month
        assert stopped.total_interest_paid == full.total_interest_paid
        assert len(stopped.months) == len(full.months)
    else:
        assert stopped.debt_free_month is None
    if len(stopped.months) < len(full.months):
        # Only a run past STOP x month 1's debt is cut short.
        first = full.months[0].balance_in_user_currency + full.months[0].gap_debt
        last = stopped.months[-1]
        assert last.balance_in_user_currency + last.gap_debt > STOP * max(first, D("1"))


@settings(max_examples=examples(120), deadline=None)
@given(u=users(allow_extras=True), s=st.sampled_from([Strategy.AVALANCHE, Strategy.SNOWBALL]))
def test_early_stop_keeps_every_month_it_returns(u, s):
    full = simulate_plan(u, strategy=s, horizon_months=600)
    stopped = simulate_plan(u, strategy=s, horizon_months=600, stop_owed_multiple=STOP)
    _same_prefix(full, stopped)
    _same_prefix(baseline_minimums_only(u, horizon_months=600),
                 baseline_minimums_only(u, horizon_months=600, stop_owed_multiple=STOP))
