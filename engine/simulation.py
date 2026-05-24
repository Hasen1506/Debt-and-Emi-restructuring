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
from engine.models import (
    User,
    Loan,
    LoanType,
    Country,
    TaxRegimeIN,
    InvestmentOption,
    LiquidityClass,
    LifecycleEvent,
    LifecycleEventKind,
)
from engine.formulas import effective_rate, prepay_recommended, real_emi
from engine.minimum_payments import compute_minimum_payment
from engine.ordering import Strategy, rank_loans
from engine.goals import GoalState, MonthlyGoalAllocation, serial_fill_allocation
from engine.surplus import (
    allocate_surplus,
    compute_available_surplus,
    compute_efund_monthly,
    from_user_currency,
    loan_currency_or_default,
    to_user_currency,
)

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
    # Outstanding-balance breakdown by loan currency this month. Keys are
    # currency codes ("INR", "USD"); values are the sum of balances for
    # loans tagged with that currency. Lets the API expose a per-currency
    # trajectory series without leaking the engine's id(loan) bookkeeping.
    balances_by_currency: dict[str, Decimal] = field(default_factory=dict)
    # Per-loan outstanding this month, keyed by 0-based position in the
    # original user.loans list. Drives the per-loan trajectory chart on
    # /plan — each loan's curve shrinks visibly until it clears. Includes
    # cleared loans with value 0 so chart consumers see a flat-at-0 tail
    # rather than a vanishing series.
    balances_by_loan_index: dict[int, Decimal] = field(default_factory=dict)
    # Per-goal contribution this month, keyed by goal id. Empty when
    # `goals` wasn't passed to simulate_plan. Lets the API expose an
    # engine-truth array so client-side achievability can sum actuals
    # (accounting for inflation / hike / expiry) instead of multiplying
    # a single static surplus by a month count.
    goal_contributions: dict[str, Decimal] = field(default_factory=dict)


@dataclass
class SimulationResult:
    months: list[MonthRow]
    debt_free_month: int | None               # 1-based; None if not paid off in horizon
    total_interest_paid: Decimal
    total_invested: Decimal
    final_balances: dict[int, Decimal]
    # First-month goal allocation snapshot. Populated when `goals` was
    # passed to simulate_plan; None otherwise. Lets the API handler
    # surface per-goal contributions in the SurplusAllocationOut
    # response without re-running the allocator.
    first_month_goal_allocation: MonthlyGoalAllocation | None = None


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


def _resolve_hike_rate(user: User, year_idx: int) -> Decimal:
    """Pick the hike rate that applies to the year-`year_idx` hike event.

    `year_idx` is 1-based: the first hike fires at the end of year 1 in
    the simulation (i.e. month ~12-13), the second at year 2, etc.

    Falls back to the scalar `annual_hike_rate` when:
      • the schedule is empty (legacy behaviour);
      • no phase covers this year (gap in user-defined ranges).

    Phases are checked in order; the first matching one wins. Overlaps
    aren't validated at the engine level — the caller (frontend form)
    enforces non-overlap when building the list.
    """
    for y_from, y_to, rate in user.hike_schedule or []:
        if y_from <= year_idx < y_to:
            return rate
    return user.annual_hike_rate


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
    reinvest_events: list[tuple[int, Decimal]] | None = None,
    inflate_expenses: bool = False,
    lifecycle_events: list[LifecycleEvent] | None = None,
    ef_top_up_rate: Decimal = D("0"),
    goals: list[GoalState] | None = None,
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

    `reinvest_events` is an optional list of (month_index, amount) tuples in
    the user's residence currency. At each matching month, after normal
    minimums + surplus + cascade have been applied, the engine routes the
    amount as additional principal to the highest-effective-APR active loan.
    Used by the "auto-reinvest tax savings" toggle on /plan — the frontend
    pre-computes annual deductible-interest × marginal_rate and seeds these
    events at the post-ITR-filing month of each fiscal year. Empty / None
    means no reinvest stream.

    `inflate_expenses` (default False) drives the /plan inflation toggle:
    when True, fixed_expenses + variable_expenses grow by `(1 + inflation_rate)
    ^(m/12)` each month so the available surplus shrinks over time as the
    user's purchasing power erodes. False preserves legacy flat-expenses
    behaviour for callers / tests that don't opt in.

    `ef_top_up_rate` (default 0) drives the soft emergency-fund waterfall:
    when > 0 AND `user.efund_balance < user.efund_target`, that fraction of
    each month's surplus is diverted into the EF pool before the remainder
    flows into debt prepayment. Once the running EF balance reaches
    `efund_target`, allocation switches back to 100% debt. Default 0
    preserves the legacy "all surplus → debt" behaviour for tests and
    for users who haven't set an EF target.

    `goals` (default None) is the engine-authoritative per-goal state
    list. When provided, the serial-fill allocator runs each month,
    routing surplus to goals in user-effective order before the
    EF/debt cascade. An explicit empty list means "no active goals"
    (cascade gets the full surplus). When None, the engine skips the
    goal block entirely — the legacy "all surplus → EF/debt" behaviour
    for callers that don't model goals.
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
    # Soft EF waterfall state — running balance that grows by the diverted
    # surplus each month until ef_target is hit. Frozen at 0 / no diversion
    # when ef_top_up_rate=0 (legacy default).
    ef_balance = user.efund_balance
    ef_target = user.efund_target
    best_liquid_return = _best_liquid_return(user.investment_options)
    inflation = user.inflation_rate
    debt_free_month: int | None = None
    first_month_alloc: MonthlyGoalAllocation | None = None
    first_hike = _first_hike_month_index(simulation_start_month, user.hike_effective_month)
    # Pre-compute the monthly compounding factor for the inflation toggle —
    # Decimal doesn't support fractional exponents natively, so we convert
    # via float once at setup. Precision loss ≪ 1bp; engine doesn't need
    # accountant accuracy on inflation projections.
    monthly_inflation_factor = (
        D(str((1 + float(inflation)) ** (1 / 12)))
        if inflate_expenses and inflation > 0
        else D("1")
    )
    # Same trick for FX drift — capture the spot rates we started with and
    # pre-compute monthly compounding factors per currency. The loop
    # mutates user.fx_to_user_currency each month so all downstream
    # to_user_currency / from_user_currency calls see the drifted rate
    # without changing their signature.
    fx_spot_rates: dict[str, Decimal] = dict(user.fx_to_user_currency)
    fx_monthly_factors: dict[str, Decimal] = {
        ccy: D(str((1 + float(drift)) ** (1 / 12)))
        for ccy, drift in (user.fx_drift_annualized or {}).items()
        if drift != D("0")
    }
    # Part-payment frequency tracker — keyed by Python id(loan), value =
    # last sim month at which an above-minimum payment landed on that loan.
    # Consulted alongside lock-in months to decide whether `extra_for_debt`
    # is legally allowed to deploy here this month, per the bank's T&Cs.
    last_part_payment_month: dict[int, int] = {}

    def _can_part_pay(loan, m: int) -> bool:
        """True when an above-minimum payment is allowed on this loan in
        sim-month `m`. Three gates:
          1. Not in lock-in: m > prepay_lock_in_months.
          2. Frequency window cleared: at least
             `part_payment_freq_months` since the last extra payment
             (None ⇒ unlimited).
          3. Not currently in pre-EMI: pre_emi_months_remaining == 0
             (the loan is interest-only, can't accept principal yet).
        """
        if loan.pre_emi_months_remaining > 0:
            return False
        if m <= loan.prepay_lock_in_months:
            return False
        freq = loan.part_payment_freq_months
        if freq:
            last = last_part_payment_month.get(id(loan), 0)
            if last > 0 and (m - last) < freq:
                return False
        return True

    # Bucket reinvest events by month for O(1) lookup inside the loop. We
    # sum amounts if multiple events land on the same month (defensive — the
    # frontend currently emits one per year, but the engine shouldn't care).
    reinvest_by_month: dict[int, Decimal] = {}
    for ev_month, ev_amount in reinvest_events or []:
        if ev_amount > 0 and ev_month >= 1:
            reinvest_by_month[ev_month] = (
                reinvest_by_month.get(ev_month, D("0")) + ev_amount
            )

    # Bucket lifecycle events by their effective month. Multiple events
    # firing the same month are applied in input order. Events with
    # effective_month <= 0 are ignored (treated as already-baked into the
    # profile by the L1 immediate-apply path on the frontend).
    lifecycle_by_month: dict[int, list[LifecycleEvent]] = {}
    for ev in lifecycle_events or []:
        if ev.effective_month and ev.effective_month >= 1:
            lifecycle_by_month.setdefault(ev.effective_month, []).append(ev)

    for m in range(1, horizon_months + 1):
        # Lifecycle events fire at the very start of month m, before any
        # other month-mutating logic. A salary_reset at m=12 replaces
        # `income` immediately; subsequent annual-hike compounding picks
        # up from the new base. A floating_rate_reset mutates the loan's
        # nominal_rate so the effective_rate / ranking / amortisation
        # math from this month forward sees the new value.
        for ev in lifecycle_by_month.get(m, []):
            if ev.kind == LifecycleEventKind.SALARY_RESET:
                if ev.new_monthly_take_home is not None:
                    income = ev.new_monthly_take_home
                elif ev.new_annual_gross is not None:
                    # Rough net-from-gross: divide by 12 and trim 20% as a
                    # tax/PF/insurance withholding placeholder. Callers
                    # who care about exact net should set new_monthly_take_home.
                    income = (ev.new_annual_gross / D("12")) * D("0.8")
            elif ev.kind == LifecycleEventKind.FLOATING_RATE_RESET:
                if (
                    ev.loan_index is not None
                    and 0 <= ev.loan_index < len(loans)
                    and ev.new_rate is not None
                ):
                    loans[ev.loan_index].nominal_rate = ev.new_rate

        # Auto floating-rate resets — for any floating loan with a
        # next_reset_month + rate_reset_frequency_months pair, fire a
        # rate adjustment whenever m hits the schedule. The new rate is
        # current_rate + (rate_drift_annualized × frequency/12) so a
        # +50bps/yr drift with a 12mo reset bumps the loan by 50bps each
        # reset, while a 1-month-reset loan bumps by ~4bps per reset.
        # Defensive: skip when fields are missing OR rate_type != floating.
        for li, ln in enumerate(loans):
            if ln.rate_type != "floating":
                continue
            if ln.next_reset_month is None or ln.rate_reset_frequency_months is None:
                continue
            if m == ln.next_reset_month:
                freq = max(1, ln.rate_reset_frequency_months)
                step = ln.rate_drift_annualized * D(str(freq)) / D("12")
                ln.nominal_rate = ln.nominal_rate + step
                ln.next_reset_month = m + freq

        # FX drift — update user.fx_to_user_currency at month m to reflect
        # cumulative drift since simulation start. At m=1 drift = 0 (rate
        # equals spot); subsequent months compound the per-currency monthly
        # factor (m-1) times. No-op when fx_monthly_factors is empty.
        if fx_monthly_factors:
            for ccy, factor in fx_monthly_factors.items():
                spot = fx_spot_rates.get(ccy, D("1"))
                user.fx_to_user_currency[ccy] = spot * (factor ** (m - 1))

        # Salary growth — fires at the user's hike-effective month, then every 12.
        # With default simulation_start_month=1 and hike_effective_month=1 this
        # resolves to m=13, 25, 37 …, matching the pre-FY-anchoring behavior.
        # When a hike_schedule is present, each year's rate may differ —
        # _resolve_hike_rate picks the right one based on the firing year.
        # The firing-condition check still uses annual_hike_rate as the "is
        # there any hike at all" trigger so legacy users without a schedule
        # work unchanged; schedule users must also set annual_hike_rate > 0
        # for the schedule to fire (or they can set it to the schedule's
        # first-phase rate as a sensible fallback).
        if (
            user.annual_hike_rate > 0
            and m >= first_hike
            and (m - first_hike) % 12 == 0
        ):
            # year_idx is 1-based: m=first_hike → year 1, +12 → year 2, etc.
            year_idx = (m - first_hike) // 12 + 1
            rate = _resolve_hike_rate(user, year_idx)
            if rate > 0:
                income = income * (D("1") + rate)

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

        # Card spend: for any active credit card with expected_monthly_spend
        # set, bump outstanding before computing minimum payments. Models
        # "user keeps using the card" rather than the freeze-and-pay-off
        # default. Non-cards ignore the field.
        for l in active:
            if (
                l.loan_type == LoanType.CREDIT_CARD
                and l.expected_monthly_spend > 0
            ):
                l.outstanding += l.expected_monthly_spend

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
        # Inflation modeling: scale expenses by monthly_inflation_factor^m
        # so surplus erodes at the country-default CPI rate. Compounds
        # monthly with annual rate semantics — at m=12 expenses equal
        # user.fixed/variable × (1 + inflation), m=24 × (1+i)², etc.
        # inflate_expenses=False (default) leaves monthly_inflation_factor=1,
        # so this block is a no-op for legacy callers.
        if inflate_expenses and inflation > 0:
            growth = monthly_inflation_factor ** m
            scratch_user.fixed_expenses = user.fixed_expenses * growth
            scratch_user.variable_expenses = user.variable_expenses * growth
        # Sync the EF state into scratch_user BEFORE computing surplus.
        # compute_available_surplus internally calls compute_efund_monthly
        # against user.efund_balance — without this sync it'd see the
        # frozen initial balance every month, never the growing one, and
        # the held-back EF allocation would never decline as the fund fills.
        scratch_user.efund_balance = ef_balance
        # The 1/12 linear path EF top-up: compute_available_surplus subtracts
        # this from `surplus` (treating it as a baseline obligation), so we
        # must credit it back to ef_balance below — otherwise the held-back
        # money never lands anywhere and the EF target is never reached even
        # though debt prepay is suppressed every month. Capped at the gap
        # to ef_target so the EF never overshoots.
        efund_monthly_to_credit = compute_efund_monthly(scratch_user)
        if ef_balance + efund_monthly_to_credit > ef_target:
            efund_monthly_to_credit = max(D("0"), ef_target - ef_balance)
        surplus = compute_available_surplus(
            scratch_user, active, matched_contribution=matched_contribution,
            simple_mode=simple_mode,
        )
        # Pre-allocation snapshot — captured before goal / EF / debt
        # routing so the API can expose an engine-truth surplus series
        # for client-side achievability without back-deriving it from
        # the post-allocation `surplus` variable below.
        pre_allocation_surplus = surplus
        # Land the baseline EF allocation. This is *separate* from the
        # cascade ef_slice below: the baseline 1/12 path always fires
        # (when there's a gap); the cascade ef_slice is the additional
        # top-up driven by ef_top_up_rate. With ef_top_up_rate=0 (the
        # legacy default), only the baseline path contributes, and the
        # EF still fills geometrically toward target.
        ef_balance += efund_monthly_to_credit

        # Multi-goal monthly outflow. `goals is not None` (not
        # `if goals`): an explicit empty list means "no active goals"
        # and falls through to the cascade — the goal block is skipped
        # only when the caller didn't model goals at all (goals=None).
        # We call the allocator unconditionally (even when surplus is
        # 0 or negative) so the API can surface past_date / over_funded
        # / surplus_exhausted rows in lean months. The allocator
        # internally clamps the funding pool at 0, so the surplus
        # subtraction below is a no-op when there's nothing to give.
        goal_contributions_this_month: dict[str, Decimal] = {}
        if goals is not None:
            alloc = serial_fill_allocation(goals, surplus, m - 1)
            # `alloc.total_outflow` is already bounded by `surplus`
            # inside the allocator, so no defensive min() needed —
            # adding one would risk a desync where goal.saved_so_far
            # disagrees with the surplus subtraction.
            surplus -= alloc.total_outflow
            # Capture per-goal contributions for this month so the API
            # can expose an engine-truth array. Includes zero rows for
            # past_date / over_funded / surplus_exhausted goals so the
            # client sees a consistent shape across months.
            goal_contributions_this_month = {
                c.goal_id: c.amount for c in alloc.contributions
            }
            if m == 1:
                first_month_alloc = alloc

        # Soft EF waterfall: route through the shared `allocate_surplus`
        # helper so the engine and the /plan SurplusWaterfall snapshot
        # use one source of truth for the goal/EF/debt cascade. Any
        # future change to the cascade semantics (e.g. EF preempts goal
        # under hardship) only needs editing in one place.
        ef_gap_this_month = (
            ef_target - ef_balance
            if ef_target > 0 and ef_balance < ef_target
            else D("0")
        )
        cascade = allocate_surplus(
            surplus=surplus,
            ef_split=ef_top_up_rate,
            ef_gap=ef_gap_this_month,
            ef_preempted=False,
        )
        ef_balance += cascade.ef_slice
        surplus = cascade.debt_slice

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

        # Allocate. `extra_for_debt` is in the user's residence currency;
        # convert to the target loan's currency before adding so the
        # amortisation math (interest/principal) stays consistent with the
        # loan's outstanding balance. No-op for single-currency users.
        payments = {id(l): minimums[id(l)] for l in active}
        # Pre-compute the per-loan penalty paid this month from prepay
        # routing (in user residence currency). Added back to interest_paid
        # after amortisation so the user sees the real cost — the bank
        # took the fee out of the principal payment, not as a separate
        # charge against surplus.
        prepay_penalty_paid = D("0")
        if extra_for_debt > 0 and ranked:
            # Pick the highest-ranked loan that's actually open to extra
            # payment this month (out of lock-in, past its part-payment
            # cooldown, and not in pre-EMI). Falls back to the next-best
            # candidate, then no-op if every loan is gated — surplus
            # carries forward implicitly via the EF buffer.
            target = next((l for l in ranked if _can_part_pay(l, m)), None)
            if target is not None:
                extra_in_loan_ccy = from_user_currency(extra_for_debt, target, user)
                penalty_in_loan_ccy = extra_in_loan_ccy * target.prepayment_penalty_pct
                effective_prepay = extra_in_loan_ccy - penalty_in_loan_ccy
                payments[id(target)] += effective_prepay
                if penalty_in_loan_ccy > 0:
                    prepay_penalty_paid = to_user_currency(penalty_in_loan_ccy, target, user)
                last_part_payment_month[id(target)] = m

        # Amortise each loan; track cascade
        interest_paid = D("0")
        principal_paid = D("0")
        cleared: list[int] = []
        cascade_surplus = D("0")

        # Track interest + principal *in user residence currency* so the
        # cross-loan totals (interest_paid, principal_paid) remain summable
        # when loans span currencies. Per-loan amortisation still happens
        # in loan currency below.
        # Cascade is also tracked in user currency so it can be re-converted
        # into whichever loan currency the next-priority loan is in.
        for l in active:
            monthly_rate = l.nominal_rate / D("12")
            interest_this = l.outstanding * monthly_rate
            # Pre-EMI broken-period: bank charges interest only, no
            # principal payment. The user pays exactly `interest_this`
            # for this month; payments[id(l)] gets overwritten so the
            # UI breakdown reflects the actual cash outflow.
            if l.pre_emi_months_remaining > 0:
                payments[id(l)] = interest_this
                pay = interest_this
                principal_this = D("0")
                l.pre_emi_months_remaining -= 1
            else:
                pay = payments[id(l)]
                principal_this = pay - interest_this
            if principal_this >= l.outstanding:
                # Loan clears; cascade the unused portion (in user ccy so
                # we can route it to a different-ccy loan cleanly).
                refund = principal_this - l.outstanding
                principal_this = l.outstanding
                cascade_surplus += to_user_currency(refund, l, user)
                l.outstanding = D("0")
                cleared.append(id(l))
                # Refund came off this loan's payment — it never actually
                # left the user's account toward this bank.
                payments[id(l)] = pay - refund
            else:
                l.outstanding -= principal_this
            interest_paid += to_user_currency(interest_this, l, user)
            principal_paid += to_user_currency(principal_this, l, user)

        # Fold prepay penalty into interest_paid — bank pocketed it,
        # principal didn't budge by that amount. Accounting it as
        # interest keeps total_interest comparable across runs and
        # makes the cost visible in the debt-free month.
        if prepay_penalty_paid > 0:
            interest_paid += prepay_penalty_paid

        # Apply cascade within the same month to the next-priority active loan
        # (after the clears we just processed)
        if cascade_surplus > 0:
            next_active = [l for l in ranked if l.outstanding > 0]
            if next_active:
                top = next_active[0]
                monthly_rate = top.nominal_rate / D("12")
                add_principal = from_user_currency(cascade_surplus, top, user)
                if add_principal >= top.outstanding:
                    add_principal = top.outstanding
                    cleared.append(id(top))
                top.outstanding -= add_principal
                principal_paid += to_user_currency(add_principal, top, user)
                # Reflect the cascade in the per-loan payment dict so the UI
                # can show the real amount the user sends to that bank.
                payments[id(top)] = payments.get(id(top), D("0")) + add_principal

        # Auto-reinvest event (e.g. annual tax-saving refund routed back
        # into debt). Layered on top of cascade — same routing rule (highest
        # effective-APR active loan after this month's payments). Cascades
        # again if it clears the target.
        if m in reinvest_by_month:
            reinvest_amount = reinvest_by_month[m]
            remaining_active = [l for l in loans if l.outstanding > 0]
            if remaining_active:
                # Re-rank by current effective APR (some loans may have
                # cleared this month — those drop out automatically).
                reinvest_ranked = rank_loans(
                    remaining_active,
                    {id(l): effective_rate(l, marg, user.country, user.tax_regime)
                     for l in remaining_active},
                    strategy,
                    country=user.country,
                )
                if reinvest_ranked:
                    target = reinvest_ranked[0]
                    add = from_user_currency(reinvest_amount, target, user)
                    if add >= target.outstanding:
                        add = target.outstanding
                        cleared.append(id(target))
                    target.outstanding -= add
                    principal_paid += to_user_currency(add, target, user)
                    payments[id(target)] = (
                        payments.get(id(target), D("0")) + add
                    )

        total_payment_nominal = interest_paid + principal_paid
        total_payment_real = real_emi(total_payment_nominal, inflation, m)

        balances_snapshot = {id(l): l.outstanding for l in loans}
        # Bucket the same balances by loan currency for FE chart series.
        # Empty values (cleared loans contributing 0) are kept so a cleared
        # currency continues to appear with a zero entry — easier for the
        # chart layer than chasing missing keys.
        ccy_buckets: dict[str, Decimal] = {}
        for l in loans:
            ccy = loan_currency_or_default(l, user)
            ccy_buckets[ccy] = ccy_buckets.get(ccy, D("0")) + l.outstanding

        payments_by_idx = {
            loan_position[lid]: amt
            for lid, amt in payments.items()
            if amt > D("0")
        }
        # Per-loan balance by 0-based position. ALL loans included so the
        # chart sees a stable series (cleared loans flat at 0, never
        # disappearing).
        balances_by_idx = {loan_position[id(l)]: l.outstanding for l in loans}
        months.append(MonthRow(
            month_index=m,
            # Pre-allocation surplus — the pool the engine had to work
            # with this month, before goals / EF / debt took their
            # slices. Achievability sums this across the goal's window.
            available_surplus=pre_allocation_surplus,
            total_payment_nominal=total_payment_nominal,
            total_payment_real=total_payment_real,
            interest_paid_month=interest_paid,
            principal_paid_month=principal_paid,
            invested_this_month=invested_this_month,
            balances=balances_snapshot,
            cleared_this_month=cleared,
            payments_by_loan_index=payments_by_idx,
            balances_by_currency=ccy_buckets,
            balances_by_loan_index=balances_by_idx,
            goal_contributions=goal_contributions_this_month,
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
        first_month_goal_allocation=first_month_alloc,
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

        # Same card-spend bump as the scenario sim so baseline stays
        # apples-to-apples — both legs assume the same user spending
        # behaviour.
        for l in active:
            if (
                l.loan_type == LoanType.CREDIT_CARD
                and l.expected_monthly_spend > 0
            ):
                l.outstanding += l.expected_monthly_spend

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
                interest_paid += to_user_currency(interest_this, l, user)
                continue
            if principal_this >= l.outstanding:
                principal_this = l.outstanding
                cleared.append(id(l))
            l.outstanding -= principal_this
            interest_paid += to_user_currency(interest_this, l, user)
            principal_paid += to_user_currency(principal_this, l, user)

        balances_snapshot = {id(l): l.outstanding for l in loans}
        ccy_buckets: dict[str, Decimal] = {}
        for l in loans:
            ccy = loan_currency_or_default(l, user)
            ccy_buckets[ccy] = ccy_buckets.get(ccy, D("0")) + l.outstanding
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
            balances_by_currency=ccy_buckets,
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
