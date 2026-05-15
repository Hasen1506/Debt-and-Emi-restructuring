"""Month-by-month plan simulation (§5).

Drives Layers 0-3 forward in time and returns the schedule the Plan screen renders.

Per month:
  1. Compute available_surplus (§4.23) including salary growth + match deduction.
  2. Layer 3 invest-vs-prepay gate: if loan's effective rate doesn't beat best
     liquid return + 0.5pp, redirect that loan's extra to investment instead.
  3. Rank remaining loans by Layer 2 strategy.
  4. Allocate minimums to all loans; route extra to top-priority loan.
  5. Amortise each loan; when one clears, §4.21 cascade frees its minimum + extra.

Salary growth: apply `annual_hike_rate` once every 12 months.
Real-EMI: nominal payments deflated by `inflation_rate` per §4.10.
"""
from decimal import Decimal
from dataclasses import dataclass, field
from copy import deepcopy
from engine.models import User, Loan, Country, TaxRegimeIN, InvestmentOption, LiquidityClass
from engine.formulas import effective_rate, prepay_recommended, real_emi
from engine.minimum_payments import compute_minimum_payment
from engine.ordering import Strategy, rank_loans
from engine.surplus import compute_available_surplus

D = Decimal


@dataclass
class MonthRow:
    month_index: int                          # 1-based
    available_surplus: Decimal
    total_payment_nominal: Decimal
    total_payment_real: Decimal
    interest_paid_month: Decimal
    principal_paid_month: Decimal
    invested_this_month: Decimal
    balances: dict[int, Decimal]              # {id(loan): balance after this month}
    cleared_this_month: list[int]             # ids of loans that hit zero
    # Per-loan total payment for THIS month, including any cascade. Keyed by
    # 0-based POSITION in the original user.loans list (NOT id(loan)) so
    # consumers can join against the user's loan list without Python pointers.
    # Stays empty for months where every loan has cleared.
    payments_by_loan_index: dict[int, Decimal] = field(default_factory=dict)


@dataclass
class SimulationResult:
    months: list[MonthRow]
    debt_free_month: int | None               # 1-based; None if not paid off in horizon
    total_interest_paid: Decimal
    total_invested: Decimal
    final_balances: dict[int, Decimal]


def _marginal_rate(user: User, marginal_rate_override: Decimal | None) -> Decimal:
    if marginal_rate_override is not None:
        return marginal_rate_override
    return D("0")


def _liquid_pool(options: list[InvestmentOption]) -> list[InvestmentOption]:
    return [o for o in options if o.liquidity_class == LiquidityClass.LIQUID and o.is_in_pool]


def _best_liquid_return(options: list[InvestmentOption]) -> Decimal:
    pool = _liquid_pool(options)
    if not pool:
        return D("0")
    return max(o.expected_return for o in pool)


def _first_hike_month_index(
    simulation_start_month: int, hike_effective_month: int
) -> int:
    """First sim-month index (1-based) at which the annual hike fires.

    If `simulation_start_month == hike_effective_month`, the caller's
    current income is assumed to already include this year's hike — so we
    defer to next year (m=13).
    """
    m = ((hike_effective_month - simulation_start_month) % 12) + 1
    return m if m > 1 else 13


def simulate_plan(
    user: User,
    strategy: Strategy = Strategy.AVALANCHE,
    horizon_months: int = 360,
    matched_contribution: Decimal = D("0"),
    marginal_rate: Decimal | None = None,
    simple_mode: bool = False,
    income_delta: Decimal = D("0"),
    income_delta_from_month: int = 1,
    simulation_start_month: int = 1,
) -> SimulationResult:
    """Run the plan forward `horizon_months`. Returns one MonthRow per month
    until either all loans clear or horizon is reached.

    Loans in `user.loans` are deep-copied — the caller's data is not mutated.

    `income_delta` (default 0) is added to `monthly_income` starting at
    `income_delta_from_month` (1-based, default 1 = from the start). This
    lets the sensitivity engine model "I'll trim ₹5k/mo from month 7
    onwards" without mutating the user upfront.

    `simulation_start_month` (1-12, default 1=Jan) is the calendar month
    corresponding to sim month m=1. Combined with `user.hike_effective_month`,
    it anchors annual income hikes to the user's actual FY/anniversary month
    instead of firing at m=13 regardless of calendar. Default `1` preserves
    the legacy "hike at m=13" behavior so existing callers/tests are unaffected.
    """
    loans = [deepcopy(l) for l in user.loans]
    # Map deep-copied loan identity → its original position in user.loans.
    # Used to translate per-loan payments into a position-keyed dict that
    # the API can pass to the frontend without leaking Python ids.
    loan_position = {id(l): i for i, l in enumerate(loans)}
    income = user.monthly_income
    if income_delta != D("0") and income_delta_from_month <= 1:
        # Apply immediately — preserves the old with_surplus_delta semantics
        # where the delta was baked into user.monthly_income before the call.
        income = income + income_delta
    marg = _marginal_rate(user, marginal_rate)
    months: list[MonthRow] = []
    total_interest = D("0")
    total_invested = D("0")
    best_liquid_return = _best_liquid_return(user.investment_options)
    inflation = user.inflation_rate
    debt_free_month: int | None = None
    first_hike = _first_hike_month_index(simulation_start_month, user.hike_effective_month)

    for m in range(1, horizon_months + 1):
        # Salary growth — fires at the user's hike-effective month, then every 12.
        # With default simulation_start_month=1 and hike_effective_month=1 this
        # resolves to m=13, 25, 37 …, matching the pre-FY-anchoring behavior.
        if (
            user.annual_hike_rate > 0
            and m >= first_hike
            and (m - first_hike) % 12 == 0
        ):
            income = income * (D("1") + user.annual_hike_rate)

        # Deferred surplus delta — kicks in at the user's chosen month.
        # `+=` only on the exact firing month so it stacks with subsequent
        # salary growth without doubling up.
        if income_delta != D("0") and m == income_delta_from_month and m > 1:
            income = income + income_delta

        # Filter out paid-off loans
        active = [l for l in loans if l.outstanding > 0]
        if not active:
            debt_free_month = m - 1
            break

        # Minimum payments per active loan
        minimums = {id(l): compute_minimum_payment(l, user.country, simple_mode=simple_mode)
                    for l in active}

        # Effective rate per loan (drives ordering + Layer 3 gate)
        rates = {
            id(l): effective_rate(l, marg, user.country, user.tax_regime)
            for l in active
        }

        # Available surplus this month — recompute with current income
        scratch_user = deepcopy(user)
        scratch_user.monthly_income = income
        scratch_user.loans = active
        surplus = compute_available_surplus(
            scratch_user, active, matched_contribution=matched_contribution,
            simple_mode=simple_mode,
        )

        # Layer 3 — invest-vs-prepay gate per loan
        # If the top-priority loan fails the gate, redirect its extra to investment.
        ranked = rank_loans(active, rates, strategy, country=user.country)
        invested_this_month = D("0")
        extra_for_debt = surplus

        if ranked and surplus > 0:
            top = ranked[0]
            if not prepay_recommended(rates[id(top)], best_liquid_return, inflation):
                invested_this_month = surplus
                extra_for_debt = D("0")

        # Allocate
        payments = {id(l): minimums[id(l)] for l in active}
        if extra_for_debt > 0 and ranked:
            payments[id(ranked[0])] += extra_for_debt

        # Amortise each loan; track cascade
        interest_paid = D("0")
        principal_paid = D("0")
        cleared: list[int] = []
        cascade_surplus = D("0")

        for l in active:
            monthly_rate = l.nominal_rate / D("12")
            interest_this = l.outstanding * monthly_rate
            pay = payments[id(l)]
            principal_this = pay - interest_this
            if principal_this >= l.outstanding:
                # Loan clears; cascade the unused portion
                refund = principal_this - l.outstanding
                principal_this = l.outstanding
                cascade_surplus += refund
                l.outstanding = D("0")
                cleared.append(id(l))
                # Refund came off this loan's payment — it never actually
                # left the user's account toward this bank.
                payments[id(l)] = pay - refund
            else:
                l.outstanding -= principal_this
            interest_paid += interest_this
            principal_paid += principal_this

        # Apply cascade within the same month to the next-priority active loan
        # (after the clears we just processed)
        if cascade_surplus > 0:
            next_active = [l for l in ranked if l.outstanding > 0]
            if next_active:
                top = next_active[0]
                monthly_rate = top.nominal_rate / D("12")
                add_principal = cascade_surplus
                if add_principal >= top.outstanding:
                    add_principal = top.outstanding
                    cleared.append(id(top))
                top.outstanding -= add_principal
                principal_paid += add_principal
                # Reflect the cascade in the per-loan payment dict so the UI
                # can show the real amount the user sends to that bank.
                payments[id(top)] = payments.get(id(top), D("0")) + add_principal

        total_payment_nominal = interest_paid + principal_paid
        total_payment_real = real_emi(total_payment_nominal, inflation, m)

        balances_snapshot = {id(l): l.outstanding for l in loans}

        payments_by_idx = {
            loan_position[lid]: amt
            for lid, amt in payments.items()
            if amt > D("0")
        }
        months.append(MonthRow(
            month_index=m,
            available_surplus=surplus,
            total_payment_nominal=total_payment_nominal,
            total_payment_real=total_payment_real,
            interest_paid_month=interest_paid,
            principal_paid_month=principal_paid,
            invested_this_month=invested_this_month,
            balances=balances_snapshot,
            cleared_this_month=cleared,
            payments_by_loan_index=payments_by_idx,
        ))

        total_interest += interest_paid
        total_invested += invested_this_month

        if all(l.outstanding == 0 for l in loans):
            debt_free_month = m
            break

    return SimulationResult(
        months=months,
        debt_free_month=debt_free_month,
        total_interest_paid=total_interest,
        total_invested=total_invested,
        final_balances={id(l): l.outstanding for l in loans},
    )


def baseline_minimums_only(
    user: User,
    horizon_months: int = 360,
    simple_mode: bool = False,
) -> SimulationResult:
    """Counterfactual: pay only minimums (no extra), no Layer 3 redirection.
    Used to compute `savings_vs_minimums` for the Plan screen.
    """
    loans = [deepcopy(l) for l in user.loans]
    months: list[MonthRow] = []
    total_interest = D("0")
    debt_free_month: int | None = None

    for m in range(1, horizon_months + 1):
        active = [l for l in loans if l.outstanding > 0]
        if not active:
            debt_free_month = m - 1
            break

        interest_paid = D("0")
        principal_paid = D("0")
        cleared: list[int] = []
        for l in active:
            mp = compute_minimum_payment(l, user.country, simple_mode=simple_mode)
            monthly_rate = l.nominal_rate / D("12")
            interest_this = l.outstanding * monthly_rate
            principal_this = mp - interest_this
            if principal_this <= 0:
                # Minimum doesn't cover interest — loan grows. Cap principal at zero.
                interest_paid += interest_this
                continue
            if principal_this >= l.outstanding:
                principal_this = l.outstanding
                cleared.append(id(l))
            l.outstanding -= principal_this
            interest_paid += interest_this
            principal_paid += principal_this

        balances_snapshot = {id(l): l.outstanding for l in loans}
        months.append(MonthRow(
            month_index=m,
            available_surplus=D("0"),
            total_payment_nominal=interest_paid + principal_paid,
            total_payment_real=real_emi(interest_paid + principal_paid, user.inflation_rate, m),
            interest_paid_month=interest_paid,
            principal_paid_month=principal_paid,
            invested_this_month=D("0"),
            balances=balances_snapshot,
            cleared_this_month=cleared,
        ))
        total_interest += interest_paid
        if all(l.outstanding == 0 for l in loans):
            debt_free_month = m
            break

    return SimulationResult(
        months=months, debt_free_month=debt_free_month,
        total_interest_paid=total_interest, total_invested=D("0"),
        final_balances={id(l): l.outstanding for l in loans},
    )
