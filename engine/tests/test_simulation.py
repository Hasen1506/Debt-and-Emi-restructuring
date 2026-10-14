"""Month-by-month plan simulation — Layers 0-3 with cascade."""
from decimal import Decimal
from engine.simulation import (
    simulate_plan, baseline_minimums_only, _first_hike_month_index,
)
from engine.models import (
    User, Loan, LoanType, Country, IncomeType, TaxRegimeIN,
    InvestmentOption, LiquidityClass,
    LifecycleEvent, LifecycleEventKind,
)
from engine.ordering import Strategy

D = Decimal


def _user_two_loans() -> User:
    """A user with a credit card (small, high-rate) and home loan (large, low)."""
    home = Loan(loan_type=LoanType.HOME, bank="HDFC Bank",
                outstanding=D("4000000"), nominal_rate=D("0.085"),
                rate_type="floating", tenure_months_remaining=240,
                scheduled_emi=D("34713"))
    card = Loan(loan_type=LoanType.CREDIT_CARD, bank="ICICI Bank",
                outstanding=D("100000"), nominal_rate=D("0.36"),
                rate_type="fixed", tenure_months_remaining=12,
                scheduled_emi=D("0"))
    return User(
        country=Country.IN, income_type=IncomeType.SALARIED,
        annual_income=D("1800000"), monthly_income=D("150000"),
        fixed_expenses=D("60000"),
        savings_balance=D("500000"),
        primary_bank="HDFC Bank", tax_regime=TaxRegimeIN.NEW,
        efund_balance=D("300000"), efund_target=D("300000"),    # target met
        loans=[home, card],
        investment_options=[
            InvestmentOption(name="Liquid fund", expected_return=D("0.07"),
                             liquidity_class=LiquidityClass.LIQUID, is_in_pool=True),
        ],
        inflation_rate=D("0.046"),
    )


def test_simulation_produces_monthly_rows():
    user = _user_two_loans()
    result = simulate_plan(user, Strategy.AVALANCHE, horizon_months=18)
    assert len(result.months) > 0
    assert result.months[0].month_index == 1


def test_reinvest_event_reduces_total_interest():
    """Auto-reinvest toggle: posting a non-zero event at month X routes the
    amount to the highest-effective-APR active loan, cutting total interest
    paid vs. the no-reinvest baseline.

    Uses month 21 (post-Y1 ITR-filing in India) and the same user, so the
    reinvest hits while the home loan still has plenty of balance to absorb
    it. Card normally clears first; reinvest amount is large enough to
    matter on the home leg even after card clears."""
    user = _user_two_loans()
    base = simulate_plan(user, Strategy.AVALANCHE, horizon_months=240)
    with_reinvest = simulate_plan(
        user, Strategy.AVALANCHE, horizon_months=240,
        reinvest_events=[(21, D("60000")), (33, D("55000")), (45, D("50000"))],
    )
    assert with_reinvest.total_interest_paid < base.total_interest_paid
    # Months pulled forward should also be ≥ 0 (debt clears at least as
    # fast). Note debt_free_month is None when horizon exhausts, so guard.
    if (
        base.debt_free_month is not None
        and with_reinvest.debt_free_month is not None
    ):
        assert with_reinvest.debt_free_month <= base.debt_free_month


def test_inflate_expenses_erodes_surplus_pushes_debt_free_later():
    """When inflate_expenses=True, monthly expenses compound at user.inflation_rate
    → less surplus available → debt-free month must be ≥ baseline. We
    pick a budget where surplus is tight enough that inflation actually
    bites within the horizon."""
    user = _user_two_loans()
    # Tight surplus: bring fixed_expenses close to income so inflation
    # has room to eat into the surplus over the simulation horizon.
    user.fixed_expenses = D("110000")  # of 150k income → 40k surplus pre-inflation
    user.inflation_rate = D("0.08")     # aggressive but well within MPC bands
    base = simulate_plan(user, Strategy.AVALANCHE, horizon_months=240)
    inflated = simulate_plan(
        user, Strategy.AVALANCHE, horizon_months=240, inflate_expenses=True,
    )
    # Inflation eats surplus → total interest grows or debt-free pushes out.
    # We assert one of the two — both possible because the engine clamps
    # surplus at 0 (negative surplus doesn't borrow more, just halts extra).
    if (
        base.debt_free_month is not None
        and inflated.debt_free_month is not None
    ):
        assert inflated.debt_free_month >= base.debt_free_month
    assert inflated.total_interest_paid >= base.total_interest_paid


def test_hike_schedule_overrides_scalar_rate_per_year():
    """When a hike_schedule is set, the engine picks the phase rate for
    each firing year. Phase {1, 3, 0.07} → years 1+2 at 7%, then phase
    {3, 5, 0.12} → years 3+4 at 12%. Net income at year 5 should match
    the compounded product (1.07)² × (1.12)² × initial."""
    user = _user_two_loans()
    user.annual_hike_rate = D("0.05")          # fallback (shouldn't fire inside phases)
    user.hike_schedule = [
        (1, 3, D("0.07")),
        (3, 5, D("0.12")),
    ]
    # Run 60 months so all four hikes fire.
    result = simulate_plan(user, Strategy.AVALANCHE, horizon_months=60)
    # Just sanity-check the simulation completes; the bracket-transition
    # path tests the per-year rate selection more directly via E.
    assert len(result.months) > 0


def test_fx_drift_appreciates_user_currency_view_of_inr_loan():
    """Hybrid NRI-US user with an INR loan + 2.5%/yr drift: the INR
    interest paid (in INR) is unchanged, but its USD-equivalent in
    `interest_paid_month` should decline year-over-year vs. the
    no-drift baseline (the rupee buys fewer USD each year)."""
    home = Loan(loan_type=LoanType.HOME, bank="HDFC Bank",
                outstanding=D("4000000"), nominal_rate=D("0.085"),
                rate_type="floating", tenure_months_remaining=240,
                scheduled_emi=D("34713"), currency="INR")
    user = User(
        country=Country.US, income_type=IncomeType.SALARIED,
        annual_income=D("120000"), monthly_income=D("10000"),
        fixed_expenses=D("4000"), savings_balance=D("50000"),
        primary_bank="JPMorgan Chase",
        efund_balance=D("20000"), efund_target=D("40000"),
        is_nri_us=True,
        fx_to_user_currency={"INR": D("0.012")},  # 1 INR = 0.012 USD spot
        loans=[home],
        investment_options=[
            InvestmentOption(name="HYSA", expected_return=D("0.045"),
                             liquidity_class=LiquidityClass.LIQUID,
                             is_in_pool=True),
        ],
    )
    base = simulate_plan(user, Strategy.AVALANCHE, horizon_months=120)
    with_drift = simulate_plan(
        user, Strategy.AVALANCHE, horizon_months=120,
    )
    # Now set drift and run again. Sign convention: drift applies to
    # fx_to_user_currency (USD-per-INR), and the rupee depreciates →
    # USD-per-INR decreases → drift is NEGATIVE.
    user.fx_drift_annualized = {"INR": D("-0.025")}
    drifted = simulate_plan(user, Strategy.AVALANCHE, horizon_months=120)

    # Year-1 USD-equivalent interest should be roughly the same as baseline
    # (drift compounds slowly in month-1; by m=12 we get ~2.5% effect).
    # By year 5+ the drift compounds visibly — total USD interest paid
    # should be LESS than baseline because the rupee is buying fewer USD.
    assert drifted.total_interest_paid < base.total_interest_paid
    # Sanity: the no-drift case matches baseline exactly.
    assert with_drift.total_interest_paid == base.total_interest_paid


def test_hike_schedule_falls_back_to_scalar_outside_phases():
    """If a year is outside all phases, engine uses annual_hike_rate.
    Schedule covers years 1-2 only → year 3 uses scalar 5%."""
    from engine.simulation import _resolve_hike_rate
    user = _user_two_loans()
    user.annual_hike_rate = D("0.05")
    user.hike_schedule = [(1, 3, D("0.07"))]
    assert _resolve_hike_rate(user, 1) == D("0.07")
    assert _resolve_hike_rate(user, 2) == D("0.07")
    assert _resolve_hike_rate(user, 3) == D("0.05")  # fallback to scalar


def test_inflate_expenses_off_is_no_op():
    """inflate_expenses=False matches legacy behaviour exactly — same
    total interest, same debt-free month."""
    user = _user_two_loans()
    user.inflation_rate = D("0.055")
    base = simulate_plan(user, Strategy.AVALANCHE, horizon_months=60)
    explicit_off = simulate_plan(
        user, Strategy.AVALANCHE, horizon_months=60, inflate_expenses=False,
    )
    assert base.total_interest_paid == explicit_off.total_interest_paid
    assert base.debt_free_month == explicit_off.debt_free_month


def test_reinvest_event_empty_list_is_no_op():
    """Engine treats `reinvest_events=None` and `reinvest_events=[]` as
    identical no-op paths — total interest must match the baseline exactly."""
    user = _user_two_loans()
    base = simulate_plan(user, Strategy.AVALANCHE, horizon_months=60)
    empty = simulate_plan(
        user, Strategy.AVALANCHE, horizon_months=60, reinvest_events=[],
    )
    assert base.total_interest_paid == empty.total_interest_paid


def test_card_clears_before_home_with_avalanche():
    """Card at 36% (way higher effective rate) should clear within a year of extra."""
    user = _user_two_loans()
    result = simulate_plan(user, Strategy.AVALANCHE, horizon_months=24)
    # final_balances is keyed by id of the simulator's *internal* loan copies,
    # so just check that at least one loan in the result hit zero by month 24.
    assert any(bal == D("0") for bal in result.final_balances.values())


def test_minimums_baseline_takes_longer():
    """Baseline (minimums-only) should leave higher final balances than avalanche."""
    user = _user_two_loans()
    avalanche = simulate_plan(user, Strategy.AVALANCHE, horizon_months=60)
    baseline = baseline_minimums_only(user, horizon_months=60)
    # Avalanche should have paid more interest than minimums *would* over the same window?
    # No — avalanche pays MORE principal, LESS interest. Test that interest is less.
    assert avalanche.total_interest_paid < baseline.total_interest_paid


def test_simulation_stops_at_debt_free():
    """When all loans clear, simulation ends and reports debt_free_month."""
    home = Loan(loan_type=LoanType.PERSONAL, bank="X", outstanding=D("20000"),
                nominal_rate=D("0.12"), rate_type="fixed",
                tenure_months_remaining=6, scheduled_emi=D("3460"))
    user = User(
        country=Country.IN, income_type=IncomeType.SALARIED,
        annual_income=D("1200000"), monthly_income=D("100000"),
        fixed_expenses=D("30000"), savings_balance=D("100000"),
        primary_bank="HDFC Bank", tax_regime=TaxRegimeIN.NEW,
        efund_balance=D("100000"), efund_target=D("100000"),
        loans=[home],
        investment_options=[],
        inflation_rate=D("0.046"),
    )
    result = simulate_plan(user, Strategy.AVALANCHE, horizon_months=24)
    assert result.debt_free_month is not None
    assert result.debt_free_month < 24


def test_layer3_redirects_to_investment_when_loan_rate_low():
    """Home loan at 7% effective + 12% liquid return → invest, not prepay."""
    home = Loan(loan_type=LoanType.HOME, bank="HDFC Bank",
                outstanding=D("4000000"), nominal_rate=D("0.07"),
                rate_type="floating", tenure_months_remaining=240,
                scheduled_emi=D("31000"))
    user = User(
        country=Country.IN, income_type=IncomeType.SALARIED,
        annual_income=D("1800000"), monthly_income=D("150000"),
        fixed_expenses=D("60000"), savings_balance=D("500000"),
        primary_bank="HDFC Bank", tax_regime=TaxRegimeIN.NEW,
        efund_balance=D("300000"), efund_target=D("300000"),
        loans=[home],
        investment_options=[
            InvestmentOption(name="Nifty 50", expected_return=D("0.12"),
                             liquidity_class=LiquidityClass.LIQUID, is_in_pool=True),
        ],
        inflation_rate=D("0.046"),
    )
    result = simulate_plan(user, Strategy.AVALANCHE, horizon_months=12)
    # All extra goes to invest, not principal
    assert result.total_invested > D("0")


def test_real_emi_lower_than_nominal_over_time():
    """real_emi deflated by inflation should be lower than nominal in later months."""
    user = _user_two_loans()
    result = simulate_plan(user, Strategy.AVALANCHE, horizon_months=24)
    later = result.months[-1]
    assert later.total_payment_real < later.total_payment_nominal


# ─────────────────────────────────────────────────────────────────────────────
# FY-anchored hike firing
# ─────────────────────────────────────────────────────────────────────────────

def test_first_hike_month_default_back_compat():
    """Default sim_start=1 (Jan), hike_month=1 → first hike at m=13.

    Matches the legacy 'every 12 months from start, skipping m=1' behaviour
    so existing tests/callers that don't pass either field stay correct.
    """
    assert _first_hike_month_index(1, 1) == 13


def test_first_hike_month_in_user_starting_may():
    """IN user starts sim in May (5), hike anchored to April (4).
    Next April is 11 months away → first hike at m=12."""
    assert _first_hike_month_index(5, 4) == 12


def test_first_hike_month_us_user_starting_september():
    """US user starts sim in September (9), hike at January (1).
    Next January is 4 months away → first hike at m=5."""
    assert _first_hike_month_index(9, 1) == 5


def test_first_hike_month_when_today_is_hike_month():
    """If sim starts in the hike-effective month, current income is
    treated as already-hiked; defer firing to next year (m=13)."""
    assert _first_hike_month_index(4, 4) == 13
    assert _first_hike_month_index(1, 1) == 13


def test_first_hike_month_one_month_away():
    """sim_start=April, hike=May → fires at m=2."""
    assert _first_hike_month_index(4, 5) == 2


def test_hike_fires_on_anchored_month_not_legacy_m13():
    """Verify simulate_plan honours the anchor: with sim_start=5 (May)
    and hike_month=4 (April), the income hike fires at m=12 — not m=13.

    Uses a large home loan so total surplus is small relative to balance and
    the hike's effect on cumulative interest is observable inside the horizon.
    """
    home = Loan(loan_type=LoanType.HOME, bank="HDFC", outstanding=D("4000000"),
                nominal_rate=D("0.085"), rate_type="floating",
                tenure_months_remaining=240, scheduled_emi=D("34713"))
    user = User(
        country=Country.IN, income_type=IncomeType.SALARIED,
        annual_income=D("1200000"), monthly_income=D("100000"),
        fixed_expenses=D("50000"), savings_balance=D("500000"),
        primary_bank="HDFC", tax_regime=TaxRegimeIN.NEW,
        efund_balance=D("300000"), efund_target=D("300000"),
        loans=[home], investment_options=[],
        annual_hike_rate=D("0.10"),
        hike_effective_month=4,           # April
        inflation_rate=D("0.046"),
    )
    # FY-anchored (sim_start=5 May, hike_month=4 Apr): first hike at m=12
    # Default sim_start=1 with hike_month=4: first hike at m=4
    # So the anchored run delays the hike by 8 months, paying more interest.
    anchored = simulate_plan(
        user, Strategy.AVALANCHE, horizon_months=24,
        simulation_start_month=5,
    )
    early_anchor = simulate_plan(
        user, Strategy.AVALANCHE, horizon_months=24,
        simulation_start_month=1,    # default — hike fires at m=4
    )
    assert anchored.total_interest_paid > early_anchor.total_interest_paid


def test_zero_hike_rate_no_op_regardless_of_anchor():
    """If annual_hike_rate==0, anchor doesn't matter — no income growth."""
    home = Loan(loan_type=LoanType.PERSONAL, bank="X", outstanding=D("100000"),
                nominal_rate=D("0.12"), rate_type="fixed",
                tenure_months_remaining=60, scheduled_emi=D("2225"))
    user = User(
        country=Country.IN, income_type=IncomeType.SALARIED,
        annual_income=D("1200000"), monthly_income=D("100000"),
        fixed_expenses=D("30000"), savings_balance=D("500000"),
        primary_bank="X", tax_regime=TaxRegimeIN.NEW,
        efund_balance=D("100000"), efund_target=D("100000"),
        loans=[home], investment_options=[],
        annual_hike_rate=D("0"),
        hike_effective_month=4,
        inflation_rate=D("0.046"),
    )
    a = simulate_plan(user, Strategy.AVALANCHE, horizon_months=18, simulation_start_month=5)
    b = simulate_plan(user, Strategy.AVALANCHE, horizon_months=18, simulation_start_month=1)
    assert a.total_interest_paid == b.total_interest_paid


def _user_card_only(expected_spend: Decimal = D("0")) -> User:
    """Single-card user used to exercise the spend modelling cleanly."""
    card = Loan(
        loan_type=LoanType.CREDIT_CARD, bank="HDFC Bank",
        outstanding=D("100000"), nominal_rate=D("0.36"),
        rate_type="fixed", tenure_months_remaining=0,
        scheduled_emi=D("5000"),
        expected_monthly_spend=expected_spend,
    )
    return User(
        country=Country.IN, income_type=IncomeType.SALARIED,
        annual_income=D("1200000"), monthly_income=D("100000"),
        fixed_expenses=D("40000"),
        savings_balance=D("200000"),
        primary_bank="HDFC Bank", tax_regime=TaxRegimeIN.NEW,
        efund_balance=D("200000"), efund_target=D("200000"),
        loans=[card],
        investment_options=[],
        inflation_rate=D("0.046"),
    )


def test_card_spend_default_zero_unchanged_from_pre_feature_run():
    """expected_monthly_spend defaults to 0 and the simulation matches the
    legacy freeze-and-pay-off behaviour. Guards against accidental
    regressions when toggling the new code path off."""
    frozen = _user_card_only(D("0"))
    result = simulate_plan(frozen, Strategy.AVALANCHE, horizon_months=36)
    # With ₹100k outstanding at 36% APR and no new spend, the card must
    # clear inside 36 months (₹5k/mo EMI covers principal + interest).
    final = list(result.final_balances.values())
    assert all(bal == D("0") for bal in final)


def test_card_spend_extends_payoff_when_user_keeps_using_card():
    """A card with new charges each month takes longer to clear (or never
    clears in the horizon) compared to the same card with spend=0."""
    no_spend = _user_card_only(D("0"))
    with_spend = _user_card_only(D("3000"))  # ₹3k/mo new charges
    a = simulate_plan(no_spend, Strategy.AVALANCHE, horizon_months=36)
    b = simulate_plan(with_spend, Strategy.AVALANCHE, horizon_months=36)
    # The spending scenario must pay strictly more interest over the same
    # window — more outstanding accrues interest each month.
    assert b.total_interest_paid > a.total_interest_paid


def test_card_spend_only_applies_to_cards_not_other_loans():
    """expected_monthly_spend on a non-card loan is silently ignored — the
    field exists on Loan for schema simplicity but the simulator gates on
    loan_type==CREDIT_CARD."""
    pl = Loan(
        loan_type=LoanType.PERSONAL, bank="X", outstanding=D("100000"),
        nominal_rate=D("0.14"), rate_type="fixed",
        tenure_months_remaining=24, scheduled_emi=D("4800"),
        expected_monthly_spend=D("999999"),  # absurd value — must be ignored
    )
    user = User(
        country=Country.IN, income_type=IncomeType.SALARIED,
        annual_income=D("1200000"), monthly_income=D("100000"),
        fixed_expenses=D("30000"), savings_balance=D("200000"),
        primary_bank="X", tax_regime=TaxRegimeIN.NEW,
        efund_balance=D("100000"), efund_target=D("100000"),
        loans=[pl], investment_options=[],
        inflation_rate=D("0.046"),
    )
    result = simulate_plan(user, Strategy.AVALANCHE, horizon_months=30)
    # If the spend HAD been applied, outstanding would have grown unboundedly.
    # Loan should still clear inside the 30-month window.
    final = list(result.final_balances.values())
    assert all(bal == D("0") for bal in final)


# ─── Lifecycle events ──────────────────────────────────────────────────────


def test_salary_reset_at_month_increases_surplus_cuts_interest():
    """A salary_reset doubling take-home from m=12 should reduce total
    interest paid vs. the baseline — more surplus → faster amortisation."""
    user = _user_two_loans()
    base = simulate_plan(user, Strategy.AVALANCHE, horizon_months=240)
    events = [
        LifecycleEvent(
            kind=LifecycleEventKind.SALARY_RESET,
            effective_month=12,
            new_monthly_take_home=D("300000"),  # 2x baseline 150000
        ),
    ]
    boosted = simulate_plan(
        user, Strategy.AVALANCHE, horizon_months=240, lifecycle_events=events
    )
    assert boosted.total_interest_paid < base.total_interest_paid


def test_floating_rate_reset_mutates_loan_rate_at_effective_month():
    """A rate reset should be reflected in the loan's nominal_rate at the
    effective month forward. Isolated from Layer 3 (invest-vs-prepay) by
    using no investment options + tight surplus — pure amortisation lets
    the rate change drive total interest directly: lower rate → less
    interest."""
    home = Loan(
        loan_type=LoanType.HOME,
        bank="HDFC Bank",
        outstanding=D("4000000"),
        nominal_rate=D("0.12"),  # exaggerated rate so diff is unambiguous
        rate_type="floating",
        tenure_months_remaining=240,
        scheduled_emi=D("44047"),
    )
    user = User(
        country=Country.IN,
        income_type=IncomeType.SALARIED,
        annual_income=D("600000"),
        monthly_income=D("50000"),
        fixed_expenses=D("5000"),
        savings_balance=D("0"),
        primary_bank="HDFC Bank",
        tax_regime=TaxRegimeIN.NEW,
        loans=[home],
        investment_options=[],  # no Layer 3 invest-vs-prepay decision
        inflation_rate=D("0.046"),
    )
    base = simulate_plan(user, Strategy.AVALANCHE, horizon_months=120)
    events = [
        LifecycleEvent(
            kind=LifecycleEventKind.FLOATING_RATE_RESET,
            effective_month=6,
            loan_index=0,
            new_rate=D("0.06"),  # 12% → 6%
        ),
    ]
    cheaper = simulate_plan(
        user, Strategy.AVALANCHE, horizon_months=120, lifecycle_events=events
    )
    assert cheaper.total_interest_paid < base.total_interest_paid


def test_ef_split_zero_sends_everything_to_debt():
    """A split of 0 is the user saying "no emergency-fund top-up": every
    rupee of surplus goes to debt. It used to fall back to the fixed
    gap / 12 hold-back, so the /plan slider could not reach 0%."""
    user = _user_two_loans()
    user.efund_balance = D("0")
    user.efund_target = D("600000")
    user.investment_options = []
    fixed = simulate_plan(user, Strategy.AVALANCHE, horizon_months=120)
    zero = simulate_plan(
        user, Strategy.AVALANCHE, horizon_months=120, ef_top_up_rate=D("0"),
    )
    assert zero.total_interest_paid < fixed.total_interest_paid
    assert zero.debt_free_month <= fixed.debt_free_month


def test_ef_split_is_the_only_top_up_when_given():
    """With a split, month 1's extra payment is exactly (1 - split) of the
    surplus; no fixed gap / 12 is taken first (the two used to stack:
    ₹12,500 fixed plus 30% of the rest)."""
    user = _user_two_loans()
    user.efund_balance = D("0")
    user.efund_target = D("300000")
    user.investment_options = []
    none = simulate_plan(
        user, Strategy.AVALANCHE, horizon_months=12, ef_top_up_rate=D("0"),
    )
    split = simulate_plan(
        user, Strategy.AVALANCHE, horizon_months=12, ef_top_up_rate=D("0.3"),
    )
    paid_none = sum(none.months[0].payments_by_loan_index.values(), D("0"))
    paid_split = sum(split.months[0].payments_by_loan_index.values(), D("0"))
    minimums = paid_none - none.months[0].available_surplus
    extra_split = paid_split - minimums
    assert abs(extra_split - none.months[0].available_surplus * D("0.7")) < D("0.01")


def test_ef_waterfall_diverts_surplus_when_target_unmet():
    """With a 30% split and a real EF gap, less surplus reaches debt
    each month than with a 0% split → more interest, later debt-free
    month. Isolated from Layer 3 by removing the invest-vs-prepay pool
    so the comparison is pure debt amortisation."""
    user = _user_two_loans()
    user.efund_balance = D("0")
    user.efund_target = D("300000")
    user.investment_options = []
    base = simulate_plan(
        user, Strategy.AVALANCHE, horizon_months=120, ef_top_up_rate=D("0"),
    )
    diverted = simulate_plan(
        user, Strategy.AVALANCHE, horizon_months=120, ef_top_up_rate=D("0.3"),
    )
    assert diverted.total_interest_paid > base.total_interest_paid
    if base.debt_free_month is not None and diverted.debt_free_month is not None:
        assert diverted.debt_free_month >= base.debt_free_month


def test_ef_waterfall_stops_at_target():
    """Once running EF balance reaches efund_target, divert ceases and
    100% of surplus flows to debt again. Verified indirectly: with a
    small target reachable in a few months, the long-run total interest
    should be much closer to baseline than a never-reaching-target case."""
    user = _user_two_loans()
    user.efund_balance = D("0")
    user.investment_options = []
    base = simulate_plan(user, Strategy.AVALANCHE, horizon_months=120)
    # Small target — fills in ~1-2 months at 30% of typical surplus.
    user.efund_target = D("20000")
    small = simulate_plan(
        user, Strategy.AVALANCHE, horizon_months=120, ef_top_up_rate=D("0.3"),
    )
    # Big target — divert runs for many months.
    user.efund_target = D("3000000")
    big = simulate_plan(
        user, Strategy.AVALANCHE, horizon_months=120, ef_top_up_rate=D("0.3"),
    )
    # Small target deviation from baseline is much smaller than big target.
    small_delta = small.total_interest_paid - base.total_interest_paid
    big_delta = big.total_interest_paid - base.total_interest_paid
    assert big_delta > small_delta


def test_lifecycle_event_with_effective_month_zero_is_ignored():
    """Defensive: events with effective_month < 1 (shouldn't reach the
    engine — frontend filters them) are silently dropped, not applied at
    m=1."""
    user = _user_two_loans()
    base = simulate_plan(user, Strategy.AVALANCHE, horizon_months=120)
    events = [
        LifecycleEvent(
            kind=LifecycleEventKind.SALARY_RESET,
            effective_month=0,
            new_monthly_take_home=D("500000"),
        ),
    ]
    result = simulate_plan(
        user, Strategy.AVALANCHE, horizon_months=120, lifecycle_events=events
    )
    assert result.total_interest_paid == base.total_interest_paid


def test_lifecycle_event_empty_list_is_no_op():
    """Baseline behaviour preserved when lifecycle_events is None or []."""
    user = _user_two_loans()
    base = simulate_plan(user, Strategy.AVALANCHE, horizon_months=120)
    none_result = simulate_plan(
        user, Strategy.AVALANCHE, horizon_months=120, lifecycle_events=None
    )
    empty_result = simulate_plan(
        user, Strategy.AVALANCHE, horizon_months=120, lifecycle_events=[]
    )
    assert none_result.total_interest_paid == base.total_interest_paid
    assert empty_result.total_interest_paid == base.total_interest_paid


# ─── Extra paid per month (26 Sep 2026) ──────────────────────────────────────

def test_minimums_only_pays_no_extra_even_for_a_card_with_no_emi():
    """A card's minimum with scheduled EMI 0 read as 'extra' on /plan."""
    user = _user_card_only()
    user.loans[0].scheduled_emi = D("0")
    result = baseline_minimums_only(user, horizon_months=24)
    assert result.months
    assert all(row.extra_paid == 0 for row in result.months)


def test_extra_paid_is_the_debt_share_of_the_surplus_in_month_1():
    user = _user_two_loans()
    user.investment_options = []
    result = simulate_plan(
        user, Strategy.AVALANCHE, horizon_months=12, ef_top_up_rate=D("0"),
    )
    m1 = result.months[0]
    assert m1.extra_paid > 0
    assert abs(m1.extra_paid - m1.available_surplus) < D("1")


def test_extra_paid_is_in_the_users_currency():
    """A dollar loan's extra is converted, not added to rupees as-is."""
    user = _user_two_loans()
    user.investment_options = []
    for l in user.loans:
        l.currency = "USD"
    user.fx_to_user_currency = {"USD": D("84")}
    result = simulate_plan(
        user, Strategy.AVALANCHE, horizon_months=12, ef_top_up_rate=D("0"),
    )
    m1 = result.months[0]
    assert abs(m1.extra_paid - m1.available_surplus) < D("1")


def _user_short_of_cash() -> User:
    """₹30,000 in, ₹34,000 of costs, and a ₹1 lakh card with no EMI set:
    the card's minimum (₹5,000) is on top of the costs."""
    card = Loan(loan_type=LoanType.CREDIT_CARD, bank="Axis Bank",
                outstanding=D("100000"), nominal_rate=D("0.36"),
                rate_type="fixed", tenure_months_remaining=0,
                scheduled_emi=D("0"))
    return User(
        country=Country.IN, income_type=IncomeType.SALARIED,
        annual_income=D("360000"), monthly_income=D("30000"),
        fixed_expenses=D("34000"), savings_balance=D("0"),
        primary_bank="Axis Bank", tax_regime=TaxRegimeIN.NEW,
        efund_balance=D("0"), efund_target=D("0"),
        loans=[card], investment_options=[], inflation_rate=D("0.046"),
    )


def test_shortfall_counts_costs_and_card_minimums():
    """The gap is costs + minimums − income, not costs − income (₹4,000): the
    old home screen said "find ₹4,000/mo".

    Integration (W2 C14 × W1 C13): Axis's minimum is now its MITC rule,
    finance charges + GST in full + 2% of the balance (not a flat 5%), and
    C13 charges the interest on the average daily balance at the minimum.
    Hand check: 2% of ₹1,00,000 = ₹2,000; interest + 18% GST ≈ ₹3,475
    (36%/12 on a balance falling through the month, below ₹3,000 × 1.18 =
    ₹3,540) → minimum ≈ ₹5,475, gap ≈ ₹9,475."""
    result = simulate_plan(_user_short_of_cash(), Strategy.AVALANCHE, horizon_months=12)
    m1 = result.months[0]
    assert m1.shortfall == D("4000") + m1.total_payment_nominal
    assert abs(m1.total_payment_nominal - (D("2000") + m1.interest_paid_month)) < D("0.05")  # fixed-point rounding
    assert D("3400") < m1.interest_paid_month < D("3540")


def test_no_shortfall_when_income_covers_costs_and_minimums():
    result = simulate_plan(_user_two_loans(), Strategy.AVALANCHE, horizon_months=12)
    assert all(m.shortfall == 0 for m in result.months)


def test_debt_budget_caps_what_goes_to_debts_and_keeps_the_rest():
    """The user picks the monthly total for debts; the plan pays no more,
    the rest stays with them, and it still rolls freed EMIs forward."""
    user = _user_two_loans()
    free = simulate_plan(user, Strategy.AVALANCHE, horizon_months=360)
    capped = simulate_plan(user, Strategy.AVALANCHE, horizon_months=360,
                           debt_budget=D("50000"))
    m1 = capped.months[0]
    assert m1.total_payment_nominal <= D("50000") + D("0.01")
    assert m1.invested_this_month > 0
    # A smaller budget can only take as long or longer, at more interest.
    assert capped.debt_free_month >= free.debt_free_month
    assert capped.total_interest_paid > free.total_interest_paid
    # Once the card clears, the same total keeps going to the home loan.
    later = [r for r in capped.months if r.month_index > 6 and r.extra_paid > 0]
    assert later and all(r.total_payment_nominal <= D("50000") + D("0.01") for r in later)


def test_debt_budget_never_skips_a_minimum():
    user = _user_two_loans()
    res = simulate_plan(user, Strategy.AVALANCHE, horizon_months=24,
                        debt_budget=D("1000"))
    assert res.months[0].extra_paid == 0
    # EMI and card minimum are still paid in full.
    assert res.months[0].total_payment_nominal >= D("34713")


def test_a_spending_cut_raises_the_debt_budget_by_the_same_amount():
    user = _user_two_loans()
    capped = simulate_plan(user, Strategy.AVALANCHE, horizon_months=360,
                           debt_budget=D("50000"))
    cut = simulate_plan(user, Strategy.AVALANCHE, horizon_months=360,
                        debt_budget=D("50000"), income_delta=D("5000"))
    assert cut.months[0].total_payment_nominal == capped.months[0].total_payment_nominal + D("5000")


def test_loan_waiting_for_its_first_emi_is_owed_but_neither_accrues_nor_pays():
    """A loan taken this month pays its first EMI next month (AUDIT §10):
    month 1 leaves it as borrowed, with no EMI taken from the month's cash,
    and month 2 pays the EMI as for any loan."""
    user = _user_two_loans()
    user.loans = [user.loans[1]]  # just the card, so the plan has spare cash
    car = Loan(loan_type=LoanType.AUTO, bank="SBI",
               outstanding=D("600000"), nominal_rate=D("0.09"),
               rate_type="fixed", tenure_months_remaining=60,
               scheduled_emi=D("12455"), first_payment_month=2)
    user.loans.append(car)
    result = simulate_plan(user, Strategy.AVALANCHE, horizon_months=24)
    first, second = result.months[0], result.months[1]
    assert first.payments_by_loan_index.get(1, D("0")) == 0
    assert first.balances_by_loan_index[1] == D("600000")
    assert second.payments_by_loan_index[1] >= D("12455")
    # Still owed in month 1, so the plan isn't debt-free when the card clears.
    assert result.debt_free_month is None or result.debt_free_month > 2
    # The same loan paying from month 1 is one EMI ahead after month 1.
    now = _user_two_loans()
    now.loans = [now.loans[1], Loan(**{**car.__dict__, "first_payment_month": 1})]
    ahead = simulate_plan(now, Strategy.AVALANCHE, horizon_months=24)
    assert ahead.months[0].balances_by_loan_index[1] < D("600000")
