"""Round 3, part C (tax): US self-employment tax (u08gig) in the engine.

IRS Topic 554 (https://www.irs.gov/taxtopics/tc554), SSA 2026 wage base
$184,500 (https://www.ssa.gov/oact/cola/cbb.html), read 17 Oct 2026.
"""
from decimal import Decimal as D

import pytest

from engine.models import Country, FilingStatusUS, IncomeType, User
from engine.simulation import estimated_take_home, payroll_deductions
from engine.tax.income import gross_from_take_home
from engine.tax.usa import STANDARD_DEDUCTION_2026, federal_tax, self_employment_tax


def _user(income_type, filing=FilingStatusUS.SINGLE, country=Country.US):
    return User(country=country, income_type=income_type, annual_income=D("0"), monthly_income=D("5000"),
                fixed_expenses=D("0"), savings_balance=D("0"), primary_bank="", filing_status=filing)


def test_se_tax_hand_checked():
    # $60,000: 55,410 × 15.3% = 8,477.73, half 4,238.865.
    assert self_employment_tax(D("60000")) == (D("8477.73"), D("4238.865"))
    # $300,000 single: 12.4% × 184,500 + 2.9% × 277,050 + 0.9% × 77,050.
    tax, half = self_employment_tax(D("300000"))
    assert tax == D("22878") + D("8034.45") + D("693.45")
    assert half == (D("22878") + D("8034.45")) / 2
    # Married filing jointly: Additional Medicare from $250,000.
    assert self_employment_tax(D("300000"), FilingStatusUS.MFJ)[0] == D("22878") + D("8034.45") + D("0.009") * (D("277050") - D("250000"))
    assert self_employment_tax(D("399")) == (D("0"), D("0"))


@pytest.mark.parametrize("gross", ["20000", "80000", "150000", "250000", "600000"])
def test_us_gig_take_home_counts_se_tax_and_its_half_deduction(gross):
    g = D(gross)
    u = _user(IncomeType.BUSINESS_OWNER)
    se, half = self_employment_tax(g)
    assert payroll_deductions(u, g) == se
    fed = federal_tax(max(D("0"), g - half - STANDARD_DEDUCTION_2026[FilingStatusUS.SINGLE]), FilingStatusUS.SINGLE)
    assert estimated_take_home(u, g) == ((g - fed - se) / 12).quantize(D("0.01"))
    # Less than the same pay as an employee (who pays half the 15.3%).
    assert estimated_take_home(u, g) < estimated_take_home(_user(IncomeType.SALARIED), g)


def test_gross_from_take_home_inverts_for_gig_workers():
    u = _user(IncomeType.BUSINESS_OWNER)
    for th in ("2000", "6000", "15000"):
        g = gross_from_take_home(u, D(th))
        assert abs(estimated_take_home(u, g) - D(th)) < D("1")


def test_india_business_income_has_no_payroll_deduction():
    assert payroll_deductions(_user(IncomeType.BUSINESS_OWNER, None, Country.IN), D("1200000")) == D("0")
