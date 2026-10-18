"""Once only cheap debt is left: prepay, keep the money, or split? (audit 80+ A4, D1)

Why this exists. The plan used to send every spare rupee to whatever debt
was left, including an 8.6% home loan, without asking. Once every loan left
costs under LOW_RATE_THRESHOLD a year (compounded, after GST and any tax
break: the marginal cost the order uses), whether to prepay is a question
only the user can answer, because the alternative's return is uncertain and
theirs to judge. So the plan stops and asks, with no default.

What it shows (the founder asked for the best way to put the question, not
just the audit's three buttons). For each share of the extra kept back
(0%, 25%, 50%, 75%, 100%), run on the user's own plan:
  * the debt-free date;
  * money in hand on ONE common date: the day the slowest option clears
    (keeping everything, the loans run to their own end). Comparing each
    option on its own debt-free date would flatter whichever finishes last,
    so every option is valued on the same day. After an option clears,
    everything it used to pay the loans is kept as well, so the money is
    comparable rupee for rupee;
  * the break-even return: the yearly return, after tax, at which keeping
    everything and prepaying everything end level. This is the honest core
    of the answer: "prepaying earns exactly the loan's cost, for certain;
    money kept back has to beat X% a year after tax to come out ahead."
The return used for "money in hand" is one the user types or picks. The
module never suggests one, never names a security, fund, issuer or kind of
security, and never tells the user to invest (D1: SEBI (Investment
Advisers) Regulations 2013 as amended to 25 Nov 2025, reg. 2(1)(l)
"investment advice ... shall include financial planning", reg. 2(1)(h)
"financial planning shall include analysis of clients' current financial
situation, identification of their financial goals, and developing and
recommending financial strategies to realise such goals", reg. 2(1)(m) an
investment adviser acts "for consideration";
https://www.sebi.gov.in/sebi_data/attachdocs/aug-2026/1785912187595.pdf,
read 14 Oct 2026). Since 16 Dec 2024 "investment advice" covers securities
only, but a personalised "put your money in X" built from one user's data is
still the sentence a regulator would quote, so every line here is a
statement about the user's own assumption ("at the X% you entered ..."),
never an instruction. Counsel review stays a founder action.

Money kept back is booked in the simulator as `invested_this_month`
(engine/simulation.py `low_rate_invest`); this module grows it at the
user's return, monthly, from the month it is kept. Tax refunds from a
deductible loan (24(b) old regime, §163) are counted in every option, at the
end of each plan year, from the same yearly-capped calculation the payoff
order uses.
"""
from __future__ import annotations

from engine.plan_end import shown_debt_free_month

from dataclasses import dataclass, field
from decimal import ROUND_HALF_UP, Decimal
from typing import Callable, Optional

from engine.marginal_cost import IN_HOME_INTEREST_CAP, US_STUDENT_INTEREST_CAP, uncapped_shields, user_marginal_costs
from engine.models import Country, LoanType, User, tax_type

D = Decimal

# Round 2 (founder, 15 Oct 2026, item 3): the old fixed rule ("every loan
# left under 10% a year after tax") is replaced by a per-loan comparison
# with the user's OWN assumed return after tax plus a 1-point margin, and
# the question waits until the emergency fund target is met. Default
# assumption when the user hasn't typed one (shown as an assumption,
# editable on Plan): 6.5% India / 4% US after tax, an FD-like / savings-
# account-like figure. No product, issuer or kind of security is named.
# VERIFY: the two defaults are founder figures, not read from a source.
DEFAULT_ASSUMED_RETURN = {"IN": D("0.065"), "US": D("0.04")}
SPLIT_MARGIN = D("0.01")
# Kept for callers that still pass an explicit threshold (old behaviour).
LOW_RATE_THRESHOLD = D("0.10")
SHARES = (D("0"), D("0.25"), D("0.5"), D("0.75"), D("1"))
MAX_RETURN = D("0.30")


class PrepayInvestInputError(ValueError):
    def __init__(self, field_name: str, message: str):
        super().__init__(message)
        self.field = field_name


def _q(x: Decimal) -> Decimal:
    return x.quantize(D("1"), rounding=ROUND_HALF_UP)


@dataclass
class Phase:
    month: int                       # first plan month (1-based) when only cheap debt is left and there is extra
    loans: list[int]                 # positions of the loans still open then
    extra_then: Decimal              # the month's spare cash then
    loan_costs: dict[int, Decimal]   # position -> yearly cost (compounded, GST, tax)


def assumed_return(user: User) -> tuple[Decimal, bool]:
    """(the user's assumed yearly return after tax, True when it is the
    default rather than their own figure)."""
    if user.assumed_post_tax_return is not None:
        return user.assumed_post_tax_return, False
    return DEFAULT_ASSUMED_RETURN.get(user.country.value, DEFAULT_ASSUMED_RETURN["US"]), True


def split_threshold(user: User) -> Decimal:
    """A loan gets the prepay / keep / split question when its yearly cost
    after tax is below this: the user's assumed return + SPLIT_MARGIN."""
    return assumed_return(user)[0] + SPLIT_MARGIN


def split_eligible(user: User, marginal_rate: Decimal, threshold: Optional[Decimal] = None) -> dict[int, bool]:
    """{loan position: True when that loan, on its own, costs less after tax
    than the threshold}. Per-loan, so the page can say which loans the
    question is about; the plan only asks once every open loan qualifies
    (money is never kept back while a dearer loan is still open)."""
    t = split_threshold(user) if threshold is None else threshold
    costs = user_marginal_costs(user.loans, user, marginal_rate)
    return {i: costs[id(l)].annual_cost < t for i, l in enumerate(user.loans) if id(l) in costs}


def efund_met(user: User, row) -> bool:
    """The emergency fund target is met at the end of this plan month (a
    user with no target has nothing to wait for)."""
    target = user.efund_target or D("0")
    return target <= 0 or getattr(row, "efund_balance", D("0")) >= target


def low_rate_phase(user: User, base_res, marginal_rate: Decimal, threshold: Optional[Decimal] = None) -> Optional[Phase]:
    """When the plan reaches the point where every open loan costs under
    `threshold` a year (default: split_threshold(user)), the emergency fund
    target is met, and there is spare cash to place; None if it never does
    (a dear loan lasts the whole plan, the fund never fills, or nothing is
    left over)."""
    if threshold is None:
        threshold = split_threshold(user)
    costs = user_marginal_costs(user.loans, user, marginal_rate)
    yearly = {i: costs[id(l)].annual_cost for i, l in enumerate(user.loans) if id(l) in costs}
    prev = {i: l.outstanding for i, l in enumerate(user.loans)}
    for row in base_res.months:
        open_ = [i for i, b in prev.items() if b > 0]
        if (open_ and all(yearly.get(i, D("1")) < threshold for i in open_) and row.available_surplus > 0
                and efund_met(user, row)):
            return Phase(row.month_index, open_, _q(row.available_surplus), {i: yearly[i] for i in open_})
        prev = {i: row.balances_by_loan_index.get(i, D("0")) for i in prev}
    return None


def yearly_tax_saved(user: User, res, marginal_rate: Decimal) -> list[tuple[int, Decimal]]:
    """(month the refund lands, amount) per plan year: the tax the plan's
    deductible interest saves, with the ₹2L 24(b) / $2,500 §221 caps per
    year. Same rule as fee_order.plan_net_cost, kept by year."""
    loans = user.loans
    shield = uncapped_shields(loans, user, marginal_rate)
    if not any(v > 0 for v in shield.values()):
        return []
    from engine.formulas import loan_market
    own = user.country

    def cap_of(l):
        if loan_market(l, own) != own:
            return None
        if own == Country.IN and tax_type(l) == LoanType.HOME:
            return ("home", IN_HOME_INTEREST_CAP)
        if own == Country.US and l.loan_type == LoanType.EDUCATION:
            return ("edu", US_STUDENT_INTEREST_CAP)
        return None

    out: list[tuple[int, Decimal]] = []
    prev = {i: l.outstanding for i, l in enumerate(loans)}
    year: dict[int, Decimal] = {}

    def close(month: int):
        saved, groups = D("0"), {}
        for i, x in year.items():
            g = cap_of(loans[i])
            if g is None:
                saved += shield[id(loans[i])] * x
            else:
                groups.setdefault(g[0], [g[1], []])[1].append((i, x))
        for cap, items in groups.values():
            total = sum((x for _, x in items), D("0"))
            scale = min(D("1"), cap / total) if total > 0 else D("1")
            saved += sum((shield[id(loans[i])] * x * scale for i, x in items), D("0"))
        if saved > 0:
            out.append((month, saved))
        year.clear()

    last = 0
    for k, row in enumerate(res.months):
        for i, l in enumerate(loans):
            if shield[id(l)] > 0 and prev[i] > 0:
                year[i] = year.get(i, D("0")) + prev[i] * l.nominal_rate / 12
        prev = {i: row.balances_by_loan_index.get(i, D("0")) for i in prev}
        last = row.month_index
        if (k + 1) % 12 == 0:
            close(row.month_index)
    if year:
        close(last)
    return out


@dataclass
class Option:
    share_kept: Decimal              # of the extra, once only cheap debt is left
    debt_free_month: Optional[int]
    interest_paid: Decimal
    kept_by_debt_free: Decimal       # money kept, grown, on this option's own debt-free date (needs a return)
    money_on_common_date: Optional[Decimal]   # grown to the common date (needs a return)
    # The streams, so the page (or a test) can regrow them at another return.
    contributions: list[tuple[int, Decimal]] = field(default_factory=list)


@dataclass
class PrepayInvest:
    phase: Phase
    threshold: Decimal
    common_month: int                # the date every option is valued on
    assumed_return: Optional[Decimal]
    options: list[Option]
    break_even_return: Optional[Decimal]   # after tax, yearly; None if keeping never catches up below MAX_RETURN
    statement: str                   # one neutral line about the user's own assumption


def _grow(stream: list[tuple[int, Decimal]], to_month: int, r: Decimal) -> Decimal:
    g = (D("1") + r) ** (D("1") / D("12"))
    return sum((amt * g ** (to_month - m) for m, amt in stream if m <= to_month), D("0"))


def compare(
    user: User,
    run: Callable[[User, Optional[tuple[Decimal, Decimal]]], object],
    marginal_rate: Decimal,
    assumed_return: Optional[Decimal] = None,
    shares: tuple[Decimal, ...] = SHARES,
    threshold: Optional[Decimal] = None,
    money: Callable[[Decimal], str] = lambda x: f"{_q(x):,}",
    month_label: Callable[[int], str] = lambda m: f"month {m}",
) -> Optional[PrepayInvest]:
    """`run(user, low_rate_invest)` runs the user's plan (their strategy,
    goals, fund split...) with the given (threshold, share), or None for
    the plan as it stands."""
    if assumed_return is not None and not (D("0") <= assumed_return <= MAX_RETURN):
        raise PrepayInvestInputError("assumed_return", "Enter a yearly return between 0% and 30%.")
    if threshold is None:
        threshold = split_threshold(user)
    base = run(user, None)
    if base.months and base.months[0].shortfall > 0:
        return None                   # short: closing the gap comes first
    phase = low_rate_phase(user, base, marginal_rate, threshold)
    if phase is None:
        return None
    shares = tuple(sorted(set(shares) | {D("0"), D("1")}))
    runs = {s: run(user, (threshold, s)) for s in shares}
    keep_all = runs[D("1")]
    common = keep_all.debt_free_month or len(keep_all.months)
    budget_row = {row.month_index: row for row in keep_all.months}

    def stream(s: Decimal) -> list[tuple[int, Decimal]]:
        res = runs[s]
        out = [(row.month_index, row.invested_this_month) for row in res.months if row.invested_this_month > 0]
        out += yearly_tax_saved(user, res, marginal_rate)
        end = res.debt_free_month or len(res.months)
        # After this option clears, all it paid the loans is kept too: the
        # whole debt budget of that month, read from the keep-everything run
        # (which is still paying its loans then, income rises included).
        for m in range(end + 1, common + 1):
            row = budget_row.get(m)
            if row is None:
                continue
            # Kept + paid to the loans that month: the money every option
            # splits between the two (goals and the fund are the same in each).
            budget = row.invested_this_month + row.total_payment_nominal
            if budget > 0:
                out.append((m, budget))
        return out

    streams = {s: stream(s) for s in shares}
    options = []
    for s in shares:
        res = runs[s]
        own = res.debt_free_month or len(res.months)
        options.append(Option(
            share_kept=s, debt_free_month=shown_debt_free_month(res), interest_paid=_q(res.total_interest_paid),
            kept_by_debt_free=_q(_grow([c for c in streams[s] if c[0] <= own], own, assumed_return)) if assumed_return is not None else D("0"),
            money_on_common_date=_q(_grow(streams[s], common, assumed_return)) if assumed_return is not None else None,
            contributions=streams[s],
        ))

    def edge(r: Decimal) -> Decimal:
        return _grow(streams[D("1")], common, r) - _grow(streams[D("0")], common, r)

    be: Optional[Decimal] = None
    if edge(MAX_RETURN) > 0:
        lo, hi = D("0"), MAX_RETURN
        if edge(lo) >= 0:
            be = D("0")
        else:
            for _ in range(40):
                mid = (lo + hi) / 2
                if edge(mid) > 0:
                    hi = mid
                else:
                    lo = mid
            be = ((lo + hi) / 2).quantize(D("0.0001"))

    when = month_label(common)
    if assumed_return is None:
        statement = (
            f"Prepaying earns exactly what the loan costs, for certain. Money kept back comes out ahead by {when} "
            f"only if it earns more than {be * 100:.1f}% a year after tax." if be is not None else
            f"Prepaying comes out ahead by {when} at any return up to {MAX_RETURN * 100:.0f}% a year after tax.")
    else:
        all_kept = next(o for o in options if o.share_kept == D("1"))
        none_kept = next(o for o in options if o.share_kept == D("0"))
        diff = (all_kept.money_on_common_date or D("0")) - (none_kept.money_on_common_date or D("0"))
        r = f"{assumed_return * 100:.1f}%"
        if diff > 0:
            statement = (f"At the {r} a year after tax you entered, keeping the extra ends with {money(diff)} more "
                         f"by {when} than prepaying it, if that return holds every year.")
        elif diff < 0:
            statement = (f"At the {r} a year after tax you entered, prepaying ends with {money(-diff)} more by "
                         f"{when} than keeping the extra.")
        else:
            statement = f"At the {r} a year after tax you entered, both end level by {when}."
        if be is not None:
            statement += f" They're level at {be * 100:.1f}%."
    return PrepayInvest(phase=phase, threshold=threshold, common_month=common, assumed_return=assumed_return,
                        options=options, break_even_return=be, statement=statement)
