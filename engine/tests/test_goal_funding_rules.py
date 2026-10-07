"""Roadmap PR F: goals with a funding rule (fixed monthly, % of spare cash,
after debt X clears / debt first) and the trade-off of funding a goal
before high-interest debt."""
from decimal import Decimal as D

from engine.formulas import emi
from engine.goals import GoalState, debt_gate, high_apr_threshold, serial_fill_allocation
from engine.models import Country, IncomeType, Loan, LoanType, TaxRegimeIN, User
from engine.ordering import Strategy
from engine.simulation import goal_tradeoff, simulate_plan


def _goal(**kw) -> GoalState:
    base = dict(id="g", target_month_index=24, required_amount=D("240000"))
    base.update(kw)
    return GoalState(**base)


def _loan(lt, bal, rate, n=36) -> Loan:
    sched = D("0") if lt == LoanType.CREDIT_CARD else emi(D(bal), D(rate), n).quantize(D("0.01"))
    return Loan(lt, "HDFC Bank", D(bal), D(rate), "fixed", n, sched,
                min_payment_override=(D(bal) / 20).quantize(D("1")) if lt == LoanType.CREDIT_CARD else None)


def _user(loans, income="150000") -> User:
    return User(Country.IN, IncomeType.SALARIED, D(income) * 12, D(income), D("40000"), D("0"), "HDFC Bank",
                tax_regime=TaxRegimeIN.NEW, efund_balance=D("0"), efund_target=D("0"), loans=loans,
                investment_options=[])


def test_schedule_is_the_default_and_unchanged():
    g = _goal()
    assert g.funding_rule == "schedule"
    a = serial_fill_allocation([g], D("50000"), 0)
    assert a.contributions[0].amount == D("10000")          # 240000 / 24


def test_fixed_monthly_amount():
    g = _goal(funding_rule="fixed", funding_amount=D("4000"))
    a = serial_fill_allocation([g], D("50000"), 0)
    assert a.contributions[0].amount == D("4000") and a.contributions[0].queued_reason is None
    short = serial_fill_allocation([_goal(funding_rule="fixed", funding_amount=D("4000"))], D("3000"), 0)
    assert short.contributions[0].amount == D("3000") and short.contributions[0].queued_reason == "partial_fill"


def test_share_of_spare_cash():
    g = _goal(funding_rule="surplus_pct", funding_pct=D("0.25"))
    a = serial_fill_allocation([g], D("40000"), 0)
    assert a.contributions[0].amount == D("10000")


def test_after_a_named_loan_clears():
    g = _goal(funding_rule="after_debt", after_loan_index=1)
    waiting = serial_fill_allocation([g], D("50000"), 0, debt_cleared=lambda i: i != 1)
    assert waiting.contributions[0].amount == 0 and waiting.contributions[0].queued_reason == "waiting_on_debt"
    assert not waiting.any_goal_short                       # intentional, like `deferred`
    go = serial_fill_allocation([g], D("50000"), 0, debt_cleared=lambda i: True)
    assert go.contributions[0].amount == D("10000")


def test_debt_gate_names_high_interest_loans_only():
    card = _loan(LoanType.CREDIT_CARD, 100000, "0.36")
    home = _loan(LoanType.HOME, 2000000, "0.085", n=240)
    gate = debt_gate([card, home], Country.IN)
    assert not gate(None) and not gate(0) and not gate(1)
    card.outstanding = D("0")
    gate = debt_gate([card, home], Country.IN)
    assert gate(None) and gate(0) and not gate(1)           # the home loan doesn't block "debt first"
    assert high_apr_threshold(Country.US) == D("0.10")


def test_simulation_starts_a_debt_first_goal_when_the_card_clears():
    card = _loan(LoanType.CREDIT_CARD, 150000, "0.42")
    car = _loan(LoanType.AUTO, 400000, "0.09", n=48)
    u = _user([card, car])
    goals = [_goal(funding_rule="after_debt", target_month_index=36, required_amount=D("300000"))]
    res = simulate_plan(u, Strategy.AVALANCHE, horizon_months=60, marginal_rate=D("0.3"), goals=goals)
    card_clear = next(r.month_index for r in res.months if r.balances_by_loan_index[0] == 0)
    first_goal = next(r.month_index for r in res.months if r.goal_contributions.get("g", 0) > 0)
    assert first_goal == card_clear + 1
    assert all(r.goal_contributions.get("g", 0) == 0 for r in res.months if r.month_index <= card_clear)


def test_tradeoff_prices_funding_a_goal_before_a_card():
    card = _loan(LoanType.CREDIT_CARD, 200000, "0.42")
    u = _user([card], income="70000")
    goals = [_goal(target_month_index=30, required_amount=D("300000"))]
    t = goal_tradeoff(u, goals, "g", strategy=Strategy.AVALANCHE, horizon_months=120, marginal_rate=D("0.3"))
    assert t.has_high_apr_debt
    assert t.extra_interest > D("20000")                    # the card runs longer at 42% + GST
    assert t.debt_free_later_months >= 3 and t.debt_first_reaches_target
    assert t.funded_now_fill_rate >= t.debt_first_fill_rate
    assert goals[0].funding_rule == "schedule"              # the caller's goals are untouched


def test_tradeoff_without_high_interest_debt():
    car = _loan(LoanType.AUTO, 300000, "0.09", n=48)
    u = _user([car])
    t = goal_tradeoff(u, [_goal()], "g", strategy=Strategy.AVALANCHE, horizon_months=120, marginal_rate=D("0.3"))
    assert not t.has_high_apr_debt
    assert t.extra_interest == 0 and t.debt_first_reaches_target
