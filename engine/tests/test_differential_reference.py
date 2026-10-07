"""Differential tests: the engine against an independent reference.

The reference below is written from the textbook definitions with exact
rational arithmetic (fractions.Fraction), sharing no code with the engine.
On thousands of seeded random inputs the engine's EMI, remaining balance,
flat→reducing conversion and month-by-month amortisation must agree with it
to a fraction of a paisa/cent.

numpy-financial would serve as the reference too, but it computes in binary
floating point (errors of ~1e-7 on a ₹5 crore loan); exact fractions give a
stricter oracle with no extra dependency.
"""
from __future__ import annotations

import random
from decimal import Decimal
from fractions import Fraction as F

import pytest

from engine.formulas import emi, flat_to_reducing, remaining_balance
from engine.models import Country, IncomeType, Loan, LoanType, User
from engine.simulation import baseline_minimums_only, simulate_plan

D = Decimal
SEED = 20261007
N_CASES = 1500
TOL = F(1, 10**6)          # a millionth of a rupee/dollar


# ── the independent reference ───────────────────────────────────────────────

def ref_emi(p: F, annual: F, n: int) -> F:
    """P·r·(1+r)^n / ((1+r)^n − 1), r monthly; P/n at 0%."""
    if n <= 0:
        return p
    r = annual / 12
    if r == 0:
        return p / n
    g = (1 + r) ** n
    return p * r * g / (g - 1)


def ref_balance_after(p: F, annual: F, n: int, k: int) -> F:
    """Walk the schedule month by month (no closed form)."""
    r, e, b = annual / 12, ref_emi(p, annual, n), p
    for _ in range(min(k, n)):
        b = b + b * r - e
    return max(F(0), b) if k >= n else b


def ref_amortise(p: F, annual: F, payment: F, gst: F = F(0), months: int = 480,
                 extra=lambda m: F(0)):
    """Rows of (balance_after, interest, invested) for a single loan paid
    `payment` (+ `extra(m)`) a month; interest carries `gst` on top."""
    r, b, rows = annual / 12, p, []
    for m in range(1, months + 1):
        if b <= 0:
            break
        interest = b * r * (1 + gst)
        pay = payment + extra(m)
        principal = pay - interest
        invested = F(0)
        if principal >= b:
            invested = principal - b
            principal = b
        b -= principal
        rows.append((b, interest, invested))
    return rows


def ref_flat_to_reducing(flat: F, n: int) -> F:
    target = (1 + flat * n / 12) / n
    lo, hi = F(0), flat * 3
    for _ in range(80):
        mid = (lo + hi) / 2
        if ref_emi(F(1), mid, n) < target:
            lo = mid
        else:
            hi = mid
    return (lo + hi) / 2


# ── seeded case generation ──────────────────────────────────────────────────

def _cases(n=N_CASES, seed=SEED):
    rng = random.Random(seed)
    for _ in range(n):
        p = rng.choice([rng.randint(1_000, 99_999), rng.randint(100_000, 9_999_999), rng.randint(10_000_000, 50_000_000)])
        bps = rng.choice([0, rng.randint(1, 60), rng.randint(60, 4800)])
        n = rng.choice([rng.randint(1, 12), rng.randint(12, 120), rng.randint(120, 480)])
        yield D(p), D(bps) / D(10000), n


def _f(x: Decimal) -> F:
    return F(x)


def _close(a: Decimal, b: F, tol: F = TOL) -> bool:
    return abs(F(a) - b) <= tol


# ── EMI and balances ────────────────────────────────────────────────────────

def test_emi_matches_reference_exactly():
    worst = F(0)
    for p, r, n in _cases():
        got, want = emi(p, r, n), ref_emi(_f(p), _f(r), n)
        worst = max(worst, abs(F(got) - want))
        assert _close(got, want), (p, r, n, got, float(want))
    assert worst < TOL


def test_remaining_balance_matches_month_by_month_walk():
    rng = random.Random(SEED + 1)
    for p, r, n in list(_cases(400, SEED + 1)):
        k = rng.randint(0, n)
        got = remaining_balance(p, r, n, k)
        want = ref_balance_after(_f(p), _f(r), n, k)
        assert _close(got, want, F(1, 10**4)), (p, r, n, k, got, float(want))


def test_flat_to_reducing_matches_reference():
    rng = random.Random(SEED + 2)
    for _ in range(300):
        flat = D(rng.randint(1, 3000)) / D(10000)
        n = rng.randint(2, 120)
        got = flat_to_reducing(flat, n)
        want = ref_flat_to_reducing(_f(flat), n)
        assert abs(F(got) - want) <= F(2, 10**5), (flat, n, got, float(want))


# ── month-by-month amortisation through the simulator ───────────────────────

def _user(country, loan, income, expenses=D("0")):
    return User(country=country, income_type=IncomeType.SALARIED, annual_income=income * 12,
                monthly_income=income, fixed_expenses=expenses, savings_balance=D("0"),
                primary_bank="SBI", loans=[loan])


def _emi_loans(n=N_CASES):
    rng = random.Random(SEED + 3)
    types = [LoanType.HOME, LoanType.AUTO, LoanType.PERSONAL, LoanType.EDUCATION, LoanType.GOLD, LoanType.BNPL]
    for p, r, tenure in _cases(n, SEED + 3):
        sched = emi(p, r, tenure).quantize(D("0.01"))
        if sched <= 0:
            continue
        country = rng.choice([Country.IN, Country.US])
        yield country, Loan(loan_type=rng.choice(types), bank="SBI", outstanding=p, nominal_rate=r,
                            rate_type="fixed", tenure_months_remaining=tenure, scheduled_emi=sched), rng


@pytest.mark.parametrize("chunk", range(3))
def test_minimum_only_schedule_matches_reference(chunk):
    for i, (country, loan, _rng) in enumerate(_emi_loans(900)):
        if i % 3 != chunk:
            continue
        res = baseline_minimums_only(_user(country, loan, loan.scheduled_emi), horizon_months=480)
        ref = ref_amortise(_f(loan.outstanding), _f(loan.nominal_rate), _f(loan.scheduled_emi))
        assert len(res.months) == len(ref), (loan, len(res.months), len(ref))
        for row, (bal, interest, _inv) in zip(res.months, ref):
            assert _close(row.balances_by_loan_index[0], bal, F(1, 10**4)), (loan, row.month_index)
            assert _close(row.interest_paid_month, interest, F(1, 10**4)), (loan, row.month_index)
        assert _close(res.total_interest_paid, sum(x[1] for x in ref), F(1, 10**3))


def test_plan_with_surplus_matches_reference():
    """A single loan plus a monthly surplus: the engine must put every spare
    rupee on the loan when it charges more than the 0.5pp prepay hurdle,
    and invest it otherwise — exactly as the reference does."""
    for country, loan, rng in _emi_loans(600):
        spare = D(rng.randint(0, 200_000))
        income = loan.scheduled_emi + spare
        res = simulate_plan(_user(country, loan, income), horizon_months=480)
        worth = loan.nominal_rate > D("0.005")
        ref = ref_amortise(_f(loan.outstanding), _f(loan.nominal_rate), _f(loan.scheduled_emi),
                           extra=(lambda m, s=_f(spare): s) if worth else (lambda m: F(0)))
        assert len(res.months) == len(ref), (loan, spare, len(res.months), len(ref))
        for row, (bal, interest, invested) in zip(res.months, ref):
            assert _close(row.balances_by_loan_index[0], bal, F(1, 10**4)), (loan, spare, row.month_index)
            assert _close(row.interest_paid_month, interest, F(1, 10**4))
            want_inv = invested if worth else invested + _f(spare)
            assert _close(row.invested_this_month, want_inv, F(1, 10**4)), (loan, spare, row.month_index)


def test_card_with_fixed_minimum_matches_reference_including_gst():
    """Cards with a set minimum: Indian cards add 18% GST to the finance
    charge (P2-13), US cards don't."""
    rng = random.Random(SEED + 4)
    for _ in range(600):
        country = rng.choice([Country.IN, Country.US])
        p = D(rng.randint(1_000, 2_000_000))
        r = D(rng.randint(0, 4800)) / D(10000)
        # Always at least the first month's interest (+GST) plus 1%.
        floor = p * r / 12 * D("1.18") + p / 100
        minimum = (floor * D(rng.randint(100, 400)) / 100).quantize(D("0.01"))
        card = Loan(loan_type=LoanType.CREDIT_CARD, bank="HDFC Bank", outstanding=p, nominal_rate=r,
                    rate_type="fixed", tenure_months_remaining=0, scheduled_emi=D("0"),
                    min_payment_override=minimum)
        res = baseline_minimums_only(_user(country, card, minimum), horizon_months=480)
        gst = F(18, 100) if country == Country.IN else F(0)
        ref = ref_amortise(_f(p), _f(r), _f(minimum), gst=gst)
        assert len(res.months) == len(ref)
        for row, (bal, interest, _inv) in zip(res.months, ref):
            assert _close(row.balances_by_loan_index[0], bal, F(1, 10**4)), (country, p, r, minimum, row.month_index)
            assert _close(row.interest_paid_month, interest, F(1, 10**4))
