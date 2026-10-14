"""Audit 80 · W2 (tax): golden cases with hand checks + invariants.

Primary sources (read 14 Oct 2026):
- Income-tax Act 2025 as amended by Finance Act 2026 (incometaxindia.gov.in),
  s.22 (house property), s.109(1)(b) (₹2L HP-loss set-off), s.123 + Sch XV
  (80C ₹1.5L incl. home-loan principal), s.156 (rebate), s.202 (new regime).
- IRC §163(h)(3)(F) and (h)(4) (https://www.law.cornell.edu/uscode/text/26/163),
  IRS FS-2025-03 (car-loan interest), Rev. Proc. 2025-32 (2026 MFS brackets),
  IRS Topic 456 (§221 not on a separate return).
"""
from __future__ import annotations

import pathlib
import re
from decimal import Decimal

import pytest
from hypothesis import given, settings, strategies as st

from engine.formulas import effective_rate, emi, tax_shield_fraction
from engine.marginal_cost import user_forward_rates, user_marginal_costs, why_first
from engine.models import Country, FilingStatusUS, IncomeType, Loan, LoanType, TaxRegimeIN, User
from engine.simulation import Strategy, simulate_plan, tax_caps_context
from engine.tax import india, usa
from engine.tax.income import user_gross

D = Decimal
ROOT = pathlib.Path(__file__).resolve().parents[2]


def _loan(lt, bal, rate, n=240, **kw) -> Loan:
    sched = D("0") if lt == LoanType.CREDIT_CARD else emi(D(bal), D(rate), n).quantize(D("0.01"))
    return Loan(lt, kw.pop("bank", "HDFC Bank"), D(bal), D(rate), "fixed", n, sched, **kw)


def _user(loans, country=Country.IN, take_home="200000", regime=TaxRegimeIN.OLD, **kw) -> User:
    return User(country, IncomeType.SALARIED, D(take_home) * 12, D(take_home), D("40000"), D("0"), "HDFC Bank",
                tax_regime=regime if country == Country.IN else None,
                efund_balance=D("0"), efund_target=D("0"), loans=loans, investment_options=[], **kw)


# ── C7: the ₹2L house-property set-off is counted once ──────────────────────

def test_c7_self_occupied_plus_let_out_counts_2L_once():
    so = _loan(LoanType.HOME, 3000000, "0.09", property_use="self_occupied")   # ₹2.7L interest
    lo = _loan(LoanType.HOME, 5000000, "0.09", property_use="let_out")         # ₹4.5L, no rent
    u = _user([so, lo])
    ctx = tax_caps_context(u.loans, u)
    m = D("0.312")
    sh_so = tax_shield_fraction(so, m, Country.IN, TaxRegimeIN.OLD, **ctx)
    sh_lo = tax_shield_fraction(lo, m, Country.IN, TaxRegimeIN.OLD, **ctx)
    # Hand check: 2L/2.7L × 31.2% = 0.23111; the let-out loss has no set-off left.
    assert sh_so.quantize(D("0.00001")) == D("0.23111")
    assert sh_lo == 0
    deducted = (sh_so * D("270000") + sh_lo * D("450000")) / m
    cmp = india.compare_regimes(india.RegimeInputs(salary=D("3000000"), home_loans=[
        india.HomeLoanYear(interest=D("270000")), india.HomeLoanYear(interest=D("450000"), let_out=True)]))
    assert cmp.old.house_property == D("-200000")
    assert deducted.quantize(D("1")) == -cmp.old.house_property      # both paths agree


@settings(max_examples=60, deadline=None)
@given(so_bal=st.integers(0, 8_000_000), lo_bal=st.integers(1, 8_000_000),
       rent=st.one_of(st.none(), st.integers(0, 600_000)), rate=st.sampled_from(["0.08", "0.09", "0.11"]))
def test_c7_invariant_hp_deduction_never_exceeds_statutory_room(so_bal, lo_bal, rent, rate):
    """Average-path HP deduction ≤ 70% of rent + ₹2L (old regime), whatever the mix."""
    loans = [_loan(LoanType.HOME, lo_bal, rate, property_use="let_out", annual_rent=D(rent) if rent is not None else None)]
    if so_bal:
        loans.append(_loan(LoanType.HOME, so_bal, rate, property_use="self_occupied"))
    u = _user(loans)
    ctx = tax_caps_context(u.loans, u)
    m = D("0.312")
    total = sum((tax_shield_fraction(l, m, Country.IN, TaxRegimeIN.OLD, **ctx) * l.outstanding * l.nominal_rate
                 for l in loans), D("0")) / m
    cap = D(rent or 0) * D("0.7") + india.HP_LOSS_SET_OFF_CAP
    assert total <= cap + D("0.01")
    for l in loans:   # and a shield never exceeds the marginal rate
        assert tax_shield_fraction(l, m, Country.IN, TaxRegimeIN.OLD, **ctx) <= m


# ── C8: forward decisions use the forward rate; total cost keeps sunk fees ──

def test_c8_forward_rate_excludes_sunk_fees_and_average_shield():
    pl = _loan(LoanType.PERSONAL, 300000, "0.14", n=36, processing_fee_amortised=D("0.03"), insurance_premium_pct=D("0.01"))
    card = _loan(LoanType.CREDIT_CARD, 80000, "0.36", n=0)
    home = _loan(LoanType.HOME, 6000000, "0.09")          # ₹5.4L interest: far above the ₹2L cap
    u = _user([pl, card, home])
    fwd = user_forward_rates(u.loans, u, D("0.312"))
    assert fwd[id(pl)] == D("0.14")                         # no 3% fee, no 1% insurance (sunk)
    assert fwd[id(card)] == D("0.36") * D("1.18")           # GST on card interest is forward
    assert fwd[id(home)] == D("0.09")                       # cap binds: no shield at the margin
    eff = effective_rate(home, D("0.312"), Country.IN, TaxRegimeIN.OLD)
    assert eff < D("0.09")                                  # total-cost view keeps the average shield


def test_c8_grep_gate_effective_rate_callers():
    """Only formulas.py (definition) and true_apr.py (total cost) may call
    effective_rate outside tests; forward decisions use marginal_cost."""
    allowed = {"engine/formulas.py", "engine/true_apr.py"}
    bad = []
    for base in ("engine", "api"):
        for p in (ROOT / base).rglob("*.py"):
            rel = p.relative_to(ROOT).as_posix()
            if "/tests/" in rel or rel in allowed:
                continue
            code = re.sub(r'"""[\s\S]*?"""|#.*', "", p.read_text(encoding="utf-8"))
            if re.search(r"(?<!\w)effective_rate\(", code):
                bad.append(rel)
    assert not bad, f"use marginal_cost.user_forward_rates for forward decisions: {bad}"


# ── C10: 80C room on home-loan principal (old regime) ───────────────────────

def test_c10_80c_room_ranks_home_loan_above_cheaper_car_loan_only_when_known():
    home = _loan(LoanType.HOME, 2000000, "0.086")            # sched principal ≈ ₹37k/yr
    car = _loan(LoanType.AUTO, 700000, "0.10", n=60)
    m = D("0.312")
    unknown = _user([home, car])
    mcs = user_marginal_costs(unknown.loans, unknown, m)
    assert mcs[id(home)].principal_80c == 0                  # sec80c_other unknown: nothing assumed
    known = _user([home, car], sec80c_other=D("0"))
    mcs = user_marginal_costs(known.loans, known, m)
    assert mcs[id(home)].principal_80c == m                  # 1 rupee prepaid saves 31.2 paise this year
    assert mcs[id(home)].order_key > mcs[id(car)].order_key
    assert "80C" in why_first(mcs[id(home)])
    full = _user([home, car], sec80c_other=D("150000"))     # 80C already full (EPF + PPF)
    assert user_marginal_costs(full.loans, full, m)[id(home)].principal_80c == 0
    new = _user([home, car], sec80c_other=D("0"), regime=TaxRegimeIN.NEW)
    assert user_marginal_costs(new.loans, new, m)[id(home)].principal_80c == 0   # new regime: no 80C


def test_c10_room_runs_out_within_the_tax_year():
    home = _loan(LoanType.HOME, 2000000, "0.086")
    car = _loan(LoanType.AUTO, 700000, "0.10", n=60)
    u = _user([home, car], sec80c_other=D("0"))
    room = india.sec80c_room(D("0"), max(D("0"), home.scheduled_emi * 12 - home.outstanding * home.nominal_rate))
    used = user_marginal_costs(u.loans, u, D("0.312"), home_prepaid_this_tax_year=room)
    assert used[id(home)].principal_80c == 0
    res = simulate_plan(u, Strategy.AVALANCHE, horizon_months=3, marginal_rate=D("0.312"), simulation_start_month=1)
    first = res.months[0]
    assert first.payments_by_loan_index[0] > home.scheduled_emi    # month 1's extra goes to the home loan


# ── C16: OBBBA car-loan interest (IRC §163(h)(4)) ───────────────────────────

@pytest.mark.parametrize("interest,magi,fs,year,expected", [
    ("12000", "90000", FilingStatusUS.SINGLE, 2026, "10000"),   # capped at $10,000
    ("12000", "100500", FilingStatusUS.SINGLE, 2026, "9800"),   # $500 over = one $1,000 step (or part)
    ("12000", "120000", FilingStatusUS.SINGLE, 2026, "6000"),   # 20 steps × $200
    ("12000", "150000", FilingStatusUS.SINGLE, 2026, "0"),      # gone at $150k
    ("8000", "210000", FilingStatusUS.MFJ, 2026, "6000"),       # joint line $200k
    ("8000", "120000", FilingStatusUS.MFS, 2026, "4000"),       # no MFS carve-out in the statute
    ("8000", "50000", FilingStatusUS.SINGLE, 2029, "0"),        # 2025-2028 only
])
def test_c16_auto_interest_deduction_hand_checks(interest, magi, fs, year, expected):
    assert usa.auto_loan_interest_deduction(D(interest), D(magi), fs, year) == D(expected)


def test_c16_only_a_qualified_us_car_loan_gets_a_shield():
    q = _loan(LoanType.AUTO, 40000, "0.07", n=60, us_auto_interest_qualified=True, currency="USD")
    nq = _loan(LoanType.AUTO, 40000, "0.07", n=60, currency="USD")
    u = _user([q, nq], country=Country.US, take_home="6000", filing_status=FilingStatusUS.SINGLE,
              annual_gross_salary=D("90000"))
    mcs = user_marginal_costs(u.loans, u, D("0.22"))
    assert mcs[id(q)].tax_benefit > 0 and mcs[id(nq)].tax_benefit == 0
    ctx = tax_caps_context(u.loans, u)
    assert tax_shield_fraction(q, D("0.22"), Country.US, None, **ctx) == D("0.22")
    assert tax_shield_fraction(nq, D("0.22"), Country.US, None, **ctx) == 0


# ── C17: married filing separately, pre-2018 mortgages ──────────────────────

def test_c17_mfs_rules():
    # Rev. Proc. 2025-32: MFS 37% starts above $384,350 where tax is $103,291.75.
    assert usa.federal_tax(D("384350"), FilingStatusUS.MFS) == D("103291.75")
    assert usa.student_loan_interest_deduction(D("2000"), D("50000"), FilingStatusUS.MFS) == 0
    assert usa.mortgage_debt_limit(FilingStatusUS.MFS) == D("375000")
    assert usa.mortgage_debt_limit(FilingStatusUS.SINGLE, before_2017_12_16=True) == D("1000000")
    assert usa.mortgage_debt_limit(FilingStatusUS.MFS, before_2017_12_16=True) == D("500000")
    old = _loan(LoanType.HOME, 900000, "0.04", n=360, mortgage_before_2017_12_16=True, currency="USD")
    new = _loan(LoanType.HOME, 900000, "0.06", n=360, currency="USD")
    assert tax_shield_fraction(old, D("0.32"), Country.US) == D("0.32")              # under $1M
    assert tax_shield_fraction(new, D("0.32"), Country.US).quantize(D("0.0001")) == D("0.2667")  # 750/900
    edu = _loan(LoanType.EDUCATION, 30000, "0.06", n=120, currency="USD")
    assert tax_shield_fraction(edu, D("0.22"), Country.US, filing_status=FilingStatusUS.MFS) == 0


# ── C20: §221 phase-out with no gross pay on file ───────────────────────────

def test_c20_high_take_home_gets_no_student_loan_shield():
    edu = _loan(LoanType.EDUCATION, 30000, "0.06", n=120, currency="USD")
    u = _user([edu], country=Country.US, take_home="12000", filing_status=FilingStatusUS.SINGLE)
    gross, est = user_gross(u)
    assert est and gross > D("180000")                      # ~$190k gross from $12k/mo take-home
    assert user_marginal_costs(u.loans, u, D("0.24"))[id(edu)].tax_benefit == 0
    ctx = tax_caps_context(u.loans, u)
    assert tax_shield_fraction(edu, D("0.24"), Country.US, **ctx) == 0
    low = _user([edu], country=Country.US, take_home="4000", filing_status=FilingStatusUS.SINGLE)
    assert user_marginal_costs(low.loans, low, D("0.12"))[id(edu)].tax_benefit > 0


# ── India 2026-27 hand checks and invariants ────────────────────────────────

@pytest.mark.parametrize("salary,regime,tax", [
    ("1300000", TaxRegimeIN.NEW, "26000"),     # 12.25L taxable: min(63,750, 25,000) × 1.04 (marginal relief)
    ("1800000", TaxRegimeIN.NEW, "150800"),    # (20k + 40k + 60k + 25k) × 1.04
    ("1275000", TaxRegimeIN.NEW, "0"),         # 12L taxable after ₹75k standard deduction: rebate
    ("1800000", TaxRegimeIN.OLD, "351000"),    # (12,500 + 1,00,000 + 2,25,000) × 1.04
    ("550000", TaxRegimeIN.OLD, "0"),          # 5L taxable: s.156 rebate ₹12,500
])
def test_india_slab_hand_checks(salary, regime, tax):
    std = india.STANDARD_DEDUCTION_NEW_SALARIED if regime == TaxRegimeIN.NEW else india.STANDARD_DEDUCTION_OLD_SALARIED
    assert india.income_tax(D(salary) - std, regime).quantize(D("1")) == D(tax)


@settings(max_examples=200, deadline=None)
@given(a=st.integers(0, 60_000_000), b=st.integers(0, 60_000_000),
       regime=st.sampled_from([TaxRegimeIN.NEW, TaxRegimeIN.OLD]), age=st.sampled_from([None, "60_79", "80_plus"]))
def test_india_tax_monotone_in_income(a, b, regime, age):
    lo, hi = sorted((a, b))
    assert india.income_tax_for_age(D(lo), regime, age) <= india.income_tax_for_age(D(hi), regime, age) + D("0.000001")


@settings(max_examples=100, deadline=None)
@given(taxable=st.integers(0, 60_000_000), regime=st.sampled_from([TaxRegimeIN.NEW, TaxRegimeIN.OLD]))
def test_india_marginal_rate_is_a_real_slab_plus_cess(taxable, regime):
    """E9 invariant: the marginal rate is slab × (1 + surcharge) × 1.04, slab in the Act's table."""
    r = india.marginal_rate(D(taxable), regime)
    slabs = {rate for _, rate in (india.NEW_REGIME_SLABS if regime == TaxRegimeIN.NEW else india.OLD_REGIME_SLABS)}
    s = india.surcharge_rate(D(taxable), regime=regime)
    assert any(r == slab * (1 + s) * (1 + india.CESS_RATE) for slab in slabs | {D("0")})
