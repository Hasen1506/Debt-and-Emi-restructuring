"""§4.23 — Available monthly surplus + one-time deployable buffer.

Two separate cash pools:
  • available_surplus — monthly recurring; feeds the ongoing schedule.
  • available_buffer  — one-time deployable; can fund a lump-sum prepayment immediately.

Hard floors (always honoured): minimum payments, e-fund top-up, Layer 0 match.
India-specific: MAB is a cash floor on `savings_balance` (not a monthly deduction).
Business-owner DSR: 3× monthly EMIs held in savings (one-time reserve, not monthly).
"""
from decimal import Decimal
from engine.models import User, Loan, Country, IncomeType
from engine.minimum_payments import compute_minimum_payment
from engine.country_data import lookup_mab

D = Decimal


def compute_total_minimums(
    user: User,
    loans: list[Loan],
    simple_mode: bool = False,
) -> Decimal:
    """Sum of bank-specific minimum payments across all loans."""
    return sum(
        (compute_minimum_payment(l, user.country, simple_mode=simple_mode) for l in loans),
        D("0"),
    )


def compute_efund_monthly(user: User, months_to_target: int = 12) -> Decimal:
    """Monthly contribution to reach efund_target. Zero once reached."""
    gap = user.efund_target - user.efund_balance
    if gap <= 0 or months_to_target <= 0:
        return D("0")
    return gap / D(months_to_target)


def compute_available_buffer(
    user: User,
    total_monthly_emis: Decimal,
) -> Decimal:
    """One-time deployable cash = savings − MAB reserve − efund_target − DSR (business owners)."""
    mab_reserve = D("0")
    if user.country == Country.IN:
        mab_reserve = lookup_mab(user.primary_bank, user.location_tier)

    buffer = user.savings_balance - mab_reserve - user.efund_target
    if user.income_type == IncomeType.BUSINESS_OWNER:
        buffer -= D("3") * total_monthly_emis
    return max(D("0"), buffer)


def compute_available_surplus(
    user: User,
    loans: list[Loan],
    matched_contribution: Decimal = D("0"),
    simple_mode: bool = False,
    months_to_efund_target: int = 12,
) -> Decimal:
    """Monthly surplus available for extra debt payments. Floored at zero."""
    total_minimums = compute_total_minimums(user, loans, simple_mode=simple_mode)
    efund_monthly = compute_efund_monthly(user, months_to_efund_target)
    surplus = (
        user.monthly_income
        - user.fixed_expenses
        - total_minimums
        - efund_monthly
        - matched_contribution
    )
    return max(D("0"), surplus)
