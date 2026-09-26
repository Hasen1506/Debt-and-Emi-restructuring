"""India tax — verifies worked examples from brainstorm §25.5."""
from decimal import Decimal
from engine.tax import india
from engine.models import TaxRegimeIN

D = Decimal


def test_12L_new_regime_zero_tax():
    """₹12L income under new regime: tax before rebate = ₹60k, 87A rebate = ₹60k → ₹0."""
    tax = india.income_tax(D("1200000"), TaxRegimeIN.NEW)
    assert tax == D("0")


def test_14L_new_regime_marginal_rate():
    """₹14L new regime: marginal slab 15% × cess 4% = 15.6%."""
    rate = india.marginal_rate(D("1400000"), TaxRegimeIN.NEW)
    assert rate == D("0.15") * D("1.04")
    assert rate == D("0.1560")


def test_14L_new_regime_total_tax():
    """₹14L new regime: ₹20k + ₹40k + ₹30k = ₹90k slab tax; no rebate (>₹12L); ×1.04 cess = ₹93,600."""
    tax = india.income_tax(D("1400000"), TaxRegimeIN.NEW)
    assert tax == D("93600.0000")


def test_12cr_old_regime_marginal_rate():
    """₹1.2Cr old regime: 30% × 1.15 surcharge × 1.04 cess = 35.88%."""
    rate = india.marginal_rate(D("12000000"), TaxRegimeIN.OLD)
    expected = D("0.30") * D("1.15") * D("1.04")
    assert rate == expected
    assert rate == D("0.358800")


def test_surcharge_bands():
    """Per spec §4.14: 50L/1Cr/2Cr/5Cr → 0/10/15/25/37%."""
    assert india.surcharge_rate(D("4000000")) == D("0.00")
    assert india.surcharge_rate(D("7500000")) == D("0.10")
    assert india.surcharge_rate(D("15000000")) == D("0.15")
    assert india.surcharge_rate(D("30000000")) == D("0.25")
    assert india.surcharge_rate(D("60000000")) == D("0.37")


def test_surcharge_ltcg_capped():
    """LTCG surcharge capped at 25% — even for >₹5Cr filers."""
    assert india.surcharge_rate(D("60000000"), is_ltcg=True) == D("0.25")
    assert india.surcharge_rate(D("30000000"), is_ltcg=True) == D("0.25")
    assert india.surcharge_rate(D("15000000"), is_ltcg=True) == D("0.15")


def test_87a_cliff_detection():
    """The ₹12L threshold creates a marginal cliff in new regime."""
    assert india.is_at_87a_cliff(D("1200001"), TaxRegimeIN.NEW)
    assert not india.is_at_87a_cliff(D("1199999"), TaxRegimeIN.NEW)
    assert not india.is_at_87a_cliff(D("1300000"), TaxRegimeIN.NEW)


def test_4L_new_regime_zero_tax_pre_rebate():
    """Below first slab boundary: zero tax."""
    assert india.income_tax(D("400000"), TaxRegimeIN.NEW) == D("0")


# ─── 87A line (26 Sep 2026) ──────────────────────────────────────────────────

def test_marginal_relief_just_above_the_12_lakh_line():
    """₹12.1L was taxed ₹63,960; relief caps the tax at the ₹10,000 above
    the line (+4% cess)."""
    from engine.tax.india import income_tax
    from engine.models import TaxRegimeIN
    assert income_tax(Decimal("1210000"), TaxRegimeIN.NEW) == Decimal("10400")
    # Relief runs out near ₹12.71L: slab tax 70,500 vs 70,000 above the line
    assert income_tax(Decimal("1270000"), TaxRegimeIN.NEW) == Decimal("70000") * Decimal("1.04")
    assert income_tax(Decimal("1300000"), TaxRegimeIN.NEW) == Decimal("75000") * Decimal("1.04")


def test_marginal_rate_is_zero_at_or_below_the_rebate_line():
    from engine.tax.india import marginal_rate
    from engine.models import TaxRegimeIN
    assert marginal_rate(Decimal("1000000"), TaxRegimeIN.NEW) == 0
    assert marginal_rate(Decimal("1200000"), TaxRegimeIN.NEW) == 0
    assert marginal_rate(Decimal("400000"), TaxRegimeIN.OLD) == 0
    assert marginal_rate(Decimal("1300000"), TaxRegimeIN.NEW) == Decimal("0.15") * Decimal("1.04")
