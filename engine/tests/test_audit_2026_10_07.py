"""Regression tests for the 7 Oct 2026 audit (BUG_REPORT H1-H5, M1-M3,
PASS2 P2-xx). Each test uses the numbers that exposed the bug."""
from datetime import date
from decimal import Decimal as D

import pytest

from engine.asset_liquidation import held_more_than_months
from engine.formulas import effective_rate, emi, prepay_recommended
from engine.minimum_payments import compute_minimum_payment
from engine.models import (
    Country, FilingStatusUS, IncomeType, InvestmentOption, LifecycleEvent,
    LifecycleEventKind, LiquidityClass, Loan, LoanType, TaxRegimeIN, User,
)
from engine.ordering import Strategy, rank_loans
from engine.sensitivity import with_income_shock, with_lump_sum, with_rate_shock
from engine.simulation import estimated_take_home, simulate_plan
from engine.surplus import MissingFxRate, compute_total_minimums
from engine.tax import india, usa


def _user(country, loans, income="100000", expenses="30000", **kw):
    kw.setdefault("savings_balance", D("0"))
    return User(
        country=country, income_type=IncomeType.SALARIED,
        annual_income=D(income) * 12, monthly_income=D(income),
        fixed_expenses=D(expenses), primary_bank="x", loans=loans, **kw,
    )


LIQUID_IN = InvestmentOption(name="Liquid", expected_return=D("0.065"),
                             liquidity_class=LiquidityClass.LIQUID, is_in_pool=True)


# H1 ────────────────────────────────────────────────────────────────────────
def test_h1_shielded_loan_compared_with_after_tax_investment_return():
    """9% education loan, old regime, 30% bracket: 6.3% net. The 6.5% liquid
    fund earns 4.55% after tax, so prepaying wins (it said invest)."""
    assert not prepay_recommended(D("0.063"), D("0.065"), D("0.05"))         # pre-tax: the old answer
    assert prepay_recommended(D("0.063"), D("0.065"), D("0.05"), D("0.30"))  # after tax: prepay
    edu = Loan(LoanType.EDUCATION, "SBI", D("1500000"), D("0.09"), "fixed", 120, D("19000"))
    u = _user(Country.IN, [edu], tax_regime=TaxRegimeIN.OLD, investment_options=[LIQUID_IN])
    r = simulate_plan(u, marginal_rate=D("0.30"), horizon_months=240)
    assert r.months[0].invested_this_month == 0
    assert r.months[0].payments_by_loan_index[0] > D("19000")


# H2 ────────────────────────────────────────────────────────────────────────
def test_h2_cascade_overflow_is_carried_not_dropped():
    """₹1k at 30%, ₹2k at 25%, ₹9L at 20% with ₹1.39L spare: month 1 must
    put all of it to work (about ₹1.16L used to vanish)."""
    loans = [
        Loan(LoanType.PERSONAL, "a", D("1000"), D("0.30"), "fixed", 12, D("100")),
        Loan(LoanType.PERSONAL, "b", D("2000"), D("0.25"), "fixed", 12, D("200")),
        Loan(LoanType.PERSONAL, "c", D("900000"), D("0.20"), "fixed", 60, D("23800")),
    ]
    u = _user(Country.IN, loans, income="193100", expenses="30000")
    r = simulate_plan(u, horizon_months=60)
    first = r.months[0]
    paid = sum(first.payments_by_loan_index.values(), D("0"))
    assert paid + first.invested_this_month == pytest.approx(
        first.available_surplus + D("24100"), abs=D("1")
    )
    # Principal is conserved: the third loan absorbed the overflow.
    assert first.balances_by_loan_index[2] < D("900000") - D("100000")


# H3 ────────────────────────────────────────────────────────────────────────
def test_h3_surplus_kept_when_the_target_loan_is_locked_in():
    """The only loan is locked against prepayment for 12 months: the spare
    cash is saved each month, not lost."""
    locked = Loan(LoanType.HOME, "x", D("3000000"), D("0.09"), "floating", 240, D("27000"),
                  prepay_lock_in_months=12)
    u = _user(Country.IN, [locked], income="92000", expenses="30000")
    r = simulate_plan(u, horizon_months=24)
    assert all(r.months[i].invested_this_month > D("30000") for i in range(11))


# H4 ────────────────────────────────────────────────────────────────────────
def test_h4_foreign_loan_without_fx_is_never_parity():
    usd = Loan(LoanType.EDUCATION, "x", D("5000"), D("0.08"), "fixed", 60, D("100"), currency="USD")
    u = _user(Country.IN, [usd])
    with pytest.raises(MissingFxRate):
        simulate_plan(u, horizon_months=12)
    u.fx_to_user_currency = {"USD": D("83")}
    r = simulate_plan(u, horizon_months=120)
    assert r.debt_free_month is None or r.debt_free_month > 1


# M1 ────────────────────────────────────────────────────────────────────────
def test_m1_moratorium_interest_is_capitalised():
    edu = Loan(LoanType.EDUCATION, "x", D("1000000"), D("0.10"), "fixed", 120, D("13215"),
               first_payment_month=13)
    u = _user(Country.IN, [edu], income="20000", expenses="20000")
    r = simulate_plan(u, horizon_months=14)
    # Simple interest on the principal through an education loan's moratorium
    # (SBI Student Loan MITC; sprint G1): 12 × ₹8,333.33 = ₹1,00,000 added.
    assert r.months[11].balances_by_loan_index[0] == pytest.approx(D("1100000"), abs=D("0.01"))


def test_m1_loan_taken_this_month_does_not_double_count():
    car = Loan(LoanType.AUTO, "x", D("600000"), D("0.09"), "fixed", 60, D("12455"),
               first_payment_month=2)
    u = _user(Country.IN, [car], income="20000", expenses="20000")
    r = simulate_plan(u, horizon_months=3)
    assert r.months[0].balances_by_loan_index[0] == D("600000")


# M3 ────────────────────────────────────────────────────────────────────────
def test_m3_snowball_ranks_by_user_currency_balance():
    usd = Loan(LoanType.PERSONAL, "x", D("10000"), D("0.10"), "fixed", 60, D("200"), currency="USD")
    inr = Loan(LoanType.PERSONAL, "y", D("50000"), D("0.10"), "fixed", 12, D("4400"))
    u = _user(Country.IN, [usd, inr], fx_to_user_currency={"USD": D("83")})
    from engine.surplus import to_user_currency
    ranked = rank_loans([usd, inr], {id(usd): D("0.1"), id(inr): D("0.1")}, Strategy.SNOWBALL,
                        balance_of=lambda l: to_user_currency(l.outstanding, l, u))
    assert ranked[0] is inr


def test_m3_usd_card_uses_us_minimum_for_indian_resident():
    card = Loan(LoanType.CREDIT_CARD, "Chase", D("100"), D("0.24"), "fixed", 0, D("0"), currency="USD")
    # US default: interest + 1% or $35 floor, capped at what's owed, never ₹200-as-$200.
    assert compute_minimum_payment(card, Country.IN, interest_accrued=D("2")) <= D("102")


# P2-01 / P2-02 ─────────────────────────────────────────────────────────────
def test_p2_01_new_regime_surcharge_capped_at_25pct():
    assert india.surcharge_rate(D("60000000"), regime=TaxRegimeIN.NEW) == D("0.25")
    assert india.surcharge_rate(D("60000000"), regime=TaxRegimeIN.OLD) == D("0.37")
    assert india.marginal_rate(D("60000000"), TaxRegimeIN.NEW) == pytest.approx(D("0.39"))


def test_p2_02_take_home_never_falls_across_a_surcharge_threshold():
    for t in (D("5000000"), D("10000000"), D("20000000"), D("50000000")):
        for regime in TaxRegimeIN:
            below = t - D("999") - india.income_tax(t - D("999"), regime)
            above = t + D("1") - india.income_tax(t + D("1"), regime)
            assert above >= below - D("1"), (t, regime)


# P2-03 / P2-04 / P2-23 / P2-22 / P2-25 / P2-05 ─────────────────────────────
def test_p2_03_salt_cap_2026():
    saved, itemises = usa.itemisation_benefit(D("10000"), D("30000"), D("0"),
                                              FilingStatusUS.SINGLE, D("0.24"))
    assert itemises and saved == D("2400")      # was $936 with the $10k cap
    assert usa.salt_cap(D("600000")) == D("11900")
    assert usa.salt_cap(D("2000000")) == D("10000")


def test_p2_04_and_p2_23_2026_tables():
    assert usa.ltcg_bracket_rate(D("49460"), FilingStatusUS.SINGLE) == D("0.15")
    assert usa.BRACKETS_2026[FilingStatusUS.HOH][3][0] == D("201750")
    assert usa.BRACKETS_2026[FilingStatusUS.HOH][4][0] == D("256200")


def test_p2_22_niit_only_on_magi_above_threshold():
    tax = usa.us_capital_gains_tax(D("100000"), 400, D("101000"), FilingStatusUS.SINGLE,
                                   long_term=True)
    # MAGI 201k: NIIT on $1,000 = $38. Gain stacked on 101k: all at 15%.
    assert tax == D("100000") * D("0.15") + D("38.000")


def test_p2_05_mortgage_shield_limited_to_750k_of_debt():
    home = Loan(LoanType.HOME, "x", D("2000000"), D("0.07"), "fixed", 360, D("13300"))
    r = effective_rate(home, D("0.35"), Country.US, itemises=True, itemised_share=D("1"))
    assert r == pytest.approx(D("0.07") * (1 - D("0.35") * D("750000") / D("2000000")))


def test_p2_06_let_out_new_regime_gets_no_shield_and_24b_is_shared():
    let_out = Loan(LoanType.HOME, "x", D("3000000"), D("0.09"), "floating", 240, D("27000"),
                   property_use="let_out")
    assert effective_rate(let_out, D("0.312"), Country.IN, TaxRegimeIN.NEW) == D("0.09")
    a = Loan(LoanType.HOME, "x", D("3000000"), D("0.09"), "floating", 240, D("27000"))
    one = effective_rate(a, D("0.30"), Country.IN, TaxRegimeIN.OLD)
    shared = effective_rate(a, D("0.30"), Country.IN, TaxRegimeIN.OLD,
                            home_interest_total=D("540000"))
    assert shared > one


def test_p2_25_us_student_loan_interest_deduction():
    edu = Loan(LoanType.EDUCATION, "x", D("20000"), D("0.06"), "fixed", 120, D("222"))
    r = effective_rate(edu, D("0.22"), Country.US, itemises=False)
    assert r == pytest.approx(D("0.06") * (1 - D("0.22")))   # $1,200 interest, all deductible
    assert effective_rate(edu, D("0.22"), Country.US, itemises=False, magi=D("120000")) == D("0.06")


# P2-07 ─────────────────────────────────────────────────────────────────────
def test_p2_07_lump_sum_converted_to_loan_currency():
    usd = Loan(LoanType.EDUCATION, "x", D("20000"), D("0.08"), "fixed", 120, D("243"), currency="USD")
    u = _user(Country.IN, [usd], income="40000", expenses="30000", fx_to_user_currency={"USD": D("83")})
    r = with_lump_sum(u, D("100000"), 0, horizon_months=240)
    assert r.debt_free_month != 0
    assert r.months[0].balances_by_loan_index[0] > D("18000")


# P2-08 ─────────────────────────────────────────────────────────────────────
def test_p2_08_rate_shock_not_clamped_back_by_auto_reset():
    home = Loan(LoanType.HOME, "x", D("3000000"), D("0.085"), "floating", 240, D("26035"),
                rate_reset_frequency_months=3, next_reset_month=3)
    u = _user(Country.IN, [home], income="40000", expenses="13000")
    r = with_rate_shock(u, D("0.04"), horizon_months=360)
    # Without the clamp, the loan stays at 12.5% after month 3.
    home2 = Loan(LoanType.HOME, "x", D("3000000"), D("0.085"), "floating", 240, D("26035"))
    r2 = with_rate_shock(_user(Country.IN, [home2], income="40000", expenses="13000"),
                         D("0.04"), horizon_months=360)
    assert r.total_interest_paid == pytest.approx(r2.total_interest_paid, rel=D("0.001"))


# P2-09 ─────────────────────────────────────────────────────────────────────
def test_p2_09_income_shock_lasts_its_full_window():
    loan = Loan(LoanType.PERSONAL, "x", D("500000"), D("0.14"), "fixed", 48, D("13700"))
    u = _user(Country.IN, [loan])
    reset = LifecycleEvent(LifecycleEventKind.SALARY_RESET, 3, new_monthly_take_home=D("120000"))
    r = with_income_shock(u, 6, horizon_months=60, plan={"lifecycle_events": [reset]})
    assert all(r.months[i].available_surplus == 0 for i in range(6))
    # The planned raise applies after; it first repays the gap the shock
    # months borrowed (grill #38), so count both.
    assert r.months[6].available_surplus + r.months[6].gap_repaid > D("70000")


# P2-10 ─────────────────────────────────────────────────────────────────────
def test_p2_10_hike_schedule_fires_without_annual_hike_rate():
    loan = Loan(LoanType.PERSONAL, "x", D("2000000"), D("0.12"), "fixed", 120, D("28700"))
    a = _user(Country.IN, [loan], income="60000", expenses="20000", hike_schedule=[(1, 6, D("0.10"))])
    b = _user(Country.IN, [loan], income="60000", expenses="20000")
    assert simulate_plan(a, horizon_months=240).debt_free_month < simulate_plan(b, horizon_months=240).debt_free_month


# P2-11 ─────────────────────────────────────────────────────────────────────
def test_p2_11_holding_period_by_calendar_months():
    assert not held_more_than_months(date(2024, 1, 1), date(2024, 12, 31), 12)
    assert not held_more_than_months(date(2025, 10, 7), date(2026, 10, 7), 12)
    assert held_more_than_months(date(2025, 10, 7), date(2026, 10, 8), 12)
    assert not held_more_than_months(date(2023, 3, 1), date(2025, 2, 28), 24)


# P2-13 ─────────────────────────────────────────────────────────────────────
def test_p2_13_indian_card_interest_carries_gst():
    card = Loan(LoanType.CREDIT_CARD, "x", D("100000"), D("0.42"), "fixed", 0, D("0"))
    u = _user(Country.IN, [card], income="40000", expenses="30000")
    r = simulate_plan(u, horizon_months=2)
    # 3.5% a month + 18% GST on the average daily balance (sprint G1): the
    # payment, made on the due date, stops interest on the paid part for the
    # last third of the cycle.
    paid = r.months[0].payments_by_loan_index[0]
    want = (D("100000") - paid / 3) * D("0.035") * D("1.18")
    assert r.months[0].interest_paid_month == pytest.approx(want)
    assert r.months[0].interest_paid_month > (D("100000") - paid / 3) * D("0.035")   # GST is in it


# P2-14 ─────────────────────────────────────────────────────────────────────
def test_p2_14_pre_emi_minimum_is_interest_only():
    home = Loan(LoanType.HOME, "x", D("4000000"), D("0.09"), "floating", 240, D("35989"),
                pre_emi_months_remaining=6)
    u = _user(Country.IN, [home], income="90000", expenses="30000")
    assert compute_total_minimums(u, [home]) == pytest.approx(D("30000"))
    r = simulate_plan(u, horizon_months=8)
    first = r.months[0]
    # Every rupee of the ₹60,000 is either paid or saved.
    assert first.total_payment_nominal + first.invested_this_month == pytest.approx(D("60000"))


# P2-15 ─────────────────────────────────────────────────────────────────────
def test_p2_15_emergency_fund_only_credited_when_affordable():
    loan = Loan(LoanType.PERSONAL, "x", D("300000"), D("0.14"), "fixed", 36, D("10250"))
    u = _user(Country.IN, [loan], income="45250", expenses="30000",
              efund_balance=D("0"), efund_target=D("120000"))
    r = simulate_plan(u, horizon_months=24)
    # ₹5,000 a month is all there is: no extra debt payment in month 13.
    assert r.months[12].extra_paid == 0


# P2-20 ─────────────────────────────────────────────────────────────────────
def test_p2_20_tiny_rate_does_not_divide_by_zero():
    assert emi(D("1e-66"), D("1e-66"), 620) == D("1e-66") / D(620)


# P2-24 ─────────────────────────────────────────────────────────────────────
def test_p2_24_us_take_home_subtracts_fica():
    u = _user(Country.US, [], income="8000", expenses="0", filing_status=FilingStatusUS.SINGLE)
    gross = D("120000")
    income_tax_only = (gross - usa.federal_tax(gross - D("16100"), FilingStatusUS.SINGLE)) / 12
    assert estimated_take_home(u, gross) == pytest.approx(income_tax_only - gross * D("0.0765") / 12, abs=D("0.01"))
