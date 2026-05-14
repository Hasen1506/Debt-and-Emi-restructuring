"""Layer 2 payoff ordering — avalanche / hybrid / snowball + freed-EMI cascade.

Avalanche is the default (most profitable). Hybrid keeps psychological wins (small
balances cleared first) while penalising rate efficiency. Snowball is pure
behavioural — smallest balance first regardless of rate.

§4.21 — when a debt reaches zero, its minimum payment + any extra allocated
to it cascades to the next-priority debt.
"""
from decimal import Decimal
from enum import Enum
from engine.models import Loan

D = Decimal


class Strategy(str, Enum):
    AVALANCHE = "avalanche"
    HYBRID = "hybrid"
    SNOWBALL = "snowball"


def rank_loans(
    loans: list[Loan],
    effective_rates: dict[int, Decimal],
    strategy: Strategy,
) -> list[Loan]:
    """Returns loans sorted by priority for extra-allocation routing.

    `effective_rates` is {id(loan): effective_rate} from formulas.effective_rate().
    Higher priority = first to receive extra.
    """
    if strategy == Strategy.AVALANCHE:
        return sorted(loans, key=lambda l: effective_rates[id(l)], reverse=True)
    if strategy == Strategy.SNOWBALL:
        return sorted(loans, key=lambda l: l.outstanding)
    if strategy == Strategy.HYBRID:
        # Small balances < ₹50k go first (or $1,000 US — caller scales).
        # Then avalanche the rest.
        small_threshold = D("50000")
        small = sorted([l for l in loans if l.outstanding < small_threshold],
                       key=lambda l: l.outstanding)
        rest = sorted([l for l in loans if l.outstanding >= small_threshold],
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
