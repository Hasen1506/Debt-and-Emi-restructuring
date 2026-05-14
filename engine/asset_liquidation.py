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
GATE_0_WEALTH_EDGE_RATIO = D("0.10")   # sell-wealth must beat hold-wealth by ≥ 10% of asset
DEFAULT_HOLD_VS_SELL_HORIZON_Y = D("5")


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


def hold_vs_sell_wealth(
    asset_value: Decimal,
    asset_nominal_return: Decimal,
    holding_cost_rate: Decimal,
    net_proceeds: Decimal,
    debt_balance: Decimal,
    debt_effective_rate: Decimal,
    surplus_reinvestment_yield: Decimal,
    horizon_years: Decimal = DEFAULT_HOLD_VS_SELL_HORIZON_Y,
) -> dict:
    """§4.18 Gate 0 — does selling actually leave you wealthier in `horizon_years`?

    Two scenarios over the same horizon:

    HOLD: keep asset (compounds at nominal_return − holding_cost) and keep paying
          the debt (compounds at debt_effective_rate against a fixed balance —
          worst-case: user only services interest, doesn't pay down).
        wealth_hold = asset_value × (1 + r_a − c)^N − debt_balance × (1 + r_d)^N

    SELL: clear the debt with net_proceeds. Whatever is left (or owed) sits in
          the user's best liquid investment for the horizon.
        surplus = net_proceeds − debt_balance
        wealth_sell = surplus × (1 + r_inv)^N        (if surplus ≥ 0)
                    = −|surplus| × (1 + r_d_assumed)^N if surplus < 0 (residual debt)

    Returns wealth_hold, wealth_sell, edge (sell − hold), edge_ratio (edge / asset_value).
    Edge_ratio is what Gate 0 thresholds against.
    """
    r_a_net = asset_nominal_return - holding_cost_rate
    growth_a = (D("1") + r_a_net) ** int(horizon_years)
    growth_d = (D("1") + debt_effective_rate) ** int(horizon_years)
    growth_inv = (D("1") + surplus_reinvestment_yield) ** int(horizon_years)

    wealth_hold = asset_value * growth_a - debt_balance * growth_d

    surplus = net_proceeds - debt_balance
    if surplus >= 0:
        wealth_sell = surplus * growth_inv
    else:
        # Residual debt compounds at debt rate.
        wealth_sell = surplus * growth_d            # surplus is negative

    edge = wealth_sell - wealth_hold
    edge_ratio = edge / asset_value if asset_value > 0 else D("0")
    return {
        "wealth_hold": wealth_hold,
        "wealth_sell": wealth_sell,
        "surplus": surplus,
        "edge": edge,
        "edge_ratio": edge_ratio,
        "horizon_years": horizon_years,
    }


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
    net_proceeds: Decimal | None = None,
    debt_balance: Decimal | None = None,
    surplus_reinvestment_yield: Decimal | None = None,
) -> dict:
    """§4.18 — Gates 0–3; Gate 4 (emotional/strategic) is UI-side.

    Gate 0 (NEW): hold-vs-sell wealth comparison over `expected_hold_years_post_sale`
        years. Sell-scenario wealth must beat hold-scenario wealth by at least
        10% of asset value. Closes the loophole where the prior 3 gates passed
        but most of the proceeds ended up sitting as low-yield cash.

    Gate 0 is only evaluated when the caller supplies surplus context
    (net_proceeds, debt_balance, surplus_reinvestment_yield); without it we
    skip Gate 0 and fall back to the legacy 3-gate behaviour for backward
    compatibility.
    """
    one_time_drag = (selling_cost_pct + ltcg_effective_rate) / expected_hold_years_post_sale
    asset_real_return_net = asset_nominal_return - inflation - holding_cost_rate - one_time_drag

    gate_1 = net_benefit > 0 and (net_benefit / asset_value) >= GATE_1_BENEFIT_RATIO
    gate_2 = debt_effective_rate >= high_rate_threshold
    gate_3 = (debt_effective_rate - asset_real_return_net) >= GATE_3_SPREAD

    out = {
        "gate_1_net_benefit": gate_1,
        "gate_2_high_rate": gate_2,
        "gate_3_spread": gate_3,
        "asset_real_return_net": asset_real_return_net,
    }

    if (
        net_proceeds is not None
        and debt_balance is not None
        and surplus_reinvestment_yield is not None
    ):
        wealth = hold_vs_sell_wealth(
            asset_value=asset_value,
            asset_nominal_return=asset_nominal_return,
            holding_cost_rate=holding_cost_rate,
            net_proceeds=net_proceeds,
            debt_balance=debt_balance,
            debt_effective_rate=debt_effective_rate,
            surplus_reinvestment_yield=surplus_reinvestment_yield,
            horizon_years=expected_hold_years_post_sale,
        )
        gate_0 = wealth["edge_ratio"] >= GATE_0_WEALTH_EDGE_RATIO
        out["gate_0_wealth_edge"] = gate_0
        out["wealth_hold"] = wealth["wealth_hold"]
        out["wealth_sell"] = wealth["wealth_sell"]
        out["surplus"] = wealth["surplus"]
        out["wealth_edge"] = wealth["edge"]
        out["wealth_edge_ratio"] = wealth["edge_ratio"]
        out["recommend_liquidation"] = gate_0 and gate_1 and gate_2 and gate_3
    else:
        out["gate_0_wealth_edge"] = None
        out["recommend_liquidation"] = gate_1 and gate_2 and gate_3

    return out
