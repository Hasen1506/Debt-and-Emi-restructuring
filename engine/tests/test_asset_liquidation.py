"""Asset liquidation §4.18 — Finance Act 2024 LTCG split + gate checks +
per-asset proceeds math + portfolio ranker."""
from datetime import date
from decimal import Decimal
from engine.asset_liquidation import (
    india_ltcg_tax, true_net_benefit, gate_check, LTCG_FLAT_RATE_POST_2024,
    compute_liquidation_proceeds, rank_liquidations,
    ProceedsResult, LiquidationRecommendation,
)
from engine.models import (
    Asset, Loan, LoanType, User, Country, IncomeType, TaxRegimeIN,
)

D = Decimal


def _asset(purchase_date: date, purchase_price: Decimal = D("5000000")) -> Asset:
    return Asset(
        asset_type="real_estate",
        purchase_price=purchase_price,
        purchase_date=purchase_date,
        current_market_value=D("10000000"),
        state="Maharashtra",
    )


def _user(loans: list[Loan], assets: list[Asset]) -> User:
    return User(
        country=Country.IN,
        income_type=IncomeType.SALARIED,
        annual_income=D("1500000"),
        monthly_income=D("125000"),
        fixed_expenses=D("40000"),
        savings_balance=D("100000"),
        primary_bank="HDFC Bank",
        tax_regime=TaxRegimeIN.NEW,
        loans=loans,
        assets=assets,
        inflation_rate=D("0.046"),
    )


def _card(outstanding: Decimal = D("200000"), bank: str = "ICICI") -> Loan:
    return Loan(
        loan_type=LoanType.CREDIT_CARD, bank=bank, outstanding=outstanding,
        nominal_rate=D("0.40"), rate_type="fixed",
        tenure_months_remaining=0, scheduled_emi=D("8000"),
    )


def _home_loan(outstanding: Decimal = D("5000000")) -> Loan:
    return Loan(
        loan_type=LoanType.HOME, bank="SBI", outstanding=outstanding,
        nominal_rate=D("0.085"), rate_type="floating",
        tenure_months_remaining=180, scheduled_emi=D("50000"),
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


# ═══════════════════════════════════════════════════════════════════════════
# Per-asset proceeds math
# ═══════════════════════════════════════════════════════════════════════════


def test_proceeds_savings_no_tax_no_penalty():
    a = Asset(
        asset_type="savings_balance",
        purchase_price=D("0"),
        purchase_date=date(2020, 1, 1),
        current_market_value=D("250000"),
    )
    r = compute_liquidation_proceeds(a, today=date(2026, 5, 16), country=Country.IN)
    assert r.net_proceeds == D("250000")
    assert r.tax_owed == D("0")
    assert r.penalty == D("0")
    assert not r.is_blocked


def test_proceeds_fd_charges_premature_penalty():
    a = Asset(
        asset_type="fixed_deposit",
        purchase_price=D("500000"),
        purchase_date=date(2025, 1, 1),
        current_market_value=D("530000"),       # accrued interest included
        fd_rate_pct=D("0.07"),
        fd_maturity_date=date(2027, 1, 1),
        fd_premature_penalty_pct=D("0.01"),
    )
    r = compute_liquidation_proceeds(a, today=date(2026, 5, 16), country=Country.IN)
    # 1% × 530000 = 5300 penalty
    assert r.penalty == D("5300.00")
    assert r.net_proceeds == D("524700.00")
    # Caveat about pre-maturity should be in there
    assert any("matures" in c for c in r.caveats)


def test_proceeds_equity_lt_uses_125l_exemption():
    """Equity MF held >1yr → LTCG 12.5% above ₹1.25L exemption."""
    a = Asset(
        asset_type="equity_mf",
        purchase_price=D("500000"),
        purchase_date=date(2023, 1, 1),
        current_market_value=D("800000"),       # ₹3L gain, of which ₹1.75L taxable
    )
    r = compute_liquidation_proceeds(
        a, today=date(2026, 5, 16), country=Country.IN,
        taxable_income=D("1500000"),
    )
    # Transaction cost: 800000 × (0.001 + 0.001) = 1600
    # Gross = 798400; cost basis = 500000; gain = 298400
    # Taxable = 298400 - 125000 = 173400; LTCG base = 173400 × 0.125 = 21675
    # Surcharge @ ₹15L income = 0; cess 4% → 21675 × 1.04 = 22542
    assert r.tax_owed > D("22000") and r.tax_owed < D("23000")
    assert r.transaction_costs == D("1600.000")
    assert r.net_proceeds == r.gross_proceeds - r.tax_owed


def test_proceeds_equity_st_at_20pct():
    """Equity held <1yr → STCG 20% on entire gain (no ₹1.25L exemption)."""
    a = Asset(
        asset_type="equity_stocks",
        purchase_price=D("200000"),
        purchase_date=date(2026, 1, 1),          # 4 months held
        current_market_value=D("250000"),
    )
    r = compute_liquidation_proceeds(
        a, today=date(2026, 5, 16), country=Country.IN,
        taxable_income=D("1500000"),
    )
    # Trans cost = 250000 × 0.002 = 500; gross = 249500; gain ≈ 49500
    # STCG: 49500 × 0.20 × 1.04 = 10296
    assert r.tax_owed > D("10000") and r.tax_owed < D("10500")


def test_proceeds_gold_lt_flat_125():
    """Gold held >2yr post-Budget-2024 → flat 12.5% LTCG."""
    a = Asset(
        asset_type="gold_physical",
        purchase_price=D("200000"),
        purchase_date=date(2022, 1, 1),
        current_market_value=D("500000"),
    )
    r = compute_liquidation_proceeds(
        a, today=date(2026, 5, 16), country=Country.IN,
        taxable_income=D("1500000"),
    )
    # Trans cost = 500000 × 0.03 = 15000; gross = 485000; gain = 285000
    # LTCG = 285000 × 0.125 = 35625; cess → 35625 × 1.04 = 37050
    assert r.tax_owed > D("36500") and r.tax_owed < D("37500")
    assert r.transaction_costs == D("15000.00")


def test_proceeds_sgb_at_maturity_tax_free():
    """SGB redeemed at maturity → fully tax-free under §47(viic)."""
    a = Asset(
        asset_type="sgb",
        purchase_price=D("500000"),
        purchase_date=date(2018, 5, 1),
        current_market_value=D("950000"),
        sgb_at_maturity=True,
    )
    r = compute_liquidation_proceeds(a, today=date(2026, 5, 16), country=Country.IN)
    assert r.tax_owed == D("0")
    assert r.transaction_costs == D("0")
    assert r.net_proceeds == D("950000")
    assert "tax-free" in r.explanation


def test_proceeds_ppf_blocked_when_under_5y():
    a = Asset(
        asset_type="ppf",
        purchase_price=D("0"),
        purchase_date=date(2023, 4, 1),
        current_market_value=D("250000"),
        ppf_opened_date=date(2023, 4, 1),
    )
    r = compute_liquidation_proceeds(a, today=date(2026, 5, 16), country=Country.IN)
    assert r.is_blocked
    assert "lockup" in r.block_reason.lower()


def test_proceeds_ppf_still_blocked_after_5y_because_tax_free_return_wins():
    """Even past the 5y lockup, advisor blocks — 7.1% tax-free beats most debts."""
    a = Asset(
        asset_type="ppf",
        purchase_price=D("0"),
        purchase_date=date(2018, 4, 1),
        current_market_value=D("1500000"),
        ppf_opened_date=date(2018, 4, 1),
    )
    r = compute_liquidation_proceeds(a, today=date(2026, 5, 16), country=Country.IN)
    assert r.is_blocked
    assert "7.1%" in r.block_reason


def test_proceeds_epf_blocked():
    a = Asset(
        asset_type="epf",
        purchase_price=D("0"),
        purchase_date=date(2020, 1, 1),
        current_market_value=D("800000"),
    )
    r = compute_liquidation_proceeds(a, today=date(2026, 5, 16), country=Country.IN)
    assert r.is_blocked


def test_proceeds_real_estate_uses_existing_ltcg_path():
    """Real-estate dispatch hands off to india_ltcg_tax. Uses post-Finance-Act-2024
    purchase so CII isn't needed (current-FY CII may not be CBDT-notified yet)."""
    a = _asset(date(2024, 8, 1), purchase_price=D("5000000"))
    r = compute_liquidation_proceeds(
        a, today=date(2026, 5, 16), country=Country.IN,
        taxable_income=D("1500000"), state="Maharashtra",
    )
    assert not r.is_blocked
    assert r.tax_owed > D("0")
    assert r.transaction_costs > D("0")


def test_proceeds_real_estate_blocks_gracefully_when_cii_missing():
    """Pre-Finance-Act property + current FY without CBDT-notified CII →
    blocked with a clear reason, not a crash."""
    a = _asset(date(2015, 6, 1), purchase_price=D("5000000"))
    r = compute_liquidation_proceeds(
        a, today=date(2026, 5, 16), country=Country.IN,
        taxable_income=D("1500000"), state="Maharashtra",
    )
    assert r.is_blocked
    assert "CII" in r.block_reason


def test_proceeds_us_stub_is_blocked():
    a = Asset(
        asset_type="equity_stocks",
        purchase_price=D("10000"),
        purchase_date=date(2020, 1, 1),
        current_market_value=D("20000"),
    )
    r = compute_liquidation_proceeds(a, today=date(2026, 5, 16), country=Country.US)
    assert r.is_blocked
    assert "US" in r.block_reason


# ═══════════════════════════════════════════════════════════════════════════
# Portfolio ranker
# ═══════════════════════════════════════════════════════════════════════════


def test_ranker_pre_filter_skips_low_rate_debt_against_equity():
    """Equity at 11% expected → home loan at 8.5% should be pre-filtered out."""
    equity = Asset(
        asset_type="equity_mf",
        purchase_price=D("500000"),
        purchase_date=date(2023, 1, 1),
        current_market_value=D("800000"),
    )
    user = _user(loans=[_home_loan()], assets=[equity])
    result = rank_liquidations(
        user, debt_effective_rates={0: D("0.06")},   # post-shield home loan
    )
    assert len(result["recommendations"]) == 0
    assert len(result["considered_but_skipped"]) == 1
    assert "below" in result["considered_but_skipped"][0].skip_reason


def test_ranker_recommends_clear_win_for_card_vs_equity():
    """Equity at 11% → credit card at 40% effective: should recommend selling."""
    equity = Asset(
        asset_type="equity_mf",
        purchase_price=D("500000"),
        purchase_date=date(2023, 1, 1),
        current_market_value=D("800000"),
    )
    user = _user(loans=[_card()], assets=[equity])
    result = rank_liquidations(
        user, debt_effective_rates={0: D("0.42")},
    )
    assert len(result["recommendations"]) == 1
    rec = result["recommendations"][0]
    assert rec.verdict in ("clear_win", "conditional")
    assert rec.net_annual_benefit_nominal > 0


def test_ranker_orders_by_net_annual_benefit_desc():
    """Two assets, two debts: top recommendation has highest net annual benefit."""
    equity = Asset(
        asset_type="equity_mf",
        purchase_price=D("500000"),
        purchase_date=date(2023, 1, 1),
        current_market_value=D("800000"),
    )
    fd = Asset(
        asset_type="fixed_deposit",
        purchase_price=D("500000"),
        purchase_date=date(2025, 1, 1),
        current_market_value=D("530000"),
    )
    card_high = Loan(
        loan_type=LoanType.CREDIT_CARD, bank="ICICI",
        outstanding=D("400000"), nominal_rate=D("0.42"), rate_type="fixed",
        tenure_months_remaining=0, scheduled_emi=D("16000"),
    )
    pl = Loan(
        loan_type=LoanType.PERSONAL, bank="HDFC", outstanding=D("300000"),
        nominal_rate=D("0.14"), rate_type="fixed",
        tenure_months_remaining=24, scheduled_emi=D("14500"),
    )
    user = _user(loans=[card_high, pl], assets=[equity, fd])
    result = rank_liquidations(
        user, debt_effective_rates={0: D("0.42"), 1: D("0.14")},
    )
    benefits = [r.net_annual_benefit_nominal for r in result["recommendations"]]
    assert benefits == sorted(benefits, reverse=True)
    # Top should be a card-targeting move
    assert result["recommendations"][0].target_loan_index == 0


def test_ranker_skips_blocked_ppf_into_skipped_bucket():
    """PPF is is_blocked=True; ranker routes it to skipped, not recommendations."""
    ppf = Asset(
        asset_type="ppf",
        purchase_price=D("0"),
        purchase_date=date(2018, 4, 1),
        current_market_value=D("500000"),
        ppf_opened_date=date(2018, 4, 1),
    )
    user = _user(loans=[_card()], assets=[ppf])
    result = rank_liquidations(
        user, debt_effective_rates={0: D("0.42")},
    )
    assert len(result["recommendations"]) == 0
    assert len(result["considered_but_skipped"]) == 1
    skipped = result["considered_but_skipped"][0]
    assert skipped.proceeds.is_blocked
    assert "PPF" in skipped.skip_reason or "7.1%" in skipped.skip_reason


def test_ranker_uses_user_inflation_rate_for_real_benefit():
    """net_annual_benefit_real subtracts inflation from asset return only."""
    equity = Asset(
        asset_type="equity_mf",
        purchase_price=D("500000"),
        purchase_date=date(2023, 1, 1),
        current_market_value=D("800000"),
    )
    user = _user(loans=[_card()], assets=[equity])
    result = rank_liquidations(
        user, debt_effective_rates={0: D("0.42")},
    )
    rec = result["recommendations"][0]
    # Real should be > nominal because we're subtracting inflation from the
    # OPPORTUNITY COST side (asset return), which makes the cost smaller and
    # the net benefit larger.
    assert rec.net_annual_benefit_real > rec.net_annual_benefit_nominal
