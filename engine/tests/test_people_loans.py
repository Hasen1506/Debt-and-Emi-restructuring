"""Loans from people: a friend, family, a chit fund.

A credit report never lists these. Zero interest is paid last in avalanche.
A lump sum is due in its month, before extra payments. Pay-whenever, with
no EMI and no end date, does not break the plan.
"""
from decimal import Decimal as D

from engine.models import Country, IncomeType, Loan, LoanType, TaxRegimeIN, User
from engine.ordering import Strategy
from engine.simulation import simulate_plan


def _user(loans, income=D("80000")) -> User:
    return User(
        country=Country.IN, income_type=IncomeType.SALARIED,
        annual_income=income * 12, monthly_income=income,
        fixed_expenses=D("10000"), savings_balance=D("0"), primary_bank="HDFC Bank",
        tax_regime=TaxRegimeIN.NEW, efund_balance=D("0"), efund_target=D("0"),
        loans=loans, investment_options=[], inflation_rate=D("0"),
    )


def _people(**kw) -> Loan:
    base = dict(
        loan_type=LoanType.PEOPLE, bank="Asha", outstanding=D("50000"),
        nominal_rate=D("0"), rate_type="fixed", tenure_months_remaining=24,
        scheduled_emi=D("0"), lender_type="other",
    )
    base.update(kw)
    return Loan(**base)


def test_zero_interest_is_paid_after_the_dearer_loan():
    dear = Loan(
        loan_type=LoanType.PERSONAL, bank="HDFC Bank", outstanding=D("100000"),
        nominal_rate=D("0.18"), rate_type="fixed", tenure_months_remaining=12,
        scheduled_emi=D("9000"),
    )
    plan = simulate_plan(_user([_people(), dear]), Strategy.AVALANCHE, horizon_months=2)
    assert plan.months[0].extra_to_loan_index == 1


def test_lump_sum_is_due_in_its_month():
    lump = _people(bank="Chit", outstanding=D("10000"), tenure_months_remaining=1, repayment="bullet")
    plan = simulate_plan(_user([lump], D("20000")), Strategy.AVALANCHE, horizon_months=2)
    assert plan.months[0].payments_by_loan_index[0] >= D("10000")


def test_pay_whenever_does_not_break_the_plan():
    dear = Loan(
        loan_type=LoanType.PERSONAL, bank="HDFC Bank", outstanding=D("20000"),
        nominal_rate=D("0.12"), rate_type="fixed", tenure_months_remaining=6,
        scheduled_emi=D("3500"),
    )
    plan = simulate_plan(_user([_people(tenure_months_remaining=0), dear]), Strategy.AVALANCHE, horizon_months=1)
    assert plan.months
    assert plan.months[0].extra_to_loan_index == 1


def test_a_fixed_monthly_amount_accrues_that_interest():
    # ₹1,000 a month on ₹1,00,000 is stored as 12% a year (1000 × 12 / 100000).
    loan = _people(outstanding=D("100000"), nominal_rate=D("0.12"), tenure_months_remaining=3, scheduled_emi=D("1000"))
    plan = simulate_plan(_user([loan], D("20000")), Strategy.AVALANCHE, horizon_months=1)
    paid = plan.months[0].payments_by_loan_index[0]
    assert paid >= D("1000")


def test_a_fixed_monthly_amount_does_not_shrink_with_the_balance():
    from engine.formulas import monthly_interest_charge
    loan = _people(outstanding=D("100000"), nominal_rate=D("0.12"), tenure_months_remaining=3,
                   scheduled_emi=D("1000"), fixed_monthly_interest=D("1000"))
    assert monthly_interest_charge(loan, Country.IN) == D("1000")
    from dataclasses import replace
    half = replace(loan, outstanding=D("50000"))
    assert monthly_interest_charge(half, Country.IN) == D("1000")
    assert monthly_interest_charge(replace(loan, outstanding=D("0")), Country.IN) == D("0")
