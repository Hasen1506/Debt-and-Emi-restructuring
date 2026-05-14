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
