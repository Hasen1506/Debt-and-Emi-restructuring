"""Asset liquidation §4.18 — Finance Act 2024 LTCG split + gate checks."""
from datetime import date
from decimal import Decimal
from engine.asset_liquidation import (
    india_ltcg_tax, true_net_benefit, gate_check, LTCG_FLAT_RATE_POST_2024
)
from engine.models import Asset

D = Decimal


def _asset(purchase_date: date, purchase_price: Decimal = D("5000000")) -> Asset:
    return Asset(
        asset_type="real_estate",
        purchase_price=purchase_price,
        purchase_date=purchase_date,
        current_market_value=D("10000000"),
        state="Maharashtra",
    )


def test_post_finance_act_2024_flat_125_no_indexation():
    """Property bought after 23 Jul 2024 → flat 12.5%, no indexation. CII not needed."""
    asset = _asset(date(2024, 8, 1), purchase_price=D("5000000"))
    net, tax = india_ltcg_tax(asset, sale_price=D("10000000"),
                               state="Maharashtra", taxable_income=D("1500000"))
    # selling cost MH = 6% + 1% reg + 1.5% brokerage = 8.5%
    # gross = 10000000 × 0.915 = 9150000
    # gain = 9150000 − 5000000 = 4150000
    # ltcg_base = 4150000 × 0.125 = 518750
    # surcharge for ₹15L income = 0
    # tax = 518750 × 1.04 = 539500
    assert tax == D("539500.00000")
    assert net == D("9150000") - D("539500.00000")


def test_pre_finance_act_picks_lower_of_two_methods():
    """Pre-23-Jul-2024 property: taxpayer picks lower of (12.5% no index) vs (20% indexed)."""
    asset = _asset(date(2015, 6, 1), purchase_price=D("5000000"))
    net, tax = india_ltcg_tax(asset, sale_price=D("10000000"),
                               state="Maharashtra", taxable_income=D("1500000"),
                               purchase_fy="2015-16", current_fy="2024-25")
    # CII 2015-16 = 254; 2024-25 = 363
    # gross = 9,150,000
    # option_a (no index) = (9150000 − 5000000) × 0.125 = 518,750
    # indexed_cost = 5000000 × 363 / 254 ≈ 7,145,669
    # option_b (indexed) = max(0, 9150000 − 7145669) × 0.20 ≈ 400,866
    # → option_b is lower; tax_base ≈ 400,866; with 4% cess ≈ 416,901
    assert tax < D("418000")
    assert tax > D("415000")


def test_ltcg_surcharge_cap_25_for_super_high_income():
    """LTCG surcharge is capped at 25% even for >₹5Cr filers (where normal cap is 37%)."""
    asset = _asset(date(2024, 8, 1), purchase_price=D("5000000"))
    net, tax = india_ltcg_tax(asset, sale_price=D("10000000"),
                               state="Maharashtra", taxable_income=D("60000000"))
    # gain = 4,150,000; ltcg_base = 518,750
    # surcharge capped at 25% (NOT 37%)
    # tax = 518,750 × 1.25 × 1.04
    expected = D("518750") * D("1.25") * D("1.04")
    assert tax == expected


def test_true_net_benefit_includes_interest_during_sale():
    """Time-to-sell drag: 3 months of debt interest accrued while sale completes."""
    # net_proceeds = ₹50L; debt = ₹40L @ 9% effective; 3 months drag
    benefit = true_net_benefit(
        net_proceeds=D("5000000"), debt_balance=D("4000000"),
        debt_effective_rate=D("0.09"), selling_period_months=3,
    )
    # interest = 4000000 × (0.09/12) × 3 = 90000
    # benefit = 5000000 − 4000000 − 90000 = 910000
    assert benefit == D("910000.000000")


def test_gate_check_all_pass():
    """High-rate debt vs poor-return asset: all gates pass."""
    result = gate_check(
        asset_value=D("10000000"),
        net_benefit=D("2000000"),         # 20% of asset value — passes gate 1
        debt_effective_rate=D("0.36"),    # credit card — gate 2 pass
        asset_nominal_return=D("0.04"),
        inflation=D("0.046"),
        selling_cost_pct=D("0.085"),
        ltcg_effective_rate=D("0.05"),
        holding_cost_rate=D("0.01"),
        expected_hold_years_post_sale=D("5"),
    )
    assert result["recommend_liquidation"] is True


def test_gate_check_fails_when_asset_returns_high():
    """If the asset itself has a great real return, don't liquidate."""
    result = gate_check(
        asset_value=D("10000000"),
        net_benefit=D("2000000"),
        debt_effective_rate=D("0.085"),     # home loan effective
        asset_nominal_return=D("0.18"),     # property booming
        inflation=D("0.046"),
        selling_cost_pct=D("0.085"),
        ltcg_effective_rate=D("0.05"),
        holding_cost_rate=D("0.01"),
        expected_hold_years_post_sale=D("5"),
    )
    assert result["gate_3_spread"] is False
    assert result["recommend_liquidation"] is False


def test_gate_0_blocks_sale_when_surplus_left_idle():
    """User's concern: 3 gates pass but most proceeds sit at low yield.
    Sale would lose money over 5 years vs holding."""
    result = gate_check(
        asset_value=D("9000000"),
        net_benefit=D("3800000"),
        debt_effective_rate=D("0.085"),    # home loan — passes 1 + 2 (loose)
        asset_nominal_return=D("0.09"),    # decent property
        inflation=D("0.046"),
        selling_cost_pct=D("0.06"),
        ltcg_effective_rate=D("0.04"),
        holding_cost_rate=D("0.01"),
        expected_hold_years_post_sale=D("5"),
        high_rate_threshold=D("0.08"),     # loosen so gate 2 passes
        net_proceeds=D("7800000"),
        debt_balance=D("4000000"),
        surplus_reinvestment_yield=D("0.068"),   # liquid fund
    )
    assert result["gate_0_wealth_edge"] is False
    assert result["recommend_liquidation"] is False
    assert result["surplus"] == D("3800000")


def test_gate_0_allows_sale_when_debt_is_expensive_enough():
    """Card-rate debt vs underperforming asset — Gate 0 still says sell."""
    result = gate_check(
        asset_value=D("9000000"),
        net_benefit=D("3800000"),
        debt_effective_rate=D("0.36"),
        asset_nominal_return=D("0.04"),
        inflation=D("0.046"),
        selling_cost_pct=D("0.06"),
        ltcg_effective_rate=D("0.04"),
        holding_cost_rate=D("0.01"),
        expected_hold_years_post_sale=D("5"),
        net_proceeds=D("7800000"),
        debt_balance=D("4000000"),
        surplus_reinvestment_yield=D("0.068"),
    )
    assert result["gate_0_wealth_edge"] is True
    assert result["recommend_liquidation"] is True
