"""Round 2, item 1 (founder, 15 Oct 2026): rate-rise handling is the user's
choice per loan, tenure-first stays the Indian default, and the extension
ceiling is min(360 months, the lender's maximum, the months until the
borrower reaches their retirement / age limit). Past the ceiling the EMI
rises. Fixed-rate loans are untouched.

Golden case (Audit C1 repro, hand check in test_a80_w10_personas.py): ₹50 L,
8.5%, 240 months, EMI ₹43,391.16; the rate goes to 9.5% in month 13 with 228
months left. Re-amortising over those 228 months gives ₹46,497.78.
"""
from decimal import Decimal

import pytest
from hypothesis import given, settings, strategies as st

from engine.contract import (
    ABSOLUTE_MAX_TENURE_MONTHS, default_retirement_age, extension_cap, months_to_clear,
    months_until_age_limit,
)
from engine.formulas import emi
from engine.models import Country, IncomeType, LifecycleEvent, LifecycleEventKind, Loan, LoanType, User
from engine.simulation import Strategy, simulate_plan

D = Decimal


def _user(loans, **kw):
    kw.setdefault("income_type", IncomeType.SALARIED)
    return User(country=Country.IN, annual_income=D("2400000"), monthly_income=D("200000"),
                fixed_expenses=D("50000"), savings_balance=D("0"), primary_bank="SBI", loans=loans, **kw)


def _home(**kw):
    return Loan(LoanType.HOME, "SBI", D("5000000"), D("0.085"), "floating", 240, D("43391.16"), **kw)


RISE = [LifecycleEvent(LifecycleEventKind.FLOATING_RATE_RESET, 13, loan_index=0, new_rate=D("0.095"))]


def _run(user, months=300):
    return simulate_plan(user, Strategy.AVALANCHE, horizon_months=months, lifecycle_events=RISE,
                         minimums_only=True)


def _hand_emi(p: Decimal, annual: Decimal, n: int) -> Decimal:
    """P·r / (1 − (1 + r)^−n), written out independently of formulas.emi."""
    r = float(annual) / 12
    return D(str(float(p) * r / (1 - (1 + r) ** -n)))


def test_defaults_are_60_salaried_70_otherwise():
    assert default_retirement_age(IncomeType.SALARIED) == 60
    assert default_retirement_age(IncomeType.BUSINESS_OWNER) == 70
    assert default_retirement_age(None) == 70


def test_months_until_age_limit():
    u = _user([], age_months=40 * 12)
    assert months_until_age_limit(u) == 240          # 60 − 40 = 20 years
    assert months_until_age_limit(u, month=13) == 228
    u.retirement_age = 65
    assert months_until_age_limit(u) == 300
    assert months_until_age_limit(_user([])) is None   # no date of birth: no age ceiling


def test_no_age_known_keeps_tenure_first():
    """No date of birth: the EMI holds (tenure-first, C1)."""
    r = _run(_user([_home()]))
    assert abs(r.months[13].payments_by_loan_index[0] - D("43391.16")) < D("1")


def test_age_limit_already_at_contract_end_raises_emi_to_golden():
    """Salaried, aged 40 at month 1: retirement at 60 leaves 228 months at the
    month-13 reset, exactly the contract's months left, so nothing can be
    extended and the EMI rises to the re-amortised ₹46,497.78."""
    r = _run(_user([_home()], age_months=480))
    assert abs(r.months[13].payments_by_loan_index[0] - D("46497.78")) < D("1")
    ev = r.rate_rise_events[0].options
    assert ev.options["extend"].capped and ev.recommended == "raise_emi"


def test_age_limit_partly_binds_stretches_to_the_limit_then_raises():
    """Aged 37: 23 years to 60 → 264 months left at the reset. Holding the EMI
    would need more than that, so the tenure stretches to 264 months and the
    EMI rises just enough to finish then."""
    base = _run(_user([_home()]))
    bal12 = base.months[11].balances_by_loan_index[0]
    need = months_to_clear(bal12, D("0.095"), D("43391.16"))
    assert need > 264                               # tenure-first alone runs past the age limit
    capped = _run(_user([_home()], age_months=37 * 12))
    expected = _hand_emi(bal12, D("0.095"), 264)
    assert abs(capped.months[13].payments_by_loan_index[0] - expected) < D("1")
    assert abs(expected - emi(bal12, D("0.095"), 264)) < D("0.01")
    assert D("43391.16") < expected < D("46497.78")
    # The loan ends by the age limit: month 12 + 264.
    last = max(m.month_index for m in capped.months if m.balances_by_loan_index.get(0, D(0)) > 0) + 1
    assert last <= 12 + 264 + 1


def test_lender_limit_and_360_and_age_take_the_smallest():
    loan = _home(max_tenure_months=300)
    assert extension_cap(loan, 228, Country.IN) == 300
    assert extension_cap(loan, 228, Country.IN, age_months_left=250) == 250
    assert extension_cap(_home(max_tenure_months=480), 228, Country.IN) == ABSOLUTE_MAX_TENURE_MONTHS
    assert extension_cap(_home(), 228, Country.IN) == 360
    assert extension_cap(_home(), 228, Country.IN, age_months_left=100) == 228   # passed: no extension


def test_non_home_floating_loan_without_lender_limit_is_not_stretched():
    lap = Loan(LoanType.PERSONAL, "Bank", D("1000000"), D("0.11"), "floating", 60, D("21742.42"))
    assert extension_cap(lap, 48, Country.IN) == 48
    lap.max_tenure_months = 84
    assert extension_cap(lap, 48, Country.IN) == 84


@pytest.mark.parametrize("mode", ["extend", "raise_emi", "mix"])
def test_per_loan_choice_is_honoured(mode):
    r = _run(_user([_home(on_rate_rise=mode)]))
    pay = r.months[13].payments_by_loan_index[0]
    if mode == "extend":
        assert abs(pay - D("43391.16")) < D("1")
    elif mode == "raise_emi":
        assert abs(pay - D("46497.78")) < D("1")
    else:
        assert abs(pay - (D("43391.16") + (D("46497.78") - D("43391.16")) / 2)) < D("1")


def test_fixed_rate_loan_is_unaffected_by_scheduled_resets_and_age():
    car = Loan(LoanType.AUTO, "ICICI Bank", D("800000"), D("0.095"), "fixed", 60, D("16801"),
               rate_reset_frequency_months=3, next_reset_month=2, rate_drift_annualized=D("0.02"))
    young = simulate_plan(_user([car]), Strategy.AVALANCHE, horizon_months=70, minimums_only=True)
    old = simulate_plan(_user([car], age_months=59 * 12), Strategy.AVALANCHE, horizon_months=70,
                        minimums_only=True)
    assert young.rate_rise_events == [] and old.rate_rise_events == []
    assert [m.payments_by_loan_index for m in young.months] == [m.payments_by_loan_index for m in old.months]


@settings(max_examples=60, deadline=None)
@given(age_years=st.integers(25, 62), rise_bp=st.integers(25, 300),
       mode=st.sampled_from(["extend", "mix", None]), lender=st.one_of(st.none(), st.integers(240, 480)))
def test_extension_never_passes_any_ceiling(age_years, rise_bp, mode, lender):
    """Class guard: after a rise, the months left never exceed 360, the
    lender's limit or the age limit (unless the contract already ran
    longer), and the EMI never falls."""
    loan = _home(on_rate_rise=mode, max_tenure_months=lender)
    ev = [LifecycleEvent(LifecycleEventKind.FLOATING_RATE_RESET, 13, loan_index=0,
                         new_rate=D("0.085") + D(rise_bp) / D("10000"))]
    u = _user([loan], age_months=age_years * 12)
    r = simulate_plan(u, Strategy.AVALANCHE, horizon_months=420, lifecycle_events=ev, minimums_only=True)
    opts = r.rate_rise_events[0].options
    applied = opts.options[opts.applied]
    ceilings = [ABSOLUTE_MAX_TENURE_MONTHS, months_until_age_limit(u, 13)]
    if lender is not None:
        ceilings.append(lender)
    assert applied.months_left <= max(228, min(ceilings))
    assert applied.emi >= D("43391.16") - D("0.01")
