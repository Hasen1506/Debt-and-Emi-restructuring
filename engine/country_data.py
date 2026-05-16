"""Country-specific reference data — brainstorm §29 (MAB), §26.1 (stamp duty), §31 (institution tiers).

Stub data, refresh from primary sources (§7.6, §7.7 in design spec). All money in
local currency (₹ for India, $ for US). All rates as decimals.
"""
from decimal import Decimal
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


def india_selling_cost_pct(state: str, brokerage_rate: Decimal = D("0.015")) -> Decimal:
    """Total selling cost as fraction of sale value: stamp duty + 1% reg + brokerage."""
    return lookup_stamp_duty(state) + INDIA_REGISTRATION_FEE + brokerage_rate


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
    # [VERIFY 2025-26, 2026-27 from CBDT annual notifications]
}


def lookup_cii(fy_string: str) -> int:
    """Returns CII index for the given financial year (e.g. '2024-25').
    Raises if not found — caller should fail loudly rather than silently substitute."""
    if fy_string not in CII_TABLE:
        raise KeyError(f"CII not in table for FY {fy_string}. Refresh from CBDT.")
    return CII_TABLE[fy_string]


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
