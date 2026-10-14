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
from engine.formulas import monthly_interest_charge
from engine.country_data import lookup_mab

D = Decimal


@dataclass(frozen=True)
class SurplusAllocation:
    """Breakdown of how each month's POST-GOAL surplus gets routed across
    EF / debt sinks. Returned by `allocate_surplus` for both the engine
    simulator and the /plan SurplusWaterfall snapshot so the displayed
    pie matches the engine's actual allocation.

    Goals are subtracted by the caller before calling `allocate_surplus`
    (a single shape for both the engine loop and the snapshot — keeps
    the cascade contract in one place). `goal_slice` therefore reflects
    only the `ef_preempted` legacy single-goal flag; the multi-goal path
    composes the per-goal breakdown externally and adds it to the
    response object.

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
    """Route the month's POST-GOAL surplus across EF / debt sinks.

    The caller subtracts multi-goal outflow from `surplus` before calling
    this function — that way both the engine trajectory and the snapshot
    use the same one-shape contract (no diverging "goal_outflow argument
    vs. pre-subtracted surplus" code paths).

    Priority order:
      1. If a preempting goal is open (legacy single-goal flag) →
         100% to goal_slice (EF + debt paused).
      2. Else: divert `ef_split` fraction to EF until gap closes.
      3. Remainder → debt slice (the simulator lands this on the
         highest-effective-APR active loan).

    Zero across the board when surplus ≤ 0.
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
    return (loan.currency or _user_residence_currency(user)).upper()


class MissingFxRate(ValueError):
    """A foreign-currency loan has no usable exchange rate (H4)."""


def fx_rate(loan_ccy: str, user: User) -> Decimal:
    """Rate for 1 unit of `loan_ccy` in the user's currency. Never guesses
    parity: ₹20 lakh is not $20 lakh. Lower-case codes are accepted."""
    rates = user.fx_to_user_currency or {}
    rate = rates.get(loan_ccy)
    if rate is None:
        rate = rates.get(loan_ccy.upper(), rates.get(loan_ccy.lower()))
    if rate is None or rate <= 0:
        raise MissingFxRate(f"No exchange rate for {loan_ccy}")
    return rate


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
    return amount * fx_rate(loan_ccy, user)


def from_user_currency(amount: Decimal, loan: Loan, user: User) -> Decimal:
    """Inverse: user-currency surplus → loan-currency principal amount.

    Used by the simulator when routing extra surplus (denominated in
    residence currency) toward a loan held in a different currency.
    """
    loan_ccy = loan_currency_or_default(loan, user)
    if loan_ccy == _user_residence_currency(user):
        return amount
    return amount / fx_rate(loan_ccy, user)


def compute_total_minimums(
    user: User,
    loans: list[Loan],
    simple_mode: bool = False,
    minimums: dict[int, Decimal] | None = None,
) -> Decimal:
    """Sum of bank-specific minimum payments across all loans, converted
    into the user's residence currency. The pure-INR or pure-USD case is
    unchanged — FX helper is a no-op when loan currency matches user
    currency."""
    # With this month's interest, as the simulator pays it: without it the
    # surplus counted a smaller card minimum than was actually paid.
    # A paid-off loan (nothing outstanding) has no EMI left; counting it cut
    # the /plan surplus snapshot below the simulator's own month 1.
    # US mortgage insurance (PMI / FHA MIP) is paid with the mortgage until
    # it ends (engine/us_loans.py, grill #34).
    # `minimums` (by id(loan)): the simulator's own figures for this month
    # (a maturity's balloon, a card's minimum at the interest it is charged;
    # Audit C2/C3/C13), so surplus and shortfall see what is actually paid.
    from engine.us_loans import pmi_due
    return sum(
        (
            to_user_currency(
                (minimums[id(l)] if minimums is not None and id(l) in minimums else compute_minimum_payment(
                    l, user.country,
                    interest_accrued=monthly_interest_charge(l, user.country),
                    simple_mode=simple_mode,
                )) + pmi_due(l),
                l,
                user,
            )
            for l in loans
            if l.outstanding > 0
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


def compute_shortfall(
    user: User,
    loans: list[Loan],
    simple_mode: bool = False,
    minimums: dict[int, Decimal] | None = None,
) -> Decimal:
    """How much income falls short of costs plus the minimum payments, in
    the user's currency; 0 when it covers them.

    The available surplus is floored at 0 and the simulator pays the
    minimums regardless, so a user short of cash still got a payoff date
    built on payments they can't fund."""
    need = (
        user.fixed_expenses
        + user.variable_expenses
        + compute_total_minimums(user, loans, simple_mode=simple_mode, minimums=minimums)
    )
    return max(D("0"), need - user.monthly_income)


def compute_available_surplus(
    user: User,
    loans: list[Loan],
    matched_contribution: Decimal = D("0"),
    simple_mode: bool = False,
    months_to_efund_target: int = 12,
    efund_monthly: Decimal | None = None,
    minimums: dict[int, Decimal] | None = None,
) -> Decimal:
    """Monthly surplus available for extra debt payments. Floored at zero.

    `efund_monthly` overrides the emergency-fund top-up for this month
    (the simulator passes a fixed amount so the fund actually fills)."""
    total_minimums = compute_total_minimums(user, loans, simple_mode=simple_mode, minimums=minimums)
    if efund_monthly is None:
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
