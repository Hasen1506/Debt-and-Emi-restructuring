"""Plan what-ifs against a hand schedule, and the 20 Oct 2026 spend-less card.

The screenshot (Spend less ₹1,000 a month, "up to ₹1,349") showed the same
debt-free month and about ₹109 less interest, with totals ₹8,815 and ₹8,707.
Those totals are a ₹2,00,000 card at 36% paid ₹98,646 a month from the
statement, not from the ₹98,481 already owed. Starting from what's owed
today, the same ₹1,000 saves ₹23.60 and the month still doesn't move:
October's payment already covers the balance, so the extra only shrinks the
₹2,159 of interest left for November.
"""
from decimal import Decimal, ROUND_HALF_UP

import pytest

from engine.models import Country, IncomeType, Loan, LoanType, TaxRegimeIN, User
from engine.ordering import Strategy
from engine.sensitivity import compare, with_lump_sum, with_rate_shock, with_surplus_delta
from engine.simulation import simulate_plan
from engine.tenure_whatif import stretch_tenure

D = Decimal
PAISA = D("0.01")
GST = D("1.18")
CARD_PAID_EARLY = D(1) / D(3)


def q(x: Decimal) -> Decimal:
    return x.quantize(PAISA, rounding=ROUND_HALF_UP)


def _user(loans, income="150000", fixed="0", variable="0") -> User:
    return User(
        country=Country.IN, income_type=IncomeType.SALARIED, annual_income=D("1800000"),
        monthly_income=D(income), fixed_expenses=D(fixed), variable_expenses=D(variable),
        savings_balance=D("0"), primary_bank="HDFC Bank", tax_regime=TaxRegimeIN.NEW,
        efund_balance=D("0"), efund_target=D("0"), loans=loans,
    )


def _card() -> User:
    return _user([
        Loan(
            loan_type=LoanType.CREDIT_CARD, bank="HDFC Bank", outstanding=D("200000"),
            nominal_rate=D("0.36"), rate_type="fixed", tenure_months_remaining=0,
            scheduled_emi=D("10000"), min_payment_override=D("10000"),
        )
    ], variable="1349")


def _reducing(principal, annual, payment, months=60):
    """Interest and the clearing month for a reducing-balance loan. No GST,
    no fees: balance × rate / 12, then the payment."""
    bal = D(principal)
    rate = D(annual) / 12
    interest = D(0)
    cleared = None
    for m in range(1, months + 1):
        if bal <= PAISA:
            break
        charge = bal * rate
        pay = min(D(payment), bal + charge)
        bal = bal + charge - pay
        interest += charge
        if bal <= PAISA and cleared is None:
            cleared = m
            bal = D(0)
    return q(interest), cleared


def _emi(principal, annual, months) -> Decimal:
    r = D(annual) / 12
    factor = (D(1) + r) ** months
    return D(principal) * r * factor / (factor - D(1))


def _card_run(opening, budget, months=8):
    """One card, no new spend. Interest is the average daily balance: the
    payment stops interest for the last third of the cycle, then 18% GST.
    The payment is the budget until the balance can be cleared."""
    bal = D(opening)
    interest = D(0)
    cleared = None
    for m in range(1, months + 1):
        if bal <= PAISA:
            break
        pay = D(budget)
        charge = D(0)
        for _ in range(4):
            paid = min(pay, bal)
            adb = bal - paid * CARD_PAID_EARLY
            charge = max(adb, D(0)) * D("0.36") / 12 * GST
            pay = charge + bal if charge + bal <= D(budget) else D(budget)
        bal = bal + charge - pay
        interest += charge
        if bal <= PAISA and cleared is None:
            cleared = m
            bal = D(0)
    return q(interest), cleared


def test_screenshot_spend_less_on_the_statement_is_about_108_in_december():
    """The bars Vijay saw: ₹8,815 against ₹8,707, both debt-free in month 3."""
    user = _card()
    plan = dict(debt_budget=D("98646"))
    base = simulate_plan(user, Strategy.SNOWBALL, horizon_months=8, **plan)
    cut = with_surplus_delta(user, D("1000"), Strategy.SNOWBALL, horizon_months=8, plan=plan, spending_cut=True)
    diff = compare(base, cut)
    assert q(base.total_interest_paid) == D("8814.98")
    assert q(cut.total_interest_paid) == D("8706.96")
    assert q(diff["interest_saved"]) == D("108.02")
    assert diff["months_pulled_forward"] == 0
    assert base.debt_free_month == cut.debt_free_month == 3
    assert _card_run(D("200000"), D("98646")) == (D("8814.98"), 3)
    assert _card_run(D("200000"), D("99646")) == (D("8706.96"), 3)


def test_spend_less_from_whats_owed_today_saves_23_60_and_stays_in_november():
    """₹1,01,519 already paid. ₹1,000 more a month does not pull the date in."""
    user = _card()
    plan = dict(debt_budget=D("98646"), paid_off_this_month={0: D("101519")})
    base = simulate_plan(user, Strategy.SNOWBALL, horizon_months=8, **plan)
    cut = with_surplus_delta(user, D("1000"), Strategy.SNOWBALL, horizon_months=8, plan=plan, spending_cut=True)
    once = with_lump_sum(user, D("1000"), 0, Strategy.SNOWBALL, horizon_months=8, plan=plan)
    later = with_surplus_delta(
        user, D("1000"), Strategy.SNOWBALL, horizon_months=8, plan=plan, spending_cut=True, start_month=4,
    )
    assert q(base.total_interest_paid) == D("2375.11")
    assert base.debt_free_month == 2
    assert q(compare(base, cut)["interest_saved"]) == D("23.60")
    assert compare(base, cut)["months_pulled_forward"] == 0
    assert cut.debt_free_month == 2
    # A one-off ₹1,000 comes off the balance before this cycle's interest.
    # The monthly cut does not: October's payment already covers the balance.
    assert q(compare(base, once)["interest_saved"]) == D("47.76")
    assert once.debt_free_month == 2
    # From month 4 the debt is already gone, so the cut changes nothing.
    assert compare(base, later)["interest_saved"] == 0
    assert later.debt_free_month == 2
    assert _card_run(D("98481"), D("98646")) == (D("2375.11"), 2)
    assert _card_run(D("98481"), D("99646")) == (D("2351.51"), 2)


def test_zero_change_matches_and_a_bigger_payment_never_costs_more():
    user = _card()
    plan = dict(debt_budget=D("98646"), paid_off_this_month={0: D("101519")})
    base = simulate_plan(user, Strategy.SNOWBALL, horizon_months=8, **plan)
    zero = with_surplus_delta(user, D("0"), Strategy.SNOWBALL, horizon_months=8, plan=plan, spending_cut=True)
    assert zero.total_interest_paid == base.total_interest_paid
    assert zero.debt_free_month == base.debt_free_month
    no_lump = with_lump_sum(user, D("0"), 0, Strategy.SNOWBALL, horizon_months=8, plan=plan)
    assert no_lump.total_interest_paid == base.total_interest_paid
    assert no_lump.debt_free_month == base.debt_free_month
    saved = D("-1")
    for cut in (D("100"), D("1000"), D("1349")):
        scen = with_surplus_delta(user, cut, Strategy.SNOWBALL, horizon_months=8, plan=plan, spending_cut=True)
        diff = compare(base, scen)
        assert diff["interest_saved"] >= saved
        assert diff["interest_saved"] >= 0
        assert diff["months_pulled_forward"] >= 0
        assert scen.debt_free_month <= base.debt_free_month
        saved = diff["interest_saved"]


def test_personal_loan_matches_a_hand_schedule():
    emi = _emi(D("240000"), D("0.12"), 24)
    loan = Loan(
        loan_type=LoanType.PERSONAL, bank="HDFC Bank", outstanding=D("240000"),
        nominal_rate=D("0.12"), rate_type="fixed", tenure_months_remaining=24, scheduled_emi=q(emi),
    )
    user = _user([loan], income="80000", fixed="20000")
    pay = q(emi)
    base = simulate_plan(user, Strategy.SNOWBALL, horizon_months=30, debt_budget=pay)
    ref_i, ref_m = _reducing(D("240000"), D("0.12"), pay, 30)
    assert abs(q(base.total_interest_paid) - ref_i) <= D("1")
    # The contract's last month pays whatever is left, so a paisa the open
    # loop would carry one more month is cleared on the tenure instead.
    assert abs(base.debt_free_month - ref_m) <= 1
    cut_pay = pay + D("2000")
    cut = with_surplus_delta(user, D("2000"), Strategy.SNOWBALL, horizon_months=30, plan=dict(debt_budget=pay), spending_cut=True)
    ref_c, ref_cm = _reducing(D("240000"), D("0.12"), cut_pay, 30)
    assert q(cut.total_interest_paid) == ref_c
    assert cut.debt_free_month == ref_cm
    assert compare(base, cut)["interest_saved"] > 0
    assert compare(base, cut)["months_pulled_forward"] > 0
    lump = with_lump_sum(user, D("20000"), 0, Strategy.SNOWBALL, horizon_months=30, plan=dict(debt_budget=pay))
    ref_l, ref_lm = _reducing(D("220000"), D("0.12"), pay, 30)
    assert abs(q(lump.total_interest_paid) - ref_l) <= D("1")
    assert lump.debt_free_month == ref_lm


def test_rate_step_and_a_longer_tenure_match_the_hand_emi():
    loan = Loan(
        loan_type=LoanType.HOME, bank="SBI", outstanding=D("1000000"), nominal_rate=D("0.085"),
        rate_type="floating", tenure_months_remaining=120, scheduled_emi=D("12399"),
    )
    user = _user([loan], income="50000", fixed="30000")
    base = simulate_plan(user, Strategy.SNOWBALL, horizon_months=140, debt_budget=D("0"))
    up = with_rate_shock(user, D("0.005"), Strategy.SNOWBALL, horizon_months=200, plan=dict(debt_budget=D("0")))
    down = with_rate_shock(user, D("-0.005"), Strategy.SNOWBALL, horizon_months=140, plan=dict(debt_budget=D("0")))
    flat = with_rate_shock(user, D("0"), Strategy.SNOWBALL, horizon_months=140, plan=dict(debt_budget=D("0")))
    assert flat.total_interest_paid == base.total_interest_paid
    assert flat.debt_free_month == base.debt_free_month
    assert compare(base, up)["interest_saved"] < 0
    assert compare(base, up)["months_pulled_forward"] <= 0
    assert compare(base, down)["interest_saved"] > 0
    stretched, change = stretch_tenure(user, 0, 60)
    assert q(change.new_emi) == q(_emi(D("1000000"), D("0.085"), 180))
    assert change.new_emi < change.old_emi
    scen = simulate_plan(stretched, Strategy.SNOWBALL, horizon_months=200, debt_budget=D("0"))
    assert scen.debt_free_month == base.debt_free_month + 60
    assert scen.total_interest_paid > base.total_interest_paid


@pytest.mark.parametrize("cut", [D("0"), D("500"), D("5000")])
def test_more_surplus_never_adds_interest_or_a_later_date(cut):
    loan = Loan(
        loan_type=LoanType.PERSONAL, bank="HDFC Bank", outstanding=D("100000"),
        nominal_rate=D("0.14"), rate_type="fixed", tenure_months_remaining=36, scheduled_emi=D("3418"),
    )
    user = _user([loan], income="40000", fixed="10000")
    plan = dict(debt_budget=D("3418"))
    base = simulate_plan(user, Strategy.AVALANCHE, horizon_months=40, **plan)
    scen = with_surplus_delta(user, cut, Strategy.AVALANCHE, horizon_months=40, plan=plan, spending_cut=True)
    diff = compare(base, scen)
    assert diff["interest_saved"] >= 0
    assert diff["months_pulled_forward"] >= 0
    if cut == 0:
        assert scen.total_interest_paid == base.total_interest_paid
        assert scen.debt_free_month == base.debt_free_month
