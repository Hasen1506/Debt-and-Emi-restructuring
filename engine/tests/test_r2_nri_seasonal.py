"""Round 2, item 4: the two W10 strict-xfails, built.

(a) NRI FX-aware payoff order: a rupee loan paid from dollar pay is ranked
at its cost in dollars (marginal_cost._fx_adjust).
Hand check (US earner, ₹40 L SBI home loan at 8.5%, 180 months, rupee
sliding 3.5% a year, World Bank $500 average transfer cost 2.45%):
  k     = (1 + 0.085/12)^12 − 1            = 8.8391%
  kept  = (1 − 0.0245)^(1/15)              = 0.998348
  cost$ = kept × (1 + k) × (1 − 0.035) − 1 = 4.8562%
so the 7.5% car (7.76% compounded) now comes first.

(b) Seasonal reserve: with a known lumpy income, good months top up the
fund to what the next lean stretch needs (simulation `income_lookahead`).
"""
from decimal import Decimal

from hypothesis import given, settings, strategies as st

from engine.income_scenarios import IncomeScenario, SeasonalIncome, build_income_path, simulate_with_income
from engine.marginal_cost import user_marginal_costs
from engine.models import Country, FilingStatusUS, IncomeType, Loan, LoanType, User
from engine.simulation import Strategy, simulate_plan

D = Decimal


def nri(drift=None, remit=None, loans=None):
    loans = loans or [Loan(LoanType.HOME, "SBI", D("4000000"), D("0.085"), "floating", 180, D("39390"), currency="INR"),
                      Loan(LoanType.AUTO, "Ally", D("22000"), D("0.075"), "fixed", 48, D("532"))]
    kw = {"fx_drift_annualized": {"INR": D(drift)}} if drift else {}
    return User(Country.US, IncomeType.SALARIED, D("108000"), D("9000"), D("4500"), D("0"), "x", loans=loans,
                is_nri_us=True, fx_to_user_currency={"INR": D("0.0105")}, filing_status=FilingStatusUS.SINGLE,
                remittance_cost=None if remit is None else D(remit), **kw)


def test_rupee_loan_cost_in_dollars_hand_check():
    u = nri("-0.035")
    mc = user_marginal_costs(u.loans, u, D("0.22"))[id(u.loans[0])]
    assert abs(mc.interest - D("0.0883909")) < D("0.000001")
    assert abs(mc.annual_cost - D("0.0485618")) < D("0.000001")
    assert abs(mc.fx_adjust - (D("0.0485618") - D("0.0883909"))) < D("0.000001")


def test_order_flips_to_the_car_once_the_slide_is_counted():
    assert simulate_plan(nri("-0.035"), Strategy.AVALANCHE, horizon_months=240,
                         marginal_rate=D("0.22")).months[0].extra_to_loan_index == 1


def test_transfer_cost_alone_and_own_cost():
    """No drift: only the 2.45% cost, spread over 15 years: k × … ≈ 8.659%,
    still above the car, so the rupee loan keeps first place. A user's own
    0% transfer cost and no drift means no adjustment at all."""
    u = nri()
    mc = user_marginal_costs(u.loans, u, D("0.22"))[id(u.loans[0])]
    assert abs(mc.annual_cost - D("0.0865925")) < D("0.000001")
    zero = nri(remit="0")
    assert user_marginal_costs(zero.loans, zero, D("0.22"))[id(zero.loans[0])].fx_adjust == 0


def test_same_currency_loans_are_untouched():
    u = User(Country.IN, IncomeType.SALARIED, D("1200000"), D("100000"), D("40000"), D("0"), "SBI",
             loans=[Loan(LoanType.PERSONAL, "X", D("300000"), D("0.14"), "fixed", 36, D("10253"))],
             remittance_cost=D("0.05"), fx_drift_annualized={"USD": D("0.03")})
    assert user_marginal_costs(u.loans, u, D("0.2"))[id(u.loans[0])].fx_adjust == 0


@settings(max_examples=60, deadline=None)
@given(rate=st.decimals("0.05", "0.15", places=3), drift=st.decimals("-0.08", "0.08", places=3),
       c=st.decimals("0", "0.05", places=4), months=st.integers(1, 360))
def test_fx_adjust_moves_with_drift_and_cost(rate, drift, c, months):
    """Class guard: a sliding loan currency or a transfer cost never makes a
    foreign loan dearer; a strengthening one with no cost never cheaper."""
    loans = [Loan(LoanType.HOME, "SBI", D("1000000"), rate, "floating", months, D("20000"), currency="INR")]
    u = nri(str(drift) if drift != 0 else None, str(c), loans=loans)
    fx = user_marginal_costs(u.loans, u, D("0.22"))[id(u.loans[0])].fx_adjust
    if drift <= 0:
        assert fx <= D("1e-12")
    if drift >= 0 and c == 0:
        assert fx >= -D("1e-12")


# ── (b) seasonal reserve ────────────────────────────────────────────────────

FESTIVE = SeasonalIncome(tuple(D(x) for x in [
    "60000", "60000", "90000", "60000", "50000", "40000",
    "40000", "50000", "80000", "200000", "240000", "130000"]))


def business(**kw):
    return User(Country.IN, IncomeType.BUSINESS_OWNER, D("1100000"), D("91666.67"), D("55000"), D("0"), "x",
                loans=[Loan(LoanType.PERSONAL, "Bajaj Finance", D("500000"), D("0.16"), "fixed", 36, D("17580")),
                       Loan(LoanType.CREDIT_CARD, "Axis Bank", D("80000"), D("0.42"), "fixed", 0, D("0"))], **kw)


def test_reserve_is_built_before_the_lean_months_hand_check():
    """Month 8 (November, ₹2,40,000) looks ahead: income from December on
    against this month's outgo (₹55,000 + EMI ₹17,580 + nothing on the
    cleared card) = ₹72,580: +57,420, −12,580, −12,580, +17,420, −12,580,
    −22,580, −32,580, −32,580, −22,580 … lowest −73,220 → ₹73,220 held."""
    u = business(efund_balance=D("146139"), efund_target=D("146139"))   # the year-1 lean stretch, covered
    p = build_income_path(u, 36, IncomeScenario(seasonal=FESTIVE), simulation_start_month=4)
    r = simulate_with_income(u, p, Strategy.AVALANCHE, simulation_start_month=4)
    assert sum(x.gap_borrowed for x in r.months) == 0
    m8 = r.months[7]
    assert m8.efund_balance == D("73220.00")


def test_reserve_never_borrows_more_and_flat_income_is_unchanged():
    u = business()
    p = build_income_path(u, 36, IncomeScenario(seasonal=FESTIVE), simulation_start_month=4)
    on = simulate_with_income(u, p, Strategy.AVALANCHE, simulation_start_month=4)
    off = simulate_with_income(u, p, Strategy.AVALANCHE, simulation_start_month=4, seasonal_reserve=False)
    assert sum(m.gap_borrowed for m in on.months) <= sum(m.gap_borrowed for m in off.months)
    flat = build_income_path(u, 36, None, simulation_start_month=4)
    a = simulate_with_income(u, flat, Strategy.AVALANCHE, simulation_start_month=4)
    b = simulate_with_income(u, flat, Strategy.AVALANCHE, simulation_start_month=4, seasonal_reserve=False)
    assert [m.payments_by_loan_index for m in a.months] == [m.payments_by_loan_index for m in b.months]


@settings(max_examples=40, deadline=None)
@given(scale=st.decimals("0.8", "1.6", places=2), rot=st.integers(0, 11))
def test_reserve_class_never_more_gap_borrowing(scale, rot):
    """Class guard over shifted / scaled seasons: holding the reserve never
    increases the money the plan has to find outside (card-rate gap
    borrowing plus anything past the borrowing limit)."""
    pat = list(FESTIVE.pattern)
    pat = pat[rot:] + pat[:rot]
    season = SeasonalIncome(tuple((x * scale).quantize(D("1")) for x in pat))
    u = business()
    p = build_income_path(u, 36, IncomeScenario(seasonal=season), simulation_start_month=4)
    on = simulate_with_income(u, p, Strategy.AVALANCHE, simulation_start_month=4)
    off = simulate_with_income(u, p, Strategy.AVALANCHE, simulation_start_month=4, seasonal_reserve=False)
    # Borrowed plus what couldn't be borrowed (C11 cap): without the reserve a
    # plan can "borrow less" only by running out of limit.
    need = lambda r: sum((m.gap_borrowed + m.unfunded_shortfall for m in r.months), D("0"))  # noqa: E731
    assert need(on) <= need(off) + D("0.01")
