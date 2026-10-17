"""Round 2, item 3 (founder, 15 Oct 2026): the prepay / keep / split question
follows a per-loan comparison with the user's OWN assumed return after tax
(default 6.5% India / 4% US, labelled) plus a 1-point margin, and only once
the emergency fund target is met. Replaces the fixed "every loan under 10%".

Hand checks (new regime, no tax break, so cost = compounded nominal):
  8.6% home loan → (1 + 0.086/12)^12 − 1 = 8.9472%
  7.0% home loan → (1 + 0.07/12)^12 − 1  = 7.2290%
India default threshold 6.5% + 1 = 7.5%: the 7% loan qualifies, the 8.6% one
does not. With an own assumption of 8.5% (threshold 9.5%) both qualify.
"""
from decimal import Decimal

import pytest
from hypothesis import given, settings, strategies as st

from engine.formulas import emi
from engine.models import Country, IncomeType, Loan, LoanType, TaxRegimeIN, User
from engine.prepay_invest import (
    DEFAULT_ASSUMED_RETURN, SPLIT_MARGIN, assumed_return, compare, low_rate_phase, split_eligible,
    split_threshold,
)
from engine.simulation import Strategy, simulate_plan

D = Decimal
MR = D("0.2")


def home(rate, bal="3500000", n=240):
    return Loan(LoanType.HOME, "SBI", D(bal), D(rate), "floating", n, emi(D(bal), D(rate), n).quantize(D("1")))


def user(loans, country=Country.IN, **kw):
    kw.setdefault("tax_regime", TaxRegimeIN.NEW if country == Country.IN else None)
    return User(country, IncomeType.SALARIED, D("1680000"), D("140000"), D("45000"), D("0"), "SBI",
                loans=loans, **kw)


def run(u, lri=None):
    return simulate_plan(u, Strategy.AVALANCHE, horizon_months=360, marginal_rate=MR, low_rate_invest=lri)


def test_defaults_and_threshold():
    assert DEFAULT_ASSUMED_RETURN == {"IN": D("0.065"), "US": D("0.04")} and SPLIT_MARGIN == D("0.01")
    assert split_threshold(user([])) == D("0.075")
    assert assumed_return(user([])) == (D("0.065"), True)
    us = User(Country.US, IncomeType.SALARIED, D("90000"), D("7500"), D("3000"), D("0"), "Chase")
    assert split_threshold(us) == D("0.05")
    own = user([], assumed_post_tax_return=D("0.085"))
    assert split_threshold(own) == D("0.095") and assumed_return(own) == (D("0.085"), False)


def test_per_loan_eligibility_hand_check():
    u = user([home("0.086"), home("0.07", bal="1000000")])
    assert split_eligible(u, MR) == {0: False, 1: True}          # 8.95% vs 7.23% against 7.5%
    u.assumed_post_tax_return = D("0.085")
    assert split_eligible(u, MR) == {0: True, 1: True}            # against 9.5%


def test_default_assumption_never_asks_about_an_8_6_pct_home_loan():
    """The old fixed 10% asked P-ok about the 8.6% home loan; at the default
    7.5% line it never comes up (the loan costs 8.95% after tax)."""
    u = user([home("0.086")])
    assert low_rate_phase(u, run(u), MR) is None
    assert compare(u, lambda x, lri: run(x, lri), MR) is None


def test_own_assumption_brings_the_question():
    u = user([home("0.086")], assumed_post_tax_return=D("0.085"))
    ph = low_rate_phase(u, run(u), MR)
    assert ph is not None and ph.month == 1 and ph.loans == [0]


def test_waits_for_the_emergency_fund():
    """Fund target ₹3,00,000 from nothing: the question waits until the plan
    has filled it, and the simulator keeps nothing back before then."""
    u = user([home("0.07")], efund_target=D("300000"))
    base = run(u)
    ph = low_rate_phase(u, base, MR)
    assert ph is not None
    full = next(r.month_index for r in base.months if r.efund_balance >= D("300000"))
    assert ph.month == full > 1
    kept = run(u, (split_threshold(u), D("1")))
    assert all(r.invested_this_month == 0 for r in kept.months[: full - 1])
    assert kept.months[full].invested_this_month > 0


def test_no_fund_target_means_nothing_to_wait_for():
    u = user([home("0.07")])
    assert low_rate_phase(u, run(u), MR).month == 1


def test_never_keeps_money_while_a_dearer_loan_is_open():
    u = user([home("0.07", bal="1000000"),
              Loan(LoanType.PERSONAL, "X", D("300000"), D("0.14"), "fixed", 36, D("10253"))])
    a, b = run(u), run(u, (split_threshold(u), D("1")))
    ph = low_rate_phase(u, a, MR)
    assert ph is not None and ph.month > 1
    for ra, rb in zip(a.months[: ph.month - 1], b.months[: ph.month - 1]):
        assert ra.balances_by_loan_index == rb.balances_by_loan_index and rb.invested_this_month == 0


@settings(max_examples=40, deadline=None)
@given(rate=st.decimals("0.05", "0.12", places=3), own=st.one_of(st.none(), st.decimals("0.02", "0.12", places=3)),
       target=st.sampled_from([D("0"), D("200000")]))
def test_phase_rule_class(rate, own, target):
    """Class guard: a phase exists only when the loan's after-tax cost is
    below assumed return + 1 point, and never before the fund is full."""
    u = user([home(str(rate), bal="1500000")], assumed_post_tax_return=own, efund_target=target)
    base = run(u)
    ph = low_rate_phase(u, base, MR)
    eligible = split_eligible(u, MR)[0]
    if not eligible:
        assert ph is None
    if ph is not None:
        row = base.months[ph.month - 1]
        assert row.efund_balance >= target
        assert all(r.efund_balance < target for r in base.months[: ph.month - 1]) or ph.month == 1 or target == 0 \
            or base.months[ph.month - 2].efund_balance >= target
