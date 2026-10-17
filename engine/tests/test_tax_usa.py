"""USA tax — Tax Year 2026 bracket arithmetic (IRS Rev Proc 2025-32)."""
from decimal import Decimal
from engine.tax import usa
from engine.models import FilingStatusUS

D = Decimal


def test_standard_deduction_2026():
    assert usa.STANDARD_DEDUCTION_2026[FilingStatusUS.SINGLE] == D("16100")
    assert usa.STANDARD_DEDUCTION_2026[FilingStatusUS.MFJ] == D("32200")
    assert usa.STANDARD_DEDUCTION_2026[FilingStatusUS.HOH] == D("24150")


def test_single_marginal_at_12400_boundary():
    """At $12,400 marginal is 10%; one dollar above → 12%."""
    assert usa.federal_marginal_rate(D("12400"), FilingStatusUS.SINGLE) == D("0.10")
    assert usa.federal_marginal_rate(D("12401"), FilingStatusUS.SINGLE) == D("0.12")


def test_single_top_bracket():
    assert usa.federal_marginal_rate(D("700000"), FilingStatusUS.SINGLE) == D("0.37")


def test_mfj_marginal():
    """MFJ thresholds are roughly double single."""
    assert usa.federal_marginal_rate(D("24800"), FilingStatusUS.MFJ) == D("0.10")
    assert usa.federal_marginal_rate(D("100800"), FilingStatusUS.MFJ) == D("0.12")
    assert usa.federal_marginal_rate(D("800000"), FilingStatusUS.MFJ) == D("0.37")


def test_federal_tax_50k_single():
    """50k single: 10% on first 12,400 + 12% on 12,400→50,000 = 1240 + 4512 = 5752."""
    tax = usa.federal_tax(D("50000"), FilingStatusUS.SINGLE)
    expected = D("12400") * D("0.10") + (D("50000") - D("12400")) * D("0.12")
    assert tax == expected


def test_itemisation_below_standard():
    """Itemisable below standard deduction → zero benefit, no itemisation."""
    saved, itemises = usa.itemisation_benefit(
        mortgage_interest_paid=D("10000"),
        salt_taxes_paid=D("3000"),
        charitable_giving=D("500"),
        filing_status=FilingStatusUS.SINGLE,
        marginal_rate=D("0.22"),
    )
    assert saved == D("0")
    assert itemises is False


def test_itemisation_above_standard_single():
    """20k mortgage + 10k SALT + 2k charity = 32k > 16,100 std → itemises.
    (2026 SALT cap is $40,400 under OBBBA, so $10k is fully counted.)"""
    saved, itemises = usa.itemisation_benefit(
        mortgage_interest_paid=D("20000"),
        salt_taxes_paid=D("10000"),
        charitable_giving=D("2000"),
        filing_status=FilingStatusUS.SINGLE,
        marginal_rate=D("0.24"),
    )
    assert itemises is True
    # incremental = 32000 - 16100 = 15900; mortgage interest = 20000
    # deductible = min(20000, 15900) = 15900; saving = 15900 × 0.24 = 3816
    assert saved == D("15900") * D("0.24")
