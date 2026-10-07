"""India income tax — FY2026-27 (verified May 2026).

Budget 2026-27 retained the FY2025-26 slabs unchanged. Income Tax Act, 2025
effective April 1, 2026. Sources: KPMG/PRS/HDFC Bank Budget 2026-27 analyses.
"""
from decimal import Decimal
from engine.models import TaxRegimeIN

D = Decimal

# ── FY2026-27 slabs (decimals) ───────────────────────────────────────────────
NEW_REGIME_SLABS = [
    (D("400000"),     D("0.00")),
    (D("800000"),     D("0.05")),
    (D("1200000"),    D("0.10")),
    (D("1600000"),    D("0.15")),
    (D("2000000"),    D("0.20")),
    (D("2400000"),    D("0.25")),
    (D("Infinity"),   D("0.30")),
]
OLD_REGIME_SLABS = [
    (D("250000"),     D("0.00")),
    (D("500000"),     D("0.05")),
    (D("1000000"),    D("0.20")),
    (D("Infinity"),   D("0.30")),
]

# 87A rebate
REBATE_87A_NEW = D("60000")          # Tax becomes ₹0 if taxable_income ≤ ₹12L (new regime)
REBATE_87A_NEW_THRESHOLD = D("1200000")
REBATE_87A_OLD = D("12500")          # Old regime: tax becomes ₹0 if taxable_income ≤ ₹5L
REBATE_87A_OLD_THRESHOLD = D("500000")

# Standard deductions
STANDARD_DEDUCTION_NEW_SALARIED = D("75000")
STANDARD_DEDUCTION_OLD_SALARIED = D("50000")

# Surcharge (applies to tax; capped at 25% for LTCG/special-rate income)
SURCHARGE_BANDS = [
    (D("5000000"),    D("0.00")),
    (D("10000000"),   D("0.10")),
    (D("20000000"),   D("0.15")),
    (D("50000000"),   D("0.25")),
    (D("Infinity"),   D("0.37")),
]
SURCHARGE_CAP_LTCG = D("0.25")
# Finance Act 2023: under the new regime (s.115BAC) the 37% band is capped
# at 25% (P2-01). Income Tax Dept: "25% in case assessee opted for new tax
# regime under section 115BAC".
SURCHARGE_CAP_NEW_REGIME = D("0.25")

CESS_RATE = D("0.04")                # Health & education cess


def _slab_tax(taxable_income: Decimal, slabs) -> Decimal:
    """Compute slab-based tax (no surcharge, no cess, no rebate)."""
    tax = D("0")
    prev_limit = D("0")
    for limit, rate in slabs:
        if taxable_income <= prev_limit:
            break
        chunk = min(taxable_income, limit) - prev_limit
        tax += chunk * rate
        prev_limit = limit
    return tax


def surcharge_rate(
    taxable_income: Decimal,
    is_ltcg: bool = False,
    regime: TaxRegimeIN | None = None,
) -> Decimal:
    """Surcharge rate based on income band. LTCG capped at 25%; the new
    regime caps every band at 25% (no 37%)."""
    for limit, rate in SURCHARGE_BANDS:
        if taxable_income <= limit:
            if is_ltcg:
                rate = min(rate, SURCHARGE_CAP_LTCG)
            if regime == TaxRegimeIN.NEW:
                rate = min(rate, SURCHARGE_CAP_NEW_REGIME)
            return rate
    return D("0")


def _tax_before_surcharge(taxable_income: Decimal, regime: TaxRegimeIN) -> Decimal:
    """Slab tax after the 87A rebate (and its new-regime marginal relief)."""
    slabs = NEW_REGIME_SLABS if regime == TaxRegimeIN.NEW else OLD_REGIME_SLABS
    tax = _slab_tax(taxable_income, slabs)
    if regime == TaxRegimeIN.NEW and taxable_income <= REBATE_87A_NEW_THRESHOLD:
        tax = max(D("0"), tax - REBATE_87A_NEW)
    elif regime == TaxRegimeIN.NEW:
        # Marginal relief (s.87A proviso, new regime): just above the ₹12L
        # line the tax can't exceed the income above it. Without it ₹12.1L
        # was taxed ₹63,960 instead of ₹10,400. Runs out near ₹12.71L.
        tax = min(tax, taxable_income - REBATE_87A_NEW_THRESHOLD)
    elif regime == TaxRegimeIN.OLD and taxable_income <= REBATE_87A_OLD_THRESHOLD:
        tax = max(D("0"), tax - REBATE_87A_OLD)
    return max(D("0"), tax)


SURCHARGE_THRESHOLDS = [D("5000000"), D("10000000"), D("20000000"), D("50000000")]


def income_tax(
    taxable_income: Decimal,
    regime: TaxRegimeIN,
    is_salaried: bool = True,
) -> Decimal:
    """Total income tax for FY2026-27: slab tax (less 87A rebate) × (1 + surcharge) × 1.04.

    Surcharge marginal relief (P2-02): just above ₹50L / ₹1Cr / ₹2Cr / ₹5Cr
    the tax plus surcharge can't exceed the tax at the threshold plus the
    income above it. Without it ₹1,000 more income cost ₹1.12 lakh at ₹50L.
    """
    tax = _tax_before_surcharge(taxable_income, regime)
    if tax <= 0:
        return D("0")
    surcharge = surcharge_rate(taxable_income, regime=regime)
    with_surcharge = tax * (D("1") + surcharge)
    below = [t for t in SURCHARGE_THRESHOLDS if t < taxable_income]
    if below and surcharge > 0:
        t = below[-1]
        at_t = _tax_before_surcharge(t, regime) * (D("1") + surcharge_rate(t, regime=regime))
        with_surcharge = min(with_surcharge, at_t + (taxable_income - t))
    return with_surcharge * (D("1") + CESS_RATE)


def marginal_rate(taxable_income: Decimal, regime: TaxRegimeIN) -> Decimal:
    """Effective marginal rate at given income: slab_rate × (1+surcharge) × 1.04.

    At or below the 87A line (₹12L new regime, ₹5L old) the rebate cancels
    the tax, so the next rupee, and a deduction's saving, is taxed at 0; it
    used to read 10.4% (new) or 5.2% (old).

    Just above the new-regime line, marginal relief taxes each extra rupee
    at ~104% until about ₹12.71L. That is not returned here (a rate above
    100% would make a loan's tax shield worth more than its interest); the
    slab rate stands in, and callers warn with is_at_87a_cliff.
    """
    if regime == TaxRegimeIN.NEW and taxable_income <= REBATE_87A_NEW_THRESHOLD:
        return D("0")
    if regime == TaxRegimeIN.OLD and taxable_income <= REBATE_87A_OLD_THRESHOLD:
        return D("0")
    slabs = NEW_REGIME_SLABS if regime == TaxRegimeIN.NEW else OLD_REGIME_SLABS
    base = D("0")
    prev = D("0")
    for limit, rate in slabs:
        if taxable_income > prev and taxable_income <= limit:
            base = rate
            break
        prev = limit
    surcharge = surcharge_rate(taxable_income, regime=regime)
    return base * (D("1") + surcharge) * (D("1") + CESS_RATE)


def is_at_87a_cliff(taxable_income: Decimal, regime: TaxRegimeIN, window: Decimal = D("10000")) -> bool:
    """True if income is within `window` rupees above the 87A threshold."""
    if regime == TaxRegimeIN.NEW:
        return REBATE_87A_NEW_THRESHOLD < taxable_income <= REBATE_87A_NEW_THRESHOLD + window
    return REBATE_87A_OLD_THRESHOLD < taxable_income <= REBATE_87A_OLD_THRESHOLD + window
