"""Hypothesis strategies shared by the property-based and differential tests.

Every generated value is a *realistic* engine input: amounts in whole
rupees/cents, rates in basis points, tenures in months. The ranges are
deliberately wide (a ₹1,000 BNPL to a ₹5 crore home loan, 0% to 48% APR)
so the invariants are exercised far outside the happy path, but never
outside what the API schema accepts.
"""
from __future__ import annotations

import os
from decimal import ROUND_CEILING, Decimal

from hypothesis import HealthCheck, settings
from hypothesis import strategies as st

from engine.formulas import emi
from engine.models import (
    Country,
    IncomeType,
    InvestmentOption,
    LiquidityClass,
    Loan,
    LoanType,
    TaxRegimeIN,
    User,
)

D = Decimal

# ── Hypothesis profiles ─────────────────────────────────────────────────────
# "ci" (the default) is derandomized: the same examples every run, on every
# machine, so a red build is reproducible and never flaky. "explore" is for
# hunting new bugs locally:  HYPOTHESIS_PROFILE=explore pytest -k property
_COMMON = dict(deadline=None, print_blob=True,
               suppress_health_check=[HealthCheck.too_slow, HealthCheck.data_too_large])
settings.register_profile("ci", derandomize=True, database=None, **_COMMON)
settings.register_profile("explore", derandomize=False, max_examples=3000, **_COMMON)
settings.load_profile(os.environ.get("HYPOTHESIS_PROFILE", "ci"))


def examples(n: int) -> int:
    """Per-test example count, scaled by PROPERTY_SCALE (e.g. 4 for a long
    nightly run). Kept modest by default so unit+property stay under ~60 s."""
    return max(10, int(n * float(os.environ.get("PROPERTY_SCALE", "1"))))


EMI_TYPES = [LoanType.HOME, LoanType.AUTO, LoanType.PERSONAL, LoanType.EDUCATION, LoanType.GOLD, LoanType.BNPL]
ALL_TYPES = EMI_TYPES + [LoanType.CREDIT_CARD]

# Sensible APR bands per loan type (basis points). Wide on purpose.
RATE_BPS = {
    LoanType.HOME: (0, 1600),
    LoanType.AUTO: (0, 2400),
    LoanType.PERSONAL: (0, 3600),
    LoanType.EDUCATION: (0, 1800),
    LoanType.GOLD: (0, 2600),
    LoanType.BNPL: (0, 3600),
    LoanType.CREDIT_CARD: (0, 4800),
}
TENURE = {
    LoanType.HOME: (12, 360),
    LoanType.AUTO: (12, 96),
    LoanType.PERSONAL: (6, 84),
    LoanType.EDUCATION: (12, 180),
    LoanType.GOLD: (3, 36),
    LoanType.BNPL: (3, 24),
    LoanType.CREDIT_CARD: (3, 36),
}


def money(lo: int, hi: int) -> st.SearchStrategy[Decimal]:
    return st.integers(lo, hi).map(D)


def rate(lo_bps: int, hi_bps: int) -> st.SearchStrategy[Decimal]:
    return st.integers(lo_bps, hi_bps).map(lambda b: D(b) / D(10000))


@st.composite
def loans(
    draw,
    country: Country = Country.IN,
    types=None,
    currency: str | None = None,
    allow_extras: bool = False,
):
    """A loan whose EMI is the textbook EMI for its balance/rate/tenure
    (cards: no EMI, minimum comes from the issuer formula)."""
    lt = draw(st.sampled_from(types or ALL_TYPES))
    lo, hi = RATE_BPS[lt]
    r = draw(rate(lo, hi))
    tlo, thi = TENURE[lt]
    n = draw(st.integers(tlo, thi))
    big = 50_000_000 if lt == LoanType.HOME else 5_000_000
    outstanding = draw(money(1_000, big))
    sched = D("0") if lt == LoanType.CREDIT_CARD else emi(outstanding, r, n).quantize(D("0.01"))
    loan = Loan(
        loan_type=lt,
        bank=draw(st.sampled_from(["HDFC Bank", "SBI", "ICICI Bank", "Chase", "Citi", "Axis Bank"])),
        outstanding=outstanding,
        nominal_rate=r,
        rate_type="fixed",
        tenure_months_remaining=n,
        scheduled_emi=sched,
        currency=currency,
    )
    if allow_extras:
        loan.rate_type = draw(st.sampled_from(["fixed", "floating"]))
        if loan.rate_type == "floating" and draw(st.booleans()):
            loan.rate_reset_frequency_months = draw(st.sampled_from([1, 3, 6, 12]))
            loan.next_reset_month = draw(st.integers(1, 24))
            loan.rate_drift_annualized = draw(rate(-200, 200))
        if draw(st.booleans()):
            loan.prepayment_penalty_pct = draw(rate(0, 400))
        if draw(st.booleans()):
            loan.prepay_lock_in_months = draw(st.integers(0, 24))
        if draw(st.booleans()):
            loan.part_payment_freq_months = draw(st.sampled_from([None, 1, 6, 12]))
        if lt == LoanType.CREDIT_CARD and draw(st.booleans()):
            loan.expected_monthly_spend = draw(money(0, 20_000))
    return loan


@st.composite
def users(
    draw,
    country: Country | None = None,
    min_loans: int = 1,
    max_loans: int = 4,
    types=None,
    allow_extras: bool = False,
    tight_budget: bool | None = None,
):
    """A single-currency user. Income is drawn relative to the EMIs so both
    comfortable and squeezed months are generated."""
    c = country or draw(st.sampled_from([Country.IN, Country.US]))
    ls = draw(st.lists(loans(country=c, types=types, allow_extras=allow_extras), min_size=min_loans, max_size=max_loans))
    emis = sum((l.scheduled_emi for l in ls), D("0"))
    cards = sum((l.outstanding for l in ls if l.loan_type == LoanType.CREDIT_CARD), D("0"))
    commitment = emis + cards * D("0.06")
    expenses = draw(money(0, 200_000))
    squeeze = tight_budget if tight_budget is not None else draw(st.booleans())
    if squeeze:
        # Sometimes less than the minimums: a shortfall month.
        income = (commitment + expenses) * D(draw(st.integers(50, 110))) / D(100)
    else:
        income = (commitment + expenses) * D(draw(st.integers(100, 300))) / D(100) + draw(money(0, 100_000))
    # Round UP: a covering income rounded down could leave a sub-rupee short
    # month (e.g. 0.41), which L2 now borrows at card rate.
    income = income.quantize(D("1"), rounding=ROUND_CEILING)
    opts = []
    if draw(st.booleans()):
        opts.append(InvestmentOption(
            name="liquid fund",
            expected_return=draw(rate(0, 1000)),
            liquidity_class=LiquidityClass.LIQUID,
            is_in_pool=True,
        ))
    return User(
        country=c,
        income_type=IncomeType.SALARIED,
        annual_income=income * 12,
        monthly_income=income,
        fixed_expenses=expenses,
        savings_balance=D("0"),
        primary_bank="HDFC Bank",
        tax_regime=TaxRegimeIN.NEW if c == Country.IN else None,
        efund_balance=D("0"),
        efund_target=D("0"),
        loans=ls,
        investment_options=opts,
    )
