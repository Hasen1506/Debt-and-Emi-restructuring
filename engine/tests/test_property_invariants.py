"""Property-based tests: engine invariants that must NEVER break.

Each test generates hundreds of realistic profiles (engine/tests/strategies.py)
and checks a law of debt arithmetic, not a hand-picked number. The "ci"
Hypothesis profile is derandomized, so every run sees the same examples and a
failure is reproducible. Run a wider search locally with
    HYPOTHESIS_PROFILE=explore PROPERTY_SCALE=5 pytest engine/tests/test_property_invariants.py

Bugs these properties found (fixed in the same PR):
  * A loan with a prepayment fee bigger than the interest the extra saves was
    still prepaid, so the "optimised" plan cost more than paying minimums.
  * In a month short of cash, the unused part of a clearing loan's minimum was
    cascaded onto other loans with money the user never had, so a ₹1
    prepayment could make the plan cost more interest.
"""
from __future__ import annotations

import math
from decimal import ROUND_HALF_UP, Decimal

import pytest
from hypothesis import assume, given, settings
from hypothesis import strategies as st

from engine.formulas import emi, flat_to_reducing, remaining_balance
from engine.models import Country, Loan, LoanType
from engine.ordering import Strategy
from engine.sensitivity import with_lump_sum
from engine.simulation import baseline_minimums_only, simulate_plan
from engine.surplus import MissingFxRate
from engine.tests.strategies import EMI_TYPES, examples, loans, money, rate, users

D = Decimal
CENT = D("0.01")
STRATEGIES = st.sampled_from(list(Strategy))


def _initial_user_ccy(u) -> Decimal:
    return sum((l.outstanding for l in u.loans), D("0"))


# ── 1. Balances never go negative ───────────────────────────────────────────

@settings(max_examples=examples(250))
@given(u=users(allow_extras=True), s=STRATEGIES)
def test_balances_never_negative(u, s):
    for result in (simulate_plan(u, strategy=s), baseline_minimums_only(u)):
        for row in result.months:
            for idx, bal in row.balances_by_loan_index.items():
                assert bal >= 0, f"loan {idx} at {bal} in month {row.month_index}"
            for idx, paid in row.payments_by_loan_index.items():
                assert paid >= 0, f"negative payment {paid} to loan {idx}"
            assert row.invested_this_month >= 0
            assert row.shortfall >= 0
        assert all(b >= 0 for b in result.final_balances.values())


# ── 2. Principal paid adds up to the principal owed ─────────────────────────

@settings(max_examples=examples(250))
@given(u=users(), s=STRATEGIES)
def test_principal_paid_equals_original_principal(u, s):
    """No capitalisation in this domain (no moratorium, card spend or
    pre-EMI), so every rupee of principal is either repaid or still owed."""
    for result in (simulate_plan(u, strategy=s), baseline_minimums_only(u)):
        paid = sum((row.principal_paid_month for row in result.months), D("0"))
        left = result.months[-1].balance_in_user_currency if result.months else _initial_user_ccy(u)
        assert abs(paid + left - _initial_user_ccy(u)) <= CENT
        if result.debt_free_month is not None:
            assert abs(paid - _initial_user_ccy(u)) <= CENT


# ── 3. The optimised plan never costs more than paying minimums ─────────────

@settings(max_examples=examples(250))
@given(u=users(allow_extras=True), s=STRATEGIES)
def test_plan_never_costs_more_interest_than_minimums(u, s):
    """Interest here includes prepayment fees (the engine books them as
    interest), so this also proves the plan never prepays at a loss."""
    plan = simulate_plan(u, strategy=s)
    base = baseline_minimums_only(u)
    assert plan.total_interest_paid <= base.total_interest_paid + CENT
    if base.debt_free_month is not None:
        assert plan.debt_free_month is not None
        assert plan.debt_free_month <= base.debt_free_month


# ── 4. Prepaying never increases total interest ─────────────────────────────

@settings(max_examples=examples(200))
@given(u=users(), amount=money(1, 3_000_000), data=st.data())
def test_lump_sum_prepayment_never_increases_interest(u, amount, data):
    idx = data.draw(st.integers(0, len(u.loans) - 1))
    before = simulate_plan(u)
    after = with_lump_sum(u, amount, idx)
    assert after.total_interest_paid <= before.total_interest_paid + CENT
    if before.debt_free_month is not None:
        assert after.debt_free_month is not None
        assert after.debt_free_month <= before.debt_free_month


@settings(max_examples=examples(150))
@given(u=users(), extra=money(1, 200_000), start=st.integers(1, 60))
def test_extra_monthly_payment_never_increases_interest(u, extra, start):
    before = simulate_plan(u)
    after = simulate_plan(u, income_delta=extra, income_delta_from_month=start)
    assert after.total_interest_paid <= before.total_interest_paid + CENT


@settings(max_examples=examples(100))
@given(u=users(), amount=money(1, 1_000_000), month=st.integers(1, 120))
def test_reinvested_refund_never_increases_interest(u, amount, month):
    before = simulate_plan(u)
    after = simulate_plan(u, reinvest_events=[(month, amount)])
    assert after.total_interest_paid <= before.total_interest_paid + CENT


# ── 5. No currency is mixed without an exchange rate ────────────────────────

@settings(max_examples=examples(150))
@given(
    home=st.sampled_from([Country.IN, Country.US]),
    data=st.data(),
    rate_value=st.sampled_from([None, D("0"), D("-1")]),
)
def test_engine_refuses_foreign_loan_without_fx_rate(home, data, rate_value):
    """The API answers these with 422 (api/tests/test_property_api.py);
    the engine itself must refuse rather than assume 1:1."""
    foreign = "USD" if home == Country.IN else "INR"
    u = data.draw(users(country=home, max_loans=3))
    fl = data.draw(loans(country=home, currency=foreign))
    u.loans.append(fl)
    if rate_value is not None:
        u.fx_to_user_currency = {foreign: rate_value}
    with pytest.raises(MissingFxRate):
        simulate_plan(u)
    with pytest.raises(MissingFxRate):
        baseline_minimums_only(u)


@settings(max_examples=examples(100))
@given(home=st.sampled_from([Country.IN, Country.US]), data=st.data())
def test_mixed_currency_totals_are_converted(home, data):
    foreign = "USD" if home == Country.IN else "INR"
    fx = D("83.25") if foreign == "USD" else D("1") / D("83.25")
    u = data.draw(users(country=home, max_loans=2, tight_budget=False))
    u.loans.append(data.draw(loans(country=home, currency=foreign)))
    u.fx_to_user_currency = {foreign: fx}
    result = simulate_plan(u)
    first = result.months[0]
    by_ccy = first.balances_by_currency
    own = "INR" if home == Country.IN else "USD"
    expected = by_ccy.get(own, D("0")) + by_ccy.get(foreign, D("0")) * fx
    assert abs(first.balance_in_user_currency - expected) <= CENT


# ── 6. Payoff months stay within bounds ─────────────────────────────────────

@settings(max_examples=examples(200))
@given(u=users(allow_extras=True), s=STRATEGIES, horizon=st.integers(1, 480))
def test_payoff_month_within_horizon(u, s, horizon):
    for result in (simulate_plan(u, strategy=s, horizon_months=horizon),
                   baseline_minimums_only(u, horizon_months=horizon)):
        assert 1 <= len(result.months) <= horizon
        assert [r.month_index for r in result.months] == list(range(1, len(result.months) + 1))
        if result.debt_free_month is not None:
            assert 1 <= result.debt_free_month <= horizon
            assert result.debt_free_month == len(result.months)
            assert result.months[-1].balance_in_user_currency == 0
        else:
            assert len(result.months) == horizon


@settings(max_examples=examples(200))
@given(u=users(types=EMI_TYPES, tight_budget=False))
def test_emi_loans_clear_within_their_tenure(u):
    """Paying at least the textbook EMI clears a loan by its last scheduled
    month (+1 for an EMI rounded down to the paisa), never earlier than the
    plan with extra payments."""
    longest = max(l.tenure_months_remaining for l in u.loans)
    base = baseline_minimums_only(u, horizon_months=480)
    plan = simulate_plan(u, horizon_months=480)
    assert base.debt_free_month is not None and base.debt_free_month <= longest + 1
    assert plan.debt_free_month is not None and plan.debt_free_month <= base.debt_free_month


# ── 7. Money rounding is idempotent ─────────────────────────────────────────

def _q(x: Decimal) -> Decimal:
    return x.quantize(CENT, rounding=ROUND_HALF_UP)


@settings(max_examples=examples(500))
@given(x=st.decimals(min_value=D("-1e12"), max_value=D("1e12"), allow_nan=False, allow_infinity=False, places=10))
def test_money_rounding_is_idempotent(x):
    from api.routes.simulation import _CENT
    from engine.loan_check import _round_money
    from engine.offer_compare import _paise, _rupees

    assert _CENT == CENT
    assert _q(_q(x)) == _q(x)
    assert _paise(_paise(x)) == _paise(x)
    assert _rupees(_rupees(x)) == _rupees(x)
    assert _round_money(_round_money(x)) == _round_money(x)
    # Rounding moves a value by at most half a unit.
    assert abs(_q(x) - x) <= D("0.005")
    assert abs(_rupees(x) - x) <= D("0.5")


# ── 8. Tenure ≥ the minimum the schedule allows ─────────────────────────────

@settings(max_examples=examples(300))
@given(l=loans(types=EMI_TYPES))
def test_minimum_only_payoff_never_beats_the_contracted_tenure(l):
    """On EMIs alone a loan can't finish before its tenure (EMI rounding to
    the paisa can push it one month past)."""
    from engine.models import IncomeType, User

    u = User(country=Country.IN, income_type=IncomeType.SALARIED, annual_income=D("0"),
             monthly_income=l.scheduled_emi * 2, fixed_expenses=D("0"), savings_balance=D("0"),
             primary_bank="SBI", loans=[l])
    r = baseline_minimums_only(u, horizon_months=480)
    n = l.tenure_months_remaining
    assert r.debt_free_month is not None
    assert n - 1 <= r.debt_free_month <= n + 1, (r.debt_free_month, n)


@settings(max_examples=examples(400))
@given(p=money(1_000, 50_000_000), r=rate(0, 4800), n=st.integers(1, 480))
def test_emi_formula_laws(p, r, n):
    e = emi(p, r, n)
    assert e * n >= p - CENT            # interest is never negative
    assert e <= p * (1 + r / 12) + CENT  # never more than one month's payoff
    assert abs(remaining_balance(p, r, n, n)) <= CENT
    if n > 1:
        assert emi(p, r, n - 1) >= e    # a shorter tenure never lowers the EMI
    assert emi(p, r + D("0.0001"), n) >= e
    # Months to clear at this EMI never undercut the tenure (ceil(P / EMI)).
    assert math.ceil(p / e) <= n + 1


@settings(max_examples=examples(200))
@given(f=rate(1, 3000), n=st.integers(2, 120))
def test_flat_rate_never_reads_cheaper_than_reducing(f, n):
    reducing = flat_to_reducing(f, n)
    assert reducing >= f - D("0.0001")
    flat_emi = (1 + f * n / 12) / n
    assert abs(emi(D("1"), reducing, n) - flat_emi) <= D("0.00001")
