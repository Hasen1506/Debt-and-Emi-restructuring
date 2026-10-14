"""Audit 80 W10 — sale_cost_breakdown: the Sell-to-repay calculator's maths.

Invariants over a grid of assets, prices, residency and debts:
* net proceeds = sale price − selling costs − tax (to the paisa);
* debt cleared = min(max(net, 0), debt); left after debt = net − cleared;
* for resident property bought before 23 Jul 2024 and held long-term, both
  computations are returned and the tax charged is the lower one (Finance
  (No. 2) Act 2024 grandfathering, resident individuals/HUFs only:
  https://www.incometaxindia.gov.in/w/tax-on-long-term-capital-gains%E2%80%8B);
* a non-resident never gets the indexation option.
Golden: ₹50 L flat bought Jun 2015, sold ₹90 L (hand check in the test).
"""
from datetime import date
from decimal import Decimal
from itertools import product

import pytest

from engine.asset_liquidation import sale_cost_breakdown
from engine.models import Asset

D = Decimal
TODAY = date(2026, 10, 14)


def _flat(bought: date, price: str = "5000000") -> Asset:
    return Asset(asset_type="real_estate", purchase_price=D(price), purchase_date=bought,
                 current_market_value=D(price), state="Tamil Nadu", label="Flat")


GRID = list(product(
    [date(2012, 4, 1), date(2019, 9, 1), date(2024, 7, 22), date(2024, 8, 1), date(2026, 1, 5)],
    ["3000000", "9000000", "20000000"],
    [True, False],
    ["0", "1500000", "50000000"],
))


@pytest.mark.parametrize("bought, sale, resident, debt", GRID)
def test_breakdown_identities(bought, sale, resident, debt):
    b = sale_cost_breakdown(_flat(bought), sale_price=D(sale), today=TODAY,
                            debt_balance=D(debt), debt_effective_rate=D("0.14"),
                            taxable_income=D("1800000"), resident=resident)
    assert b.tax >= 0 and b.selling_costs >= 0
    assert abs(b.net_proceeds - (b.sale_price - b.selling_costs - b.tax)) <= D("0.02")
    assert b.debt_cleared == min(max(b.net_proceeds, D(0)), D(debt))
    assert b.left_after_debt == b.net_proceeds - b.debt_cleared
    assert b.yearly_interest_on_cleared_debt == (b.debt_cleared * D("0.14")).quantize(D("0.01"))
    pre_2024 = bought < date(2024, 7, 23)
    if b.tax_options:
        assert resident and pre_2024 and b.holding == "long-term"
        assert abs(b.tax - min(o.tax for o in b.tax_options)) <= D("1")
    if not resident:
        assert b.tax_options == []


def test_golden_resident_pre_2024_flat():
    """₹50 L flat bought Jun 2015, sold ₹90 L in FY 2026-27, ₹15 L debt at 36%.
    Hand check: debt cleared ₹15,00,000 (net proceeds exceed it); a year's
    interest on it 15,00,000 × 0.36 = ₹5,40,000. Both property computations
    are listed for a resident; an NRI pays the 12.5% figure. The CII
    arithmetic itself is pinned in engine/tests/test_asset_liquidation.py."""
    b = sale_cost_breakdown(_flat(date(2015, 6, 1)), sale_price=D("9000000"), today=TODAY,
                            debt_balance=D("1500000"), debt_effective_rate=D("0.36"),
                            taxable_income=D("1800000"))
    labels = [o.label for o in b.tax_options]
    assert labels == ["12.5% without indexation", "20% with indexation"]
    assert b.debt_cleared == D("1500000")
    assert b.yearly_interest_on_cleared_debt == D("540000.00")
    nri = sale_cost_breakdown(_flat(date(2015, 6, 1)), sale_price=D("9000000"), today=TODAY,
                              taxable_income=D("1800000"), resident=False)
    flat_option = b.tax_options[0].tax
    assert abs(nri.tax - flat_option) <= D("1")
    assert any("non-resident" in n for n in nri.notes)


def test_blocked_assets_raise_not_guess():
    ppf = Asset(asset_type="ppf", purchase_price=D("100000"), purchase_date=date(2020, 4, 1),
                current_market_value=D("150000"), ppf_opened_date=date(2020, 4, 1))
    with pytest.raises(ValueError):
        sale_cost_breakdown(ppf, sale_price=D("150000"), today=TODAY)
