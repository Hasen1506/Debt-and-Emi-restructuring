"""Owed-fix (18 Oct 2026): card payments logged this month come off owed_today,
as on Home (web/src/lib/owed-now-core.ts)."""
from decimal import Decimal as D

from engine.models import Country, IncomeType, Loan, LoanType, User
from engine.owed_today import owed_today


def _user():
    card = Loan(LoanType.CREDIT_CARD, "", D("200000"), D("0.36"), "fixed", 0, D("10000"))
    return User(Country.IN, IncomeType.SALARIED, D("150000") * 12, D("150000"), D("40000"), D("0"), "", loans=[card])


def test_card_paid_this_month_is_owed_now():
    o = owed_today(_user(), (), {0: D("79919")})
    assert o.total == D("120081")
    assert o.start_of_month == D("200000")
    assert o.paid_off == D("79919")
    assert o.by_loan[0] == D("120081.00")


def test_nothing_paid_keeps_the_statement():
    o = owed_today(_user())
    assert o.total == o.start_of_month == D("200000")
    assert o.paid_off == D("0")


def test_never_below_zero():
    assert owed_today(_user(), (), {0: D("250000")}).total == D("0")
