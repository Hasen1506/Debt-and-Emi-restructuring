"""USA federal income tax — Tax Year 2026 (verified May 2026, IRS Rev Proc 2025-32)."""
from decimal import Decimal
from engine.models import FilingStatusUS

D = Decimal

# ── 2026 brackets (IRS Rev Proc 2025-32, Oct 2025) ───────────────────────────
# Each entry: (upper_threshold, marginal_rate). Last is (Infinity, 0.37).
BRACKETS_2026 = {
    FilingStatusUS.SINGLE: [
        (D("12400"),    D("0.10")),
        (D("50400"),    D("0.12")),
        (D("105700"),   D("0.22")),
        (D("201775"),   D("0.24")),
        (D("256225"),   D("0.32")),
        (D("640600"),   D("0.35")),
        (D("Infinity"), D("0.37")),
    ],
    FilingStatusUS.MFJ: [
        (D("24800"),    D("0.10")),
        (D("100800"),   D("0.12")),
        (D("211400"),   D("0.22")),
        (D("403550"),   D("0.24")),
        (D("512450"),   D("0.32")),
        (D("768700"),   D("0.35")),
        (D("Infinity"), D("0.37")),
    ],
    # HoH thresholds approx 1.5× single below top bracket; refer IRS Rev Proc 2025-32 exact table
    FilingStatusUS.HOH: [
        (D("17700"),    D("0.10")),
        (D("67450"),    D("0.12")),
        (D("105700"),   D("0.22")),
        (D("201775"),   D("0.24")),
        (D("256225"),   D("0.32")),
        (D("640600"),   D("0.35")),
        (D("Infinity"), D("0.37")),
    ],
}

STANDARD_DEDUCTION_2026 = {
    FilingStatusUS.SINGLE: D("16100"),
    FilingStatusUS.MFJ:    D("32200"),
    FilingStatusUS.HOH:    D("24150"),
}

SALT_CAP_2026 = D("10000")             # TCJA cap, still in effect for 2026
MORTGAGE_INTEREST_PRINCIPAL_LIMIT = D("750000")    # IRC §163

# ── 2026 LTCG brackets (IRC §1(h); inflation-adjusted per Rev Proc 2025-32) ──
# Each entry: (upper_threshold, ltcg_rate). 0% / 15% / 20% brackets.
# [VERIFY exact 2026 figures from Rev Proc 2025-32 when finalised]
LTCG_BRACKETS_2026 = {
    FilingStatusUS.SINGLE: [
        (D("49500"),    D("0.00")),
        (D("547000"),   D("0.15")),
        (D("Infinity"), D("0.20")),
    ],
    FilingStatusUS.MFJ: [
        (D("99000"),    D("0.00")),
        (D("615250"),   D("0.15")),
        (D("Infinity"), D("0.20")),
    ],
    FilingStatusUS.HOH: [
        (D("66500"),    D("0.00")),
        (D("581000"),   D("0.15")),
        (D("Infinity"), D("0.20")),
    ],
}

# Net Investment Income Tax (IRC §1411) — 3.8% on investment income above MAGI threshold
NIIT_RATE = D("0.038")
NIIT_THRESHOLD_2026 = {
    FilingStatusUS.SINGLE: D("200000"),
    FilingStatusUS.MFJ:    D("250000"),
    FilingStatusUS.HOH:    D("200000"),
}

# Collectibles (gold, art, coins) — capped at 28% LTCG under §1(h)(4)
COLLECTIBLE_LTCG_MAX_RATE = D("0.28")

# §121 primary-residence capital-gains exclusion
SECTION_121_EXCLUSION_SINGLE = D("250000")
SECTION_121_EXCLUSION_MFJ    = D("500000")


def ltcg_bracket_rate(taxable_income: Decimal, filing_status: FilingStatusUS) -> Decimal:
    """Marginal LTCG rate that applies at the given taxable income."""
    brackets = LTCG_BRACKETS_2026[filing_status]
    prev = D("0")
    for limit, rate in brackets:
        if taxable_income > prev and taxable_income <= limit:
            return rate
        prev = limit
    return brackets[-1][1]


def us_capital_gains_tax(
    gain: Decimal,
    holding_days: int,
    taxable_income: Decimal,
    filing_status: FilingStatusUS,
    state_marginal_rate: Decimal = D("0"),
    is_collectible: bool = False,
) -> Decimal:
    """Total US capital gains tax: federal + NIIT (if MAGI > threshold) + state.

    Short-term (≤ 365 days): taxed as ordinary income at federal marginal rate.
    Long-term (> 365 days): 0/15/20% bracket, capped at 28% for collectibles.
    NIIT 3.8% adds on top when MAGI exceeds filing-status threshold.
    State applies its own marginal rate on the full gain (most states; some
    treat cap gains as ordinary, a couple have 0% — caller controls via the
    state_marginal_rate input).
    """
    if gain <= 0:
        return D("0")

    is_lt = holding_days > 365

    if is_lt:
        bracket = ltcg_bracket_rate(taxable_income, filing_status)
        if is_collectible:
            bracket = min(COLLECTIBLE_LTCG_MAX_RATE, max(bracket, D("0.15")))
        federal = gain * bracket
    else:
        federal = gain * federal_marginal_rate(taxable_income, filing_status)

    niit = D("0")
    if taxable_income > NIIT_THRESHOLD_2026[filing_status]:
        niit = gain * NIIT_RATE

    state = gain * state_marginal_rate
    return federal + niit + state


def federal_tax(taxable_income: Decimal, filing_status: FilingStatusUS) -> Decimal:
    """Total federal tax on taxable_income for Tax Year 2026."""
    brackets = BRACKETS_2026[filing_status]
    tax = D("0")
    prev = D("0")
    for limit, rate in brackets:
        if taxable_income <= prev:
            break
        chunk = min(taxable_income, limit) - prev
        tax += chunk * rate
        prev = limit
    return tax


def federal_marginal_rate(taxable_income: Decimal, filing_status: FilingStatusUS) -> Decimal:
    """Federal marginal rate at the given income."""
    brackets = BRACKETS_2026[filing_status]
    prev = D("0")
    for limit, rate in brackets:
        if taxable_income > prev and taxable_income <= limit:
            return rate
        prev = limit
    return brackets[-1][1]


def effective_marginal_rate(
    taxable_income: Decimal,
    filing_status: FilingStatusUS,
    state_rate: Decimal = D("0"),
) -> Decimal:
    """Federal + state combined marginal rate."""
    return federal_marginal_rate(taxable_income, filing_status) + state_rate


def itemisation_benefit(
    mortgage_interest_paid: Decimal,
    salt_taxes_paid: Decimal,
    charitable_giving: Decimal,
    filing_status: FilingStatusUS,
    marginal_rate: Decimal,
) -> tuple[Decimal, bool]:
    """Returns (tax_saved, itemises_flag).

    If total itemisables exceed standard deduction, user itemises and the
    incremental benefit of mortgage interest is `itemisable − std_deduction`.
    """
    std = STANDARD_DEDUCTION_2026[filing_status]
    itemisable = (
        mortgage_interest_paid
        + min(salt_taxes_paid, SALT_CAP_2026)
        + charitable_giving
    )
    if itemisable > std:
        incremental = itemisable - std
        deductible_interest = min(mortgage_interest_paid, incremental)
        return deductible_interest * marginal_rate, True
    return D("0"), False
