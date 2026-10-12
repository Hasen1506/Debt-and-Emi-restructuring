"""Grill #38 and live tests #15/#16/#26: what a short month really costs.

A month whose income can't cover costs plus every minimum used to be
"found somewhere" for free. Now (engine/gap_debt.py) it comes out of the
emergency fund, then goes on a card at card rates, and is repaid first.
"""
from decimal import Decimal

import pytest
from hypothesis import given, settings
from hypothesis import strategies as st

from engine.formulas import emi
from engine.gap_debt import GAP_CARD_APR_IN, GAP_CARD_APR_US, gap_interest, gap_rate_for
from engine.models import Country, IncomeType, Loan, LoanType, TaxRegimeIN, User
from engine.ordering import Strategy
from engine.simulation import baseline_minimums_only, simulate_plan
from engine.tenure_whatif import stretch_tenure
from engine.tests.strategies import examples, users

D = Decimal


def _home(outstanding="2500000", rate="0.086", tenure=240, emi_amt=None):
    e = D(emi_amt) if emi_amt else emi(D(outstanding), D(rate), tenure).quantize(D("1"))
    return Loan(LoanType.HOME, "SBI", D(outstanding), D(rate), "floating", tenure, e)


def _personal(outstanding="400000", rate="0.14", tenure=8):
    return Loan(LoanType.PERSONAL, "HDFC Bank", D(outstanding), D(rate), "fixed", tenure,
                emi(D(outstanding), D(rate), tenure).quantize(D("1")))


def _user(loans, income="120000", expenses="55000", country=Country.IN, efund="0", **kw):
    return User(
        country=country, income_type=IncomeType.SALARIED,
        annual_income=D(income) * 12, monthly_income=D(income),
        fixed_expenses=D(expenses), savings_balance=D("0"), primary_bank="SBI",
        tax_regime=TaxRegimeIN.NEW if country == Country.IN else None,
        loans=loans, efund_balance=D(efund), **kw,
    )


def _persona():
    """The live-test stress case in rupees: a personal loan whose EMI is
    most of the pay, a home loan, and costs that leave the month short."""
    return _user([_personal(), _home()])


# ── #38: the gap is borrowed, at a card rate, and costs interest ──────────

def test_short_months_are_borrowed_and_cost_card_interest():
    u = _persona()
    free = simulate_plan(u, gap_as_debt=False)
    real = simulate_plan(u)
    short = [r for r in real.months if r.gap_borrowed > 0]
    assert short, "the persona is short in its first months"
    assert real.months[0].gap_borrowed == real.months[0].shortfall
    # Interest on gap borrowing is a real cost of the plan.
    assert real.total_gap_interest > 0
    assert real.total_interest_paid > free.total_interest_paid


def test_gap_interest_is_card_rate_with_gst_in_india():
    u = _persona()
    rate = gap_rate_for(u)
    assert rate.basis == "default" and rate.annual_rate == GAP_CARD_APR_IN
    # ₹1,00,000 for a month at 45%/12 = 3.75%, plus 18% GST on the charge.
    assert gap_interest(D("100000"), rate, u) == D("100000") * D("0.45") / 12 * D("1.18")


def test_us_default_is_the_fed_g19_rate_without_gst():
    u = _user([_home(rate="0.07")], country=Country.US, income="5000", expenses="4000")
    rate = gap_rate_for(u)
    assert rate.annual_rate == GAP_CARD_APR_US
    assert gap_interest(D("1000"), rate, u) == D("1000") * GAP_CARD_APR_US / 12


def test_the_users_own_card_sets_the_rate():
    card = Loan(LoanType.CREDIT_CARD, "HDFC Bank", D("150000"), D("0.42"), "fixed", 0, D("0"))
    u = _user([card, _personal()])
    rate = gap_rate_for(u)
    assert rate.basis == "your_card" and rate.annual_rate == D("0.42")


def test_emergency_fund_pays_first():
    u = _user([_personal(), _home()], efund="1000000")
    r = simulate_plan(u)
    first = r.months[0]
    assert first.shortfall > 0
    assert first.gap_from_savings == first.shortfall
    assert first.gap_borrowed == 0
    assert all(row.gap_debt == 0 for row in r.months)


def test_not_debt_free_until_gap_borrowing_is_repaid():
    r = simulate_plan(_persona())
    assert r.debt_free_month is not None
    last = r.months[r.debt_free_month - 1]
    assert last.gap_debt == 0
    # The gap was repaid out of real money: the EMI the personal loan freed.
    assert sum(row.gap_repaid for row in r.months) > 0


def test_a_gap_that_never_closes_has_no_date():
    """Costs alone above income: the borrowing only grows."""
    u = _user([_home()], income="50000", expenses="45000")
    r = simulate_plan(u, horizon_months=120)
    assert r.debt_free_month is None
    debts = [row.gap_debt for row in r.months]
    assert all(b2 >= b1 for b1, b2 in zip(debts, debts[1:]))


# ── live test #15: no extra payments with money the month doesn't have ────

def test_no_extra_payment_in_a_short_month():
    r = simulate_plan(_persona())
    for row in r.months:
        if row.shortfall > 0:
            assert row.extra_paid == 0, row.month_index
            assert row.gap_repaid == 0, row.month_index


def test_freed_emi_repays_the_gap_before_any_loan_gets_extra():
    """#15 reproduced: when the personal loan cleared in a short plan, its
    freed EMI went to the home loan as an unlabelled "extra". Now it pays
    back the gap borrowing first; extra reaches a loan only once the gap
    borrowing is gone."""
    r = simulate_plan(_persona())
    for row in r.months:
        if row.extra_paid > 0:
            assert row.gap_debt == 0, row.month_index


def test_reinvest_money_in_a_short_month_covers_the_gap_first():
    u = _persona()
    base = simulate_plan(u)
    gap1 = base.months[0].shortfall
    r = simulate_plan(u, reinvest_events=[(1, gap1 + D("1000"))])
    assert r.months[0].shortfall == 0 and r.months[0].gap_borrowed == 0
    # Only the ₹1,000 left over reached a loan.
    assert r.months[0].extra_paid <= D("1000") + D("0.01")


def test_old_assumption_is_still_available():
    r = simulate_plan(_persona(), gap_as_debt=False)
    assert r.total_gap_interest == 0 and r.gap_rate is None
    assert all(row.gap_debt == 0 for row in r.months)


# ── properties ────────────────────────────────────────────────────────────

@settings(max_examples=examples(60), deadline=None)
@given(u=users(), s=st.sampled_from([Strategy.AVALANCHE, Strategy.SNOWBALL]))
def test_gap_borrowing_never_makes_a_plan_cheaper_or_sooner(u, s):
    free = simulate_plan(u, strategy=s, gap_as_debt=False)
    real = simulate_plan(u, strategy=s)
    assert real.total_interest_paid >= free.total_interest_paid - D("0.01")
    if real.debt_free_month is not None and free.debt_free_month is not None:
        assert real.debt_free_month >= free.debt_free_month
    if all(row.shortfall == 0 for row in free.months):
        assert real.total_gap_interest == 0
        assert real.debt_free_month == free.debt_free_month


@settings(max_examples=examples(60), deadline=None)
@given(u=users(allow_extras=True))
def test_gap_ledger_adds_up(u):
    """Owed = last month's owed + interest + borrowed - repaid, never < 0;
    a short month never prepays a loan; debt-free means nothing borrowed."""
    for r in (simulate_plan(u), baseline_minimums_only(u)):
        prev = D("0")
        for row in r.months:
            assert row.gap_debt >= 0 and row.gap_repaid >= 0 and row.gap_borrowed >= 0
            assert abs(prev + row.gap_interest + row.gap_borrowed - row.gap_repaid - row.gap_debt) <= D("0.01")
            if row.shortfall > 0:
                assert row.extra_paid == 0
            prev = row.gap_debt
        if r.debt_free_month is not None:
            assert r.months[r.debt_free_month - 1].gap_debt == 0
        assert abs(sum((row.gap_interest for row in r.months), D("0")) - r.total_gap_interest) <= D("0.01")


# ── live test #26: a longer tenure, with the engine's own EMI math ────────

def test_stretching_the_home_loan_lowers_its_emi_and_can_close_the_gap():
    u = _user([_home()], income="60000", expenses="45000")
    assert simulate_plan(u).months[0].shortfall > 0
    stretched, change = stretch_tenure(u, 0, 120)
    assert change.new_emi < change.old_emi
    assert change.new_emi == emi(D("2500000"), D("0.086"), 360)
    assert change.new_tenure == 360
    r = simulate_plan(stretched)
    assert r.months[0].shortfall < simulate_plan(u).months[0].shortfall
    # The user's own profile is untouched.
    assert u.loans[0].tenure_months_remaining == 240


def test_stretching_refuses_a_card():
    card = Loan(LoanType.CREDIT_CARD, "HDFC Bank", D("150000"), D("0.42"), "fixed", 0, D("0"))
    with pytest.raises(ValueError):
        stretch_tenure(_user([card]), 0, 12)


def test_stretching_never_goes_below_interest_only():
    """RBI's reset circular para 2(v): no negative amortisation."""
    u = _user([_home(rate="0.30")])
    _, change = stretch_tenure(u, 0, 600)
    assert change.new_emi >= D("2500000") * D("0.30") / 12
