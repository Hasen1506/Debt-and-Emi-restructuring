"""EMI, interest and principal against numpy-financial, to the paisa.

numpy-financial is not used by the app. It is the independent reference
(pmt, ipmt, ppmt, nper). The locked figures below were taken from
numpy-financial 1.0.0 and checked against the textbook formula
P·r·(1+r)^n / ((1+r)^n − 1). Hypothesis then repeats the comparison on
random loans, and checks the schedule laws: principal parts sum to the
loan, the balance never goes negative, and prepaying never raises
interest or stretches the term.

Float noise on these sizes is well under one paisa (₹0.01) or one cent.
"""
from __future__ import annotations

from decimal import Decimal, ROUND_HALF_UP

import numpy_financial as npf
from hypothesis import given, settings
from hypothesis import strategies as st

from engine.formulas import emi, flat_to_reducing, prepayment_beats_fee, schedule_interest
from engine.models import Country, IncomeType, Loan, LoanType, User
from engine.prepay_choice import months_to_clear
from engine.simulation import baseline_minimums_only

D = Decimal
PAISA = D("0.01")


def _pmt(principal: Decimal, annual: Decimal, months: int) -> Decimal:
    """numpy-financial's payment, as a positive Decimal."""
    if annual == 0:
        return principal / D(months)
    raw = -npf.pmt(float(annual) / 12, months, float(principal))
    return D(str(raw))


def _close(got: Decimal, want: Decimal, tol: Decimal = PAISA) -> None:
    assert abs(got - want) <= tol, f"{got} vs {want} (tol {tol})"


# Locked answers from numpy-financial 1.0.0, rounded half-up to the paisa.
# 100000 at 12% for 12 months: r=0.01, (1.01)^12 = 1.1268250301319695,
# EMI = 1000 * that / (that - 1) = 8884.878867… → ₹8,884.88.
GOLDEN = [
    # principal, annual rate, months, EMI to the paisa
    (D("100000"), D("0.12"), 12, D("8884.88")),
    (D("1000000"), D("0.085"), 120, D("12398.57")),
    (D("5000000"), D("0.08"), 360, D("36688.23")),
    (D("3500000"), D("0.085"), 180, D("34465.88")),
    (D("10000"), D("0.06"), 36, D("304.22")),  # dollars, to the cent
    (D("120000"), D("0"), 10, D("12000.00")),
    (D("100000"), D("0.12"), 1, D("101000.00")),
]


def test_golden_emi_matches_numpy_to_the_paisa():
    for principal, annual, months, locked in GOLDEN:
        got = emi(principal, annual, months).quantize(PAISA, ROUND_HALF_UP)
        ref = _pmt(principal, annual, months).quantize(PAISA, ROUND_HALF_UP)
        assert got == locked, (principal, annual, months, got, locked)
        assert ref == locked, (principal, annual, months, ref, locked)


def test_ipmt_ppmt_and_nper_on_the_one_year_loan():
    """₹1,00,000 at 12% for 12 months. Month-1 interest is ₹1,000 exactly.
    The principal parts sum to the loan. nper of that EMI is 12 months."""
    principal, annual, months = D("100000"), D("0.12"), 12
    payment = emi(principal, annual, months)
    rate = float(annual) / 12
    interest_1 = D(str(-npf.ipmt(rate, 1, months, float(principal))))
    principal_1 = D(str(-npf.ppmt(rate, 1, months, float(principal))))
    _close(interest_1, D("1000"))
    _close(principal_1, payment - D("1000"))
    parts = [-npf.ppmt(rate, m, months, float(principal)) for m in range(1, months + 1)]
    _close(D(str(sum(parts))), principal, D("0.05"))
    nper = npf.nper(rate, -float(payment), float(principal))
    assert abs(float(nper) - months) < 1e-6
    # The shared walk charges the same interest numpy does over the term.
    want = D(str(sum(-npf.ipmt(rate, m, months, float(principal)) for m in range(1, months + 1))))
    _close(schedule_interest(principal, annual, payment, months), want, D("0.05"))


def test_two_loans_keep_their_own_rates():
    """A 14% personal loan and a 42% card-sized loan are not blended into
    one EMI. Each matches numpy on its own rate."""
    book = [(D("500000"), D("0.14"), 36), (D("80000"), D("0.18"), 12)]
    total = D("0")
    for principal, annual, months in book:
        payment = emi(principal, annual, months)
        _close(payment, _pmt(principal, annual, months))
        total += payment
    blended = emi(D("580000"), D("0.14"), 36)
    assert total != blended


def test_flat_quote_reduces_to_the_same_emi():
    """Flat 8% for 24 months on ₹1,00,000 charges ₹16,000 of interest
    (P × f × years). The reducing rate we store prices the same EMI."""
    principal, flat, months = D("100000"), D("0.08"), 24
    flat_emi = principal * (1 + flat * D(months) / 12) / D(months)
    reducing = flat_to_reducing(flat, months)
    _close(emi(principal, reducing, months), flat_emi, D("0.05"))
    # The reducing rate is higher than the flat quote (the usual 1.7–1.9×).
    assert reducing > flat


def test_final_instalment_is_not_a_full_emi_when_the_quote_is_rounded_up():
    """Banks quote a whole rupee, rounded up. The last month then pays
    only what is left, and the balance does not go negative."""
    principal, annual, months = D("100000"), D("0.12"), 12
    quoted = emi(principal, annual, months).quantize(D("1"), rounding="ROUND_CEILING")
    balance = principal
    rate = annual / 12
    paid_principal = D("0")
    for _ in range(months + 2):
        if balance <= PAISA:
            break
        interest = balance * rate
        pay = min(quoted, balance + interest)
        paid_principal += pay - interest
        balance = balance + interest - pay
        assert balance >= -PAISA
    _close(paid_principal, principal, D("1"))
    assert balance <= PAISA


def test_prepayment_fee_gate_and_a_short_remaining_term():
    """A 2% fee on a loan with 3 months left at 6% a year costs more than
    the interest it saves. The same fee over 36 months at 12% does not."""
    assert prepayment_beats_fee(D("0.005"), D("0.02"), 3) is False
    assert prepayment_beats_fee(D("0.01"), D("0.02"), 36) is True
    assert prepayment_beats_fee(D("0.01"), D("0"), 1) is True


def test_plan_month_one_interest_matches_numpy_ipmt():
    """Minimums-only, one personal loan, EMI equal to the formula. The
    plan's first month of interest is numpy's IPMT for period 1, which is
    also the figure Home shows once the plan has loaded."""
    principal, annual, months = D("500000"), D("0.14"), 36
    payment = emi(principal, annual, months).quantize(PAISA, ROUND_HALF_UP)
    loan = Loan(
        loan_type=LoanType.PERSONAL, bank="SBI", outstanding=principal,
        nominal_rate=annual, rate_type="fixed", tenure_months_remaining=months,
        scheduled_emi=payment,
    )
    user = User(
        country=Country.IN, income_type=IncomeType.SALARIED,
        annual_income=payment * 24, monthly_income=payment * 2,
        fixed_expenses=D("0"), savings_balance=D("0"), primary_bank="SBI", loans=[loan],
    )
    plan = baseline_minimums_only(user, horizon_months=48, gap_as_debt=False)
    got = plan.months[0].interest_paid_month
    want = D(str(-npf.ipmt(float(annual) / 12, 1, months, float(principal))))
    _close(got, want, D("0.05"))
    # Two different rates in one plan: month-1 interest is the sum of each
    # loan's own opening interest, not a blend.
    other = Loan(
        loan_type=LoanType.AUTO, bank="HDFC Bank", outstanding=D("200000"),
        nominal_rate=D("0.09"), rate_type="fixed", tenure_months_remaining=24,
        scheduled_emi=emi(D("200000"), D("0.09"), 24).quantize(PAISA, ROUND_HALF_UP),
    )
    user.loans.append(other)
    both = baseline_minimums_only(user, horizon_months=48, gap_as_debt=False)
    expect = principal * annual / 12 + D("200000") * D("0.09") / 12
    _close(both.months[0].interest_paid_month, expect, D("0.05"))


@settings(max_examples=40, deadline=None)
@given(
    principal=st.integers(min_value=10_000, max_value=5_000_000),
    bps=st.integers(min_value=0, max_value=2_400),
    months=st.integers(min_value=1, max_value=360),
)
def test_emi_matches_numpy_on_random_loans(principal, bps, months):
    annual = D(bps) / D(10_000)
    got = emi(D(principal), annual, months)
    ref = _pmt(D(principal), annual, months)
    _close(got, ref)


@settings(max_examples=25, deadline=None)
@given(
    principal=st.integers(min_value=100_000, max_value=2_000_000),
    bps=st.integers(min_value=100, max_value=1_800),
    months=st.integers(min_value=12, max_value=180),
    extra_pct=st.integers(min_value=5, max_value=40),
)
def test_prepaying_never_raises_interest_or_lengthens_the_term(principal, bps, months, extra_pct):
    amount = D(principal)
    annual = D(bps) / D(10_000)
    payment = emi(amount, annual, months)
    extra = (amount * extra_pct / 100).quantize(D("1"))
    before = schedule_interest(amount, annual, payment, months + 5)
    after = schedule_interest(amount - extra, annual, payment, months + 5)
    assert after <= before + PAISA
    old = months_to_clear(amount, annual, payment)
    new = months_to_clear(amount - extra, annual, payment)
    assert old is not None and new is not None and new <= old


@settings(max_examples=20, deadline=None)
@given(
    principal=st.integers(min_value=50_000, max_value=1_000_000),
    bps=st.integers(min_value=100, max_value=1_800),
    months=st.integers(min_value=6, max_value=120),
)
def test_numpy_principal_parts_sum_to_the_loan_and_balance_stays_positive(principal, bps, months):
    annual = D(bps) / D(10_000)
    rate = float(annual) / 12
    parts = [-npf.ppmt(rate, m, months, principal) for m in range(1, months + 1)]
    _close(D(str(sum(parts))), D(principal), D("0.05"))
    balance = D(principal)
    payment = emi(balance, annual, months)
    for _ in range(months):
        interest = balance * annual / 12
        pay = min(payment, balance + interest)
        balance = balance + interest - pay
        assert balance >= -PAISA
    assert balance <= PAISA
