"""What RightDue tells a borrower that a plain calculator doesn't (audit 80+ A1, A2, A5).

A1 "Where we disagree with a plain calculator, worth ₹X". A plain
calculator (an online EMI/avalanche tool, a spreadsheet, a general
assistant) orders loans by the rate printed on the statement, ignores
prepayment fees, lock-ins, GST on card interest and tax breaks, and leaves
every balance where it is. Each finding here is a place where the user's
own plan, run on the same simulator, does better than that, in rupees:

* "order": the plain calculator's order (highest printed rate first) run
  through RightDue's simulator against RightDue's own plan. The difference
  in what each pays beyond principal, net of tax (fee_order.plan_net_cost),
  is what the order is worth. The reason names what moved it: a
  prepayment fee or lock-in (fee_order.py), a tax break (24(b) / 80E /
  §163 / §221), or GST on card interest.
* "consolidation": moving a card over 30% a year to a personal loan
  (engine/consolidation.py), priced at the user's quote or the banks'
  published typical rate.
* "old_benchmark" / "missed_rate_cut": what Loan Check found on a loan
  (MCLR or base rate still running; a cut not passed on), as the user ran
  it; the figure is Loan Check's own this-year amount.
When none applies the answer is one line ("your order is the obvious
one") and the page turns to what RightDue watches each month.

A2: ask the payoff-order question only when the orders differ by more than
max(₹500 / $10, 0.5% of the plan's interest) or give different debt-free
months; otherwise pick the cheapest and say all orders give the same
result.

A5: when take-home doesn't cover spending plus minimums, the headline is
the monthly gap and three ways to close it, each sized against the gap.
"""
from __future__ import annotations

from copy import copy
from dataclasses import dataclass, field
from decimal import ROUND_HALF_UP, Decimal
from typing import Callable, Optional

from engine.fee_order import payoff_sequence, plan_net_cost
from engine.marginal_cost import uncapped_shields, user_marginal_costs
from engine.models import Country, Loan, LoanType, PayoffRules, User
from engine.ordering import Strategy

D = Decimal

ORDER_ABS_MIN = {Country.IN: D("500"), Country.US: D("10")}
ORDER_SHARE_MIN = D("0.005")
LOAN_NAME = {
    LoanType.HOME: "home loan", LoanType.AUTO: "car loan", LoanType.PERSONAL: "personal loan",
    LoanType.CREDIT_CARD: "credit card", LoanType.EDUCATION: "education loan",
    LoanType.LAP: "loan against property", LoanType.HOME_TOPUP: "home loan top-up",
    LoanType.TWO_WHEELER: "two-wheeler loan", LoanType.MEDICAL: "medical loan",
    LoanType.PEOPLE: "loan from a person",
}


def _q(x: Decimal) -> Decimal:
    return x.quantize(D("1"), rounding=ROUND_HALF_UP)


def loan_label(l: Loan) -> str:
    name = LOAN_NAME.get(l.loan_type, getattr(l.loan_type, "value", str(l.loan_type)).replace("_", " "))
    return f"{l.bank} {name}".strip() if l.bank else name


# ── A2: does the order matter? ──────────────────────────────────────────────

@dataclass
class OrderRun:
    strategy: str
    net_cost: Decimal
    interest: Decimal
    debt_free_month: Optional[int]


@dataclass
class OrderSpread:
    runs: list[OrderRun]
    cheapest: str
    spread: Decimal                 # dearest net cost - cheapest
    threshold: Decimal
    months_apart: int
    material: bool                  # ask the user to choose


def order_spread(user: User, run: Callable[[User, Strategy], object], marginal_rate: Decimal) -> OrderSpread:
    """Avalanche against Snowball (the two orders Setup offers before the
    user has set one of their own) on the user's plan."""
    runs = []
    for strat in (Strategy.AVALANCHE, Strategy.SNOWBALL):
        res = run(user, strat)
        runs.append(OrderRun(strat.value, _q(plan_net_cost(user, res, marginal_rate)), _q(res.total_interest_paid),
                             res.debt_free_month))
    cheapest = min(runs, key=lambda r: (r.net_cost, 0 if r.strategy == "avalanche" else 1))
    spread = max(r.net_cost for r in runs) - cheapest.net_cost
    months = [r.debt_free_month for r in runs]
    if all(m is None for m in months):
        apart = 0
    elif any(m is None for m in months):
        apart = 10**6
    else:
        apart = max(months) - min(months)
    floor = ORDER_ABS_MIN.get(user.country, ORDER_ABS_MIN[Country.IN])
    threshold = max(floor, _q(cheapest.interest * ORDER_SHARE_MIN))
    return OrderSpread(runs=runs, cheapest=cheapest.strategy, spread=spread, threshold=threshold,
                       months_apart=apart if apart < 10**6 else -1,
                       material=spread > threshold or apart > 0)


# ── A1: where RightDue disagrees with a plain calculator ────────────────────

@dataclass
class Disagreement:
    kind: str                       # order | consolidation | old_benchmark | missed_rate_cut
    worth: Decimal                  # rupees (dollars), never negative
    basis: str                      # over_plan | this_year
    headline: str
    detail: str
    reasons: list[str] = field(default_factory=list)
    loan_index: Optional[int] = None


@dataclass
class Disagreements:
    items: list[Disagreement]
    total_over_plan: Decimal
    plain_order: list[int]
    rightdue_order: list[int]
    zero_line: Optional[str]        # the one line when nothing differs


def plain_order(user: User) -> list[int]:
    """A plain calculator's order: highest printed (nominal) rate first."""
    open_ = [i for i, l in enumerate(user.loans) if l.outstanding > 0]
    return sorted(open_, key=lambda i: (-user.loans[i].nominal_rate, i))


def _order_reasons(user: User, moved: list[int], marginal_rate: Decimal) -> list[str]:
    shields = uncapped_shields(user.loans, user, marginal_rate)
    costs = user_marginal_costs(user.loans, user, marginal_rate)
    out: list[str] = []
    for i in moved:
        l = user.loans[i]
        from engine.prepayment_fee import chargeable_lock_in_months, chargeable_prepayment_pct
        fee = chargeable_prepayment_pct(l, user.country)
        lock = chargeable_lock_in_months(l, user.country)
        if fee > 0:
            out.append(f"the {loan_label(l)} charges {fee * 100:.1f}% on each part-payment")
        if lock > 0:
            out.append(f"the {loan_label(l)} takes no part-payment for {lock} months")
        if shields.get(id(l), D("0")) > 0:
            out.append(f"the {loan_label(l)}'s interest earns a tax break, so it costs less than its printed rate")
        mc = costs.get(id(l))
        if mc is not None and mc.gst > 0:
            out.append(f"the {loan_label(l)} adds 18% GST to its interest")
    return list(dict.fromkeys(out))


def order_disagreement(user: User, run_rules: Callable[[User], object], rightdue_res, marginal_rate: Decimal,
                       money: Callable[[Decimal], str]) -> tuple[Optional[Disagreement], list[int], list[int]]:
    """RightDue's plan against the plain calculator's order, both run on
    the same simulator. Positive worth only when RightDue's plan is cheaper
    by more than the A2 threshold's absolute floor."""
    n = len(user.loans)
    plain = plain_order(user)
    u = copy(user)
    u.payoff_rules = PayoffRules(custom_order=plain)
    plain_res = run_rules(u)
    rd_seq = [i for i in payoff_sequence(rightdue_res, n) if user.loans[i].outstanding > 0]
    worth = _q(plan_net_cost(user, plain_res, marginal_rate) - plan_net_cost(user, rightdue_res, marginal_rate))
    floor = ORDER_ABS_MIN.get(user.country, ORDER_ABS_MIN[Country.IN])
    if worth <= floor:
        return None, plain, rd_seq
    moved = [i for k, i in enumerate(rd_seq) if k >= len(plain) or plain[k] != i]
    reasons = _order_reasons(user, moved or rd_seq, marginal_rate)
    first = rd_seq[0] if rd_seq else None
    head = (f"A plain calculator would clear the highest printed rate first. "
            f"Your plan's order costs {money(worth)} less, net of tax and fees.")
    if first is not None and plain and plain[0] != first:
        head = (f"A plain calculator would put your extra on the {loan_label(user.loans[plain[0]])} first. "
                f"Your plan starts with the {loan_label(user.loans[first])}, which costs {money(worth)} less, "
                f"net of tax and fees.")
    detail = ("Why: " + "; ".join(reasons) + ".") if reasons else (
        "Why: what each loan really costs a year from here (compounded, after GST and tax), not its printed rate.")
    return Disagreement("order", worth, "over_plan", head, detail, reasons), plain, rd_seq


@dataclass(frozen=True)
class LoanCheckFindingIn:
    """What Loan Check found on one loan, as the browser kept it."""
    kind: str                       # old_benchmark | missed_rate_cut
    amount_this_year: Decimal
    overcharged_so_far: Decimal = D("0")
    lender: Optional[str] = None
    loan_index: Optional[int] = None


def disagreements(
    user: User,
    rightdue_res,
    run_rules: Callable[[User], object],
    marginal_rate: Decimal,
    money: Callable[[Decimal], str],
    consolidation=None,             # engine.consolidation.ConsolidationCard | None
    loan_check: Optional[list[LoanCheckFindingIn]] = None,
) -> Disagreements:
    items: list[Disagreement] = []
    order, plain, rd_seq = order_disagreement(user, run_rules, rightdue_res, marginal_rate, money)
    if order:
        items.append(order)
    # UX walkthrough fix 1: no "worth ₹X" for a move the plan makes pointless
    # (cards cleared within two months) or that saves nothing.
    if consolidation is not None and consolidation.scenarios and not getattr(consolidation, "not_worth_it", None):
        sc = consolidation.scenarios               # the user's quote, or the typical and high rates
        best = max(sc, key=lambda x: x.saving)
        if best.saving > 0:
            window = f" over the next {best.cost_window_months} months" if best.cost_window_months else ""
            what = "your card" if len(best.card_indices) == 1 else f"your {len(best.card_indices)} cards"
            if len(sc) == 1:
                rate_words = ("at the rate you entered" if best.rate_basis == "yours"
                              else "at the banks' typical personal-loan rate") + f" ({best.rate * 100:.1f}%)"
                worth, saves = best.saving, f"saves {money(best.saving)}"
                caveat = ""
            else:
                lo, hi = min(sc, key=lambda x: x.rate), max(sc, key=lambda x: x.rate)
                rate_words = f"at the rates banks charged last quarter ({lo.rate * 100:.1f}% typical, {hi.rate * 100:.1f}% high)"
                if all(x.saving > 0 for x in sc):
                    # Claim the conservative figure; the range is in the words.
                    worth = min(x.saving for x in sc)
                    saves = f"saves {money(worth)} to {money(best.saving)}"
                    caveat = ""
                else:
                    worth, saves = best.saving, f"saves {money(best.saving)} at the typical rate"
                    caveat = f" At {hi.rate * 100:.1f}% it doesn't pay, so it depends on the rate you're offered."
            items.append(Disagreement(
                "consolidation", worth, "over_plan",
                f"A plain calculator leaves {what} where it is. Moving it to a personal loan {rate_words} "
                f"{saves}{window}, fee and GST counted.{caveat}",
                f"The required payment goes from {money(best.card_minimum_now)} to {money(best.emi)} a month "
                f"at {best.rate * 100:.1f}%.",
                loan_index=best.card_indices[0],
            ))
    for f in loan_check or []:
        if f.amount_this_year <= 0 or f.kind not in ("old_benchmark", "missed_rate_cut"):
            continue
        who = f.lender or "your lender"
        if f.kind == "old_benchmark":
            head = (f"A plain calculator takes your rate as given. Loan Check found the loan with {who} still on "
                    f"an old benchmark (MCLR or base rate): switching to repo-linked is worth about "
                    f"{money(f.amount_this_year)} this year.")
        else:
            head = (f"A plain calculator takes your rate as given. Loan Check found {who} didn't pass on a rate "
                    f"cut: about {money(f.amount_this_year)} this year"
                    + (f", {money(f.overcharged_so_far)} overcharged so far." if f.overcharged_so_far > 0 else "."))
        items.append(Disagreement(f.kind, _q(f.amount_this_year), "this_year", head,
                                  "From the Loan Check you ran; run it again after your next statement.",
                                  loan_index=f.loan_index))
    total = sum((i.worth for i in items if i.basis == "over_plan"), D("0"))
    zero = None if items else (
        "Your order is the obvious one, and a plain calculator would get it right. "
        "What we'll watch for you: rate resets, a card creeping back up, and when a loan offer is a bad idea.")
    return Disagreements(items=items, total_over_plan=total, plain_order=plain, rightdue_order=rd_seq, zero_line=zero)


# ── A5: the gap and three ways to close it ──────────────────────────────────

@dataclass
class GapWay:
    kind: str                       # consolidate | stretch | spend
    monthly: Decimal                # how much a month it frees
    closes: Decimal                 # min(monthly, gap)
    closes_all: bool
    headline: str
    detail: str
    extra_cost: Optional[Decimal] = None    # interest it adds (stretch), rupees
    loan_index: Optional[int] = None


@dataclass
class GapHeadline:
    gap: Decimal
    ways: list[GapWay]
    closed_debt_free_month: Optional[int]   # the conditional date, demoted


STRETCH_MONTHS = {LoanType.HOME: 60, LoanType.EDUCATION: 24, LoanType.AUTO: 12}


def gap_ways(
    user: User,
    base,
    run: Callable[[User], object],
    money: Callable[[Decimal], str],
    consolidation=None,
    closed_debt_free_month: Optional[int] = None,
) -> Optional[GapHeadline]:
    """None unless month 1 is short. Up to three ways, largest first:
    move a dear card to a cheaper loan (cash freed), ask for a longer tenure
    on the loan with the biggest EMI that lenders do stretch (what it frees,
    what the extra months cost), and spend less or earn more by the gap."""
    from engine.tenure_whatif import stretch_tenure
    gap = base.months[0].shortfall if base.months else D("0")
    if gap <= 0:
        return None
    gap = _q(gap)
    ways: list[GapWay] = []
    if consolidation is not None and consolidation.scenarios and getattr(consolidation, "not_worth_it", None) != "plan_clears":
        sc = consolidation.scenarios
        # The conservative figure (the highest rate shown) is what is counted
        # against the gap; the range is in the words.
        s = min(sc, key=lambda x: x.cash_freed)
        top = max(sc, key=lambda x: x.cash_freed)
        if s.cash_freed > 0:
            frees = (f"frees {money(s.cash_freed)} a month" if top.cash_freed == s.cash_freed
                     else f"frees {money(s.cash_freed)} to {money(top.cash_freed)} a month")
            ways.append(GapWay(
                "consolidate", s.cash_freed, min(s.cash_freed, gap), s.cash_freed >= gap,
                f"Move the card to a personal loan: {frees}",
                f"At {s.rate * 100:.1f}% over {s.tenure_months} months the EMI is {money(s.emi)}"
                + (f" ({money(top.emi)} at {top.rate * 100:.1f}%)" if top is not s else "")
                + f", against a card minimum of {money(s.card_minimum_now)}.",
                loan_index=s.card_indices[0],
            ))
    stretchable = [
        (l.scheduled_emi, i) for i, l in enumerate(user.loans)
        if l.loan_type in STRETCH_MONTHS and l.outstanding > 0 and l.tenure_months_remaining > 0 and l.scheduled_emi > 0
    ]
    if stretchable:
        _, i = max(stretchable)
        l = user.loans[i]
        try:
            longer, change = stretch_tenure(user, i, STRETCH_MONTHS[l.loan_type])
        except ValueError:
            longer = None
        if longer is not None:
            freed = _q(change.old_emi - change.new_emi)
            if freed > 0:
                after = run(longer)
                extra = None
                # Capped plans (C11 infeasible_from_month) clear only on paper:
                # their interest totals leave the unfunded part out.
                if all(r.debt_free_month is not None and getattr(r, "infeasible_from_month", None) is None
                       for r in (base, after)):
                    extra = _q(after.total_interest_paid - base.total_interest_paid)
                ways.append(GapWay(
                    "stretch", freed, min(freed, gap), freed >= gap,
                    f"Ask for {change.new_tenure - change.old_tenure} more months on the {loan_label(l)}: "
                    f"frees {money(freed)} a month",
                    f"The EMI goes from {money(change.old_emi)} to {money(change.new_emi)}. Outside a rate reset "
                    f"a longer tenure is the lender's decision, so ask; at a reset RBI says they must offer it.",
                    extra_cost=extra, loan_index=i,
                ))
    spend = user.fixed_expenses + (user.variable_expenses or D("0"))
    share = f" (about {gap / spend * 100:.0f}% of your spending)" if spend > 0 else ""
    ways.append(GapWay(
        "spend", gap, gap, True,
        f"Spend {money(gap)} less, or bring in {money(gap)} more, a month{share}",
        "Even part of it helps: every rupee closed is a rupee not borrowed at card rates.",
    ))
    # Rupee findings first, the plain lever last.
    return GapHeadline(gap=gap, ways=ways[:3], closed_debt_free_month=closed_debt_free_month)
