"""Live test #23 (sprint L3): card interest with new spending.

The live test could not check whether a card's interest counts the money
the user keeps spending on it (the persona's HDFC card with ₹20,000 a month
of new spend never saved). These tests pin the rule the plan must follow.

The expected rule, from RBI's Master Direction on Credit Card and Debit
Card - Issuance and Conduct, 2022 (RBI/2022-23/92, DoR.AUT.REC.No.27/
24.01.041/2022-23, 21 April 2022, updated), as summarised in the sprint plan
(G1 #25 owns the exact clause text): the interest-free period applies only
when the previous statement is paid in full. While a balance is revolving
(carried over), new purchases attract interest from the date of each
transaction, and Indian card statements add 18% GST on the finance charge.
https://www.rbi.org.in/Scripts/BS_ViewMasDirections.aspx?id=12300

The engine works month by month, so it can't follow each purchase's date.
It posts the month's spend at the start of the month and charges a full
month's interest on it: the most a purchase made that month could cost
(the daily rule gives about half a month on spend spread evenly through it).
The test accepts any convention between half a month and a full month, so
a finer convention from G1 still passes, but never zero (no interest-free
period while revolving) and never without GST.
"""
from decimal import Decimal

from engine.formulas import monthly_interest_charge
from engine.models import Country, IncomeType, Loan, LoanType, TaxRegimeIN, User
from engine.ordering import Strategy
from engine.simulation import simulate_plan
from engine.tax.gst import GST_RATE_IN

D = Decimal


def _card_user(spend: Decimal, *, country: Country = Country.IN) -> User:
    # The live-test persona's card: ₹1,50,000 at 42% a year, HDFC.
    card = Loan(
        loan_type=LoanType.CREDIT_CARD, bank="HDFC Bank",
        outstanding=D("150000"), nominal_rate=D("0.42"),
        rate_type="fixed", tenure_months_remaining=0,
        scheduled_emi=D("7500"), expected_monthly_spend=spend,
    )
    return User(
        country=country, income_type=IncomeType.SALARIED,
        annual_income=D("1440000"), monthly_income=D("120000"),
        fixed_expenses=D("60000"), savings_balance=D("0"),
        primary_bank="HDFC Bank", tax_regime=TaxRegimeIN.NEW,
        efund_balance=D("0"), efund_target=D("0"),
        loans=[card], investment_options=[], inflation_rate=D("0"),
    )


def _first_month_interest(user: User) -> Decimal:
    res = simulate_plan(user, Strategy.AVALANCHE, horizon_months=3, minimums_only=True)
    return res.months[0].interest_paid_month


def test_new_spend_on_a_revolving_card_is_charged_interest_with_gst():
    base = _first_month_interest(_card_user(D("0")))
    spend = D("20000")
    with_spend = _first_month_interest(_card_user(spend))
    extra = with_spend - base
    # A full month on the spend at 3.5% a month, plus 18% GST on it.
    full_month = spend * D("0.42") / 12 * (1 + GST_RATE_IN)
    assert extra > 0, "new spend on a revolving card has no interest-free period"
    assert full_month / 2 - D("0.01") <= extra <= full_month + D("0.01"), (extra, full_month)


def test_card_interest_is_not_just_balance_times_monthly_rate():
    """The live test's suspicion: interest = balance × 3.5%, ignoring new
    spend and GST. With ₹20,000 a month of spend the plan's first-month
    interest must be more than that naive figure."""
    naive = D("150000") * D("0.035")
    got = _first_month_interest(_card_user(D("20000")))
    assert got > naive
    # And GST is on the finance charge itself (18% of it), not 18 points.
    card = _card_user(D("0")).loans[0]
    assert monthly_interest_charge(card, Country.IN) == (naive * (1 + GST_RATE_IN))


def test_us_card_new_spend_has_interest_but_no_gst():
    base = _first_month_interest(_card_user(D("0"), country=Country.US))
    with_spend = _first_month_interest(_card_user(D("1000"), country=Country.US))
    extra = with_spend - base
    full_month = D("1000") * D("0.42") / 12
    assert full_month / 2 - D("0.01") <= extra <= full_month + D("0.01")


def test_spend_makes_the_balance_grow_by_spend_less_principal_paid():
    """Minimums only: after month 1 the card owes the old balance plus the
    spend, less the principal part of the minimum (payment − interest − GST)."""
    for spend in (D("0"), D("20000")):
        res = simulate_plan(_card_user(spend), Strategy.AVALANCHE, horizon_months=2, minimums_only=True)
        row = res.months[0]
        balance = row.balances_by_loan_index[0]
        assert balance == D("150000") + spend - row.principal_paid_month


def test_minimum_never_lets_interest_or_gst_capitalise():
    """RBI MD para 9(b)(ii): the minimum due must not cause negative
    amortisation, and unpaid charges/levies/taxes (GST included) are not
    capitalised for interest. On minimums only, the balance never grows by
    more than the new spend."""
    spend = D("20000")
    res = simulate_plan(_card_user(spend), Strategy.AVALANCHE, horizon_months=12, minimums_only=True)
    prev = D("150000")
    for row in res.months:
        bal = row.balances_by_loan_index[0]
        assert bal <= prev + spend + D("0.01"), (row.month_index, prev, bal)
        prev = bal


import pytest


# Was xfail on hark/sprint-L3; G1 made it pass (RBI MD para 9(b)(ii), FAQ 7).
def test_card_gst_does_not_compound_in_the_yearly_cost():
    from engine.marginal_cost import compounded, marginal_cost
    mc = marginal_cost(D("0.42"), True, D("0"), D("0"), 0)
    interest = compounded(D("0.42"))
    assert abs(mc.gst - interest * GST_RATE_IN) < D("0.0001")
    assert abs((mc.interest + mc.gst) - D("0.6031")) < D("0.0001")
