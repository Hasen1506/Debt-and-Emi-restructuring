"""Sprint G10: assets expanded and made accurate.

Rules read from the Income-tax Act, 2025 as amended by Finance Act 2026
(https://www.incometaxindia.gov.in/documents/d/guest/income_tax_act_2025_as_amended_by_fa_act_2026-pdf,
read 2026-10-12):
  - s.2(101): short-term = held not more than 24 months; 12 months for a
    security listed in India, a UTI unit, an equity-oriented fund unit or a
    zero-coupon bond. A gold ETF is a listed unit.
  - s.76: a Specified Mutual Fund (over 65% debt) unit bought on or after
    1 Apr 2023 is always short-term (slab rate).
  - s.197: other long-term gains at 12.5%.
  - s.194 Table Sl. No. 4: virtual digital assets at 30%, cost the only deduction.
"""
from datetime import date
from decimal import Decimal

from engine.asset_liquidation import compute_liquidation_proceeds
from engine.models import Asset, AssetType, Country
from engine.tax.india import CESS_RATE

D = Decimal
TODAY = date(2026, 10, 12)


def _a(kind: str, bought: date, cost: str = "100000", value: str = "200000") -> Asset:
    return Asset(asset_type=kind, purchase_price=D(cost), purchase_date=bought, current_market_value=D(value))


def test_new_asset_types_exist():
    assert AssetType("gold_etf") is AssetType.GOLD_ETF
    assert AssetType("crypto") is AssetType.CRYPTO


def test_gold_etf_is_long_term_after_12_months_not_24():
    # 18 months: physical gold is still short-term, a gold ETF is long-term.
    bought = date(2025, 4, 1)
    etf = compute_liquidation_proceeds(_a("gold_etf", bought), TODAY, taxable_income=D("1200000"), marginal_rate=D("0.312"))
    phys = compute_liquidation_proceeds(_a("gold_physical", bought), TODAY, taxable_income=D("1200000"), marginal_rate=D("0.312"))
    gain = D("200000") * (1 - D("0.001")) - D("100000")
    assert etf.tax_owed == gain * D("0.125") * (1 + CESS_RATE)
    assert "12.5%" in etf.explanation
    assert "slab" in phys.explanation or "STCG" in phys.explanation


def test_gold_etf_under_12_months_is_slab():
    r = compute_liquidation_proceeds(_a("gold_etf", date(2026, 1, 1)), TODAY, marginal_rate=D("0.312"))
    gain = D("200000") * (1 - D("0.001")) - D("100000")
    assert r.tax_owed == gain * D("0.312")


def test_debt_fund_bought_after_april_2023_is_slab_however_long_held():
    r = compute_liquidation_proceeds(_a("debt_mf", date(2023, 4, 1)), TODAY, marginal_rate=D("0.312"))
    assert r.tax_owed == D("100000") * D("0.312")
    assert "slab" in r.explanation


def test_debt_fund_bought_before_april_2023_and_held_over_24_months_is_12_5():
    r = compute_liquidation_proceeds(_a("debt_mf", date(2022, 6, 1)), TODAY, taxable_income=D("1200000"), marginal_rate=D("0.312"))
    assert r.tax_owed == D("100000") * D("0.125") * (1 + CESS_RATE)
    assert "12.5%" in r.explanation


def test_crypto_is_30_percent_plus_cess_cost_only():
    r = compute_liquidation_proceeds(_a("crypto", date(2020, 1, 1)), TODAY)
    assert r.tax_owed == D("100000") * D("0.30") * (1 + CESS_RATE)
    assert any("set off" in c for c in r.caveats)
    assert any("TDS" in c for c in r.caveats)


def test_crypto_selling_cost_does_not_reduce_taxed_gain():
    a = _a("crypto", date(2020, 1, 1))
    a.selling_cost_pct = D("0.01")
    r = compute_liquidation_proceeds(a, TODAY)
    assert r.tax_owed == D("100000") * D("0.30") * (1 + CESS_RATE)
    assert r.transaction_costs == D("2000")


def test_us_gold_etf_is_a_collectible_and_us_crypto_follows_capital_gains():
    etf = compute_liquidation_proceeds(_a("gold_etf", date(2020, 1, 1)), TODAY, country=Country.US, taxable_income=D("90000"))
    assert "collectible" in etf.explanation
    coin = compute_liquidation_proceeds(_a("crypto", date(2020, 1, 1)), TODAY, country=Country.US, taxable_income=D("90000"))
    assert coin.tax_owed > 0 and "long-term" in coin.explanation
