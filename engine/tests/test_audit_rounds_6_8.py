from decimal import Decimal as D
import pytest
from engine.models import Country, IncomeType, LifecycleEvent, LifecycleEventKind, Loan, LoanType, TaxRegimeIN, User
from engine.simulation import simulate_plan, baseline_minimums_only, estimated_take_home
from engine.ordering import Strategy


def user(loans):
    return User(Country.IN, IncomeType.SALARIED, D('600000'), D('50000'), D('30000'), D('100000'), 'HDFC Bank',
                tax_regime=TaxRegimeIN.NEW, loans=loans)


def loan(balance='500000', payment='6350', **kwargs):
    return Loan(LoanType.HOME, 'Future Bank', D(balance), D('.09'), 'fixed', 120, D(payment), **kwargs)


@pytest.mark.parametrize('strategy', list(Strategy))
@pytest.mark.parametrize('existing', [False, True])
def test_planned_property_arrives_after_debt_free_gap_with_stable_indices(strategy, existing):
    original = [loan('1000','1000')] if existing else []
    u = user(original)
    draft = loan()
    event = LifecycleEvent(LifecycleEventKind.PROPERTY_BUY, 4, loan_draft=draft)
    result = simulate_plan(u, strategy, horizon_months=120, lifecycle_events=[event])
    idx = len(original)
    assert len(result.months) >= 4
    assert result.months[2].balances_by_loan_index[idx] == 0
    assert result.months[3].balances_by_loan_index[idx] > 0
    assert result.months[3].payments_by_loan_index[idx] > 0
    assert result.debt_free_month is not None and result.debt_free_month > 4
    assert draft.outstanding == D('500000')
    assert u.loans == original
    base = baseline_minimums_only(u, horizon_months=120, lifecycle_events=[event])
    assert base.total_interest_paid > result.total_interest_paid


def test_future_arrival_beyond_horizon_is_not_reported_as_debt_free():
    event = LifecycleEvent(LifecycleEventKind.PROPERTY_BUY, 20, loan_draft=loan())
    result = simulate_plan(user([]), horizon_months=12, lifecycle_events=[event])
    assert result.debt_free_month is None
    assert len(result.months) == 12


def test_future_loan_lock_in_starts_on_arrival_not_simulation_start():
    draft = loan(prepay_lock_in_months=3)
    event = LifecycleEvent(LifecycleEventKind.PROPERTY_BUY, 5, loan_draft=draft)
    result = simulate_plan(user([]), horizon_months=12, lifecycle_events=[event])
    for row in result.months[4:7]:
        assert row.payments_by_loan_index[0] == D('6350')
    assert result.months[7].payments_by_loan_index[0] > D('6350')


def test_multiple_future_loans_reserve_positions_in_input_order():
    events = [LifecycleEvent(LifecycleEventKind.PROPERTY_BUY, 6, loan_draft=loan('100000')), LifecycleEvent(LifecycleEventKind.PROPERTY_BUY, 2, loan_draft=loan('200000'))]
    result = simulate_plan(user([]), horizon_months=12, lifecycle_events=events)
    assert result.months[1].balances_by_loan_index[0] == 0
    assert result.months[1].balances_by_loan_index[1] > 0
    assert result.months[5].balances_by_loan_index[0] > 0


def test_gross_salary_estimate_and_explicit_take_home_are_consistent():
    u = user([loan('1000000')])
    assert estimated_take_home(u, D('1200000')) == D('100000')
    gross = LifecycleEvent(LifecycleEventKind.SALARY_RESET, 1, new_annual_gross=D('1200000'))
    net = LifecycleEvent(LifecycleEventKind.SALARY_RESET, 1, new_monthly_take_home=D('100000'))
    a = simulate_plan(u, horizon_months=120, lifecycle_events=[gross])
    b = simulate_plan(u, horizon_months=120, lifecycle_events=[net])
    assert a.total_interest_paid == b.total_interest_paid
    assert a.debt_free_month == b.debt_free_month
