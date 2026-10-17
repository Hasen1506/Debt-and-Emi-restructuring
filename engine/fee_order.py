"""Fee-aware payoff order (roadmap PR K, founder decision 2026-10-08).

Why a search. Without prepayment fees, putting each month's extra on the
loan with the highest marginal cost of the next rupee (engine/marginal_cost.py,
PR J) is the cheapest plan: the property test checks it against every fixed
order. A prepayment fee breaks that. It is charged on each rupee prepaid, so
its total depends on *when* the loan is prepaid (the EMIs shrink what is
left to prepay, and a loan that runs out on its own pays no fee at all). No
per-year rate can capture that, so a rate-by-rate (greedy) order can lose
to a fixed order: on fee portfolios sampled on main @ 7f97fc0 a fixed order
beat it in 11 of 41 and 7 of 40.

What it does. When at least one open loan carries a fee and the strategy is
Avalanche, the plan is run for candidate payoff orders on the same
simulator, and the cheapest is kept, counting what the plan pays net of tax:

    net cost = interest paid (GST on card interest and prepayment fees
               included, as the simulator books them)
             − tax the deductible interest saves (24(b) / 80E / US §163 /
               §221 at the marginal rate, yearly caps applied)

* Up to EXACT_MAX_LOANS (5) open loans: every order (5! = 120 runs at most,
  about 11 ms each), plus the greedy marginal-cost plan itself. This is
  exact: the plan is never worse than the best fixed order.
* More loans: the greedy plan, the rate-only order, and a local search from
  the better of the two (swap any two loans, or move a loan with a fee to
  any position; keep the best; repeat until nothing improves or
  LOCAL_MAX_ROUNDS). Every order of 6-7 loans is 720-5,040 runs (8-60 s per
  plan), too slow for one request.
* Ties keep the greedy plan, then the rate-only order. The search itself
  moves on any saving above TIE (one rupee / cent), but the plan only
  leaves the greedy order when the fixed order saves more than
  `order_tolerance`: max(₹500 / $10, 0.5% of the plan's interest) (Audit
  80+ C18, grill #37). Balances people type are often 5% off, so a ₹1 win
  is noise; a smaller win is reported as "within rounding" instead.

"Why this loan first". When the kept plan puts its extra on the loans in a
different order than ranking by rate alone (the marginal cost without its fee term),
`note` says which loan moved, the fee that moved it, and what the change
saves over the plan.
"""
from __future__ import annotations

import itertools
from copy import copy
from dataclasses import dataclass
from decimal import Decimal
from typing import Callable

from engine.marginal_cost import (
    IN_HOME_INTEREST_CAP, US_STUDENT_INTEREST_CAP, LOCKED_OFFSET, marginal_cost, uncapped_shields,
    user_marginal_costs,
)
from engine.models import Country, Loan, LoanType, tax_type

D = Decimal

EXACT_MAX_LOANS = 5
LOCAL_MAX_ROUNDS = 6
TIE = D("1")
# Audit C18: the smallest saving that changes the plan's order. A tolerance
# (judgement, not a sourced figure): the audit's max(₹500, 0.5% of interest);
# $10 is the same idea for a US plan.
ORDER_TOLERANCE_FLOOR = {Country.IN: D("500"), Country.US: D("10")}
ORDER_TOLERANCE_SHARE = D("0.005")


def order_tolerance(user, plan_interest: Decimal) -> Decimal:
    """Saving a fixed payoff order must beat the greedy plan by before the
    order changes: max(₹500 / $10, 0.5% of the plan's interest)."""
    floor = ORDER_TOLERANCE_FLOOR.get(getattr(user, "country", Country.IN), D("500"))
    return max(floor, ORDER_TOLERANCE_SHARE * max(D("0"), plan_interest))

LOAN_TYPE_NAME = {
    "home_loan": "home loan", "auto_loan": "car loan", "personal_loan": "personal loan",
    "credit_card": "credit card", "education_loan": "education loan", "gold_loan": "gold loan", "bnpl": "BNPL",
    "loan_against_property": "loan against property", "home_topup": "home loan top-up",
    "two_wheeler_loan": "two-wheeler loan", "medical_loan": "medical loan",
}


def has_fee_loan(loans: list[Loan]) -> bool:
    """True when an open loan charges a prepayment fee."""
    return any(l.outstanding > 0 and (l.prepayment_penalty_pct or D("0")) > 0 for l in loans)


def plan_net_cost(user, res, marginal_rate: Decimal) -> Decimal:
    """Interest the plan pays (GST and prepayment fees included) minus the tax
    its deductible interest saves. Each loan's interest in a month is its
    opening balance × rate / 12; deductible interest earns the loan's shield
    (marginal rate, regime, itemising, US phase-out) and the ₹2L 24(b) /
    $2,500 §221 caps are applied per plan year across those loans."""
    loans = user.loans
    shield = uncapped_shields(loans, user, marginal_rate)
    if not any(v > 0 for v in shield.values()):
        return res.total_interest_paid
    from engine.formulas import loan_market
    own = user.country

    def cap_group(l: Loan):
        if loan_market(l, own) != own:
            return None
        if own == Country.IN and tax_type(l) == LoanType.HOME:
            return ("home", IN_HOME_INTEREST_CAP)
        if own == Country.US and l.loan_type == LoanType.EDUCATION:
            return ("edu", US_STUDENT_INTEREST_CAP)
        return None

    saved = D("0")
    prev = {i: l.outstanding for i, l in enumerate(loans)}
    year: dict[int, Decimal] = {}

    def close_year():
        nonlocal saved
        groups: dict[str, list] = {}
        for i, interest in year.items():
            g = cap_group(loans[i])
            if g is None:
                saved += shield[id(loans[i])] * interest
            else:
                groups.setdefault(g[0], [g[1], []])[1].append((i, interest))
        for cap, items in groups.values():
            total = sum((x for _, x in items), D("0"))
            scale = min(D("1"), cap / total) if total > 0 else D("1")
            saved += sum((shield[id(loans[i])] * x * scale for i, x in items), D("0"))
        year.clear()

    for k, row in enumerate(res.months):
        for i, l in enumerate(loans):
            if shield[id(l)] > 0 and prev[i] > 0:
                year[i] = year.get(i, D("0")) + prev[i] * l.nominal_rate / 12
        prev = {i: row.balances_by_loan_index.get(i, D("0")) for i in prev}
        if (k + 1) % 12 == 0:
            close_year()
    close_year()
    return res.total_interest_paid - saved


def rate_only_order(user, marginal_rate: Decimal) -> list[int]:
    """Positions of the open loans ranked by the marginal cost of the next
    rupee with the prepayment-fee term left out ("by rate alone"): interest
    compounded monthly + GST − tax break; locked loans last."""
    mcs = user_marginal_costs(user.loans, user, marginal_rate)
    key = {}
    for i, l in enumerate(user.loans):
        mc = mcs.get(id(l))
        if mc is None:
            continue
        blind = marginal_cost(l.nominal_rate, mc.gst > 0, mc.tax_benefit / mc.interest if mc.interest > 0 else D("0"),
                              D("0"), 0, mc.lock_in_months)
        key[i] = blind.total - LOCKED_OFFSET if blind.locked else blind.total
    return sorted(key, key=lambda i: (-key[i], i))


def payoff_sequence(res, n: int) -> list[int]:
    """Loan positions in the order the plan puts its extra on them: by the
    first month each one took the month's extra, then (for loans that never
    did) by the month they cleared; ties by position."""
    first_extra: dict[int, int] = {}
    cleared: dict[int, int] = {}
    for row in res.months:
        if row.extra_to_loan_index is not None and row.extra_to_loan_index not in first_extra:
            first_extra[row.extra_to_loan_index] = row.month_index
        for i, b in row.balances_by_loan_index.items():
            if b <= 0 and i not in cleared:
                cleared[i] = row.month_index
    end = (res.months[-1].month_index + 1) if res.months else 1
    return sorted(range(n), key=lambda i: (0, first_extra[i], i) if i in first_extra else (1, cleared.get(i, end), i))


@dataclass
class FeeOrderChoice:
    method: str                      # "exact" | "local"
    order: list[int] | None          # the fixed order kept; None = the greedy plan was kept
    net_cost: Decimal
    rate_only_net_cost: Decimal
    plans_run: int
    note: str | None                 # "why this loan first" when a fee changed the order


def choose_order(
    user,
    marginal_rate: Decimal,
    run_greedy: Callable[[], object],
    run_fixed: Callable[[list[int]], object],
) -> tuple[FeeOrderChoice, object]:
    """Pick the cheapest of the greedy plan and the candidate fixed orders.
    Returns the choice and the plan result that won."""
    n = len(user.loans)
    open_idx = [i for i, l in enumerate(user.loans) if l.outstanding > 0]
    results: dict[tuple, tuple[Decimal, object]] = {}

    def cost(order: tuple) -> Decimal:
        if order not in results:
            r = run_fixed(list(order))
            results[order] = (plan_net_cost(user, r, marginal_rate), r)
        return results[order][0]

    greedy = run_greedy()
    greedy_cost = plan_net_cost(user, greedy, marginal_rate)
    blind = tuple(rate_only_order(user, marginal_rate))
    blind_cost = cost(blind)

    if len(open_idx) <= EXACT_MAX_LOANS:
        method = "exact"
        for perm in itertools.permutations(open_idx):
            cost(perm)
    else:
        method = "local"
        fee_pos = {i for i in open_idx if (user.loans[i].prepayment_penalty_pct or D("0")) > 0}
        greedy_seq = tuple(i for i in payoff_sequence(greedy, n) if i in set(open_idx))
        current = min((blind, greedy_seq), key=cost)
        for _ in range(LOCAL_MAX_ROUNDS):
            neighbours = set()
            m = len(current)
            for a in range(m):
                for b in range(a + 1, m):
                    o = list(current)
                    o[a], o[b] = o[b], o[a]
                    neighbours.add(tuple(o))
            for a in range(m):
                if current[a] not in fee_pos:
                    continue
                for b in range(m):
                    if a != b:
                        o = list(current)
                        o.insert(b, o.pop(a))
                        neighbours.add(tuple(o))
            best_n = min(neighbours, key=lambda o: (cost(o), o)) if neighbours else current
            if cost(best_n) < cost(current) - TIE:
                current = best_n
            else:
                break

    # Cheapest fixed order; ties go to the rate-only order.
    best_order = min(results, key=lambda o: (results[o][0], o != blind, o))
    best_cost, best_res = results[best_order]
    tol = order_tolerance(user, greedy.total_interest_paid)
    if best_cost < greedy_cost - tol:
        chosen_order, chosen_cost, chosen_res = list(best_order), best_cost, best_res
    else:
        chosen_order, chosen_cost, chosen_res = None, greedy_cost, greedy

    note = _fee_note(user, chosen_res, results[blind][1], blind_cost - chosen_cost, n, tol)
    if note is None and chosen_order is None and TIE < greedy_cost - best_cost <= tol:
        from engine.restructuring_scan import _money
        sym = "₹" if user.country == Country.IN else "$"
        note = (f"Another payoff order would save about {_money((greedy_cost - best_cost).quantize(D('1')), sym)}, "
                "which is within rounding of the balances entered, so the plan keeps the order by rate.")
    return FeeOrderChoice(method, chosen_order, chosen_cost, blind_cost, len(results) + 1, note), chosen_res


def _label(l: Loan) -> str:
    t = LOAN_TYPE_NAME.get(l.loan_type.value if hasattr(l.loan_type, "value") else l.loan_type, "loan")
    bank = (l.bank or "").strip()
    if bank.lower().endswith(" bank"):
        bank = bank[:-5].strip()
    return f"{bank} {t}" if bank else t


def _pct(v: Decimal) -> str:
    s = f"{v * 100:.2f}".rstrip("0").rstrip(".")
    return f"{s}%"


def _fee_note(user, chosen_res, blind_res, saving: Decimal, n: int, tol: Decimal = TIE) -> str | None:
    """Plain words for "why this loan first" when a fee changed the order."""
    if saving <= max(TIE, tol):
        return None
    chosen = payoff_sequence(chosen_res, n)
    blind = payoff_sequence(blind_res, n)
    if chosen == blind:
        return None
    k = next(j for j in range(n) if chosen[j] != blind[j])
    first, displaced = user.loans[chosen[k]], user.loans[blind[k]]
    from engine.restructuring_scan import _money
    money = _money(saving.quantize(D("1")), "₹" if user.country == Country.IN else "$")
    fee_d = displaced.prepayment_penalty_pct or D("0")
    fee_f = first.prepayment_penalty_pct or D("0")
    if fee_d > fee_f:
        return (
            f"A prepayment fee changed this order. By rate alone the extra would go to your "
            f"{_label(displaced)} ({_pct(displaced.nominal_rate)}) before your {_label(first)} "
            f"({_pct(first.nominal_rate)}), but its {_pct(fee_d)} fee on every amount prepaid costs more "
            f"than the interest that prepaying it early saves. Putting the extra on your {_label(first)} "
            f"first saves about {money} over the plan, fees included."
        )
    return (
        f"A prepayment fee changed this order: the plan puts the extra on your {_label(first)} before "
        f"your {_label(displaced)}, which saves about {money} over the plan, fees included, compared with "
        f"going by rate alone."
    )


# ── A fee nobody knows (grill #29, sprint G1) ───────────────────────────────
# A blank fee on a fixed-rate loan (or a card, a US loan, a business loan RBI's
# rule doesn't clearly cover) is "Not known": the plan runs it at 0%. That can
# send the extra into a fee that is really there. So the plan is run twice,
# at 0% and at an illustrative high fee, and the user is asked for the fee
# only when the answer changes which loan the extra goes to first.
#
# 4% is illustrative, not a lender figure or an average: it is a stress test
# high enough to flip the order when a fee could matter. GST (18%) is added on
# top for an Indian loan, as a lender would. Copy must call it illustrative.
ILLUSTRATIVE_HIGH_FEE = D("0.04")


@dataclass(frozen=True)
class UnknownFeeCheck:
    ask_fee: bool                  # True: the first loan to prepay changes, ask for the fee
    loans: list[int]               # the unknown-fee loans (positions) that were stressed
    first_at_zero: int | None      # first loan to get extra with the fee at 0%
    first_at_high: int | None      # ... with the illustrative high fee
    note: str | None


def first_extra_target(res) -> int | None:
    """Position of the first loan the plan sends extra money to."""
    for row in res.months:
        if getattr(row, "extra_to_loan_index", None) is not None:
            return row.extra_to_loan_index
    return None


def unknown_fee_check(user, unknown_fee_loans: list[int], run: Callable[[object], object],
                      high_fee: Decimal = ILLUSTRATIVE_HIGH_FEE) -> UnknownFeeCheck:
    """`unknown_fee_loans`: positions of loans whose fee the user left blank
    and no rule fixes ("Not known"). `run(user) -> SimulationResult`."""
    idx = [i for i in unknown_fee_loans
           if 0 <= i < len(user.loans) and user.loans[i].outstanding > 0
           and not (user.loans[i].prepayment_penalty_pct or D("0")) > 0]
    if not idx:
        return UnknownFeeCheck(False, [], None, None, None)
    at_zero = first_extra_target(run(user))
    stressed = copy(user)
    stressed.loans = [copy(l) for l in user.loans]
    for i in idx:
        stressed.loans[i].prepayment_penalty_pct = high_fee
    at_high = first_extra_target(run(stressed))
    ask = at_zero != at_high
    note = None
    if ask and at_zero is not None:
        note = (f"Your {_label(user.loans[at_zero])} would get the extra first if it has no prepayment fee, "
                f"but not if it charges one (we tried an illustrative {_pct(high_fee)}). "
                "Check its loan agreement or Key Facts Statement for the prepayment charge and add it.")
    return UnknownFeeCheck(ask, idx, at_zero, at_high, note)
