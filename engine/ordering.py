"""Layer 2 payoff ordering — avalanche / hybrid / snowball + freed-EMI cascade.

Avalanche is the default (most profitable). Hybrid keeps psychological wins (small
balances cleared first) while penalising rate efficiency. Snowball is pure
behavioural — smallest balance first regardless of rate.

§4.21 — when a debt reaches zero, its minimum payment + any extra allocated
to it cascades to the next-priority debt.
"""
from decimal import Decimal
from enum import Enum
from engine.models import Country, Loan

D = Decimal

# §4.5 hybrid strategy — small-balance bucket threshold. Picked to surface
# typical "easy wins" in each market: BNPL/store cards in IN, low-balance
# cards in US. Keeps psychology→math switch at roughly equivalent purchasing
# power (₹50k ≈ $600 mid-2026 spot; we round US up to $1,000 for cleaner UX).
HYBRID_SMALL_BALANCE_IN = D("50000")
HYBRID_SMALL_BALANCE_US = D("1000")


class Strategy(str, Enum):
    AVALANCHE = "avalanche"
    HYBRID = "hybrid"
    SNOWBALL = "snowball"


def hybrid_small_balance_threshold(country: Country) -> Decimal:
    """§4.5 — balance below which a loan jumps to the front of the hybrid queue."""
    if country == Country.US:
        return HYBRID_SMALL_BALANCE_US
    return HYBRID_SMALL_BALANCE_IN


def rank_loans(
    loans: list[Loan],
    effective_rates: dict[int, Decimal],
    strategy: Strategy,
    country: Country = Country.IN,
) -> list[Loan]:
    """Returns loans sorted by priority for extra-allocation routing.

    `effective_rates` is {id(loan): effective_rate} from formulas.effective_rate().
    Higher priority = first to receive extra. `country` selects the hybrid
    small-balance threshold (§4.5).
    """
    if strategy == Strategy.AVALANCHE:
        return sorted(loans, key=lambda l: effective_rates[id(l)], reverse=True)
    if strategy == Strategy.SNOWBALL:
        return sorted(loans, key=lambda l: l.outstanding)
    if strategy == Strategy.HYBRID:
        threshold = hybrid_small_balance_threshold(country)
        small = sorted([l for l in loans if l.outstanding < threshold],
                       key=lambda l: l.outstanding)
        rest = sorted([l for l in loans if l.outstanding >= threshold],
                      key=lambda l: effective_rates[id(l)], reverse=True)
        return small + rest
    raise ValueError(f"Unknown strategy: {strategy}")


def allocate_extra(
    ranked_loans: list[Loan],
    minimum_payments: dict[int, Decimal],
    available_surplus: Decimal,
) -> dict[int, Decimal]:
    """All extra surplus routes to the highest-priority loan. §4.21 cascade
    happens at the simulation step (when a loan reaches zero balance).

    Returns dict {id(loan): total_payment_this_month}.
    """
    payments = {id(l): minimum_payments[id(l)] for l in ranked_loans}
    if available_surplus <= 0 or not ranked_loans:
        return payments
    payments[id(ranked_loans[0])] += available_surplus
    return payments


def cascade_on_payoff(
    cleared_loan: Loan,
    extra_allocated_to_cleared: Decimal,
    minimum_of_cleared: Decimal,
) -> Decimal:
    """§4.21 — when `cleared_loan` reaches zero, the freed amount (its minimum +
    extra previously allocated to it) cascades to the next-priority debt.

    Returns the amount of newly-available surplus for the next loan.
    """
    return minimum_of_cleared + extra_allocated_to_cleared
