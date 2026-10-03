"""Before/after repayment regressions from the PR 21 end-to-end audit."""
from copy import deepcopy
from decimal import Decimal as D

from engine.formulas import emi
from engine.models import Country, IncomeType, Loan, LoanType, User, LifecycleEvent, LifecycleEventKind
from engine.restructuring_scan import scan
from engine.simulation import simulate_plan
from engine.loan_check import _inr
from engine.goals import GoalState


def book(score=720, card_balance='80000'):
    return User(
        country=Country.IN, income_type=IncomeType.SALARIED,
        annual_income=D('1800000'), monthly_income=D('150000'),
        fixed_expenses=D('60000'), savings_balance=D('0'),
        primary_bank='HDFC Bank', credit_score=score,
        loans=[
            Loan(LoanType.PERSONAL, 'HDFC Bank', D('500000'), D('.16'), 'fixed', 60, D('12160')),
            Loan(LoanType.CREDIT_CARD, 'HDFC Bank', D(card_balance), D('.42'), 'fixed', 0, D('0')),
        ],
    )


def paths(user, result):
    return {i: [m.balances_by_loan_index[i] for m in result.months] for i in range(len(user.loans))}


def test_expensive_card_clearing_early_does_not_make_costlier_consolidation_a_saving():
    user = book()
    baseline = simulate_plan(user, debt_budget=D('50000'))
    # Both older clients with paths and current clients with full settings
    # must reject the previously advertised Rs 5,675 saving.
    for kwargs in [dict(plan_balances=paths(user, baseline)), dict(plan_options={'debt_budget': D('50000')})]:
        result = scan(user, **kwargs)
        assert not any(o.kind == 'consolidation' for o in result.opportunities)
        held = next(h for h in result.held_back if h.kind == 'consolidation')
        assert held.reason == 'costs_more'
    assert user.loans[1].outstanding == D('80000')


def test_beneficial_consolidation_matches_same_budget_repayment_and_charges_fee_once():
    user = book(750, '100000')
    opts = {'debt_budget': D('50000')}
    old = simulate_plan(user, **opts)
    opportunity = next(o for o in scan(user, plan_options=opts).opportunities if o.kind == 'consolidation')
    assert opportunity.target_rate == D('.1050')  # nominal quote, no amortised fee added to APR
    changed = deepcopy(user)
    changed.loans = [Loan(LoanType.PERSONAL, 'HDFC Bank', D('600000'), opportunity.target_rate,
                          'fixed', 36, emi(D('600000'), opportunity.target_rate, 36))]
    new = simulate_plan(changed, **opts)
    saving = sum((m.interest_paid_month for m in old.months[:12]), D('0')) - sum(
        (m.interest_paid_month for m in new.months[:12]), D('0')) - D('6000')
    assert abs(opportunity.estimated_annual_saving - saving) < D('.01')
    assert opportunity.one_time_cost == D('6000')
    assert opportunity.detail['comparison'] == 'repayment'
    assert _inr(saving) in opportunity.headline
    assert _inr(saving) in opportunity.rationale


def test_refinance_details_and_headline_use_the_same_repayment_comparison():
    user = book(750)
    user.loans = [Loan(LoanType.HOME, 'HDFC Bank', D('4000000'), D('.10'), 'floating', 240, D('38601'))]
    opts = {'debt_budget': D('90000')}
    old = simulate_plan(user, **opts)
    opportunity = next(o for o in scan(user, plan_options=opts).opportunities if o.kind == 'refinance')
    changed = deepcopy(user)
    changed.loans[0].nominal_rate = opportunity.target_rate
    changed.loans[0].scheduled_emi = emi(D('4000000'), opportunity.target_rate, 240)
    new = simulate_plan(changed, **opts)
    expected = old.total_interest_paid - new.total_interest_paid - opportunity.one_time_cost
    assert abs(opportunity.lifetime_net_saving - expected) < D('.01')
    assert _inr(expected) in opportunity.headline and _inr(expected) in opportunity.rationale
    assert '13,43,102' not in opportunity.rationale
    assert abs(D(opportunity.detail['interest_saved_total']) - expected - opportunity.one_time_cost) < D('.01')


def test_closed_unsecured_loans_do_not_count_toward_consolidation():
    user = book(750)
    user.loans[1].outstanding = D('0')
    assert not any(o.kind == 'consolidation' for o in scan(user).opportunities)
    assert not any(h.kind == 'consolidation' for h in scan(user).held_back)


def test_truncated_refinance_does_not_keep_a_static_lifetime_claim():
    user = book(750)
    user.loans = [Loan(LoanType.HOME, 'HDFC Bank', D('4000000'), D('.10'), 'floating', 240, D('38601'))]
    result = scan(user, plan_options={'debt_budget': D('90000'), 'horizon_months': 12})
    opportunity = next(o for o in result.opportunities if o.kind == 'refinance')
    assert opportunity.lifetime_net_saving is None
    assert 'interest_saved_total' not in opportunity.detail
    assert 'over the rest of the loan' not in opportunity.headline
    assert '13,43,102' not in opportunity.rationale


def test_refinance_keeps_future_benchmark_changes_and_does_not_mutate_events():
    user = book(750)
    user.loans = [Loan(LoanType.HOME, 'HDFC Bank', D('4000000'), D('.10'), 'floating', 240, D('38601'))]
    event = LifecycleEvent(LifecycleEventKind.FLOATING_RATE_RESET, 3, loan_index=0, new_rate=D('.12'))
    opts = {'debt_budget': D('90000'), 'lifecycle_events': [event]}
    opportunity = next(o for o in scan(user, plan_options=opts).opportunities if o.kind == 'refinance')
    changed = deepcopy(user)
    changed.loans[0].nominal_rate = opportunity.target_rate
    changed.loans[0].scheduled_emi = emi(D('4000000'), opportunity.target_rate, 240)
    new_opts = deepcopy(opts)
    new_opts['lifecycle_events'][0].new_rate += opportunity.target_rate - D('.10')
    old = simulate_plan(user, **deepcopy(opts))
    new = simulate_plan(changed, **new_opts)
    assert abs(opportunity.lifetime_net_saving - old.total_interest_paid + new.total_interest_paid + opportunity.one_time_cost) < D('.01')
    assert event.new_rate == D('.12')


def test_comparison_preserves_goals_emergency_fund_events_and_original_state():
    user = book(750, '100000')
    user.efund_target = D('100000')
    goal = GoalState(id='g', target_month_index=12, required_amount=D('60000'))
    event = LifecycleEvent(LifecycleEventKind.SALARY_RESET, 3, new_monthly_take_home=D('160000'))
    opts = {'debt_budget': D('50000'), 'ef_top_up_rate': D('.3'), 'goals': [goal], 'lifecycle_events': [event]}
    before = deepcopy((user, opts))
    opportunity = next(o for o in scan(user, plan_options=opts).opportunities if o.kind == 'consolidation')
    changed = deepcopy(user)
    changed.loans = [Loan(LoanType.PERSONAL, 'HDFC Bank', D('600000'), opportunity.target_rate,
                          'fixed', 36, emi(D('600000'), opportunity.target_rate, 36))]
    old = simulate_plan(user, **deepcopy(opts))
    new = simulate_plan(changed, **deepcopy(opts))
    expected = sum((m.interest_paid_month for m in old.months[:12]), D('0')) - sum(
        (m.interest_paid_month for m in new.months[:12]), D('0')) - opportunity.one_time_cost
    assert abs(opportunity.estimated_annual_saving - expected) < D('.01')
    assert (user, opts) == before


def test_foreign_refinance_money_is_converted_once():
    user = book(750)
    user.country = Country.US
    user.monthly_income = D('10000')
    user.fixed_expenses = D('2000')
    user.fx_to_user_currency = {'INR': D('.0125')}
    user.loans = [Loan(LoanType.HOME, 'HDFC Bank', D('4000000'), D('.10'), 'floating', 240,
                       D('38601'), currency='INR')]
    opts = {'debt_budget': D('1200')}
    old = simulate_plan(user, **opts)
    opportunity = next(o for o in scan(user, plan_options=opts).opportunities if o.kind == 'refinance')
    changed = deepcopy(user)
    changed.loans[0].nominal_rate = opportunity.target_rate
    changed.loans[0].scheduled_emi = emi(D('4000000'), opportunity.target_rate, 240)
    new = simulate_plan(changed, **opts)
    assert opportunity.one_time_cost == D('500')
    expected = old.total_interest_paid - new.total_interest_paid - D('500')
    assert abs(opportunity.lifetime_net_saving - expected) < D('.01')
    assert _inr(expected / D('.0125')) in opportunity.rationale


def test_known_closing_penalties_are_included_in_consolidation_costs():
    user = book(750, '100000')
    user.loans[0].prepayment_penalty_pct = D('.02')
    opts = {'debt_budget': D('50000')}
    result = scan(user, plan_options=opts)
    opportunity = next(o for o in result.opportunities if o.kind == 'consolidation')
    assert opportunity.one_time_cost == D('16000')  # 6k processing + 10k early repayment
    assert opportunity.detail['closing_fee'] == '10000.00'
    old = simulate_plan(user, **opts)
    changed = deepcopy(user)
    changed.loans = [Loan(LoanType.PERSONAL, 'HDFC Bank', D('600000'), opportunity.target_rate,
                          'fixed', 36, emi(D('600000'), opportunity.target_rate, 36))]
    new = simulate_plan(changed, **opts)
    expected = sum((m.interest_paid_month for m in old.months[:12]), D('0')) - sum(
        (m.interest_paid_month for m in new.months[:12]), D('0')) - D('16000')
    assert abs(opportunity.estimated_annual_saving - expected) < D('.01')
