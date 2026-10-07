"""Layer 2 payoff ordering — avalanche / your rules / snowball + freed-EMI cascade.

Avalanche is the default (most profitable). Your rules (RULES, roadmap PR E)
replace Hybrid: "clear any loan under X first", "pin this loan to the front",
or a custom order; everything the rules don't place goes by rate. Hybrid is
still accepted from older clients and is exactly the rule "clear loans under
₹50,000 / $1,000 first". Snowball is pure behavioural — smallest balance first.

§4.21 — when a debt reaches zero, its minimum payment + any extra allocated
to it cascades to the next-priority debt.
"""
from decimal import Decimal
from typing import Callable
from enum import Enum
from engine.models import Country, Loan, PayoffRules

D = Decimal

# §4.5 hybrid strategy — small-balance bucket threshold. Picked to surface
# typical "easy wins" in each market: BNPL/store cards in IN, low-balance
# cards in US. Keeps psychology→math switch at roughly equivalent purchasing
# power (₹50k ≈ $600 mid-2026 spot; we round US up to $1,000 for cleaner UX).
HYBRID_SMALL_BALANCE_IN = D("50000")
HYBRID_SMALL_BALANCE_US = D("1000")


class Strategy(str, Enum):
    AVALANCHE = "avalanche"
    HYBRID = "hybrid"      # legacy: the rule "clear small balances first" (see hybrid_rules)
    SNOWBALL = "snowball"
    RULES = "rules"


def hybrid_small_balance_threshold(country: Country) -> Decimal:
    """§4.5 — balance below which a loan jumps to the front of the hybrid queue."""
    if country == Country.US:
        return HYBRID_SMALL_BALANCE_US
    return HYBRID_SMALL_BALANCE_IN


def hybrid_rules(country: Country) -> PayoffRules:
    """The rule a Hybrid user is migrated to: the same order, as a rule."""
    return PayoffRules(small_first_below=hybrid_small_balance_threshold(country))


def rank_loans(
    loans: list[Loan],
    effective_rates: dict[int, Decimal],
    strategy: Strategy,
    country: Country = Country.IN,
    balance_of: Callable[[Loan], Decimal] | None = None,
    rules: PayoffRules | None = None,
    index_of: dict[int, int] | None = None,
) -> list[Loan]:
    """Returns loans sorted by priority for extra-allocation routing.

    `effective_rates` is {id(loan): effective_rate} from formulas.effective_rate().
    Higher priority = first to receive extra. `country` selects the hybrid
    small-balance threshold (§4.5).

    `balance_of` maps a loan to its balance in the user's currency (M3):
    a $10,000 loan is not smaller than a ₹50,000 one. Defaults to the raw
    balance for single-currency callers.
    """
    bal = balance_of or (lambda l: l.outstanding)
    if strategy == Strategy.AVALANCHE:
        return sorted(loans, key=lambda l: effective_rates[id(l)], reverse=True)
    if strategy == Strategy.SNOWBALL:
        return sorted(loans, key=bal)
    if strategy == Strategy.HYBRID:
        strategy, rules = Strategy.RULES, hybrid_rules(country)
    if strategy == Strategy.RULES:
        return apply_rules(loans, effective_rates, rules or PayoffRules(), bal, index_of)
    raise ValueError(f"Unknown strategy: {strategy}")


def apply_rules(
    loans: list[Loan],
    effective_rates: dict[int, Decimal],
    rules: PayoffRules,
    bal: Callable[[Loan], Decimal],
    index_of: dict[int, int] | None = None,
) -> list[Loan]:
    """Order by the user's rules; whatever they don't place goes by rate.
    `index_of` maps id(loan) → its position in user.loans (the rules' names);
    it defaults to the position in `loans`."""
    pos = index_of or {id(l): i for i, l in enumerate(loans)}
    by_rate = lambda ls: sorted(ls, key=lambda l: effective_rates[id(l)], reverse=True)  # noqa: E731
    by_index = {pos.get(id(l)): l for l in loans}
    if rules.custom_order:
        front = [by_index[i] for i in dict.fromkeys(rules.custom_order) if i in by_index]
        return front + by_rate([l for l in loans if l not in front])
    front = [by_index[i] for i in dict.fromkeys(rules.pinned) if i in by_index]
    rest = [l for l in loans if l not in front]
    if rules.small_first_below is not None and rules.small_first_below > 0:
        small = sorted([l for l in rest if bal(l) < rules.small_first_below], key=bal)
        rest = [l for l in rest if l not in small]
        front += small
    return front + by_rate(rest)


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
