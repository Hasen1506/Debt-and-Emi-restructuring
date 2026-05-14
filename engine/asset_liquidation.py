"""Asset liquidation gate (§4.18, supersedes §4.8) — Finance Act 2024 LTCG split.

Decides whether to liquidate an asset to extinguish high-rate debt. Four gates:
  Gate 1 — net benefit positive AND ≥ 10% of asset value
  Gate 2 — debt is high-rate (caller-defined threshold, typically > 20%)
  Gate 3 — debt rate exceeds asset's real return net of one-time drag by ≥ 3pp
  Gate 4 — user emotional/strategic concerns (handled in UI, not engine)
"""
from datetime import date
from decimal import Decimal
from engine.models import Asset, Country
from engine.country_data import india_selling_cost_pct, lookup_cii
from engine.tax.india import surcharge_rate, CESS_RATE

D = Decimal


FINANCE_ACT_2024_CUTOFF = date(2024, 7, 23)
LTCG_FLAT_RATE_POST_2024 = D("0.125")
LTCG_INDEXED_RATE_PRE_2024 = D("0.20")
LTCG_SURCHARGE_CAP = D("0.25")
GATE_3_SPREAD = D("0.03")              # 3pp hurdle
GATE_1_BENEFIT_RATIO = D("0.10")       # net benefit ≥ 10% of asset value


def india_ltcg_tax(
    asset: Asset,
    sale_price: Decimal,
    state: str,
    taxable_income: Decimal,
    purchase_fy: str | None = None,
    current_fy: str | None = None,
    brokerage_rate: Decimal = D("0.015"),
) -> tuple[Decimal, Decimal]:
    """Returns (net_proceeds, ltcg_tax) for India real-estate sale.

    Implements Finance Act 2024 split:
      - Post-23-Jul-2024 purchase: flat 12.5% no indexation
      - Pre-23-Jul-2024 purchase: taxpayer picks lower of (12.5% no index) vs (20% indexed)
    Surcharge on LTCG capped at 25%. Cess 4% on (tax + surcharge).
    """
    selling_cost_pct = india_selling_cost_pct(state, brokerage_rate)
    gross_proceeds = sale_price * (D("1") - selling_cost_pct)
    surcharge = min(surcharge_rate(taxable_income, is_ltcg=True), LTCG_SURCHARGE_CAP)

    if asset.purchase_date >= FINANCE_ACT_2024_CUTOFF:
        gain = max(D("0"), gross_proceeds - asset.purchase_price)
        ltcg_base = gain * LTCG_FLAT_RATE_POST_2024
    else:
        if not purchase_fy or not current_fy:
            raise ValueError("Pre-23-Jul-2024 property needs purchase_fy and current_fy for CII")
        indexed_cost = asset.purchase_price * D(lookup_cii(current_fy)) / D(lookup_cii(purchase_fy))
        option_a = max(D("0"), gross_proceeds - asset.purchase_price) * LTCG_FLAT_RATE_POST_2024
        option_b = max(D("0"), gross_proceeds - indexed_cost) * LTCG_INDEXED_RATE_PRE_2024
        ltcg_base = min(option_a, option_b)

    ltcg_tax = ltcg_base * (D("1") + surcharge) * (D("1") + CESS_RATE)
    return gross_proceeds - ltcg_tax, ltcg_tax


def true_net_benefit(
    net_proceeds: Decimal,
    debt_balance: Decimal,
    debt_effective_rate: Decimal,
    selling_period_months: int = 3,
) -> Decimal:
    """§4.18 — net benefit after subtracting debt and interest accrued during sale."""
    interest_during_sale = debt_balance * (debt_effective_rate / D("12")) * D(selling_period_months)
    return net_proceeds - debt_balance - interest_during_sale


def gate_check(
    asset_value: Decimal,
    net_benefit: Decimal,
    debt_effective_rate: Decimal,
    asset_nominal_return: Decimal,
    inflation: Decimal,
    selling_cost_pct: Decimal,
    ltcg_effective_rate: Decimal,
    holding_cost_rate: Decimal,
    expected_hold_years_post_sale: Decimal,
    high_rate_threshold: Decimal = D("0.20"),
) -> dict:
    """§4.18 — runs Gates 1–3; Gate 4 is UI-side.

    Returns dict with each gate's boolean and the computed `recommend_liquidation`.
    """
    one_time_drag = (selling_cost_pct + ltcg_effective_rate) / expected_hold_years_post_sale
    asset_real_return_net = asset_nominal_return - inflation - holding_cost_rate - one_time_drag

    gate_1 = net_benefit > 0 and (net_benefit / asset_value) >= GATE_1_BENEFIT_RATIO
    gate_2 = debt_effective_rate >= high_rate_threshold
    gate_3 = (debt_effective_rate - asset_real_return_net) >= GATE_3_SPREAD

    return {
        "gate_1_net_benefit": gate_1,
        "gate_2_high_rate": gate_2,
        "gate_3_spread": gate_3,
        "asset_real_return_net": asset_real_return_net,
        "recommend_liquidation": gate_1 and gate_2 and gate_3,
    }
