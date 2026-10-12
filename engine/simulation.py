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
import math
from decimal import Decimal, ROUND_HALF_UP
from dataclasses import dataclass, field
from copy import copy, deepcopy
from engine.models import (
    User,
    Loan,
    LoanType,
    Country,
    IncomeType,
    FilingStatusUS,
    TaxRegimeIN,
    InvestmentOption,
    LiquidityClass,
    LifecycleEvent,
    LifecycleEventKind,
    PayoffRules,
)
from engine.formulas import (
    emi, loan_market, monthly_interest_charge, prepay_recommended, prepayment_beats_fee, real_emi,
)
from engine.minimum_payments import compute_minimum_payment
from engine.gap_debt import GapRate, gap_interest, gap_rate_for
from engine.ordering import Strategy, rank_loans
from engine.marginal_cost import prepayment_fee_with_gst, user_marginal_costs
from engine.goals import GoalState, MonthlyGoalAllocation, debt_gate, serial_fill_allocation
from engine.surplus import (
    allocate_surplus,
    compute_available_surplus,
    compute_shortfall,
    compute_efund_monthly,
    from_user_currency,
    loan_currency_or_default,
    to_user_currency,
)

D = Decimal

# Auto rate drift stops this far from the loan's starting rate. A +1%/yr
# drift applied for 30 years took a home loan to 38%; rate cycles don't
# run one way for decades.
MAX_RATE_DRIFT = D("0.03")


# Payroll deductions besides income tax (P2-24).
US_SS_RATE = D("0.062")
US_SS_WAGE_BASE_2026 = D("184500")       # SSA 2026 contribution and benefit base
US_MEDICARE_RATE = D("0.0145")
US_ADDL_MEDICARE_RATE = D("0.009")       # above $200k wages (single threshold)
US_ADDL_MEDICARE_THRESHOLD = D("200000")
IN_EPF_RATE = D("0.12")
IN_EPF_WAGE_CEILING_ANNUAL = D("180000")  # ₹15,000/month statutory wage ceiling


def payroll_deductions(user: User, gross: Decimal) -> Decimal:
    """Yearly payroll deductions other than income tax: FICA in the US;
    employee EPF in India at the statutory floor (12% of the ₹15,000/month
    wage ceiling). Many employers deduct EPF on the full basic, so the
    take-home this produces is an upper bound, not an exact figure."""
    if user.income_type != IncomeType.SALARIED or gross <= 0:
        return D("0")
    if user.country == Country.IN:
        return IN_EPF_RATE * min(gross, IN_EPF_WAGE_CEILING_ANNUAL)
    fica = US_SS_RATE * min(gross, US_SS_WAGE_BASE_2026) + US_MEDICARE_RATE * gross
    if gross > US_ADDL_MEDICARE_THRESHOLD:
        fica += US_ADDL_MEDICARE_RATE * (gross - US_ADDL_MEDICARE_THRESHOLD)
    return fica


def estimated_take_home(user: User, gross: Decimal) -> Decimal:
    """Monthly take-home from a gross salary: income tax plus payroll
    deductions (FICA / EPF). It used to subtract income tax only, which
    overstated a planned salary's take-home by 7.65% in the US (P2-24).
    Callers with an exact figure should send `new_monthly_take_home`."""
    if user.country == Country.IN:
        from engine.tax.india import income_tax, STANDARD_DEDUCTION_NEW_SALARIED, STANDARD_DEDUCTION_OLD_SALARIED
        regime = user.tax_regime or TaxRegimeIN.NEW
        deduction = (STANDARD_DEDUCTION_NEW_SALARIED if regime == TaxRegimeIN.NEW else STANDARD_DEDUCTION_OLD_SALARIED) if user.income_type == IncomeType.SALARIED else D("0")
        tax = income_tax(max(D("0"), gross - deduction), regime)
    else:
        from engine.tax.usa import federal_tax, STANDARD_DEDUCTION_2026
        filing = user.filing_status or FilingStatusUS.SINGLE
        tax = federal_tax(max(D("0"), gross - STANDARD_DEDUCTION_2026[filing]), filing) + gross * user.state_marginal_rate
    tax += payroll_deductions(user, gross)
    return (max(D("0"), gross - tax) / D("12")).quantize(D("0.01"), rounding=ROUND_HALF_UP)


def _months_to_clear(balance: Decimal, rate: Decimal, payment: Decimal) -> int | None:
    """Months a fixed payment takes to clear `balance` at annual `rate`.
    None when the payment doesn't cover the interest."""
    if balance <= 0:
        return 0
    r = float(rate) / 12
    p, a = float(balance), float(payment)
    if a <= 0:
        return None
    if r == 0:
        return math.ceil(p / a)
    if a <= r * p:
        return None
    return math.ceil(-math.log(1 - r * p / a) / math.log(1 + r))


def _home_interest_pool(homes: list[Loan], country: Country) -> Decimal:
    """India: the user's share of a year's interest and pre-construction
    instalments across self-occupied home loans, which share one ₹2L cap
    (s.22(2), (5) of the Income-tax Act 2025; sprint G2). US: every home
    loan's interest, as before."""
    if country != Country.IN:
        return sum((l.outstanding * l.nominal_rate for l in homes), D("0"))
    return sum(((l.outstanding * l.nominal_rate + l.pre_construction_interest_annual) * l.tax_share
                for l in homes if (l.property_use or "self_occupied") != "let_out"), D("0"))


def tax_caps_context(loans: list[Loan], user: User) -> dict:
    """Per-taxpayer totals for the shared deduction caps (P2-05/06/25):
    India 24(b) interest across home loans, the US $750k mortgage-debt
    limit, and the US $2,500 student-loan interest deduction."""
    own_market = user.country
    def market(l: Loan) -> Country:
        c = (l.currency or "").upper()
        return Country.IN if c == "INR" else Country.US if c == "USD" else own_market
    homes = [l for l in loans if l.loan_type == LoanType.HOME and l.outstanding > 0 and market(l) == own_market]
    edu = [l for l in loans if l.loan_type == LoanType.EDUCATION and l.outstanding > 0 and market(l) == own_market]
    magi = user.annual_gross_salary or user.annual_business_income or None
    return {
        "home_interest_total": _home_interest_pool(homes, own_market),
        "mortgage_debt_total": sum((l.outstanding for l in homes), D("0")),
        "us_student_interest_total": sum((l.outstanding * l.nominal_rate for l in edu), D("0")),
        "magi": magi,
        "filing_status": user.filing_status,
    }


def _reset_rate(loan: Loan, new_rate: Decimal, months_left: int) -> None:
    """Move a floating loan to `new_rate`.

    A cut keeps the EMI, so the loan finishes sooner. A rise first uses
    up that head start: the EMI stays while the loan still clears by its
    contractual end date (`months_left`), and only then rises, just
    enough to finish on that date. RBI's 2023 reset rules forbid negative
    amortisation, and a fixed EMI under a rising rate grew a ₹30L loan
    without limit (₹82 crore of interest).

    Sprint G4 (L5 golden statement, home_floating_sbi_style): after a cut
    then a rise this used to raise the EMI to keep the NEW, earlier end
    date, a higher EMI than the bank asks. Bank statements keep the
    original maturity: the reset re-amortises over the months left to it
    (RBI DOR.MCS.REC.32/01.01.003/2023-24, 18 Aug 2023: EMI and/or tenor
    may change, with no negative amortisation). The end date is never
    pushed past the contract's.
    """
    new_rate = max(D("0"), new_rate)
    old_rate = loan.nominal_rate
    loan.nominal_rate = new_rate
    if new_rate <= old_rate or loan.loan_type == LoanType.CREDIT_CARD:
        return
    if loan.scheduled_emi <= 0 or loan.outstanding <= 0:
        return
    n_now = _months_to_clear(loan.outstanding, old_rate, loan.scheduled_emi)
    # The contractual end date is the anchor; the plan's own (later) path
    # wins only if it already ran past it (no forced EMI jump then).
    # (One month of slack: ceil() on a float path count can read 229 for a
    # loan with exactly 228 left.)
    if months_left > 0:
        n = n_now if n_now is not None and n_now > months_left + 1 else months_left
    else:
        n = n_now or 12
    needed = emi(loan.outstanding, new_rate, n)
    if needed > loan.scheduled_emi:
        loan.scheduled_emi = needed


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
    # Sum of all balances converted to the user's currency at this month's
    # rate. Adding ₹ and $ balances as plain numbers gave NRI users a
    # meaningless total on the chart.
    balance_in_user_currency: Decimal = D("0")
    # Per-goal contribution this month, keyed by goal id. Empty when
    # `goals` wasn't passed to simulate_plan. Lets the API expose an
    # engine-truth array so client-side achievability can sum actuals
    # (accounting for inflation / hike / expiry) instead of multiplying
    # a single static surplus by a month count.
    goal_contributions: dict[str, Decimal] = field(default_factory=dict)
    # Paid above each loan's minimum this month (extra, cascade, reinvest),
    # in the user's currency. The /plan schedule used to take the scheduled
    # EMIs off the total paid, so a card's minimum (EMI 0) read as "extra",
    # a cleared loan's EMI kept being subtracted, and ₹ and $ were mixed.
    extra_paid: Decimal = D("0")
    # Income short of costs plus minimums this month (user's currency).
    # With `gap_as_debt` (the default) the gap is paid from the emergency
    # fund, then borrowed at a card's rate (engine/gap_debt.py, grill #38).
    shortfall: Decimal = D("0")
    # Gap borrowing, user's currency: what's owed at the month's end, its
    # interest this month (capitalised, not paid), what was borrowed and
    # repaid this month, and what the emergency fund covered.
    gap_debt: Decimal = D("0")
    gap_interest: Decimal = D("0")
    gap_borrowed: Decimal = D("0")
    gap_repaid: Decimal = D("0")
    gap_from_savings: Decimal = D("0")
    # Position of the loan this month's extra went to (None: no extra went
    # to a loan). Read by the fee-aware order's "why this loan first".
    extra_to_loan_index: int | None = None
    # Extra money held back this month because it is under the target loan's
    # minimum part-payment (`Loan.min_prepay_amount`, grill #30): the running
    # set-aside ("sinking fund") at the end of the month, user currency.
    # Paid in once it reaches the minimum (or clears the loan).
    set_aside_for_prepay: Decimal = D("0")


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
    # Fee-aware order (roadmap PR K, engine/fee_order.py). Set only when an
    # Avalanche plan had a loan with a prepayment fee and searched orders:
    # `payoff_order_method` "exact" | "local"; `payoff_order` the fixed order
    # kept (loan positions), None when the greedy marginal-cost plan was
    # cheapest; `payoff_order_note` plain words when a fee changed the order.
    payoff_order_method: str | None = None
    payoff_order: list[int] | None = None
    payoff_order_note: str | None = None
    # Gap borrowing (grill #38): the rate it is charged and why, and its
    # interest over the plan (already inside total_interest_paid).
    gap_rate: GapRate | None = None
    total_gap_interest: Decimal = D("0")


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


# Average-daily-balance approximation for a revolving card (grill #25, L5's
# HDFC-style golden statement). RBI MD 2022 FAQ 6: once a bill isn't paid in
# full, interest runs from each transaction's date on the outstanding,
# "adjusted for payments ... as and when credited". The simulator works in
# whole months, so:
#  * new spend, spread evenly through the cycle, carries interest for about
#    half of it (CARD_SPEND_SHARE);
#  * the month's payment, made on the due date about 20 days into a ~30-day
#    cycle (HDFC's statement-to-due gap; RBI requires at least a fortnight,
#    MD para 10(a)), stops interest on the paid part for the last third of the
#    cycle (CARD_PAID_EARLY_SHARE);
#  * a card whose last bill was paid in full (opening balance 0) pays no
#    interest on this month's spend: the interest-free period applies.
# Charging a whole month on balance + spend read ₹11.8k too high after 12
# months on ₹1.5L against the daily-balance statement.
CARD_SPEND_SHARE = D("0.5")
CARD_PAID_EARLY_SHARE = D("1") / D("3")


def card_cycle_interest(loan: Loan, country: Country, opening: Decimal, spend: Decimal,
                        payment: Decimal) -> Decimal:
    """This cycle's finance charge (GST included for an Indian card) on the
    average daily balance. `opening` is the balance before this month's
    `spend`; `payment` what is paid on the due date."""
    if opening <= 0:
        return D("0")
    paid = min(max(payment, D("0")), opening + spend)
    adb = opening + spend * CARD_SPEND_SHARE - paid * CARD_PAID_EARLY_SHARE
    scratch = copy(loan)
    scratch.outstanding = max(adb, D("0"))
    return monthly_interest_charge(scratch, country)


def simulate_plan(
    user: User,
    strategy: Strategy = Strategy.AVALANCHE,
    *args,
    **kwargs,
) -> SimulationResult:
    """Run the plan forward (see `_simulate_plan` for every option).

    Avalanche with a prepayment fee on an open loan (roadmap PR K): a fixed
    fee breaks the rate-by-rate order, so candidate payoff orders are run on
    this same simulator and the cheapest plan, net of tax and fees
    included, is returned (engine/fee_order.py: every order up to 5 loans,
    greedy plus local swaps above). Ties keep the greedy plan."""
    from engine.fee_order import choose_order, has_fee_loan
    if (strategy != Strategy.AVALANCHE or args or kwargs.get("minimums_only")
            or not has_fee_loan(user.loans)):
        return _simulate_plan(user, strategy, *args, **kwargs)
    marg = _marginal_rate(user, kwargs.get("marginal_rate"))
    goals = kwargs.get("goals")

    def run(strat, order=None, final=False):
        kw = dict(kwargs)
        if goals is not None and not final:
            kw["goals"] = deepcopy(goals)      # the run fills goal states in
        u = copy(user)
        u.payoff_rules = PayoffRules(custom_order=order) if order is not None else user.payoff_rules
        return _simulate_plan(u, strat, **kw)

    choice, res = choose_order(
        user, marg,
        run_greedy=lambda: run(Strategy.AVALANCHE),
        run_fixed=lambda order: run(Strategy.RULES, order),
    )
    if goals is not None:
        # Run the winner once more on the caller's own goal states, which
        # the API reads back after the call.
        res = (_simulate_plan(user, Strategy.AVALANCHE, **kwargs) if choice.order is None
               else run(Strategy.RULES, choice.order, final=True))
    res.payoff_order_method = choice.method
    res.payoff_order = choice.order
    res.payoff_order_note = choice.note
    return res


def _simulate_plan(
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
    ef_top_up_rate: Decimal | None = None,
    goals: list[GoalState] | None = None,
    minimums_only: bool = False,
    debt_budget: Decimal | None = None,
    expense_delta: Decimal = D("0"),
    expense_delta_from_month: int = 1,
    income_shock_months: int = 0,
    gap_as_debt: bool = True,
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

    Emergency fund: one mechanism per run, never both.
    - `ef_top_up_rate=None` (the default): a fixed monthly top-up of the
      starting gap / 12 is held back from surplus until the fund is full.
    - `ef_top_up_rate` given (0–1): that share of each month's surplus goes
      to the fund until it reaches `efund_target`, and nothing else does.
      0 means every rupee goes to debt. This is the /plan slider, so the
      split the user picks is the split that happens (it used to be added
      on top of the fixed top-up, and 0% still diverted gap / 12).

    `goals` (default None) is the engine-authoritative per-goal state
    list. When provided, the serial-fill allocator runs each month,
    routing surplus to goals in user-effective order before the
    EF/debt cascade. An explicit empty list means "no active goals"
    (cascade gets the full surplus). When None, the engine skips the
    goal block entirely — the legacy "all surplus → EF/debt" behaviour
    for callers that don't model goals.

    `expense_delta` models a spending cut in the variable bucket (or fixed
    expenses when there is no variable bucket), starting at
    `expense_delta_from_month`. It follows expense inflation, never salary
    growth or salary resets, so saving the cut gives the same projection.

    `debt_budget` (default None = every spare rupee) is the most the user
    wants to put toward debts each month, in their own currency: EMIs and
    minimums plus the extra. The extra is cut to fit it; what's cut stays
    with the user (counted as invested). As loans clear, their EMIs free
    room under the same total, so it still rolls forward. Minimums are
    always paid, even above it. A positive `income_delta` or `expense_delta`
    raises it by the same amount from that month on, so
    the cut reaches the debts as the what-if says.

    `income_shock_months` (default 0) zeroes take-home pay for months
    1..N while planned salary resets and hikes still move the underlying
    pay, so what returns after the shock is the plan's pay by then.

    `gap_as_debt` (default True, grill #38): a month short of cash is paid
    from the emergency fund, then borrowed at a credit card's rate
    (engine/gap_debt.py). The borrowing charges interest (counted in
    `total_interest_paid`), is paid back first from any spare cash or freed
    EMI, and the plan is not debt-free until it is repaid. False keeps the
    old assumption that the gap is found somewhere for free.

    `minimums_only` pays each loan its minimum and nothing more: no
    surplus, no cascade when a loan clears, no reinvest events. It is the
    "pay only minimums" comparison, run through the same month loop so
    rate resets, pre-EMI and unpaid interest are treated the same way in
    both.
    """
    # FX drift below rewrites the exchange rates every month. Work on a
    # copy: the caller's user used to come back with drifted rates, and a
    # second run started from them.
    user = copy(user)
    user.fx_to_user_currency = dict(user.fx_to_user_currency)
    loans = [deepcopy(l) for l in user.loans]
    # Map deep-copied loan identity → its original position in user.loans.
    # Used to translate per-loan payments into a position-keyed dict that
    # the API can pass to the frontend without leaking Python ids.
    loan_position = {id(l): i for i, l in enumerate(loans)}
    start_rate = {id(l): l.nominal_rate for l in loans}
    loan_start_month = {id(l): 1 for l in loans}
    income = user.monthly_income
    if income_delta != D("0") and income_delta_from_month <= 1:
        # Apply immediately — preserves the old with_surplus_delta semantics
        # where the delta was baked into user.monthly_income before the call.
        income = income + income_delta
    marg = _marginal_rate(user, marginal_rate)
    months: list[MonthRow] = []
    total_interest = D("0")
    total_invested = D("0")
    # EF state — running balance that grows by whichever top-up applies
    # (fixed gap / 12, or the caller's split) until ef_target is hit.
    ef_balance = user.efund_balance
    ef_target = user.efund_target
    efund_monthly_plan = (
        compute_efund_monthly(user) if ef_top_up_rate is None else D("0")
    )
    ef_split = ef_top_up_rate if ef_top_up_rate is not None else D("0")
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
    # Set-aside for a lender's minimum part-payment (grill #30): extra below
    # the minimum waits here, in user currency, until it is big enough.
    prepay_pot = D("0")
    # Education-loan moratorium interest accrued so far (simple, not compounded).
    moratorium_accrued: dict[int, Decimal] = {}

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
        if m - loan_start_month[id(loan)] + 1 <= loan.prepay_lock_in_months:
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

    # Reserve positions for planned loans in input order. Keep them dormant
    # until arrival, so charts retain stable keys even through a debt-free gap.
    upcoming: dict[int, Loan] = {}
    for ev in lifecycle_events or []:
        if ev.kind == LifecycleEventKind.PROPERTY_BUY and ev.loan_draft is not None and ev.effective_month >= 1:
            draft = deepcopy(ev.loan_draft)
            dormant = deepcopy(draft)
            dormant.outstanding = D("0")
            upcoming[id(ev)] = dormant
            loan_position[id(dormant)] = len(loans)
            start_rate[id(dormant)] = draft.nominal_rate
            loan_start_month[id(dormant)] = ev.effective_month
            # Disbursed in its arrival month; the first EMI is the month
            # after (unless the draft says later).
            dormant.first_payment_month = max(draft.first_payment_month, ev.effective_month + 1)
            if dormant.next_reset_month is not None:
                dormant.next_reset_month += ev.effective_month - 1
            loans.append(dormant)
    last_arrival = max((ev.effective_month for ev in lifecycle_events or [] if id(ev) in upcoming), default=0)

    # Gap borrowing (grill #38), in the user's currency.
    gap_rate = gap_rate_for(user) if gap_as_debt else None
    gap_debt = D("0")
    total_gap_interest = D("0")

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
                    income = estimated_take_home(user, ev.new_annual_gross)
            elif ev.kind == LifecycleEventKind.PROPERTY_BUY and id(ev) in upcoming:
                upcoming[id(ev)].outstanding = ev.loan_draft.outstanding
            elif ev.kind == LifecycleEventKind.FLOATING_RATE_RESET:
                if (
                    ev.loan_index is not None
                    and 0 <= ev.loan_index < len(loans)
                    and ev.new_rate is not None
                ):
                    ln = loans[ev.loan_index]
                    _reset_rate(ln, ev.new_rate, ln.tenure_months_remaining - max(0, m - ln.first_payment_month))
                    # A deliberate reset (or a rate-shock what-if) is the new
                    # anchor for the ±MAX_RATE_DRIFT clamp; otherwise the next
                    # auto reset pulled a +4% shock back to +3% (P2-08).
                    start_rate[id(ln)] = ln.nominal_rate

        # Auto floating-rate resets — for any floating loan with a
        # next_reset_month + rate_reset_frequency_months pair, fire a
        # rate adjustment whenever m hits the schedule. The new rate is
        # current_rate + (rate_drift_annualized × frequency/12) so a
        # +50bps/yr drift with a 12mo reset bumps the loan by 50bps each
        # reset, while a 1-month-reset loan bumps by ~4bps per reset.
        # Defensive: skip when fields are missing OR rate_type != floating.
        for li, ln in enumerate(loans):
            if ln.rate_type != "floating" or m < loan_start_month[id(ln)]:
                continue
            if ln.next_reset_month is None or ln.rate_reset_frequency_months is None:
                continue
            if m == ln.next_reset_month:
                freq = max(1, ln.rate_reset_frequency_months)
                step = ln.rate_drift_annualized * D(str(freq)) / D("12")
                base = start_rate[id(ln)]
                new_rate = min(max(ln.nominal_rate + step, base - MAX_RATE_DRIFT), base + MAX_RATE_DRIFT)
                _reset_rate(ln, new_rate, ln.tenure_months_remaining - max(0, m - ln.first_payment_month))
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
            (user.annual_hike_rate > 0 or bool(user.hike_schedule))
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

        # Filter out paid-off loans, and loans whose first EMI is later
        # (still owed, so not debt-free).
        owing = [l for l in loans if l.outstanding > 0]
        if not owing and m > last_arrival and gap_debt <= 0:
            debt_free_month = m - 1
            break
        active = [l for l in owing if m >= l.first_payment_month]

        # Gap borrowing charges a month's card interest on what's owed.
        gap_int_month = gap_interest(gap_debt, gap_rate, user) if gap_rate and gap_debt > 0 else D("0")
        gap_debt += gap_int_month
        total_gap_interest += gap_int_month
        gap_borrowed = gap_repaid = gap_from_savings = D("0")

        # Moratorium / pre-first-EMI months still accrue interest; banks
        # capitalise it onto the balance (M1). A ₹10L education loan at 10%
        # with its first EMI in month 13 owes about ₹1.1L more by then.
        # A planned loan accrues from its arrival month.
        # A loan taken this month (first EMI next month) is covered by that
        # first EMI's interest, so only longer gaps capitalise.
        for l in owing:
            start = loan_start_month.get(id(l), 1)
            if start <= m < l.first_payment_month and l.first_payment_month - start >= 2:
                if l.loan_type == LoanType.EDUCATION:
                    # Simple interest through an education loan's moratorium,
                    # on the principal only, capitalised when repayment starts
                    # (SBI Student Loan MITC: "Simple interest to be charged
                    # during moratorium period"). Compounding it monthly read
                    # ~₹5.9k too high over 36 months on ₹10L (L5 golden).
                    accrued = moratorium_accrued.get(id(l), D("0"))
                    principal_only = copy(l)
                    principal_only.outstanding = l.outstanding - accrued
                    charge = monthly_interest_charge(principal_only, user.country)
                    moratorium_accrued[id(l)] = accrued + charge
                    l.outstanding += charge
                else:
                    l.outstanding += monthly_interest_charge(l, user.country)

        card_opening: dict[int, Decimal] = {}
        card_spend: dict[int, Decimal] = {}
        # Card spend: for any active credit card with expected_monthly_spend
        # set, bump outstanding before computing minimum payments. Models
        # "user keeps using the card" rather than the freeze-and-pay-off
        # default. Non-cards ignore the field.
        for l in active:
            if (
                l.loan_type == LoanType.CREDIT_CARD
                and l.expected_monthly_spend > 0
            ):
                # Opening balance before this month's spend: 0 means the last
                # bill was paid in full, so the spend gets its interest-free
                # period (RBI MD 2022 para 3(a)(xvi)).
                card_opening[id(l)] = l.outstanding
                card_spend[id(l)] = l.expected_monthly_spend
                l.outstanding += l.expected_monthly_spend

        # Minimum payments per active loan. Card formulas of the "interest +
        # x%" kind need this month's interest; without it a $5,000 card at
        # 24% had a $50 minimum against $100 of interest.
        minimums = {
            id(l): compute_minimum_payment(
                l, user.country,
                interest_accrued=monthly_interest_charge(l, user.country),
                simple_mode=simple_mode,
            )
            for l in active
        }

        # Available surplus this month — recompute with current income
        scratch_user = deepcopy(user)
        scratch_user.monthly_income = D("0") if m <= income_shock_months else income
        scratch_user.loans = active
        if expense_delta != 0 and m >= max(1, expense_delta_from_month):
            # Spending cuts reduce the same bucket as the saved profile.
            # They do not become salary or compound with future pay rises.
            key = "variable_expenses" if user.variable_expenses > 0 else "fixed_expenses"
            setattr(scratch_user, key, getattr(scratch_user, key) - expense_delta)
        # Inflation modeling: scale expenses by monthly_inflation_factor^m
        # so surplus erodes at the country-default CPI rate. Compounds
        # monthly with annual rate semantics — at m=12 expenses equal
        # user.fixed/variable × (1 + inflation), m=24 × (1+i)², etc.
        # inflate_expenses=False (default) leaves monthly_inflation_factor=1,
        # so this block is a no-op for legacy callers.
        if inflate_expenses and inflation > 0:
            growth = monthly_inflation_factor ** m
            scratch_user.fixed_expenses *= growth
            scratch_user.variable_expenses *= growth
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
        # A fixed amount (the starting gap over 12 months) until the fund
        # is full. Recomputing gap / 12 every month shrank the top-up as
        # the fund grew, so it never filled: 65% after a year, still
        # trickling years later while holding back debt payments.
        efund_monthly_to_credit = min(
            efund_monthly_plan, max(D("0"), ef_target - ef_balance),
        )
        # The fixed top-up only lands when the month can pay for it (P2-15):
        # crediting it regardless filled the fund on paper with money the
        # user never had, and debt prepayment started a year early.
        pre_ef_surplus = compute_available_surplus(
            scratch_user, active, matched_contribution=matched_contribution,
            simple_mode=simple_mode, efund_monthly=D("0"),
        )
        # Spare cash pays back gap borrowing before anything else: it is a
        # card balance at card rates (grill #38).
        if gap_debt > 0 and pre_ef_surplus > 0:
            pay_back = min(gap_debt, pre_ef_surplus)
            gap_debt -= pay_back
            gap_repaid += pay_back
            pre_ef_surplus -= pay_back
        efund_monthly_to_credit = min(efund_monthly_to_credit, max(D("0"), pre_ef_surplus))
        surplus = max(D("0"), pre_ef_surplus - efund_monthly_to_credit)
        shortfall = compute_shortfall(scratch_user, active, simple_mode=simple_mode)
        if minimums_only:
            surplus = D("0")
            efund_monthly_to_credit = D("0")
        # Pre-allocation snapshot — captured before goal / EF / debt
        # routing so the API can expose an engine-truth surplus series
        # for client-side achievability without back-deriving it from
        # the post-allocation `surplus` variable below.
        pre_allocation_surplus = surplus
        # Land the fixed EF top-up (zero when the caller gave a split;
        # then the cascade ef_slice below is the only EF money).
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
        if goals is not None and not minimums_only:
            # Rule "after debt X clears" (roadmap PR F) reads this month's balances.
            alloc = serial_fill_allocation(
                goals, surplus, m - 1,
                debt_cleared=debt_gate(loans, user.country, loan_position),
            )
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
            ef_split=ef_split,
            ef_gap=ef_gap_this_month,
            ef_preempted=False,
        )
        ef_balance += cascade.ef_slice
        surplus = cascade.debt_slice

        # Layer 3 — invest-vs-prepay gate, loan by loan. Extra goes to the
        # first loan in payoff order that beats the best liquid return;
        # only if none does is the surplus invested. Checking just the
        # first loan made snowball invest everything while a 42% card
        # sat at its minimum, because a small 7% car loan came first.
        # Payoff order: the marginal cost of the next unit prepaid (roadmap
        # PR J), not the all-in effective rate (which counts sunk fees).
        costs = user_marginal_costs(active, user, marg, m, loan_start_month)
        order_keys = {k: mc.order_key for k, mc in costs.items()}
        ranked = rank_loans(active, order_keys, strategy, country=user.country,
                            balance_of=lambda l: to_user_currency(l.outstanding, l, user),
                            rules=user.payoff_rules, index_of=loan_position)
        invested_this_month = D("0")
        extra_for_debt = surplus
        def _fee_pays_off(l: Loan) -> bool:
            # A prepayment fee bigger than the interest the extra saves
            # makes prepaying a loss: skip the loan (property suite bug).
            if l.prepayment_penalty_pct <= 0:
                return True
            charge = monthly_interest_charge(l, user.country)
            r_month = charge / l.outstanding if l.outstanding > 0 else D("0")
            # Months left if the plan keeps paying the minimum plus this
            # month's extra: the tail a unit prepaid now actually removes.
            extra_here = from_user_currency(max(D("0"), surplus), l, user)
            k = _months_to_clear(l.outstanding, r_month * 12, minimums[id(l)] + extra_here)
            if k is not None:
                # The extra paid this month comes off the final payment,
                # k - 1 months from now: that is how long it would have grown.
                k = min(k, horizon_months - m + 1) - 1
            fee = prepayment_fee_with_gst(l.prepayment_penalty_pct, loan_market(l, user.country) == Country.IN)
            return prepayment_beats_fee(r_month, fee, k)

        worth_prepaying = [
            l for l in ranked
            # The loan's cost a year from here (compounded, after GST and the
            # tax break at the margin), the same figure the screens show. The
            # all-in effective rate counted fees already paid and skipped
            # compounding; the prepayment fee is checked just below.
            if prepay_recommended(costs[id(l)].annual_cost, best_liquid_return, inflation, marg, user.prepay_hurdle)
            and _fee_pays_off(l)
        ]
        worth_ids = {id(l) for l in worth_prepaying}

        if surplus > 0 and (not ranked or not worth_prepaying):
            # Nothing beats the after-tax return, or every owed loan is
            # still before its first EMI: the surplus is saved, not lost.
            invested_this_month = surplus
            extra_for_debt = D("0")

        if debt_budget is not None and extra_for_debt > 0:
            budget = debt_budget
            if income_delta > 0 and m >= max(1, income_delta_from_month):
                budget += income_delta
            if expense_delta > 0 and m >= max(1, expense_delta_from_month):
                budget += expense_delta
            required = sum(
                (to_user_currency(minimums[id(l)], l, user) for l in active), D("0"),
            )
            room = max(D("0"), budget - required)
            if extra_for_debt > room:
                invested_this_month += extra_for_debt - room
                extra_for_debt = room

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
        penalised = None
        extra_target_index = None
        if extra_for_debt > 0 and ranked:
            # Pick the highest-ranked loan that's actually open to extra
            # payment this month (out of lock-in, past its part-payment
            # cooldown, and not in pre-EMI). Falls back to the next-best
            # candidate, then no-op if every loan is gated — surplus
            # carries forward implicitly via the EF buffer.
            target = next((l for l in worth_prepaying if _can_part_pay(l, m)), None)
            if target is None:
                # Every loan worth prepaying is gated this month (lock-in,
                # part-payment cooldown, pre-EMI). The money stays with the
                # user (H3): it used to vanish. So does any set-aside.
                invested_this_month += extra_for_debt + prepay_pot
                extra_for_debt = prepay_pot = D("0")
            else:
                # A lender minimum on part-payments (grill #30, sprint G1):
                # hold the extra in the set-aside until it reaches the
                # minimum, then pay it in one go. Clearing the loan is never
                # held back (foreclosure isn't a part-payment).
                held = prepay_pot + extra_for_debt
                need = to_user_currency(target.min_prepay_amount or D("0"), target, user)
                owed = to_user_currency(target.outstanding, target, user)
                if need > 0 and held < need and held < owed:
                    prepay_pot, extra_for_debt = held, D("0")
                else:
                    prepay_pot, extra_for_debt = D("0"), held
            if target is not None and extra_for_debt > 0:
                extra_in_loan_ccy = from_user_currency(extra_for_debt, target, user)
                # An Indian lender adds 18% GST on the fee (grill #27, G1).
                penalty_in_loan_ccy = extra_in_loan_ccy * prepayment_fee_with_gst(
                    target.prepayment_penalty_pct, loan_market(target, user.country) == Country.IN)
                effective_prepay = extra_in_loan_ccy - penalty_in_loan_ccy
                payments[id(target)] += effective_prepay
                if penalty_in_loan_ccy > 0:
                    prepay_penalty_paid = to_user_currency(penalty_in_loan_ccy, target, user)
                    penalised = (target, effective_prepay, penalty_in_loan_ccy / extra_in_loan_ccy)
                last_part_payment_month[id(target)] = m
                extra_target_index = loan_position[id(target)]

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
            interest_this = monthly_interest_charge(l, user.country)
            if l.loan_type == LoanType.CREDIT_CARD and l.outstanding > 0:
                interest_this = card_cycle_interest(
                    l, user.country, card_opening.get(id(l), l.outstanding),
                    card_spend.get(id(l), D("0")), payments.get(id(l), D("0")),
                )
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

        # The fee is due only on the part of the prepayment the loan
        # actually took. When the target cleared, the refunded part was
        # charged a fee it never paid (BUG_REPORT Low): give that back.
        if penalised is not None and id(penalised[0]) in cleared and penalised[2] < 1:
            tgt, eff_prepay, pct = penalised
            refund_loan = max(D("0"), min(eff_prepay, from_user_currency(cascade_surplus, tgt, user)))
            over_fee = refund_loan * pct / (D("1") - pct)
            over_fee_user = to_user_currency(over_fee, tgt, user)
            prepay_penalty_paid = max(D("0"), prepay_penalty_paid - over_fee_user)
            cascade_surplus += over_fee_user
        # Fold prepay penalty into interest_paid — bank pocketed it,
        # principal didn't budge by that amount. Accounting it as
        # interest keeps total_interest comparable across runs and
        # makes the cost visible in the debt-free month.
        if prepay_penalty_paid > 0:
            interest_paid += prepay_penalty_paid

        # In a short month the minimums were paid with money the user had
        # to find elsewhere (`shortfall`). The unused part of a clearing
        # loan's minimum shrinks that gap first; cascading it spent cash the
        # user never had, so a tiny prepayment that moved a clearing month
        # could make the plan cost MORE interest (property suite bug).
        if shortfall > 0 and cascade_surplus > 0:
            absorbed = min(shortfall, cascade_surplus)
            shortfall -= absorbed
            cascade_surplus -= absorbed
        # A freed EMI next pays back gap borrowing (live test #15: it used
        # to land on another loan as an "extra" in a month the plan had
        # already called short).
        if gap_debt > 0 and cascade_surplus > 0:
            pay_back = min(gap_debt, cascade_surplus)
            gap_debt -= pay_back
            gap_repaid += pay_back
            cascade_surplus -= pay_back

        # Apply cascade within the same month to the next-priority active loan
        # (after the clears we just processed)
        if cascade_surplus > 0 and not minimums_only:
            # Walk the payoff order until the freed money is used up (H2):
            # only the next loan used to get it, and anything above its
            # balance was dropped. Gated loans (lock-in / cooldown /
            # pre-EMI) and loans not worth prepaying are skipped; whatever
            # is left is kept by the user as savings.
            for top in ranked:
                if cascade_surplus <= 0:
                    break
                if top.outstanding <= 0 or id(top) not in worth_ids or not _can_part_pay(top, m):
                    continue
                add_principal = from_user_currency(cascade_surplus, top, user)
                if add_principal >= top.outstanding:
                    add_principal = top.outstanding
                    if id(top) not in cleared:
                        cleared.append(id(top))
                top.outstanding -= add_principal
                used = to_user_currency(add_principal, top, user)
                cascade_surplus -= used
                principal_paid += used
                # Reflect the cascade in the per-loan payment dict so the UI
                # can show the real amount the user sends to that bank.
                payments[id(top)] = payments.get(id(top), D("0")) + add_principal
            if cascade_surplus > 0:
                invested_this_month += cascade_surplus
                cascade_surplus = D("0")

        # Auto-reinvest event (e.g. annual tax-saving refund routed back
        # into debt). Layered on top of cascade — same routing rule (highest
        # effective-APR active loan after this month's payments). Cascades
        # again if it clears the target.
        if m in reinvest_by_month and not minimums_only:
            reinvest_amount = reinvest_by_month[m]
            # Money that arrives in a short month covers the gap, then any
            # gap borrowing, before it prepays a loan.
            if gap_as_debt:
                for_gap = min(shortfall, reinvest_amount)
                shortfall -= for_gap
                reinvest_amount -= for_gap
                pay_back = min(gap_debt, reinvest_amount)
                gap_debt -= pay_back
                gap_repaid += pay_back
                reinvest_amount -= pay_back
            remaining_active = [l for l in loans if l.outstanding > 0 and m >= l.first_payment_month]
            if remaining_active:
                # Re-rank by current effective APR (some loans may have
                # cleared this month — those drop out automatically).
                reinvest_ranked = rank_loans(
                    remaining_active,
                    {k: mc.order_key for k, mc in user_marginal_costs(remaining_active, user, marg, m, loan_start_month).items()},
                    strategy,
                    country=user.country,
                    balance_of=lambda l: to_user_currency(l.outstanding, l, user),
                    rules=user.payoff_rules, index_of=loan_position,
                )
                left = reinvest_amount
                for target in reinvest_ranked:
                    if left <= 0:
                        break
                    if not _can_part_pay(target, m):
                        continue
                    add = from_user_currency(left, target, user)
                    if add >= target.outstanding:
                        add = target.outstanding
                        if id(target) not in cleared:
                            cleared.append(id(target))
                    target.outstanding -= add
                    used = to_user_currency(add, target, user)
                    left -= used
                    principal_paid += used
                    payments[id(target)] = (
                        payments.get(id(target), D("0")) + add
                    )
                if left > 0:
                    invested_this_month += left

        # What's still short is paid from the emergency fund, then borrowed.
        if gap_as_debt and shortfall > 0:
            gap_from_savings = min(shortfall, max(D("0"), ef_balance))
            ef_balance -= gap_from_savings
            gap_borrowed = shortfall - gap_from_savings
            gap_debt += gap_borrowed

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
        loan_by_id = {id(l): l for l in loans}
        extra_paid = sum(
            (
                to_user_currency(
                    max(D("0"), amt - minimums.get(lid, D("0"))), loan_by_id[lid], user,
                )
                for lid, amt in payments.items()
            ),
            D("0"),
        )
        # Per-loan balance by 0-based position. ALL loans included so the
        # chart sees a stable series (cleared loans flat at 0, never
        # disappearing).
        balances_by_idx = {loan_position[id(l)]: l.outstanding for l in loans}
        balance_user_ccy = sum(
            (to_user_currency(l.outstanding, l, user) for l in loans), D("0"),
        )
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
            balance_in_user_currency=balance_user_ccy,
            goal_contributions=goal_contributions_this_month,
            extra_paid=extra_paid,
            shortfall=shortfall,
            extra_to_loan_index=extra_target_index,
            set_aside_for_prepay=prepay_pot,
            gap_debt=gap_debt,
            gap_interest=gap_int_month,
            gap_borrowed=gap_borrowed,
            gap_repaid=gap_repaid,
            gap_from_savings=gap_from_savings,
        ))

        total_interest += interest_paid
        total_invested += invested_this_month

        if m >= last_arrival and all(l.outstanding == 0 for l in loans) and gap_debt <= 0:
            debt_free_month = m
            break

    return SimulationResult(
        months=months,
        debt_free_month=debt_free_month,
        # Gap borrowing's interest is a real cost of the plan (grill #38).
        total_interest_paid=total_interest + total_gap_interest,
        total_invested=total_invested,
        final_balances={id(l): l.outstanding for l in loans},
        first_month_goal_allocation=first_month_alloc,
        gap_rate=gap_rate,
        total_gap_interest=total_gap_interest,
    )


def baseline_minimums_only(
    user: User,
    horizon_months: int = 360,
    simple_mode: bool = False,
    lifecycle_events: list[LifecycleEvent] | None = None,
    gap_as_debt: bool = True,
) -> SimulationResult:
    """Counterfactual: pay only minimums (no extra), no Layer 3 redirection.
    Used to compute `savings_vs_minimums` for the Plan screen.

    Runs the plan's own month loop with `minimums_only`, so both sides see
    the same rate resets, drift, pre-EMI months and card spend. The old
    separate loop kept a balance flat when the minimum didn't cover the
    interest, and counted interest the user never paid.
    """
    return simulate_plan(
        user,
        horizon_months=horizon_months,
        simple_mode=simple_mode,
        lifecycle_events=lifecycle_events,
        minimums_only=True,
        gap_as_debt=gap_as_debt,
    )


@dataclass
class GoalTradeoff:
    """Roadmap PR F: one goal funded now (on schedule, before high-interest
    debt) against debt first (funded after every high-interest loan clears)."""
    goal_id: str
    has_high_apr_debt: bool
    extra_interest: Decimal
    debt_free_later_months: int
    debt_first_reaches_target: bool
    debt_first_fill_rate: Decimal
    funded_now_fill_rate: Decimal


def goal_tradeoff(user: User, goals: list[GoalState], goal_id: str, **plan_kwargs) -> GoalTradeoff:
    """The interest cost of funding `goal_id` before high-interest debt.

    Runs the plan twice with every other goal as set: once with this goal
    on schedule from today (no deferral), once debt first. The difference
    in interest paid is the trade-off line on Goals."""
    from engine.goals import debt_gate

    def run(rule: str):
        gs = deepcopy(goals)
        for g in gs:
            if g.id == goal_id:
                g.funding_rule, g.after_loan_index, g.funding_start_month_index = rule, None, None
        res = simulate_plan(user, goals=gs, **plan_kwargs)
        g = next(g for g in gs if g.id == goal_id)
        saved = g.saved_at_target if g.saved_at_target is not None else g.saved_so_far
        if g.saved_at_target is None and res.months and g.target_month_index > len(res.months):
            # The plan stopped when the debts cleared, before the goal's date:
            # from then on the month's spare cash and what went to the loans
            # are free for it.
            last = res.months[-1]
            saved += (last.available_surplus + last.total_payment_nominal) * (g.target_month_index - len(res.months))
        fill = min(D("1"), saved / g.required_amount) if g.required_amount > 0 else D("1")
        return res, fill

    has_high = not debt_gate(user.loans, user.country)(None)
    now, now_fill = run("schedule")
    later, later_fill = run("after_debt")
    horizon = plan_kwargs.get("horizon_months", 360)
    m_now = now.debt_free_month or horizon + 1
    m_later = later.debt_free_month or horizon + 1
    return GoalTradeoff(
        goal_id=goal_id,
        has_high_apr_debt=has_high,
        extra_interest=(now.total_interest_paid - later.total_interest_paid).quantize(D("0.01")),
        debt_free_later_months=max(0, m_now - m_later),
        debt_first_reaches_target=later_fill >= D("1"),
        debt_first_fill_rate=later_fill,
        funded_now_fill_rate=now_fill,
    )
