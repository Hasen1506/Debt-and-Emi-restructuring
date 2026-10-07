"""Regression tests for the engine bugs found in the 26 Sep 2026 audit
(AUDIT.md §2). Each uses the numbers that exposed the bug."""
from decimal import Decimal as D

import pytest

from engine.formulas import effective_rate
from engine.minimum_payments import compute_minimum_payment
from engine.models import (
    Country, IncomeType, InvestmentOption, LifecycleEvent, LifecycleEventKind,
    LiquidityClass, Loan, LoanType, TaxRegimeIN, User,
)
from engine.ordering import Strategy
from engine.simulation import MAX_RATE_DRIFT, baseline_minimums_only, simulate_plan


def _user(country, loans, income="8000", expenses="3000", **kw):
    return User(
        country=country, income_type=IncomeType.SALARIED,
        annual_income=D(income) * 12, monthly_income=D(income),
        fixed_expenses=D(expenses), savings_balance=D("0"),
        primary_bank="x", loans=loans, **kw,
    )


def _balance(row, loan_pos=0):
    return row.balances_by_loan_index[loan_pos]


# E1 ─────────────────────────────────────────────────────────────────────
@pytest.mark.parametrize("strategy", list(Strategy))
def test_every_strategy_prepays_the_card_when_a_cheap_loan_comes_first(strategy):
    """A small 7% car loan ranks first under snowball/hybrid. It doesn't
    beat the 7.5% liquid fund, so its extra shouldn't be prepaid, but the
    42% card behind it should. Only checking the first loan invested all
    of the surplus and left the card at its minimum for 26 months."""
    car = Loan(LoanType.AUTO, "x", D("40000"), D("0.07"), "fixed", 24, D("1800"))
    card = Loan(LoanType.CREDIT_CARD, "HDFC Bank", D("200000"), D("0.42"), "fixed", 0, D("0"))
    u = _user(
        Country.IN, [car, card], income="150000", expenses="60000",
        investment_options=[InvestmentOption(
            name="Liquid", expected_return=D("0.075"),
            liquidity_class=LiquidityClass.LIQUID, is_in_pool=True,
        )],
    )
    r = simulate_plan(u, strategy=strategy, horizon_months=120)
    first = r.months[0]
    assert first.invested_this_month == 0
    assert first.payments_by_loan_index[1] > D("50000")   # the card got the extra
    # The card clears within 4 months. The 7% car loan doesn't beat the
    # 7.5% fund, so after the card clears the freed money is saved and the
    # car runs to its schedule (the cascade used to ignore the gate: H2/H3).
    assert any(r.months[i].balances_by_loan_index[1] == 0 for i in range(4))
    assert r.total_invested > 0


def test_surplus_is_invested_only_when_no_loan_beats_the_hurdle():
    car = Loan(LoanType.AUTO, "x", D("400000"), D("0.07"), "fixed", 60, D("8000"))
    u = _user(
        Country.IN, [car], income="150000", expenses="60000",
        investment_options=[InvestmentOption(
            name="Liquid", expected_return=D("0.075"),
            liquidity_class=LiquidityClass.LIQUID, is_in_pool=True,
        )],
    )
    r = simulate_plan(u, horizon_months=12)
    assert r.months[0].invested_this_month > 0


# E2 ─────────────────────────────────────────────────────────────────────
def _floating_home(drift="0.01", **kw):
    return Loan(
        LoanType.HOME, "x", D("3000000"), D("0.085"), "floating", 240, D("26035"),
        rate_reset_frequency_months=3, next_reset_month=3,
        rate_drift_annualized=D(drift), **kw,
    )


def test_rate_drift_stops_three_points_from_the_start():
    """+1%/yr for 30 years took the loan to 38%. Drift now stops at ±3."""
    u = _user(Country.IN, [_floating_home()], income="200000", expenses="100000")
    r = simulate_plan(u, horizon_months=360)
    assert r.debt_free_month is not None
    # ₹82 crore of interest before the fix; a 30L loan at ≤11.5% for ~20
    # years is well under 60L.
    assert r.total_interest_paid < D("6000000")


def test_rate_rise_raises_the_emi_instead_of_growing_the_balance():
    """RBI's 2023 reset rules forbid negative amortisation: a rise must
    raise the EMI (or tenure), never let the balance climb."""
    u = _user(Country.IN, [_floating_home(drift="0.03")], income="200000", expenses="170000")
    r = simulate_plan(u, horizon_months=360)
    balances = [_balance(row) for row in r.months]
    assert all(b2 <= b1 for b1, b2 in zip(balances, balances[1:]))
    assert r.debt_free_month is not None and r.debt_free_month <= 245


def test_rate_cut_keeps_the_emi_and_finishes_sooner():
    u = _user(Country.IN, [_floating_home(drift="-0.01")], income="100000", expenses="73965")
    r = simulate_plan(u, horizon_months=360)
    assert r.debt_free_month is not None and r.debt_free_month < 240
    assert all(p[0] <= D("26035.01") for p in (row.payments_by_loan_index for row in r.months) if 0 in p)


def test_lifecycle_rate_rise_also_reprices_the_emi():
    loan = Loan(LoanType.HOME, "x", D("3000000"), D("0.085"), "floating", 240, D("26035"))
    u = _user(Country.IN, [loan], income="200000", expenses="170000")
    ev = LifecycleEvent(
        kind=LifecycleEventKind.FLOATING_RATE_RESET, effective_month=13,
        loan_index=0, new_rate=D("0.20"),
    )
    r = simulate_plan(u, horizon_months=360, lifecycle_events=[ev])
    balances = [_balance(row) for row in r.months]
    assert all(b2 <= b1 for b1, b2 in zip(balances, balances[1:]))
    assert r.debt_free_month is not None and r.debt_free_month <= 241


def test_drift_cap_constant():
    assert MAX_RATE_DRIFT == D("0.03")


# E3 ─────────────────────────────────────────────────────────────────────
def test_interest_plus_percent_card_minimum_includes_the_interest():
    """BoA: interest + 1%. $5,000 at 24% owes $100 interest; the minimum
    was $50 because the simulator never passed the interest in."""
    card = Loan(LoanType.CREDIT_CARD, "Bank of America", D("5000"), D("0.24"), "fixed", 0, D("0"))
    u = _user(Country.US, [card])
    b = baseline_minimums_only(u, horizon_months=1)
    assert b.months[0].payments_by_loan_index[0] == D("150")
    assert _balance(b.months[0]) == D("4950")
    assert compute_minimum_payment(card, Country.US, interest_accrued=D("100")) == D("150")


# E4 ─────────────────────────────────────────────────────────────────────
def test_baseline_capitalises_unpaid_interest():
    """A minimum below the interest must grow the balance, and the total
    paid must equal what was actually paid. The old loop kept the balance
    flat and booked $2,400 of interest while $1,200 was paid."""
    card = Loan(
        LoanType.CREDIT_CARD, "x", D("5000"), D("0.24"), "fixed", 0, D("0"),
        min_payment_override=D("50"),
    )
    u = _user(Country.US, [card])
    b = baseline_minimums_only(u, horizon_months=24)
    assert _balance(b.months[-1]) > D("5000")
    paid = sum((row.total_payment_nominal for row in b.months), D("0"))
    assert paid == D("1200")


# E5 ─────────────────────────────────────────────────────────────────────
def test_baseline_sees_the_same_rate_resets_as_the_plan():
    loan = Loan(LoanType.HOME, "x", D("3000000"), D("0.085"), "floating", 240, D("26035"))
    u = _user(Country.IN, [loan], income="100000", expenses="73965")   # no surplus
    ev = LifecycleEvent(
        kind=LifecycleEventKind.FLOATING_RATE_RESET, effective_month=6,
        loan_index=0, new_rate=D("0.095"),
    )
    plan = simulate_plan(u, horizon_months=360, lifecycle_events=[ev])
    base = baseline_minimums_only(u, horizon_months=360, lifecycle_events=[ev])
    assert plan.total_interest_paid == base.total_interest_paid
    assert plan.debt_free_month == base.debt_free_month


def test_baseline_honours_pre_emi_months():
    loan = Loan(
        LoanType.HOME, "x", D("3000000"), D("0.085"), "floating", 240, D("26035"),
        pre_emi_months_remaining=6,
    )
    u = _user(Country.IN, [loan], income="100000", expenses="73965")
    base = baseline_minimums_only(u, horizon_months=7)
    assert _balance(base.months[5]) == D("3000000")          # interest only
    assert _balance(base.months[6]) < D("3000000")


# E6 / E7 / E9 ───────────────────────────────────────────────────────────
def test_no_80e_shield_on_the_new_regime():
    ed = Loan(LoanType.EDUCATION, "x", D("800000"), D("0.10"), "fixed", 60, D("17000"))
    assert effective_rate(ed, D("0.30"), Country.IN, TaxRegimeIN.NEW) == D("0.10")
    assert effective_rate(ed, D("0.30"), Country.IN, None) == D("0.10")
    assert effective_rate(ed, D("0.30"), Country.IN, TaxRegimeIN.OLD) == D("0.0700")


def test_us_mortgage_shield_only_for_itemisers():
    h = Loan(LoanType.HOME, "x", D("300000"), D("0.065"), "fixed", 300, D("2000"))
    assert effective_rate(h, D("0.24"), Country.US, itemises=False) == D("0.065")
    assert effective_rate(h, D("0.24"), Country.US, itemises=True) == D("0.04940")


def test_gst_on_the_processing_fee_is_18_percent_of_it():
    pl = Loan(
        LoanType.PERSONAL, "x", D("500000"), D("0.12"), "fixed", 36, D("16600"),
        processing_fee_amortised=D("0.01"),
    )
    assert effective_rate(pl, D("0"), Country.IN, TaxRegimeIN.NEW) == D("0.1318")


# E8 / E10 ───────────────────────────────────────────────────────────────
def _nri_user():
    inr_home = Loan(
        LoanType.HOME, "HDFC Bank", D("4000000"), D("0.085"), "floating", 240,
        D("34713"), currency="INR",
    )
    usd_card = Loan(
        LoanType.CREDIT_CARD, "Chase", D("2500"), D("0.249"), "fixed", 0, D("100"),
        currency="USD",
    )
    return _user(
        Country.US, [inr_home, usd_card], income="10000", expenses="4000",
        fx_to_user_currency={"INR": D("0.012")},
        fx_drift_annualized={"INR": D("-0.03")},
    )


def test_fx_drift_leaves_the_callers_rates_alone():
    u = _nri_user()
    first = simulate_plan(u, horizon_months=60)
    assert u.fx_to_user_currency == {"INR": D("0.012")}
    second = simulate_plan(u, horizon_months=60)
    assert first.total_interest_paid == second.total_interest_paid


def test_total_balance_is_in_the_users_currency():
    u = _nri_user()
    row = simulate_plan(u, horizon_months=1).months[0]
    expected = row.balances_by_currency["INR"] * D("0.012") + row.balances_by_currency["USD"]
    assert row.balance_in_user_currency == expected
    assert row.balance_in_user_currency < D("60000")   # ~$48k, not 4 million


# Tools and surplus (AUDIT.md §2b) ───────────────────────────────────────
def test_windfall_skips_a_cheap_first_loan_under_snowball():
    from engine.decisions import allocate_windfall

    car = Loan(LoanType.AUTO, "x", D("40000"), D("0.07"), "fixed", 24, D("1800"))
    card = Loan(LoanType.CREDIT_CARD, "HDFC Bank", D("200000"), D("0.42"), "fixed", 0, D("0"))
    rates = {id(car): D("0.07"), id(card): D("0.4956")}
    fund = [InvestmentOption(name="Liquid", expected_return=D("0.075"),
                             liquidity_class=LiquidityClass.LIQUID, is_in_pool=True)]
    a = allocate_windfall(D("100000"), [car, card], rates, fund, D("0.046"),
                          strategy=Strategy.SNOWBALL)
    assert a.invest_instead is False
    assert a.to_loan_id == id(card)
    assert "The dearest debt" in a.rationale


def test_windfall_invests_only_when_no_loan_beats_the_fund():
    from engine.decisions import allocate_windfall

    car = Loan(LoanType.AUTO, "x", D("40000"), D("0.07"), "fixed", 24, D("1800"))
    fund = [InvestmentOption(name="Liquid", expected_return=D("0.075"),
                             liquidity_class=LiquidityClass.LIQUID, is_in_pool=True)]
    a = allocate_windfall(D("100000"), [car], {id(car): D("0.07")}, fund, D("0.046"))
    assert a.invest_instead is True


def test_cash_yield_compares_the_fund_with_the_loan_rate():
    """Idle cash at 3%: a 7% fund vs prepaying a 9% loan. Prepaying wins
    (9 > 7), but the old test compared the 4-point gap with the whole 9%.
    At 3% vs an 8% fund and a 6% loan, the fund wins: the old test said
    the loan (6% > 5-point gap)."""
    from engine.decisions import cash_yield_check

    fund_wins = cash_yield_check(
        idle_balance=D("200000"), current_yield=D("0.03"), country=Country.IN,
        top_loan_effective_rate=D("0.06"), best_alt_yield=D("0.08"), alt_name="Fund",
    )
    assert fund_wins.beats_top_loan is True
    loan_wins = cash_yield_check(
        idle_balance=D("200000"), current_yield=D("0.03"), country=Country.IN,
        top_loan_effective_rate=D("0.09"), best_alt_yield=D("0.07"), alt_name="Fund",
    )
    assert loan_wins.beats_top_loan is False
    assert "₹" in fund_wins.rationale


def test_emergency_fund_fills_in_twelve_months():
    """Recomputing gap/12 every month left the fund 35% short after a year."""
    home = Loan(LoanType.HOME, "x", D("3000000"), D("0.085"), "fixed", 240, D("26035"))
    u = _user(Country.IN, [home], income="150000", expenses="60000",
              efund_balance=D("0"), efund_target=D("120000"))
    r = simulate_plan(u, horizon_months=24)
    # 10,000/month is held back for the fund in months 1-12, none after.
    extra = [row.payments_by_loan_index[0] - D("26035") for row in r.months]
    assert extra[11] < extra[12]
    assert extra[12] - extra[11] == pytest.approx(D("10000"), abs=D("1"))


def test_cash_out_never_exceeds_income_with_a_card():
    """Payments + investment each month stay within income − expenses.
    The surplus counted a card minimum without its interest while the
    payment included it, so more went out than came in."""
    card = Loan(LoanType.CREDIT_CARD, "Bank of America", D("5000"), D("0.24"), "fixed", 0, D("0"))
    home = Loan(LoanType.HOME, "x", D("300000"), D("0.065"), "fixed", 300, D("2000"))
    u = _user(Country.US, [card, home], income="8000", expenses="5000")
    r = simulate_plan(u, horizon_months=36)
    for row in r.months:
        assert row.total_payment_nominal + row.invested_this_month <= D("3000.01")


def _two_loan_user():
    home = Loan(LoanType.HOME, "x", D("3000000"), D("0.085"), "floating", 240, D("26035"))
    card = Loan(LoanType.CREDIT_CARD, "HDFC Bank", D("200000"), D("0.42"), "fixed", 0, D("0"))
    return _user(Country.IN, [home, card], income="150000", expenses="60000")


def test_job_loss_slider_moves_the_plan():
    """A six-month job loss came out identical to no job loss."""
    from engine.sensitivity import with_income_shock

    u = _two_loan_user()
    base = simulate_plan(u, horizon_months=360)
    shock = with_income_shock(u, 6, horizon_months=360)
    assert shock.debt_free_month > base.debt_free_month
    assert shock.total_interest_paid > base.total_interest_paid
    assert all(row.available_surplus == 0 for row in shock.months[:6])
    assert shock.months[6].available_surplus > 0


def test_rate_shock_raises_the_emi():
    from engine.sensitivity import with_rate_shock

    home = Loan(LoanType.HOME, "x", D("3000000"), D("0.085"), "floating", 240, D("26035"))
    u = _user(Country.IN, [home], income="100000", expenses="73965")
    r = with_rate_shock(u, D("0.04"), horizon_months=480)
    balances = [_balance(row) for row in r.months]
    assert all(b2 <= b1 for b1, b2 in zip(balances, balances[1:]))
    assert r.debt_free_month is not None and r.debt_free_month <= 241
