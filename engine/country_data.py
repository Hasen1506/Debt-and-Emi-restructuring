"""Country-specific reference data — brainstorm §29 (MAB), §26.1 (stamp duty), §31 (institution tiers).

Stub data, refresh from primary sources (§7.6, §7.7 in design spec). All money in
local currency (₹ for India, $ for US). All rates as decimals.
"""
from decimal import Decimal
from typing import Optional
from engine.models import Country

D = Decimal


# ─────────────────────────────────────────────────────────────────────────────
# India MAB requirements per bank × location tier (brainstorm §29.1)
# ─────────────────────────────────────────────────────────────────────────────

INDIA_MAB = {
    # bank: {"urban": ₹, "semi_urban": ₹, "rural": ₹}
    "SBI":            {"urban": D("3000"),  "semi_urban": D("2000"), "rural": D("1000")},
    "HDFC Bank":      {"urban": D("10000"), "semi_urban": D("5000"), "rural": D("2500")},
    "ICICI Bank":     {"urban": D("10000"), "semi_urban": D("5000"), "rural": D("2000")},
    "Axis Bank":      {"urban": D("10000"), "semi_urban": D("5000"), "rural": D("2500")},
    "Kotak 811":      {"urban": D("0"),     "semi_urban": D("0"),    "rural": D("0")},
    "Kotak Mahindra": {"urban": D("10000"), "semi_urban": D("5000"), "rural": D("2000")},
    "PNB":            {"urban": D("2000"),  "semi_urban": D("1000"), "rural": D("500")},
    "Bank of Baroda": {"urban": D("2000"),  "semi_urban": D("1000"), "rural": D("500")},
    "Canara Bank":    {"urban": D("2500"),  "semi_urban": D("1000"), "rural": D("500")},
    "Yes Bank":       {"urban": D("10000"), "semi_urban": D("5000"), "rural": D("2500")},
    "IDFC First":     {"urban": D("10000"), "semi_urban": D("5000"), "rural": D("2500")},
    "IndusInd Bank":  {"urban": D("10000"), "semi_urban": D("5000"), "rural": D("2500")},
    "RBL Bank":       {"urban": D("5000"),  "semi_urban": D("2500"), "rural": D("1000")},
    "Federal Bank":   {"urban": D("5000"),  "semi_urban": D("2000"), "rural": D("1000")},
}


def lookup_mab(bank: str, location_tier: str = "urban") -> Decimal:
    """Returns MAB requirement in ₹. Unknown bank defaults to ₹0."""
    return INDIA_MAB.get(bank, {}).get(location_tier, D("0"))


# ─────────────────────────────────────────────────────────────────────────────
# India real-estate transaction costs (brainstorm §26.1)
# Stamp duty varies by state; registration is ~1%; brokerage 1–2%.
# Stamp duty and registration are the BUYER's costs (Indian Stamp Act
# 1899 s.29(c): on a conveyance the grantee pays), so a seller only
# loses the broker's fee.
# ─────────────────────────────────────────────────────────────────────────────

INDIA_STAMP_DUTY = {
    "Maharashtra":  D("0.06"),
    "Karnataka":    D("0.0565"),
    "Delhi":        D("0.06"),
    "Tamil Nadu":   D("0.07"),
    "Telangana":    D("0.055"),
    "Gujarat":      D("0.049"),
    "West Bengal":  D("0.07"),
    "Haryana":      D("0.07"),
    "UP":           D("0.07"),
    "Rajasthan":    D("0.06"),
    "Kerala":       D("0.08"),
    "Andhra Pradesh": D("0.075"),
    "Madhya Pradesh": D("0.075"),
    "Punjab":       D("0.06"),
}

INDIA_REGISTRATION_FEE = D("0.01")    # 1% across most states


def lookup_stamp_duty(state: str) -> Decimal:
    """Returns stamp duty rate for the state. Unknown state defaults to 6% (typical)."""
    return INDIA_STAMP_DUTY.get(state, D("0.06"))


def india_buying_cost_pct(state: str) -> Decimal:
    """Buyer's one-time cost as a fraction of the price: stamp duty + 1% registration."""
    return lookup_stamp_duty(state) + INDIA_REGISTRATION_FEE


def india_selling_cost_pct(state: str, brokerage_rate: Decimal = D("0.015")) -> Decimal:
    """Seller's cost as a fraction of the sale value: the broker's fee.

    Stamp duty and registration are paid by the buyer, so they don't come
    off what the seller receives (they used to, which cut a ₹1 crore sale's
    proceeds by ~₹7 lakh). `state` is kept so callers don't change.
    """
    return brokerage_rate


# ─────────────────────────────────────────────────────────────────────────────
# CII table for pre-23-Jul-2024 property indexation (CBDT)
# ─────────────────────────────────────────────────────────────────────────────

CII_TABLE = {
    "2001-02": 100,
    "2002-03": 105,
    "2003-04": 109,
    "2004-05": 113,
    "2005-06": 117,
    "2006-07": 122,
    "2007-08": 129,
    "2008-09": 137,
    "2009-10": 148,
    "2010-11": 167,
    "2011-12": 184,
    "2012-13": 200,
    "2013-14": 220,
    "2014-15": 240,
    "2015-16": 254,
    "2016-17": 264,
    "2017-18": 272,
    "2018-19": 280,
    "2019-20": 289,
    "2020-21": 301,
    "2021-22": 317,
    "2022-23": 331,
    "2023-24": 348,
    "2024-25": 363,    # CBDT notification Aug 2024
    "2025-26": 376,    # CBDT Notification 70/2025, 1 Jul 2025
    "2026-27": 384,    # CBDT notification, gazette 15 Jul 2026
}

# Provisional CII values for FYs whose CBDT notification hasn't landed yet.
# Extrapolated at the last five years' average rise (317 → 384, ~3.9% a
# year); flagged via
# `cii_is_provisional()` so callers render an "estimate, awaiting CBDT
# notification" caveat next to any tax math that relies on them. The
# alternative — raising on missing FY — leaves the portfolio-liquidation
# advisor unable to score pre-23-Jul-2024 real estate during the months the
# notification lags, which is exactly when users are most likely to be
# planning a sale.
PROVISIONAL_CII_TABLE = {
    "2027-28": 399,    # 384 × 1.039. Pending CBDT (usually notified in July).
}


def lookup_cii(fy_string: str, *, allow_provisional: bool = True) -> int:
    """Returns CII index for the given financial year (e.g. '2024-25').

    With `allow_provisional=True` (default), falls back to the extrapolated
    `PROVISIONAL_CII_TABLE` when the FY isn't in the verified set — keeps
    downstream LTCG math working while the CBDT notification lags. Callers
    that need authoritative-only data can pass `allow_provisional=False`
    and let the KeyError propagate.
    """
    if fy_string in CII_TABLE:
        return CII_TABLE[fy_string]
    if allow_provisional and fy_string in PROVISIONAL_CII_TABLE:
        return PROVISIONAL_CII_TABLE[fy_string]
    raise KeyError(f"CII not in table for FY {fy_string}. Refresh from CBDT.")


def cii_is_provisional(fy_string: str) -> bool:
    """True when the CII for `fy_string` is an extrapolated estimate (CBDT
    notification not yet released). UI should surface "indicative" copy
    next to LTCG math relying on this."""
    return fy_string in PROVISIONAL_CII_TABLE


# ─────────────────────────────────────────────────────────────────────────────
# Asset advisor — default nominal expected returns by asset class
# (used by the portfolio liquidation ranker; overridable per-asset by user)
# ─────────────────────────────────────────────────────────────────────────────

ASSET_DEFAULT_RETURNS_IN = {
    "savings_balance": D("0.035"),
    "fixed_deposit":   D("0.07"),     # bank-FD blended; overridden by fd_rate_pct
    "equity_stocks":   D("0.12"),     # 10-yr Nifty CAGR ballpark
    "equity_mf":       D("0.11"),
    "debt_mf":         D("0.07"),
    "gold_physical":   D("0.08"),
    "sgb":             D("0.08"),     # excludes 2.5% semi-annual coupon (added separately if needed)
    "real_estate":     D("0.07"),
    "ppf":             D("0.071"),    # April 2026 notified rate; tax-free
    "epf":             D("0.0825"),   # EPFO declared; tax-free post 5y service
    "nps":             D("0.09"),     # equity-heavy blended
    "other":           D("0.06"),
}

ASSET_DEFAULT_RETURNS_US = {
    "savings_balance": D("0.04"),     # HYSA ballpark
    "fixed_deposit":   D("0.045"),    # CD rate
    "equity_stocks":   D("0.10"),
    "equity_mf":       D("0.09"),
    "debt_mf":         D("0.05"),
    "gold_physical":   D("0.07"),
    "real_estate":     D("0.06"),
    "ppf":             D("0"),         # n/a
    "epf":             D("0"),         # n/a
    "nps":             D("0"),         # n/a
    "sgb":             D("0"),         # n/a
    "other":           D("0.05"),
}


def lookup_asset_return(asset_type: str, country: Country = Country.IN) -> Decimal:
    """Default nominal annual return for an asset class. Unknown → 6% conservative."""
    table = ASSET_DEFAULT_RETURNS_IN if country == Country.IN else ASSET_DEFAULT_RETURNS_US
    return table.get(asset_type, D("0.06"))


def project_future_value(
    current_value: Decimal,
    asset_type: str,
    country: Country,
    months_forward: int,
    user_cagr_override: Optional[Decimal] = None,
) -> Decimal:
    """Compound a holding's current market value forward by `months_forward`
    using the user's per-asset CAGR override when set, falling back to the
    country-default for the asset type. Conservative compounding: monthly
    rate r/12 applied `months_forward` times.

    Used by the goal-achievability tier-3 (will my liquidatable corpus be
    big enough by the target month?) and the portfolio advisor (which of
    these is the best to liquidate next year vs now?).

    Zero months → returns current_value unchanged. Negative cagr → value
    decays. Conservative cap: if the implied rate is > 100%/yr the helper
    still computes — caller is expected to sanity-check the input.
    """
    if months_forward <= 0:
        return current_value
    cagr = user_cagr_override if user_cagr_override is not None else lookup_asset_return(asset_type, country)
    if cagr == 0:
        return current_value
    monthly = cagr / D("12")
    factor = (D("1") + monthly) ** months_forward
    return current_value * factor


# ─── US real-estate selling costs (closing costs + agent commission) ─────────
# Agent commission: 5-6% (recent NAR settlement may push this down to 4-5%, but
# 6% remains the default many sellers still pay). Closing costs (title insurance,
# transfer tax, recording fee, prorated property tax): 1-3% varies by state.
US_REAL_ESTATE_AGENT_COMMISSION = D("0.06")
US_REAL_ESTATE_CLOSING_COSTS = D("0.02")     # blended national average

def us_real_estate_selling_cost_pct(state: str = "") -> Decimal:
    """Total selling cost as fraction of sale price for US real-estate.
    Currently state-agnostic; can specialise later (TX, CA, NY have higher fees)."""
    return US_REAL_ESTATE_AGENT_COMMISSION + US_REAL_ESTATE_CLOSING_COSTS


# CD early-withdrawal penalty: typically 3-6 months of interest. Modelled as
# ~half the contracted annual rate × principal.
US_CD_EARLY_WITHDRAWAL_PENALTY_PCT = D("0.025")   # ≈ 6mo of interest at 5% rate


# ─────────────────────────────────────────────────────────────────────────────
# Institution tier (brainstorm §31) — for scrape cadence in data ops
# ─────────────────────────────────────────────────────────────────────────────

INSTITUTION_TIER = {
    Country.IN: {
        "A": ["SBI", "HDFC Bank", "ICICI Bank", "Axis Bank", "Kotak Mahindra", "PNB"],
        "B": ["Bank of Baroda", "Canara Bank", "Bank of India", "Union Bank",
              "Indian Bank", "Central Bank", "IDBI", "Yes Bank", "IDFC First", "IndusInd Bank"],
        "C": ["Federal Bank", "South Indian Bank", "RBL Bank", "Bandhan Bank",
              "AU SFB", "UCO Bank", "Bank of Maharashtra", "Punjab & Sind",
              "Karnataka Bank", "Karur Vysya", "City Union", "J&K Bank",
              "Ujjivan SFB", "Suryoday SFB"],
    },
    Country.US: {
        "A": ["JPMorgan Chase", "Bank of America", "Wells Fargo", "Citibank",
              "U.S. Bank", "Capital One"],
        "B": ["American Express", "Discover", "Goldman Sachs", "Ally Financial",
              "Truist", "PNC Financial"],
        "C": ["TD Bank", "Navy Federal Credit Union", "SoFi"],
    },
}
