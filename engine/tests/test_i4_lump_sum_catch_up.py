"""A lump sum catches up behind loans first, like monthly spare cash
(founder decision 17 Oct 2026, FOUNDER-RECORDS B17; integration-4).

Hand check: ₹1,00,000 to place. A personal loan ₹30,000 overdue takes
₹30,000 first; ₹70,000 is left for the normal pick. With a blank amount
behind, one month's EMI (₹10,871) is the estimate.
"""
from decimal import Decimal

from engine.debt_status import lump_sum_catch_up
from engine.models import Country, IncomeType, Loan, LoanType, TaxRegimeIN, User

D = Decimal


def pl(**kw):
    return Loan(LoanType.PERSONAL, "SBI", D("500000"), D("0.11"), "fixed", 60, D("10871"), **kw)


def car(**kw):
    return Loan(LoanType.AUTO, "HDFC", D("400000"), D("0.09"), "fixed", 60, D("8000"), **kw)


def user(loans):
    return User(Country.IN, IncomeType.SALARIED, D("1680000"), D("140000"), D("45000"), D("0"), "SBI",
                loans=loans, tax_regime=TaxRegimeIN.NEW)


def test_typed_overdue_is_taken_first():
    u = user([car(), pl(debt_status="behind", overdue_amount=D("30000"))])
    i, pay, used, est = lump_sum_catch_up(u.loans, u, D("100000"))
    assert (i, pay, used, est) == (1, D("30000"), D("30000"), False)


def test_blank_overdue_is_one_emi_estimated():
    u = user([pl(debt_status="behind")])
    i, pay, used, est = lump_sum_catch_up(u.loans, u, D("100000"))
    assert i == 0 and est is True and pay == D("10871")


def test_never_more_than_the_lump_sum():
    u = user([pl(debt_status="behind", overdue_amount=D("30000"))])
    assert lump_sum_catch_up(u.loans, u, D("12000"))[1:3] == (D("12000"), D("12000"))


def test_secured_behind_loan_first_then_dearest():
    u = user([pl(debt_status="behind", overdue_amount=D("5000")), car(debt_status="behind", overdue_amount=D("8000"))])
    assert lump_sum_catch_up(u.loans, u, D("100000"))[0] == 1


def test_no_behind_loan_or_collections_only_is_none():
    assert lump_sum_catch_up(user([pl()]).loans, user([pl()]), D("100000")) is None
    u = user([pl(debt_status="collections")])
    assert lump_sum_catch_up(u.loans, u, D("100000")) is None


def test_zero_overdue_is_none():
    u = user([pl(debt_status="behind", overdue_amount=D("0"))])
    assert lump_sum_catch_up(u.loans, u, D("100000")) is None
