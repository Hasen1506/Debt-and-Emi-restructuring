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
    # Rev. Proc. 2025-32 Table 2 (P2-23: was 201,775 / 256,225).
    FilingStatusUS.HOH: [
        (D("17700"),    D("0.10")),
        (D("67450"),    D("0.12")),
        (D("105700"),   D("0.22")),
        (D("201750"),   D("0.24")),
        (D("256200"),   D("0.32")),
        (D("640600"),   D("0.35")),
        (D("Infinity"), D("0.37")),
    ],
}

STANDARD_DEDUCTION_2026 = {
    FilingStatusUS.SINGLE: D("16100"),
    FilingStatusUS.MFJ:    D("32200"),
    FilingStatusUS.HOH:    D("24150"),
}

# OBBBA §70120 raised the SALT cap to $40,000 for 2025, +1% a year: $40,400
# for 2026 ($20,200 married filing separately). It phases down by 30% of
# MAGI above $505,000 ($252,500 MFS) but never below $10,000 (P2-03).
SALT_CAP_2026 = D("40400")
SALT_CAP_FLOOR = D("10000")
SALT_PHASEDOWN_MAGI_2026 = D("505000")
SALT_PHASEDOWN_RATE = D("0.30")
MORTGAGE_INTEREST_PRINCIPAL_LIMIT = D("750000")    # IRC §163

# ── 2026 LTCG brackets (IRC §1(h); inflation-adjusted per Rev Proc 2025-32) ──
# Each entry: (upper_threshold, ltcg_rate). 0% / 15% / 20% brackets.
# Rev. Proc. 2025-32 §4.03 (P2-04).
LTCG_BRACKETS_2026 = {
    FilingStatusUS.SINGLE: [
        (D("49450"),    D("0.00")),
        (D("545500"),   D("0.15")),
        (D("Infinity"), D("0.20")),
    ],
    FilingStatusUS.MFJ: [
        (D("98900"),    D("0.00")),
        (D("613700"),   D("0.15")),
        (D("Infinity"), D("0.20")),
    ],
    FilingStatusUS.HOH: [
        (D("66200"),    D("0.00")),
        (D("579600"),   D("0.15")),
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

# §221 student-loan interest (Rev. Proc. 2025-32 §4.29), P2-25.
STUDENT_LOAN_INTEREST_MAX = D("2500")
STUDENT_LOAN_PHASEOUT_2026 = {
    FilingStatusUS.SINGLE: (D("85000"), D("100000")),
    FilingStatusUS.HOH:    (D("85000"), D("100000")),
    FilingStatusUS.MFJ:    (D("175000"), D("205000")),
}


# IRC §164(b)(7) as added by P.L. 119-21 §70120 (read 2026-10-12 at
# https://www.law.cornell.edu/uscode/text/26/164): cap $40,000 (2025),
# $40,400 (2026), then 101% of the prior year's for 2027-2029, and $10,000
# from 2030. Phase-down threshold $500,000 (2025), $505,000 (2026), then
# 101% a year. The phase-down (30% of MAGI over the threshold, never below
# $10,000) applies only before 2030. Married filing separately: half of each.
# The statute gives no rounding for the 101% years, so none is applied;
# IRS may publish rounded figures for 2027+, which then replace these.
SALT_CAP_BY_YEAR = {2025: D("40000"), 2026: D("40400")}
SALT_THRESHOLD_BY_YEAR = {2025: D("500000"), 2026: D("505000")}
SALT_CAP_AFTER_2029 = D("10000")


def _salt_indexed(table: dict[int, Decimal], year: int) -> Decimal:
    if year in table:
        return table[year]
    if year < min(table):
        raise ValueError(f"SALT cap before {min(table)} isn't modelled")
    amt = table[max(table)]
    for _ in range(max(table), year):
        amt = amt * D("1.01")
    return amt


def salt_cap_for_year(year: int, magi: Decimal | None = None, married_separately: bool = False) -> Decimal:
    """The SALT deduction cap for a tax year, after the MAGI phase-down."""
    half = D("0.5") if married_separately else D("1")
    if year >= 2030:
        return SALT_CAP_AFTER_2029 * half
    cap = _salt_indexed(SALT_CAP_BY_YEAR, year) * half
    threshold = _salt_indexed(SALT_THRESHOLD_BY_YEAR, year) * half
    if magi is None or magi <= threshold:
        return cap
    return max(SALT_CAP_FLOOR * half, cap - SALT_PHASEDOWN_RATE * (magi - threshold))


def salt_cap(magi: Decimal | None = None, year: int = 2026) -> Decimal:
    """SALT cap after the high-income phase-down (default tax year 2026)."""
    return salt_cap_for_year(year, magi)


def student_loan_interest_deduction(
    interest_paid: Decimal, magi: Decimal, filing_status: FilingStatusUS,
) -> Decimal:
    """Above-the-line §221 deduction: up to $2,500, phased out by MAGI."""
    if interest_paid <= 0:
        return D("0")
    lo, hi = STUDENT_LOAN_PHASEOUT_2026[filing_status]
    allowed = min(interest_paid, STUDENT_LOAN_INTEREST_MAX)
    if magi <= lo:
        return allowed
    if magi >= hi:
        return D("0")
    return allowed * (hi - magi) / (hi - lo)


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
    long_term: bool | None = None,
) -> Decimal:
    """Total US capital gains tax: federal + NIIT (if MAGI > threshold) + state.

    `taxable_income` is the year's ordinary taxable income WITHOUT this
    gain; the gain is stacked on top of it, and income + gain is the MAGI
    proxy for NIIT.

    Short-term: taxed as ordinary income at the federal marginal rate.
    Long-term ("more than one year": pass `long_term` from calendar dates;
    the `holding_days > 365` fallback is wrong on leap years, P2-11): the
    0/15/20% bands apply to the gain STACKED on top of ordinary income
    (P2-22), capped at 28% for collectibles.
    NIIT 3.8% applies to min(gain, MAGI − threshold), not the whole gain.
    """
    if gain <= 0:
        return D("0")

    is_lt = long_term if long_term is not None else holding_days > 365

    if is_lt:
        ordinary = max(D("0"), taxable_income)
        federal = D("0")
        prev = D("0")
        for limit, rate in LTCG_BRACKETS_2026[filing_status]:
            lo = max(prev, ordinary)
            hi = min(limit, ordinary + gain)
            if hi > lo:
                r = rate
                if is_collectible:
                    r = min(COLLECTIBLE_LTCG_MAX_RATE, max(rate, D("0.15")))
                federal += (hi - lo) * r
            prev = limit
    else:
        federal = federal_tax(taxable_income + gain, filing_status) - federal_tax(taxable_income, filing_status)

    over = taxable_income + gain - NIIT_THRESHOLD_2026[filing_status]
    niit = min(gain, over) * NIIT_RATE if over > 0 else D("0")

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
    magi: Decimal | None = None,
) -> tuple[Decimal, bool]:
    """Returns (tax_saved, itemises_flag).

    If total itemisables exceed standard deduction, user itemises and the
    incremental benefit of mortgage interest is `itemisable − std_deduction`.
    """
    std = STANDARD_DEDUCTION_2026[filing_status]
    itemisable = (
        mortgage_interest_paid
        + min(salt_taxes_paid, salt_cap(magi))
        + charitable_giving
    )
    if itemisable > std:
        incremental = itemisable - std
        deductible_interest = min(mortgage_interest_paid, incremental)
        return deductible_interest * marginal_rate, True
    return D("0"), False
