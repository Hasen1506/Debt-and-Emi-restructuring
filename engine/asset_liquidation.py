"""Asset liquidation gate (§4.18, supersedes §4.8) — Finance Act 2024 LTCG split.

Decides whether to liquidate an asset to extinguish high-rate debt. Four gates:
  Gate 1 — net benefit positive AND ≥ 10% of asset value
  Gate 2 — debt is high-rate (caller-defined threshold, typically > 20%)
  Gate 3 — debt rate exceeds asset's real return net of one-time drag by ≥ 3pp
  Gate 4 — user emotional/strategic concerns (handled in UI, not engine)

Also: portfolio ranker (rank_liquidations) and per-asset-type proceeds math
(compute_liquidation_proceeds). The ranker loops over (asset, debt) pairs and
ranks the strongest moves; the proceeds helpers handle CGT, exit penalties,
and lockup blocks per asset class.
"""
from dataclasses import dataclass, field
from datetime import date
from decimal import Decimal
from typing import Optional
from engine.models import Asset, Country, FilingStatusUS, Loan, User
from engine.country_data import (
    india_selling_cost_pct,
    lookup_cii,
    lookup_asset_return,
    us_real_estate_selling_cost_pct,
    US_CD_EARLY_WITHDRAWAL_PENALTY_PCT,
)
from engine.tax.india import surcharge_rate, CESS_RATE
from engine.tax.usa import (
    us_capital_gains_tax,
    federal_marginal_rate as us_federal_marginal_rate,
    SECTION_121_EXCLUSION_SINGLE,
    SECTION_121_EXCLUSION_MFJ,
)

D = Decimal


FINANCE_ACT_2024_CUTOFF = date(2024, 7, 23)
LTCG_FLAT_RATE_POST_2024 = D("0.125")
LTCG_INDEXED_RATE_PRE_2024 = D("0.20")
LTCG_SURCHARGE_CAP = D("0.25")
GATE_3_SPREAD = D("0.03")              # 3pp hurdle
GATE_1_BENEFIT_RATIO = D("0.10")       # net benefit ≥ 10% of asset value
GATE_0_WEALTH_EDGE_RATIO = D("0.10")   # sell-wealth must beat hold-wealth by ≥ 10% of asset
DEFAULT_HOLD_VS_SELL_HORIZON_Y = D("5")

# ─── Equity-specific constants (Finance Act 2024) ───────────────────────────
EQUITY_LTCG_RATE = D("0.125")
EQUITY_LTCG_EXEMPTION = D("125000")       # ₹1.25L LTCG exemption per FY
EQUITY_STCG_RATE = D("0.20")
EQUITY_LT_HOLD_DAYS = 365                  # 12 months
EQUITY_SURCHARGE_CAP = D("0.15")           # §112A/§111A — capped at 15%, not 25%
EQUITY_STT_RATE = D("0.001")               # 0.1% on sell value (delivery)
EQUITY_BROKERAGE = D("0.001")              # 0.1% discount broker

# ─── Gold ─────────────────────────────────────────────────────────────────────
GOLD_LT_HOLD_DAYS = 730                    # 24 months
GOLD_TRANSACTION_COST = D("0.03")          # 3% blended (jewelry-loss / bullion-spread)

# ─── Debt MF ──────────────────────────────────────────────────────────────────
DEBT_MF_EXIT_LOAD = D("0.01")              # 1% if held <1 year
DEBT_MF_EXIT_LOAD_DAYS = 365

# ─── FD ───────────────────────────────────────────────────────────────────────
FD_DEFAULT_PENALTY_PCT = D("0.01")         # 1% penalty on current balance

# ─── SGB ──────────────────────────────────────────────────────────────────────
SGB_LT_HOLD_DAYS = 365
SGB_EXCHANGE_COST = D("0.005")             # 0.5% on exchange sale

# ─── PPF / EPF lockup ─────────────────────────────────────────────────────────
PPF_PARTIAL_WITHDRAWAL_YEAR = 7
PPF_PREMATURE_CLOSURE_YEAR = 5
PPF_PREMATURE_INTEREST_PENALTY = D("0.01")  # 1% rate reduction retrospectively
EPF_FULL_WITHDRAWAL_SERVICE_YEARS = 5       # tax-free threshold


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


# ═══════════════════════════════════════════════════════════════════════════
# Per-asset proceeds math
# ═══════════════════════════════════════════════════════════════════════════
#
# Each helper returns a ProceedsResult with the same shape so the ranker can
# treat asset types uniformly. India-only for v1; US path is a stub.
# ═══════════════════════════════════════════════════════════════════════════


@dataclass
class ProceedsResult:
    """Net cash from liquidating a single asset, with full breakdown."""
    asset_label: str
    asset_type: str
    gross_proceeds: Decimal
    tax_owed: Decimal
    penalty: Decimal
    transaction_costs: Decimal
    net_proceeds: Decimal
    explanation: str
    is_blocked: bool = False         # True ⇒ recommend never surfaces it
    block_reason: str = ""
    caveats: list[str] = field(default_factory=list)


def _holding_days(asset: Asset, today: date) -> int:
    return (today - asset.purchase_date).days


def _years_held(asset: Asset, today: date) -> int:
    return _holding_days(asset, today) // 365


def _proceeds_savings(asset: Asset) -> ProceedsResult:
    """Cash in SB/CA — no tax, no penalty, no transaction cost."""
    val = asset.current_market_value
    return ProceedsResult(
        asset_label=asset.label or "Savings balance",
        asset_type=asset.asset_type,
        gross_proceeds=val,
        tax_owed=D("0"),
        penalty=D("0"),
        transaction_costs=D("0"),
        net_proceeds=val,
        explanation=(
            f"Just transfer the ₹{val:,.0f} from your savings — no tax, no penalty. "
            f"You'll lose the {lookup_asset_return('savings_balance')*100:.1f}% interest "
            f"this balance was earning."
        ),
    )


def _proceeds_fd(asset: Asset, today: date) -> ProceedsResult:
    """FD broken before maturity — pay penalty (typically 1%) on principal.

    Simplification: penalty modelled as flat % of current balance. Real banks
    re-price interest to the (lower) rate that applied for the actual period
    held — we approximate that loss with the headline 1% which is the typical
    range. User can override via asset.fd_premature_penalty_pct.
    """
    val = asset.current_market_value
    penalty_pct = asset.fd_premature_penalty_pct or FD_DEFAULT_PENALTY_PCT
    penalty = val * penalty_pct

    matures = asset.fd_maturity_date
    months_to_maturity = (
        (matures - today).days // 30 if matures and matures > today else 0
    )

    caveats = []
    if months_to_maturity > 0:
        caveats.append(
            f"FD matures in ~{months_to_maturity} months — breaking now forfeits "
            f"the higher contracted rate; bank pays interest at the rate that "
            f"applied for the period actually held."
        )

    fd_rate = asset.fd_rate_pct or lookup_asset_return("fixed_deposit")
    return ProceedsResult(
        asset_label=asset.label or "Fixed deposit",
        asset_type=asset.asset_type,
        gross_proceeds=val,
        tax_owed=D("0"),       # interest is taxed at slab via TDS, already accrued
        penalty=penalty,
        transaction_costs=D("0"),
        net_proceeds=val - penalty,
        explanation=(
            f"Break the ₹{val:,.0f} FD. Penalty is ~₹{penalty:,.0f} "
            f"({penalty_pct*100:.1f}% of balance). You give up the "
            f"{fd_rate*100:.1f}% interest this FD was earning."
        ),
        caveats=caveats,
    )


def _equity_tax(gain: Decimal, holding_days: int, taxable_income: Decimal) -> Decimal:
    """Tax on listed-equity sale: STCG 20% or LTCG 12.5% above ₹1.25L exemption.

    Surcharge capped at 15% for equity (§111A / §112A). Cess 4%.
    """
    if gain <= 0:
        return D("0")
    if holding_days < EQUITY_LT_HOLD_DAYS:
        base_tax = gain * EQUITY_STCG_RATE
    else:
        taxable_gain = max(D("0"), gain - EQUITY_LTCG_EXEMPTION)
        base_tax = taxable_gain * EQUITY_LTCG_RATE

    surcharge = min(surcharge_rate(taxable_income, is_ltcg=True), EQUITY_SURCHARGE_CAP)
    return base_tax * (D("1") + surcharge) * (D("1") + CESS_RATE)


def _proceeds_equity(
    asset: Asset, today: date, taxable_income: Decimal
) -> ProceedsResult:
    """Listed equity (stocks/MF) — STCG 20% or LTCG 12.5% above ₹1.25L."""
    val = asset.current_market_value
    days_held = _holding_days(asset, today)
    is_lt = days_held >= EQUITY_LT_HOLD_DAYS

    transaction_costs = val * (EQUITY_STT_RATE + EQUITY_BROKERAGE)
    gross = val - transaction_costs
    gain = max(D("0"), gross - asset.purchase_price)
    tax = _equity_tax(gain, days_held, taxable_income)

    is_mf = asset.asset_type == "equity_mf"
    label_type = "equity MF" if is_mf else "equity stocks"
    period = "long-term" if is_lt else "short-term"
    rate_used = "12.5% (LTCG over ₹1.25L exemption)" if is_lt else "20% (STCG)"

    return ProceedsResult(
        asset_label=asset.label or label_type.capitalize(),
        asset_type=asset.asset_type,
        gross_proceeds=gross,
        tax_owed=tax,
        penalty=D("0"),
        transaction_costs=transaction_costs,
        net_proceeds=gross - tax,
        explanation=(
            f"Sell ₹{val:,.0f} of {label_type}. Held {days_held // 30} months "
            f"({period}). Capital gain ≈ ₹{gain:,.0f}, taxed at {rate_used} → "
            f"~₹{tax:,.0f}. After STT + brokerage you net ₹{gross - tax:,.0f}."
        ),
        caveats=(
            ["LTCG exemption (₹1.25L/yr) may already be partially used elsewhere — "
             "actual tax could be higher."]
            if is_lt and gain > 0 else []
        ),
    )


def _proceeds_debt_mf(
    asset: Asset, today: date, marginal_rate: Decimal
) -> ProceedsResult:
    """Debt MF (post-Apr-2023 units) — entire gain at slab; 1% exit load if <1yr."""
    val = asset.current_market_value
    days_held = _holding_days(asset, today)
    exit_load = (
        val * DEBT_MF_EXIT_LOAD if days_held < DEBT_MF_EXIT_LOAD_DAYS else D("0")
    )
    gross = val - exit_load
    gain = max(D("0"), gross - asset.purchase_price)
    tax = gain * marginal_rate * (D("1") + CESS_RATE)

    return ProceedsResult(
        asset_label=asset.label or "Debt mutual fund",
        asset_type=asset.asset_type,
        gross_proceeds=gross,
        tax_owed=tax,
        penalty=exit_load,
        transaction_costs=D("0"),
        net_proceeds=gross - tax,
        explanation=(
            f"Redeem ₹{val:,.0f} of debt MF. Gain ₹{gain:,.0f} taxed at your "
            f"slab rate {marginal_rate*100:.1f}% (post-Apr-2023 units lose "
            f"indexation) → ~₹{tax:,.0f}."
            + (f" Plus 1% exit load (₹{exit_load:,.0f}) for <1yr hold."
               if exit_load > 0 else "")
        ),
    )


def _proceeds_gold(
    asset: Asset, today: date, taxable_income: Decimal, marginal_rate: Decimal
) -> ProceedsResult:
    """Physical gold — ST<24mo at slab; LT 12.5% flat post-Budget-2024."""
    val = asset.current_market_value
    days_held = _holding_days(asset, today)
    is_lt = days_held >= GOLD_LT_HOLD_DAYS

    transaction_costs = val * GOLD_TRANSACTION_COST
    gross = val - transaction_costs
    gain = max(D("0"), gross - asset.purchase_price)

    if is_lt:
        # Post-Budget-2024 (Finance Act 2024): flat 12.5% no indexation
        base_tax = gain * LTCG_FLAT_RATE_POST_2024
        surcharge = min(surcharge_rate(taxable_income, is_ltcg=True), LTCG_SURCHARGE_CAP)
        tax = base_tax * (D("1") + surcharge) * (D("1") + CESS_RATE)
        rate_used = "12.5% LTCG (flat, no indexation)"
    else:
        tax = gain * marginal_rate * (D("1") + CESS_RATE)
        rate_used = f"slab rate {marginal_rate*100:.1f}% (STCG)"

    return ProceedsResult(
        asset_label=asset.label or "Physical gold",
        asset_type=asset.asset_type,
        gross_proceeds=gross,
        tax_owed=tax,
        penalty=D("0"),
        transaction_costs=transaction_costs,
        net_proceeds=gross - tax,
        explanation=(
            f"Sell ₹{val:,.0f} of gold (held {days_held // 30} months). "
            f"~3% transaction friction (making-charge / spread), then ~₹{tax:,.0f} "
            f"tax at {rate_used} on the ₹{gain:,.0f} gain."
        ),
        caveats=[
            "Gold transaction cost varies 0.5% (digital/bullion) to 10% (jewelry "
            "making-charge loss) — using a 3% blended assumption."
        ],
    )


def _proceeds_sgb(
    asset: Asset, today: date, taxable_income: Decimal, marginal_rate: Decimal
) -> ProceedsResult:
    """Sovereign Gold Bond — fully tax-free at maturity; LTCG 12.5% on early sale."""
    val = asset.current_market_value
    days_held = _holding_days(asset, today)

    if asset.sgb_at_maturity:
        return ProceedsResult(
            asset_label=asset.label or "Sovereign Gold Bond (at maturity)",
            asset_type=asset.asset_type,
            gross_proceeds=val,
            tax_owed=D("0"),
            penalty=D("0"),
            transaction_costs=D("0"),
            net_proceeds=val,
            explanation=(
                f"Redeem SGB at maturity — proceeds ₹{val:,.0f} are fully "
                f"tax-free under §47(viic). No transaction cost from RBI redemption."
            ),
        )

    is_lt = days_held >= SGB_LT_HOLD_DAYS
    transaction_costs = val * SGB_EXCHANGE_COST
    gross = val - transaction_costs
    gain = max(D("0"), gross - asset.purchase_price)

    if is_lt:
        base_tax = gain * LTCG_FLAT_RATE_POST_2024
        surcharge = min(surcharge_rate(taxable_income, is_ltcg=True), LTCG_SURCHARGE_CAP)
        tax = base_tax * (D("1") + surcharge) * (D("1") + CESS_RATE)
    else:
        tax = gain * marginal_rate * (D("1") + CESS_RATE)

    return ProceedsResult(
        asset_label=asset.label or "Sovereign Gold Bond",
        asset_type=asset.asset_type,
        gross_proceeds=gross,
        tax_owed=tax,
        penalty=D("0"),
        transaction_costs=transaction_costs,
        net_proceeds=gross - tax,
        explanation=(
            f"Sell SGB on exchange (not at maturity). Held {days_held // 30} months, "
            f"~0.5% exchange spread, then ₹{tax:,.0f} tax on the ₹{gain:,.0f} gain. "
            f"You give up the 2.5% semi-annual coupon."
        ),
        caveats=[
            "If you can wait until the 8-year maturity, redemption is fully "
            "tax-free — usually the better play unless debt is very expensive."
        ],
    )


def _proceeds_real_estate(
    asset: Asset, taxable_income: Decimal, state: Optional[str]
) -> ProceedsResult:
    """Real estate — defers to existing india_ltcg_tax for LTCG (handles the
    Finance Act 2024 pre/post split). Holds <24mo treated at slab — we surface
    that as a caveat but still compute the gain.
    """
    if not state:
        # Without state we can't compute stamp duty / brokerage — flag as blocked
        return ProceedsResult(
            asset_label=asset.label or "Real estate",
            asset_type=asset.asset_type,
            gross_proceeds=asset.current_market_value,
            tax_owed=D("0"),
            penalty=D("0"),
            transaction_costs=D("0"),
            net_proceeds=asset.current_market_value,
            explanation="Real-estate proceeds need a state for stamp-duty math.",
            is_blocked=True,
            block_reason="Set asset.state to enable real-estate liquidation math.",
        )

    purchase_fy = _to_fy(asset.purchase_date) if asset.purchase_date else None
    current_fy = _to_fy(date.today())

    try:
        net, tax = india_ltcg_tax(
            asset,
            sale_price=asset.current_market_value,
            state=state,
            taxable_income=taxable_income,
            purchase_fy=purchase_fy,
            current_fy=current_fy,
        )
    except (KeyError, ValueError) as e:
        return ProceedsResult(
            asset_label=asset.label or "Real estate",
            asset_type=asset.asset_type,
            gross_proceeds=asset.current_market_value,
            tax_owed=D("0"),
            penalty=D("0"),
            transaction_costs=D("0"),
            net_proceeds=asset.current_market_value,
            explanation="Couldn't compute LTCG — missing CII data.",
            is_blocked=True,
            block_reason=str(e),
        )

    selling_pct = india_selling_cost_pct(state)
    transaction_costs = asset.current_market_value * selling_pct

    return ProceedsResult(
        asset_label=asset.label or f"Real estate ({state})",
        asset_type=asset.asset_type,
        gross_proceeds=asset.current_market_value - transaction_costs,
        tax_owed=tax,
        penalty=D("0"),
        transaction_costs=transaction_costs,
        net_proceeds=net,
        explanation=(
            f"Sell property at ₹{asset.current_market_value:,.0f}. Stamp duty + "
            f"registration + brokerage ≈ {selling_pct*100:.1f}% (₹{transaction_costs:,.0f}). "
            f"After LTCG of ₹{tax:,.0f}, you net ₹{net:,.0f}."
        ),
        caveats=[
            "Property sales take 3-6 months on average — proceeds aren't immediate.",
            "You may qualify for §54/54EC exemptions if reinvesting in property "
            "or NHAI/REC bonds — consult a CA before paying the LTCG.",
        ],
    )


def _proceeds_ppf(asset: Asset, today: date) -> ProceedsResult:
    """PPF — locked 15y; partial withdrawal year 7; premature closure year 5 w/ 1% rate cut.

    Default stance: block in v1. Tax-free 7.1% beats almost any debt post-shield.
    """
    val = asset.current_market_value
    opened = asset.ppf_opened_date

    if not opened:
        return ProceedsResult(
            asset_label=asset.label or "PPF",
            asset_type=asset.asset_type,
            gross_proceeds=val,
            tax_owed=D("0"),
            penalty=D("0"),
            transaction_costs=D("0"),
            net_proceeds=val,
            explanation="PPF account opening date missing — can't model lockup.",
            is_blocked=True,
            block_reason="Add ppf_opened_date to model PPF liquidation.",
        )

    years_in = (today - opened).days // 365
    if years_in < PPF_PREMATURE_CLOSURE_YEAR:
        return ProceedsResult(
            asset_label=asset.label or "PPF",
            asset_type=asset.asset_type,
            gross_proceeds=val,
            tax_owed=D("0"),
            penalty=D("0"),
            transaction_costs=D("0"),
            net_proceeds=val,
            explanation=(
                f"PPF locked for {PPF_PREMATURE_CLOSURE_YEAR}+ years — "
                f"you're {years_in}y in. No withdrawal path."
            ),
            is_blocked=True,
            block_reason=f"PPF lockup ({years_in}/{PPF_PREMATURE_CLOSURE_YEAR}y minimum)",
        )

    return ProceedsResult(
        asset_label=asset.label or "PPF",
        asset_type=asset.asset_type,
        gross_proceeds=val,
        tax_owed=D("0"),
        penalty=D("0"),
        transaction_costs=D("0"),
        net_proceeds=val,
        explanation=(
            f"PPF allows partial withdrawal from year 7, and premature closure "
            f"after year 5 only for medical emergency / higher education / NRI "
            f"status change. Even when accessible, the 7.1% tax-free return "
            f"beats almost every post-shield debt rate — recommend keeping."
        ),
        is_blocked=True,
        block_reason="PPF returns 7.1% tax-free; access paths exist (year-7 "
                     "partial withdrawal, year-5 premature closure for specific "
                     "reasons) but the math almost never favours breaking it.",
    )


def _proceeds_epf(asset: Asset) -> ProceedsResult:
    """EPF — withdrawal paths exist (full on retirement age 55+ or 2 months
    unemployed; partial for housing/medical/marriage/education) but blocked by
    default in the advisor because 8.25% tax-free is rarely worth breaking."""
    return ProceedsResult(
        asset_label=asset.label or "EPF",
        asset_type=asset.asset_type,
        gross_proceeds=asset.current_market_value,
        tax_owed=D("0"),
        penalty=D("0"),
        transaction_costs=D("0"),
        net_proceeds=asset.current_market_value,
        explanation=(
            "EPF withdrawal paths: full on retirement (age 55+) or after 2 "
            "months unemployed; partial for housing / medical / marriage / "
            "education. Tax-free if continuous service ≥ 5y, else slab + 10% TDS."
        ),
        is_blocked=True,
        block_reason="EPF returns 8.25% tax-free (post 5y service); access paths "
                     "exist but the math almost never favours breaking it.",
    )


def _proceeds_nps(asset: Asset) -> ProceedsResult:
    """NPS Tier-1 — heavily restricted. Block in v1."""
    return ProceedsResult(
        asset_label=asset.label or "NPS",
        asset_type=asset.asset_type,
        gross_proceeds=asset.current_market_value,
        tax_owed=D("0"),
        penalty=D("0"),
        transaction_costs=D("0"),
        net_proceeds=asset.current_market_value,
        explanation="NPS Tier-1 has heavy withdrawal restrictions before age 60.",
        is_blocked=True,
        block_reason="NPS Tier-1: max 20% pre-60 withdrawal, 80% must annuitise.",
    )


# ─── US per-asset helpers ────────────────────────────────────────────────────


def _proceeds_us_savings(asset: Asset) -> ProceedsResult:
    """HYSA / checking — no tax to liquidate (interest taxed as you earn it)."""
    val = asset.current_market_value
    return ProceedsResult(
        asset_label=asset.label or "Savings (HYSA)",
        asset_type=asset.asset_type,
        gross_proceeds=val,
        tax_owed=D("0"),
        penalty=D("0"),
        transaction_costs=D("0"),
        net_proceeds=val,
        explanation=(
            f"Move ${val:,.0f} from your HYSA — no tax or penalty. You'll lose "
            f"the ~4% interest this was earning."
        ),
    )


def _proceeds_us_cd(asset: Asset, today: date) -> ProceedsResult:
    """CD broken before maturity — typically 3-6 months of interest as penalty."""
    val = asset.current_market_value
    penalty_pct = (
        asset.fd_premature_penalty_pct
        if asset.fd_premature_penalty_pct
        and asset.fd_premature_penalty_pct != FD_DEFAULT_PENALTY_PCT
        else US_CD_EARLY_WITHDRAWAL_PENALTY_PCT
    )
    penalty = val * penalty_pct
    matures = asset.fd_maturity_date
    months_to_maturity = (
        (matures - today).days // 30 if matures and matures > today else 0
    )
    caveats = []
    if months_to_maturity > 0:
        caveats.append(
            f"CD matures in ~{months_to_maturity} months — breaking now forfeits "
            f"the contracted rate and pays the early-withdrawal penalty."
        )
    return ProceedsResult(
        asset_label=asset.label or "Certificate of Deposit",
        asset_type=asset.asset_type,
        gross_proceeds=val,
        tax_owed=D("0"),       # interest taxed on 1099-INT as you earn it
        penalty=penalty,
        transaction_costs=D("0"),
        net_proceeds=val - penalty,
        explanation=(
            f"Break the ${val:,.0f} CD. Early-withdrawal penalty is ~${penalty:,.0f} "
            f"({penalty_pct*100:.1f}% — roughly 3-6 months of interest)."
        ),
        caveats=caveats,
    )


def _us_cap_gains_helpers(
    val: Decimal, cost_basis: Decimal, asset: Asset, today: date,
    taxable_income: Decimal, filing_status: FilingStatusUS,
    state_marginal_rate: Decimal,
    transaction_costs: Decimal, is_collectible: bool = False,
) -> tuple[Decimal, Decimal, int, bool]:
    """Returns (gross_proceeds, tax, days_held, is_lt) for a US capital-gains sale."""
    gross = val - transaction_costs
    gain = max(D("0"), gross - cost_basis)
    days_held = (today - asset.purchase_date).days
    tax = us_capital_gains_tax(
        gain=gain,
        holding_days=days_held,
        taxable_income=taxable_income,
        filing_status=filing_status,
        state_marginal_rate=state_marginal_rate,
        is_collectible=is_collectible,
    )
    return gross, tax, days_held, days_held > 365


def _proceeds_us_equity(
    asset: Asset, today: date, taxable_income: Decimal,
    filing_status: FilingStatusUS, state_marginal_rate: Decimal,
) -> ProceedsResult:
    """US stocks / mutual funds / index funds — STCG ordinary / LTCG 0/15/20%."""
    val = asset.current_market_value
    transaction_costs = val * D("0.001")     # most brokers: $0 commission, slippage
    gross, tax, days_held, is_lt = _us_cap_gains_helpers(
        val, asset.purchase_price, asset, today, taxable_income,
        filing_status, state_marginal_rate, transaction_costs,
    )
    period = "long-term" if is_lt else "short-term"
    rate_note = (
        "0/15/20% bracket + 3.8% NIIT if applicable + state"
        if is_lt
        else "ordinary income rates + state"
    )
    return ProceedsResult(
        asset_label=asset.label or "US equity",
        asset_type=asset.asset_type,
        gross_proceeds=gross,
        tax_owed=tax,
        penalty=D("0"),
        transaction_costs=transaction_costs,
        net_proceeds=gross - tax,
        explanation=(
            f"Sell ${val:,.0f} of equity. Held {days_held // 30} months ({period}). "
            f"Tax: {rate_note} → ~${tax:,.0f}. Net ${gross - tax:,.0f}."
        ),
        caveats=(
            ["Wash sale rule: don't re-buy substantially identical security "
             "within 30 days or the loss/gain treatment changes."]
            if not is_lt else []
        ),
    )


def _proceeds_us_debt_fund(
    asset: Asset, today: date, taxable_income: Decimal,
    filing_status: FilingStatusUS, state_marginal_rate: Decimal,
) -> ProceedsResult:
    """US bond funds / debt MFs — STCG ordinary / LTCG 0/15/20%. Same shape as equity
    but the helper exists separately for future muni-bond / treasury specialisation."""
    val = asset.current_market_value
    transaction_costs = val * D("0.001")
    gross, tax, days_held, is_lt = _us_cap_gains_helpers(
        val, asset.purchase_price, asset, today, taxable_income,
        filing_status, state_marginal_rate, transaction_costs,
    )
    return ProceedsResult(
        asset_label=asset.label or "US bond fund",
        asset_type=asset.asset_type,
        gross_proceeds=gross,
        tax_owed=tax,
        penalty=D("0"),
        transaction_costs=transaction_costs,
        net_proceeds=gross - tax,
        explanation=(
            f"Redeem ${val:,.0f} of bond fund. "
            f"{'Long-term' if is_lt else 'Short-term'} gains; tax ~${tax:,.0f}."
        ),
        caveats=[
            "Muni-bond tax-exemption not modelled — if these are tax-exempt "
            "municipals, override the marginal rate."
        ],
    )


def _proceeds_us_gold(
    asset: Asset, today: date, taxable_income: Decimal,
    filing_status: FilingStatusUS, state_marginal_rate: Decimal,
) -> ProceedsResult:
    """US gold (physical or ETF like GLD) — collectible, LTCG capped at 28%."""
    val = asset.current_market_value
    transaction_costs = val * GOLD_TRANSACTION_COST
    gross, tax, days_held, is_lt = _us_cap_gains_helpers(
        val, asset.purchase_price, asset, today, taxable_income,
        filing_status, state_marginal_rate, transaction_costs,
        is_collectible=True,
    )
    return ProceedsResult(
        asset_label=asset.label or "Physical gold",
        asset_type=asset.asset_type,
        gross_proceeds=gross,
        tax_owed=tax,
        penalty=D("0"),
        transaction_costs=transaction_costs,
        net_proceeds=gross - tax,
        explanation=(
            f"Sell ${val:,.0f} of gold (held {days_held // 30} months). "
            f"Gold is a 'collectible' under §1(h)(4) — LTCG rate is capped at "
            f"28%, not the usual 15/20%. After ~3% transaction friction and "
            f"~${tax:,.0f} tax, you net ${gross - tax:,.0f}."
        ),
        caveats=[
            "GLD and similar grantor-trust ETFs are also treated as collectibles. "
            "Gold-mining stocks are NOT — those follow normal equity LTCG rates."
        ],
    )


def _proceeds_us_real_estate(
    asset: Asset, today: date, taxable_income: Decimal,
    filing_status: FilingStatusUS, state_marginal_rate: Decimal,
) -> ProceedsResult:
    """US real estate — §121 primary-residence exclusion if eligible; else LTCG."""
    val = asset.current_market_value
    selling_pct = us_real_estate_selling_cost_pct(asset.state or "")
    transaction_costs = val * selling_pct
    gross = val - transaction_costs
    gain = max(D("0"), gross - asset.purchase_price)
    days_held = (today - asset.purchase_date).days

    exclusion_applied = D("0")
    if asset.us_section_121_eligible:
        exclusion = (
            SECTION_121_EXCLUSION_MFJ
            if filing_status == FilingStatusUS.MFJ
            else SECTION_121_EXCLUSION_SINGLE
        )
        exclusion_applied = min(gain, exclusion)
        gain_after_121 = gain - exclusion_applied
    else:
        gain_after_121 = gain

    tax = us_capital_gains_tax(
        gain=gain_after_121,
        holding_days=days_held,
        taxable_income=taxable_income,
        filing_status=filing_status,
        state_marginal_rate=state_marginal_rate,
        is_collectible=False,
    )

    s121_note = (
        f" §121 exclusion of ${exclusion_applied:,.0f} applied (primary residence)."
        if exclusion_applied > 0 else ""
    )
    return ProceedsResult(
        asset_label=asset.label or "US real estate",
        asset_type=asset.asset_type,
        gross_proceeds=gross,
        tax_owed=tax,
        penalty=D("0"),
        transaction_costs=transaction_costs,
        net_proceeds=gross - tax,
        explanation=(
            f"Sell property at ${val:,.0f}. Agent commission + closing costs "
            f"~{selling_pct*100:.1f}% (${transaction_costs:,.0f}).{s121_note} "
            f"After ~${tax:,.0f} capital-gains tax, you net ${gross - tax:,.0f}."
        ),
        caveats=[
            "Property sales typically take 60-90 days to close.",
            "§1031 like-kind exchange could defer the gain entirely if reinvesting "
            "in another investment property — consult a CPA before paying.",
        ] + (
            ["§121 exclusion needs 2-of-last-5 years primary residence — verify "
             "you actually qualify before relying on this number."]
            if asset.us_section_121_eligible else []
        ),
    )


def _proceeds_us_retirement_blocked(asset: Asset, label: str) -> ProceedsResult:
    """401(k) / IRA / Roth — withdrawals before 59½ trigger 10% penalty + ordinary
    income tax. Treat as blocked in v1 (detailed rules for traditional vs Roth,
    rule-of-55, SEPP/72(t), hardship withdrawal all deferred)."""
    return ProceedsResult(
        asset_label=asset.label or label,
        asset_type=asset.asset_type,
        gross_proceeds=asset.current_market_value,
        tax_owed=D("0"),
        penalty=D("0"),
        transaction_costs=D("0"),
        net_proceeds=asset.current_market_value,
        explanation=(
            "US retirement-account withdrawals before age 59½ usually trigger "
            "a 10% additional tax plus ordinary income tax. Exceptions exist "
            "(Rule of 55 for 401(k), SEPP/72(t), Roth contributions, hardship) "
            "but they're case-specific."
        ),
        is_blocked=True,
        block_reason="US retirement-account math (Traditional vs Roth × 401k vs "
                     "IRA × age × hardship) deferred — almost never worth the "
                     "10% penalty + tax acceleration.",
    )


def _proceeds_us_unsupported(asset: Asset, label: str) -> ProceedsResult:
    """Asset types that don't exist in the US (e.g. SGB)."""
    return ProceedsResult(
        asset_label=asset.label or label,
        asset_type=asset.asset_type,
        gross_proceeds=asset.current_market_value,
        tax_owed=D("0"),
        penalty=D("0"),
        transaction_costs=D("0"),
        net_proceeds=asset.current_market_value,
        explanation=f"{label} doesn't exist as an asset class in the US.",
        is_blocked=True,
        block_reason=f"{label} is India-specific.",
    )


def _compute_liquidation_proceeds_us(
    asset: Asset, today: date, taxable_income: Decimal,
    filing_status: FilingStatusUS, state_marginal_rate: Decimal,
) -> ProceedsResult:
    at = asset.asset_type
    if at == "savings_balance":
        return _proceeds_us_savings(asset)
    if at == "fixed_deposit":           # CD analog
        return _proceeds_us_cd(asset, today)
    if at in ("equity_stocks", "equity_mf"):
        return _proceeds_us_equity(
            asset, today, taxable_income, filing_status, state_marginal_rate,
        )
    if at == "debt_mf":
        return _proceeds_us_debt_fund(
            asset, today, taxable_income, filing_status, state_marginal_rate,
        )
    if at == "gold_physical":
        return _proceeds_us_gold(
            asset, today, taxable_income, filing_status, state_marginal_rate,
        )
    if at == "real_estate":
        return _proceeds_us_real_estate(
            asset, today, taxable_income, filing_status, state_marginal_rate,
        )
    if at == "sgb":
        return _proceeds_us_unsupported(asset, "Sovereign Gold Bond")
    if at == "ppf":
        return _proceeds_us_unsupported(asset, "PPF")
    if at in ("epf", "nps"):
        return _proceeds_us_retirement_blocked(asset, at.upper())
    # Generic "other"
    return ProceedsResult(
        asset_label=asset.label or "Unknown asset",
        asset_type=asset.asset_type,
        gross_proceeds=asset.current_market_value,
        tax_owed=D("0"),
        penalty=D("0"),
        transaction_costs=D("0"),
        net_proceeds=asset.current_market_value,
        explanation="Unknown asset type — assuming no tax or penalty.",
        caveats=["Tax treatment for this asset type isn't modelled."],
    )


def _to_fy(d: date) -> str:
    """Calendar date → India FY string ('2024-25')."""
    y = d.year
    if d.month >= 4:                       # Apr-Mar FY
        return f"{y}-{str(y + 1)[-2:]}"
    return f"{y - 1}-{str(y)[-2:]}"


def compute_liquidation_proceeds(
    asset: Asset,
    today: date,
    country: Country = Country.IN,
    taxable_income: Decimal = D("1200000"),
    marginal_rate: Decimal = D("0.30"),
    state: Optional[str] = None,
    filing_status: FilingStatusUS = FilingStatusUS.SINGLE,
    state_marginal_rate: Decimal = D("0"),
) -> ProceedsResult:
    """Dispatch to per-asset-type proceeds math. Always returns ProceedsResult.

    Blocked assets (PPF, EPF, NPS, US retirement, US unsupported) return
    is_blocked=True; the ranker surfaces them under "considered but didn't
    recommend" rather than as moves.

    `filing_status` and `state_marginal_rate` are only consulted for US
    residents; ignored for India.
    """
    if country == Country.US:
        return _compute_liquidation_proceeds_us(
            asset, today, taxable_income, filing_status, state_marginal_rate,
        )

    at = asset.asset_type
    if at == "savings_balance":
        return _proceeds_savings(asset)
    if at == "fixed_deposit":
        return _proceeds_fd(asset, today)
    if at in ("equity_stocks", "equity_mf"):
        return _proceeds_equity(asset, today, taxable_income)
    if at == "debt_mf":
        return _proceeds_debt_mf(asset, today, marginal_rate)
    if at == "gold_physical":
        return _proceeds_gold(asset, today, taxable_income, marginal_rate)
    if at == "sgb":
        return _proceeds_sgb(asset, today, taxable_income, marginal_rate)
    if at == "real_estate":
        return _proceeds_real_estate(asset, taxable_income, state or asset.state)
    if at == "ppf":
        return _proceeds_ppf(asset, today)
    if at == "epf":
        return _proceeds_epf(asset)
    if at == "nps":
        return _proceeds_nps(asset)

    # Unknown / "other" — pass through with no tax/penalty assumption
    return ProceedsResult(
        asset_label=asset.label or "Unknown asset",
        asset_type=asset.asset_type,
        gross_proceeds=asset.current_market_value,
        tax_owed=D("0"),
        penalty=D("0"),
        transaction_costs=D("0"),
        net_proceeds=asset.current_market_value,
        explanation="Unknown asset type — assuming no tax or penalty.",
        caveats=["Tax treatment for this asset type isn't modelled; treat the "
                 "above number as a rough upper bound."],
    )


# ═══════════════════════════════════════════════════════════════════════════
# Portfolio ranker — loops over (asset, debt) pairs
# ═══════════════════════════════════════════════════════════════════════════


@dataclass
class LiquidationRecommendation:
    """A single (asset → debt) liquidation move with its full case."""
    asset_index: int
    asset_label: str
    asset_type: str
    target_loan_index: int
    target_loan_label: str
    proceeds: ProceedsResult
    debt_balance: Decimal
    debt_effective_rate: Decimal
    debt_cleared_amount: Decimal
    interest_saved_yr1_nominal: Decimal
    asset_return_pct: Decimal
    holding_cost_given_up_yr1: Decimal
    net_annual_benefit_nominal: Decimal
    net_annual_benefit_real: Decimal
    verdict: str                            # "clear_win" | "conditional" | "marginal" | "dont_sell"
    gates: dict                              # full gate_check output
    skip_reason: Optional[str] = None        # set if pre-filter or block tripped


def _verdict_for(
    net_annual_benefit: Decimal,
    asset_value: Decimal,
    debt_rate: Decimal,
    high_rate_threshold: Decimal,
) -> str:
    """Bucket benefit + debt rate into a four-tier verdict label."""
    if net_annual_benefit <= 0:
        return "dont_sell"
    ratio = net_annual_benefit / asset_value if asset_value > 0 else D("0")
    if debt_rate >= high_rate_threshold and ratio >= D("0.10"):
        return "clear_win"
    if ratio >= D("0.05"):
        return "conditional"
    return "marginal"


def rank_liquidations(
    user: User,
    debt_effective_rates: dict[int, Decimal],
    today: Optional[date] = None,
    inflation: Optional[Decimal] = None,
    marginal_rate: Decimal = D("0.30"),
    high_rate_threshold: Decimal = D("0.20"),
    horizon_years: Decimal = D("5"),
    surplus_reinvestment_yield: Decimal = D("0.07"),
    pre_filter_margin: Decimal = D("0.01"),
    state: Optional[str] = None,
) -> dict:
    """Loop every (asset, debt) pair → return ranked recommendations.

    Pre-filter (cheap): skip pair if debt_eff < asset_nominal_return + margin.
    Otherwise compute proceeds and run Gates 0-3, then bucket the verdict.

    Returns: {
        "recommendations": [...]            # passed pre-filter, sorted desc by net annual benefit
        "considered_but_skipped": [...]     # pre-filter trip or asset blocked
    }
    """
    today = today or date.today()
    inflation = inflation if inflation is not None else user.inflation_rate
    taxable_income = user.annual_income
    country = user.country
    state = state or user.state
    filing_status = user.filing_status or FilingStatusUS.SINGLE
    state_marginal_rate = user.state_marginal_rate

    recommendations: list[LiquidationRecommendation] = []
    skipped: list[LiquidationRecommendation] = []

    for ai, asset in enumerate(user.assets):
        asset_return = asset.expected_return_pct or lookup_asset_return(
            asset.asset_type, country
        )
        proceeds = compute_liquidation_proceeds(
            asset,
            today=today,
            country=country,
            taxable_income=taxable_income,
            marginal_rate=marginal_rate,
            state=state,
            filing_status=filing_status,
            state_marginal_rate=state_marginal_rate,
        )

        for li, loan in enumerate(user.loans):
            debt_eff = debt_effective_rates.get(li)
            if debt_eff is None:
                continue

            loan_label = f"{loan.bank} {loan.loan_type.value}"

            # ─── Pre-filter: skip if debt rate doesn't clear asset return + margin
            threshold = asset_return + pre_filter_margin
            if debt_eff < threshold:
                skipped.append(LiquidationRecommendation(
                    asset_index=ai,
                    asset_label=proceeds.asset_label,
                    asset_type=asset.asset_type,
                    target_loan_index=li,
                    target_loan_label=loan_label,
                    proceeds=proceeds,
                    debt_balance=loan.outstanding,
                    debt_effective_rate=debt_eff,
                    debt_cleared_amount=D("0"),
                    interest_saved_yr1_nominal=D("0"),
                    asset_return_pct=asset_return,
                    holding_cost_given_up_yr1=D("0"),
                    net_annual_benefit_nominal=D("0"),
                    net_annual_benefit_real=D("0"),
                    verdict="dont_sell",
                    gates={},
                    skip_reason=(
                        f"Debt at {debt_eff*100:.1f}% is below this asset's "
                        f"{asset_return*100:.1f}% expected return + "
                        f"{pre_filter_margin*100:.1f}% safety margin — "
                        f"selling would lose money."
                    ),
                ))
                continue

            # ─── Asset blocked (PPF, EPF, etc.) — surface in skipped
            if proceeds.is_blocked:
                skipped.append(LiquidationRecommendation(
                    asset_index=ai,
                    asset_label=proceeds.asset_label,
                    asset_type=asset.asset_type,
                    target_loan_index=li,
                    target_loan_label=loan_label,
                    proceeds=proceeds,
                    debt_balance=loan.outstanding,
                    debt_effective_rate=debt_eff,
                    debt_cleared_amount=D("0"),
                    interest_saved_yr1_nominal=D("0"),
                    asset_return_pct=asset_return,
                    holding_cost_given_up_yr1=D("0"),
                    net_annual_benefit_nominal=D("0"),
                    net_annual_benefit_real=D("0"),
                    verdict="dont_sell",
                    gates={},
                    skip_reason=proceeds.block_reason,
                ))
                continue

            # ─── Full evaluation. Model partial sale: user sells just enough
            # asset value to net the debt balance (sale is partial when the
            # asset is bigger than the debt). Holding cost is on the *sold*
            # portion only — the rest keeps earning at asset_return.
            debt_cleared = min(proceeds.net_proceeds, loan.outstanding)
            if proceeds.net_proceeds > 0:
                asset_value_sold = (
                    debt_cleared * asset.current_market_value / proceeds.net_proceeds
                )
            else:
                asset_value_sold = asset.current_market_value
            interest_saved = debt_cleared * debt_eff
            holding_cost_given_up = asset_value_sold * asset_return
            net_benefit_nominal = interest_saved - holding_cost_given_up

            # Real-benefit: subtract inflation from the asset's nominal return.
            # Captures "what am I really giving up" in today's-rupees terms.
            asset_real_return = asset_return - inflation
            net_benefit_real = interest_saved - asset_value_sold * asset_real_return

            # Run the existing Gate 0-3 check
            selling_cost_pct = (
                (proceeds.transaction_costs + proceeds.tax_owed + proceeds.penalty)
                / asset.current_market_value
                if asset.current_market_value > 0 else D("0")
            )
            net_benefit_one_shot = proceeds.net_proceeds - debt_cleared
            gates = gate_check(
                asset_value=asset.current_market_value,
                net_benefit=net_benefit_one_shot,
                debt_effective_rate=debt_eff,
                asset_nominal_return=asset_return,
                inflation=inflation,
                selling_cost_pct=selling_cost_pct,
                ltcg_effective_rate=D("0"),     # already in selling_cost_pct
                holding_cost_rate=D("0"),
                expected_hold_years_post_sale=horizon_years,
                high_rate_threshold=high_rate_threshold,
                net_proceeds=proceeds.net_proceeds,
                debt_balance=loan.outstanding,
                surplus_reinvestment_yield=surplus_reinvestment_yield,
            )

            verdict = _verdict_for(
                net_benefit_nominal,
                asset.current_market_value,
                debt_eff,
                high_rate_threshold,
            )

            recommendations.append(LiquidationRecommendation(
                asset_index=ai,
                asset_label=proceeds.asset_label,
                asset_type=asset.asset_type,
                target_loan_index=li,
                target_loan_label=loan_label,
                proceeds=proceeds,
                debt_balance=loan.outstanding,
                debt_effective_rate=debt_eff,
                debt_cleared_amount=debt_cleared,
                interest_saved_yr1_nominal=interest_saved,
                asset_return_pct=asset_return,
                holding_cost_given_up_yr1=holding_cost_given_up,
                net_annual_benefit_nominal=net_benefit_nominal,
                net_annual_benefit_real=net_benefit_real,
                verdict=verdict,
                gates=gates,
            ))

    recommendations.sort(key=lambda r: r.net_annual_benefit_nominal, reverse=True)
    return {
        "recommendations": recommendations,
        "considered_but_skipped": skipped,
    }
