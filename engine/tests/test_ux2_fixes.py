"""UX walkthrough round 2, part A (16 Oct 2026, work/reports/ux-walkthrough-2.md)."""
from decimal import Decimal

from engine.models import Country, IncomeType, Loan, LoanType, User
from engine.simulation import Strategy, simulate_plan

D = Decimal


def _user(loans, income="0", spend="15000", **kw):
    kw.setdefault("income_type", IncomeType.SALARIED)
    return User(country=Country.IN, annual_income=D(income) * 12, monthly_income=D(income),
                fixed_expenses=D(spend), savings_balance=D("0"), primary_bank="SBI", loans=loans, **kw)


def test_2_zero_take_home_runs_and_reports_the_shortfall():
    """#2: job loss / student: no pay is a plan, not an error. Month 1 is
    short by spending plus every EMI and minimum."""
    pl = Loan(LoanType.PERSONAL, "Kotak", D("300000"), D("0.14"), "fixed", 60, D("7000"))
    r = simulate_plan(_user([pl]), Strategy.AVALANCHE, horizon_months=120)
    assert r.infeasible_from_month == 1
    assert r.months[0].shortfall == D("22000.00")


def test_1_long_tenure_loan_runs_to_its_real_end():
    """#1: ₹3 L at 14% with a ₹3,501 EMI clears in ~703 months; the plan
    (1,200-month horizon) carries it, never as a lump sum now."""
    pl = Loan(LoanType.PERSONAL, "Kotak", D("300000"), D("0.14"), "fixed", 703, D("3501"))
    r = simulate_plan(_user([pl], income="3600", spend="0"), Strategy.AVALANCHE, horizon_months=1200,
                      minimums_only=True)
    assert r.months[0].shortfall == 0
    assert 700 <= r.debt_free_month <= 705
