"""§4.23 — Available monthly surplus + one-time deployable buffer.

Two separate cash pools:
  • available_surplus — monthly recurring; feeds the ongoing schedule.
  • available_buffer  — one-time deployable; can fund a lump-sum prepayment immediately.

Hard floors (always honoured): minimum payments, e-fund top-up, Layer 0 match.
India-specific: MAB is a cash floor on `savings_balance` (not a monthly deduction).
Business-owner DSR: 3× monthly EMIs held in savings (one-time reserve, not monthly).
"""
from dataclasses import dataclass
from decimal import Decimal
from engine.models import User, Loan, Country, IncomeType
from engine.minimum_payments import compute_minimum_payment
from engine.country_data import lookup_mab

D = Decimal


@dataclass(frozen=True)
class SurplusAllocation:
    """Breakdown of how each month's surplus gets routed across goal / EF /
    debt sinks. Returned by `allocate_surplus` for both the engine simulator
    and the /plan SurplusWaterfall card so the displayed pie matches the
    engine's actual allocation.

    Invariant: goal_slice + ef_slice + debt_slice == surplus (when surplus
    is non-negative). Each slice is non-negative.
    """
    goal_slice: Decimal
    ef_slice: Decimal
    debt_slice: Decimal


def allocate_surplus(
    surplus: Decimal,
    ef_split: Decimal,
    ef_gap: Decimal,
    ef_preempted: bool,
) -> SurplusAllocation:
    """Route the month's surplus across goal / EF / debt sinks.

    Priority order:
      1. If a preempting goal is open → 100% to goal (EF + debt paused).
      2. Else: divert `ef_split` fraction to EF until gap closes.
      3. Remainder → debt slice (the simulator lands this on the
         highest-effective-APR active loan).

    Zero across the board when surplus ≤ 0. The simulator and the
    SurplusWaterfall UI card both consume this so the displayed pie
    matches what the engine actually applies.
    """
    if surplus <= 0:
        return SurplusAllocation(D("0"), D("0"), D("0"))
    if ef_preempted:
        return SurplusAllocation(surplus, D("0"), D("0"))
    if ef_gap > 0 and ef_split > 0:
        want = surplus * ef_split
        ef_slice = min(want, ef_gap)
        return SurplusAllocation(D("0"), ef_slice, surplus - ef_slice)
    return SurplusAllocation(D("0"), D("0"), surplus)


def _user_residence_currency(user: User) -> str:
    """Currency the user earns + spends in. Drives FX conversion direction."""
    return "USD" if user.country == Country.US else "INR"


def loan_currency_or_default(loan: Loan, user: User) -> str:
    """Resolve a loan's currency, falling back to user residence default."""
    return loan.currency or _user_residence_currency(user)


def to_user_currency(amount: Decimal, loan: Loan, user: User) -> Decimal:
    """Convert a loan-currency amount into the user's residence currency.

    For single-currency users this is a no-op (rate defaults to 1). For
    hybrid users (NRI-US with INR loans), `user.fx_to_user_currency["INR"]`
    holds the per-1-INR USD rate so the surplus / DTI math sums in a
    single currency.
    """
    loan_ccy = loan_currency_or_default(loan, user)
    if loan_ccy == _user_residence_currency(user):
        return amount
    rate = user.fx_to_user_currency.get(loan_ccy, D("1"))
    return amount * rate


def from_user_currency(amount: Decimal, loan: Loan, user: User) -> Decimal:
    """Inverse: user-currency surplus → loan-currency principal amount.

    Used by the simulator when routing extra surplus (denominated in
    residence currency) toward a loan held in a different currency.
    """
    loan_ccy = loan_currency_or_default(loan, user)
    if loan_ccy == _user_residence_currency(user):
        return amount
    rate = user.fx_to_user_currency.get(loan_ccy, D("1"))
    if rate == 0:
        return amount
    return amount / rate


def compute_total_minimums(
    user: User,
    loans: list[Loan],
    simple_mode: bool = False,
) -> Decimal:
    """Sum of bank-specific minimum payments across all loans, converted
    into the user's residence currency. The pure-INR or pure-USD case is
    unchanged — FX helper is a no-op when loan currency matches user
    currency."""
    return sum(
        (
            to_user_currency(
                compute_minimum_payment(l, user.country, simple_mode=simple_mode),
                l,
                user,
            )
            for l in loans
        ),
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
        - user.variable_expenses
        - total_minimums
        - efund_monthly
        - matched_contribution
    )
    return max(D("0"), surplus)
