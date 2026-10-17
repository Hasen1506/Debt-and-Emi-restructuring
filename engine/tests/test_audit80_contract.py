"""Audit 80+ Section C (W1): the contract over time.

Golden cases are the audit's own repros, each with an independent hand
check written next to it. Property tests guard the whole class of defect:

* a rate rise never raises the EMI under tenure-first unless the ceiling binds;
* every loan with a term reaches zero by its term (minimums only);
* a bullet repays exactly principal × (1 + r × n / 12) at maturity;
* gap borrowing never passes its limit;
* a card minimum never falls below the interest it is charged (no negative
  amortisation) and never above the old full-month figure;
* lock-in months left never rise as time passes (api/tests/test_audit80_api.py).
"""
from __future__ import annotations

import math
from copy import deepcopy
from decimal import Decimal as D

import pytest
from hypothesis import given, settings
from hypothesis import strategies as st

from engine.contract import (
    IN_HOME_MAX_TENURE_MONTHS, contract_mismatch, extension_cap, implied_reducing_rate,
    months_to_clear, rate_rise_mode, rate_rise_options, reprice_on_rise, repayment_kind,
)
from engine.fee_order import choose_order, order_tolerance
from engine.formulas import emi, flat_to_reducing
from engine.models import (Country, IncomeType, LifecycleEvent, LifecycleEventKind, Loan, LoanType,
                           TaxRegimeIN, User)
from engine.simulation import (GAP_ROUNDING, baseline_minimums_only, card_cycle_interest,
                               non_amortising_loans, simulate_plan)
from engine.tests.strategies import examples, loans as loan_strategy

R = D("0.01")


def _user(loans, income="1000000", fixed="0", country=Country.IN, **kw):
    return User(country=country, income_type=IncomeType.SALARIED, annual_income=D(income) * 12,
                monthly_income=D(income), fixed_expenses=D(fixed), savings_balance=D("0"),
                primary_bank="SBI", tax_regime=TaxRegimeIN.NEW if country == Country.IN else None,
                loans=loans, **kw)


def _home(**kw):
    a = dict(loan_type=LoanType.HOME, bank="SBI", outstanding=D("5000000"), nominal_rate=D("0.085"),
             rate_type="floating", tenure_months_remaining=240,
             scheduled_emi=emi(D("5000000"), D("0.085"), 240), currency="INR")
    a.update(kw)
    return Loan(**a)


def _rise(month, rate, idx=0):
    return LifecycleEvent(kind=LifecycleEventKind.FLOATING_RATE_RESET, effective_month=month,
                          loan_index=idx, new_rate=D(rate))


def _float_balance(p, r, e, k):
    """Independent closed form: balance after k EMIs."""
    i = r / 12
    return p * (1 + i) ** k - e * ((1 + i) ** k - 1) / i


def _float_months(b, r, e):
    i = r / 12
    return math.ceil(-math.log(1 - i * b / e) / math.log(1 + i) - 1e-6)


# ── C1: rate rise, tenure-first by default ──────────────────────────────────

def test_c1_reset_repro_holds_the_emi_and_runs_285_more_months():
    """Repro "reset": ₹50L, 8.5%, 240 mo, rise to 9.5% in month 13. The
    Indian default holds ₹43,391 and runs ≈285 months instead of 228."""
    e = float(emi(D("5000000"), D("0.085"), 240))
    b12 = _float_balance(5_000_000, 0.085, e, 12)
    n = _float_months(b12, 0.095, e)
    assert n == 285                                     # hand check (audit: "≈285")
    res = baseline_minimums_only(_user([_home()]), horizon_months=400, lifecycle_events=[_rise(13, "0.095")])
    assert abs(res.months[12].payments_by_loan_index[0] - D(str(e))) < R
    assert res.debt_free_month == 12 + n
    ev = res.rate_rise_events[0]
    assert ev.month_index == 13 and ev.options.applied == "extend"
    assert ev.options.options["extend"].months_left == 285
    assert ev.options.options["raise_emi"].months_left == 228


def test_c1_raise_emi_choice_matches_the_audit_hand_check():
    """emi(bal₁₂, 9.5%, 228) = 46,497.78 (audit)."""
    res = baseline_minimums_only(_user([_home(on_rate_rise="raise_emi")]), horizon_months=400,
                                 lifecycle_events=[_rise(13, "0.095")])
    assert abs(res.months[12].payments_by_loan_index[0] - D("46497.78")) < R
    assert res.debt_free_month == 240
    opts = res.rate_rise_events[0].options
    assert abs(opts.options["raise_emi"].emi_change - D("3106.62")) < R
    # Both outcomes are shown whichever one the plan applied.
    assert opts.options["extend"].months_left == 285
    assert opts.extra_interest_if_extended > 0


def test_c1_mix_sits_between():
    res = baseline_minimums_only(_user([_home(on_rate_rise="mix")]), horizon_months=400,
                                 lifecycle_events=[_rise(13, "0.095")])
    paid = res.months[12].payments_by_loan_index[0]
    assert D("43391.16") < paid < D("46497.78")
    assert 240 < res.debt_free_month < 297


def test_c1_us_loan_keeps_the_end_date_by_default():
    loan = _home(currency="USD", bank="Chase", outstanding=D("300000"),
                 scheduled_emi=emi(D("300000"), D("0.085"), 240))
    assert rate_rise_mode(loan, Country.US) == "raise_emi"
    res = baseline_minimums_only(_user([loan], income="20000", country=Country.US), horizon_months=400,
                                 lifecycle_events=[_rise(13, "0.095")])
    assert res.debt_free_month == 240


def test_c1_ceiling_binds_then_the_emi_rises_just_enough():
    """Lender maximum of 250 months from the rise: emi(bal₁₂, 9.5%, 250)."""
    e = float(emi(D("5000000"), D("0.085"), 240))
    b12 = _float_balance(5_000_000, 0.085, e, 12)
    i = 0.095 / 12
    want = b12 * i * (1 + i) ** 250 / ((1 + i) ** 250 - 1)
    res = baseline_minimums_only(_user([_home(max_tenure_months=250)]), horizon_months=400,
                                 lifecycle_events=[_rise(13, "0.095")])
    assert abs(float(res.months[12].payments_by_loan_index[0]) - want) < 0.05
    assert res.debt_free_month == 12 + 250
    assert res.rate_rise_events[0].options.options["extend"].capped


def test_c1_non_home_indian_loan_without_a_ceiling_raises_the_emi():
    """Founder decision: only a home loan has a default ceiling (SBI's 30
    years). Any other loan is extended only as far as the user says its
    lender allows; with nothing given the EMI rises to keep the end date."""
    car = Loan(LoanType.AUTO, "HDFC", D("800000"), D("0.09"), "floating", 60,
               emi(D("800000"), D("0.09"), 60), currency="INR")
    assert extension_cap(car, 48, Country.IN) == 48
    res = baseline_minimums_only(_user([car]), horizon_months=120, lifecycle_events=[_rise(13, "0.10")])
    assert res.debt_free_month == 60
    car.max_tenure_months = 72
    res = baseline_minimums_only(_user([car]), horizon_months=120, lifecycle_events=[_rise(13, "0.10")])
    assert res.debt_free_month > 60


def test_c1_negative_amortisation_is_never_allowed():
    """At 20% the EMI no longer covers the interest: tenure-first must still
    raise it, just enough to finish by the 30-year ceiling (RBI para 2(v))."""
    res = baseline_minimums_only(_user([_home()]), horizon_months=400, lifecycle_events=[_rise(13, "0.20")])
    bal = [r.balances_by_loan_index[0] for r in res.months]
    assert all(b2 <= b1 for b1, b2 in zip(bal, bal[1:]))
    assert res.debt_free_month == 12 + IN_HOME_MAX_TENURE_MONTHS


@pytest.mark.parametrize("spare,fee,want", [
    (D("5000"), D("0"), "keep_emi_and_prepay"),   # fits, prepaying free (IN floating)
    (D("5000"), D("0.02"), "raise_emi"),          # fits, but prepaying costs a fee
    (D("1000"), D("0"), "extend"),                # doesn't fit this month
    (None, D("0"), "extend"),                     # spare cash unknown
])
def test_c1_recommends_the_most_valuable_step(spare, fee, want):
    e = emi(D("5000000"), D("0.085"), 240)
    b12 = D(str(_float_balance(5_000_000, 0.085, float(e), 12)))
    o = rate_rise_options(b12, D("0.085"), D("0.095"), e, 228, 360, "extend", spare_cash=spare, prepay_fee=fee)
    assert o.recommended == want
    assert o.reason


def test_c1_plan_event_carries_the_months_spare_cash():
    """In a real plan the recommendation sees the month's surplus: plenty of
    spare cash and a free prepayment = keep the EMI and prepay."""
    home = _home()
    # The user keeps the extra (debt budget = the EMI), so the loan reaches
    # the rise with no prepayment head start but with spare cash in hand.
    res = simulate_plan(_user([home], income="200000", fixed="50000"), horizon_months=400,
                        lifecycle_events=[_rise(13, "0.095")], debt_budget=home.scheduled_emi)
    o = res.rate_rise_events[0].options
    assert o.spare_cash is not None and o.spare_cash > o.options["raise_emi"].emi_change
    assert o.recommended == "keep_emi_and_prepay"


@settings(max_examples=examples(300))
@given(
    bal=st.integers(10_000, 50_000_000).map(D),
    r=st.integers(0, 2400).map(lambda b: D(b) / 10000),
    rise=st.integers(1, 600).map(lambda b: D(b) / 10000),
    left=st.integers(1, 360),
    cap_extra=st.integers(0, 240),
)
def test_property_tenure_first_never_raises_the_emi_unless_the_ceiling_binds(bal, r, rise, left, cap_extra):
    e = emi(bal, r, left)
    cap = left + cap_extra
    rp = reprice_on_rise(bal, r + rise, e, left, "extend", cap)
    assert rp.months_left >= left and rp.months_left <= cap
    if rp.emi > e:
        n = months_to_clear(bal, r + rise, e)
        assert rp.capped and (n is None or n > cap)
    else:
        assert rp.emi == e and not rp.capped
    # Whatever happens, the new EMI amortises (no negative amortisation).
    assert rp.emi > bal * (r + rise) / 12
    raised = reprice_on_rise(bal, r + rise, e, left, "raise_emi", left)
    mix = reprice_on_rise(bal, r + rise, e, left, "mix", cap)
    assert rp.emi <= mix.emi <= raised.emi + R
    assert raised.months_left == left


@settings(max_examples=examples(40))
@given(rise_bps=st.integers(1, 300), month=st.integers(2, 60), tenure=st.integers(60, 300))
def test_property_plan_holds_the_emi_on_an_indian_home_loan_rise(rise_bps, month, tenure):
    loan = _home(tenure_months_remaining=tenure, scheduled_emi=emi(D("5000000"), D("0.085"), tenure))
    res = baseline_minimums_only(_user([loan]), horizon_months=IN_HOME_MAX_TENURE_MONTHS + month + 2,
                                 lifecycle_events=[_rise(month, str(D("0.085") + D(rise_bps) / 10000))])
    o = res.rate_rise_events[0].options
    if not o.options["extend"].capped:
        assert abs(res.months[month - 1].payments_by_loan_index[0] - loan.scheduled_emi) < R
    assert res.debt_free_month is not None and res.debt_free_month <= month - 1 + max(
        o.cap, o.months_left_before)


# ── C2: bullet / interest-only gold loans mature ────────────────────────────

def _gold(e="0", **kw):
    return Loan(LoanType.GOLD, "Muthoot", D("100000"), D("0.09"), "fixed", 12, D(e), currency="INR", **kw)


def test_c2_bullet_gold_loan_repays_simple_interest_at_month_12():
    """Repro "gold": ₹1L at 9% for 12 months, EMI 0. Hand: 1,00,000 ×
    (1 + 0.09 × 12/12) = 1,09,000 in month 12 (it used to compound forever)."""
    loan = _gold()
    assert repayment_kind(loan) == "bullet"
    res = baseline_minimums_only(_user([loan]), horizon_months=60)
    assert res.debt_free_month == 12
    assert res.months[11].payments_by_loan_index[0] == D("109000")
    assert res.months[10].balances_by_loan_index[0] == D("108250")     # 11 months simple
    assert all(not r.payments_by_loan_index for r in res.months[:11])
    assert [(m.month_index, m.kind, m.amount_due) for m in res.maturities] == [(12, "bullet", D("109000.00"))]
    assert not non_amortising_loans(_user([loan]))


def test_c2_interest_only_gold_loan_clears_with_its_principal():
    """EMI ₹750 = the month's interest: clears at maturity, not "never"."""
    loan = _gold("750", repayment="interest_only")
    assert not non_amortising_loans(_user([loan]))
    res = baseline_minimums_only(_user([loan]), horizon_months=60)
    assert res.debt_free_month == 12
    assert all(r.payments_by_loan_index[0] == D("750") for r in res.months[:11])
    assert res.months[11].payments_by_loan_index[0] == D("100750")


def test_c2_unaffordable_maturity_is_a_renew_or_repay_event():
    loan = _gold()
    res = simulate_plan(_user([loan], income="30000", fixed="25000"), horizon_months=60)
    m = res.maturities[0]
    assert m.month_index == 12 and m.short
    assert res.months[11].gap_borrowed > 0


@settings(max_examples=examples(100))
@given(p=st.integers(1_000, 5_000_000).map(D), bps=st.integers(0, 3000), n=st.integers(1, 12))
def test_property_bullet_repays_exactly_simple_interest(p, bps, n):
    r = D(bps) / 10000
    loan = Loan(LoanType.GOLD, "x", p, r, "fixed", n, D("0"), currency="INR")
    res = baseline_minimums_only(_user([loan], income=str(p * 3)), horizon_months=n + 3)
    assert res.debt_free_month == n
    assert abs(res.months[n - 1].payments_by_loan_index[0] - p * (1 + r * n / 12)) < R


# ── C3 / C6: the contract end date is enforced ──────────────────────────────

def test_c3_one_month_left_pays_the_whole_balance_in_month_1():
    """Repro "onemonth": ₹50,000 left, 1 month, EMI ₹10,000 (14%). Month 1's
    instalment is 50,000 × (1 + 0.14/12) = ₹50,583.33; it used to run to m6."""
    loan = Loan(LoanType.PERSONAL, "X", D("50000"), D("0.14"), "fixed", 1, D("10000"), currency="INR")
    res = simulate_plan(_user([loan], income="100000"), horizon_months=60)
    assert res.debt_free_month == 1
    assert abs(res.months[0].payments_by_loan_index[0] - D("50583.33")) < R
    msg = contract_mismatch(loan)
    assert msg and "6 months" in msg and "1 is left" in msg


def test_c3_consistent_loans_get_no_warning():
    assert contract_mismatch(_home()) is None
    assert contract_mismatch(_home(scheduled_emi=D("43391"))) is None     # rounded EMI


def test_c6_rupee_rounded_emi_still_clears_in_month_240():
    """Repro "round": EMI typed as ₹43,391 leaves ₹101.37 after the 240th
    EMI. Banks adjust the final instalment: m240 pays 43,391 + 101.37."""
    e = 43391.0
    left = _float_balance(5_000_000, 0.085, e, 239) * (1 + 0.085 / 12) - e
    assert abs(left - 101.37) < 0.01                                      # hand check
    res = baseline_minimums_only(_user([_home(scheduled_emi=D("43391"))]), horizon_months=400)
    assert res.debt_free_month == 240
    assert abs(float(res.months[239].payments_by_loan_index[0]) - (e + left)) < 0.01
    assert res.maturities == []           # a rounding adjustment isn't a balloon event


@settings(max_examples=examples(40))
@given(loan=loan_strategy(types=[LoanType.HOME, LoanType.AUTO, LoanType.PERSONAL, LoanType.EDUCATION,
                                 LoanType.GOLD, LoanType.BNPL]),
       emi_scale=st.integers(50, 200))
def test_property_every_loan_with_a_term_is_clear_by_its_term(loan, emi_scale):
    """Minimums only, ample income, no rate change: whatever EMI was typed
    (even one that disagrees with the months left), the loan is at zero by
    its last contractual month."""
    loan = deepcopy(loan)
    loan.rate_type = "fixed"
    loan.scheduled_emi = (loan.scheduled_emi * D(emi_scale) / 100).quantize(D("1"))
    loan.pre_emi_months_remaining = 0
    loan.first_payment_month = 1
    if loan.tenure_months_remaining <= 0:
        return
    res = baseline_minimums_only(_user([loan], income=str(loan.outstanding * 4 + 10_000)),
                                 horizon_months=loan.tenure_months_remaining + 2)
    assert res.debt_free_month is not None and res.debt_free_month <= loan.tenure_months_remaining
    assert res.months[-1].balances_by_loan_index[0] == 0


# ── C5: cash held during a lock-in is paid in when it ends ──────────────────

def _locked_pl():
    return Loan(LoanType.PERSONAL, "Bajaj", D("500000"), D("0.16"), "fixed", 36,
                emi(D("500000"), D("0.16"), 36), prepay_lock_in_months=12, currency="INR")


def test_c5_lock_in_pot_is_paid_in_on_the_first_open_month():
    u = _user([_locked_pl()], income="100000", fixed="40000")
    res = simulate_plan(u, horizon_months=60)
    spare = res.months[0].available_surplus
    assert spare > 0
    # Months 1-12: saved for the loan, nothing counted as invested.
    assert all(r.invested_this_month == 0 for r in res.months[:12])
    assert abs(res.months[11].held_for_lock_in - 12 * spare) < R          # hand: 12 × spare
    # Month 13: the pot goes in on the first open month. Here it is more than
    # what's left (hand: 12 × spare > the balance after 12 EMIs), so the loan
    # clears in month 13; before the fix the pot was "invested" and the loan
    # ran on to the audit's m17.
    assert res.months[12].held_for_lock_in == 0
    assert res.months[11].held_for_lock_in > res.months[11].balances_by_loan_index[0]
    assert res.debt_free_month == 13


def test_c5_pot_released_as_savings_if_the_loan_never_opens():
    loan = _locked_pl()
    loan.prepay_lock_in_months = 400       # longer than the loan
    res = simulate_plan(_user([loan], income="100000", fixed="40000"), horizon_months=48)
    assert res.debt_free_month == 36
    assert res.total_invested > 0          # the held money stays the user's


# ── C11: gap borrowing has a limit ──────────────────────────────────────────

def test_c11_short_repro_is_capped_and_marked_infeasible():
    """Repro "short": income 50k, spend 45k, EMI 10,253 (₹5,253 short a
    month). It printed ₹1.27 crore of gap debt over 120 months; now gap
    borrowing stops at 3 months' take-home (₹1.5L) and the plan is marked
    infeasible from the month the limit is hit."""
    loan = Loan(LoanType.PERSONAL, "X", D("500000"), D("0.12"), "fixed", 60, D("10253"), currency="INR")
    res = simulate_plan(_user([loan], income="50000", fixed="45000"), horizon_months=120)
    assert res.gap_limit == D("150000")
    assert max(r.gap_debt for r in res.months) <= D("150000")
    assert res.months[0].shortfall == D("5253")
    # Hand: 5,253 a month at 3.75% × 1.18 = 4.425% a month passes 1.5L in
    # month 19 (Σ grows as 5,253 × ((1.04425)^k − 1)/0.04425).
    k = next(k for k in range(1, 60) if 5253 * ((1.04425 ** k) - 1) / 0.04425 > 150000)
    assert res.infeasible_from_month in (k, k + 1)
    assert res.unfunded_shortfall_total > 0


def test_c11_paise_gap_is_rounding_not_debt():
    """Repro "emi2": a 16-paise monthly gap used to become ₹1.28L of gap
    interest over 20 years."""
    loan = _home(outstanding=D("3000000"), scheduled_emi=D("26035.16"))
    res = simulate_plan(_user([loan], income="26035", fixed="0"), horizon_months=240)
    assert res.total_gap_interest == 0
    assert all(r.gap_debt == 0 for r in res.months)


@settings(max_examples=examples(25))
@given(short=st.integers(100, 50_000), limit=st.integers(0, 500_000), months=st.integers(6, 120))
def test_property_gap_borrowing_never_passes_its_limit(short, limit, months):
    loan = Loan(LoanType.PERSONAL, "X", D("2000000"), D("0.12"), "fixed", 240,
                emi(D("2000000"), D("0.12"), 240), currency="INR")
    income = D("60000")
    u = _user([loan], income=str(income), fixed=str(income - loan.scheduled_emi + short),
              gap_credit_limit=D(limit))
    res = simulate_plan(u, horizon_months=months)
    assert all(r.gap_debt <= D(limit) + R for r in res.months)
    if any(r.unfunded_shortfall > 0 for r in res.months):
        assert res.infeasible_from_month is not None


# ── C12: rates above 100% ───────────────────────────────────────────────────

def test_c12_instant_loan_above_100pct_tops_the_order():
    app = Loan(LoanType.PERSONAL, "InstaCash", D("20000"), D("1.2"), "fixed", 6,
               emi(D("20000"), D("1.2"), 6), currency="INR")
    card = Loan(LoanType.CREDIT_CARD, "SBI Card", D("50000"), D("0.42"), "fixed", 0, D("0"), currency="INR")
    res = simulate_plan(_user([card, app], income="100000", fixed="60000"), horizon_months=60)
    assert res.months[0].extra_to_loan_index == 1
    assert res.debt_free_month is not None


# ── C13: card minimum due ───────────────────────────────────────────────────

def test_c13_kotak_minimum_uses_interest_actually_charged():
    """Repro "minint": ₹1L at 42% + ₹20k spend, Kotak "5% + interest". The
    minimum was ₹10,956 (a full month on 1.2L). Hand: P = 6,000 +
    0.035 × 1.18 × (1,10,000 − P/3) → P = 10,543 / (1 + 0.0413/3) = ₹10,399.83."""
    card = Loan(LoanType.CREDIT_CARD, "Kotak Mahindra", D("100000"), D("0.42"), "fixed", 0, D("0"),
                expected_monthly_spend=D("20000"), currency="INR")
    res = baseline_minimums_only(_user([card]), horizon_months=1)
    want = D("10543") / (1 + D("0.0413") / 3)
    assert abs(res.months[0].payments_by_loan_index[0] - want) < D("0.2")
    assert abs(res.months[0].interest_paid_month - (want - D("6000"))) < D("0.2")


@settings(max_examples=examples(120))
@given(bal=st.integers(1_000, 2_000_000).map(D), bps=st.integers(100, 4800),
       spend=st.integers(0, 200_000).map(D),
       bank=st.sampled_from(["Kotak Mahindra", "SBI Card", "ICICI Bank", "HDFC Bank", "Axis Bank", "Other"]))
def test_property_card_minimum_covers_its_own_interest(bal, bps, spend, bank):
    from engine.formulas import monthly_interest_charge
    from engine.minimum_payments import compute_minimum_payment
    card = Loan(LoanType.CREDIT_CARD, bank, bal, D(bps) / 10000, "fixed", 0, D("0"),
                expected_monthly_spend=spend, currency="INR")
    res = baseline_minimums_only(_user([card]), horizon_months=1)
    paid = res.months[0].payments_by_loan_index.get(0, D("0"))
    charged = card_cycle_interest(card, Country.IN, bal, spend, paid)
    assert paid + R >= min(charged, bal + spend + charged)      # never negative amortisation
    scratch = deepcopy(card)
    scratch.outstanding = bal + spend
    old = compute_minimum_payment(scratch, Country.IN, interest_accrued=monthly_interest_charge(scratch, Country.IN))
    assert paid <= old + R                                       # never above the old full-month figure


# ── C15: flat-rate conversion uses the original tenure ──────────────────────

def test_c15_true_rate_is_solved_from_the_terms_not_the_months_left():
    """Repro "flat": 12% flat over 36 months is 21.20% reducing. Converting
    over the months left read 20.29% at 6 months left."""
    true = flat_to_reducing(D("0.12"), 36)
    assert abs(true - D("0.2120")) < D("0.0005")
    assert abs(flat_to_reducing(D("0.12"), 6) - D("0.2029")) < D("0.0005")   # the old reading
    # Balance, EMI and months left of that loan 30 months in imply 21.20%.
    p = D("100000")
    e = p * (1 + D("0.12") * 3) / 36
    bal = D(str(_float_balance(100000, float(true), float(e), 30)))
    assert abs(implied_reducing_rate(bal, e, 6) - true) < D("0.0005")


# ── C18: the fee-aware order doesn't flip on a rupee ────────────────────────

class _Res:
    def __init__(self, interest):
        self.total_interest_paid = D(interest)
        self.months = []


def _fee_user():
    a = Loan(LoanType.PERSONAL, "A", D("300000"), D("0.14"), "fixed", 36, D("10254"), currency="INR",
             prepayment_penalty_pct=D("0.04"))
    b = Loan(LoanType.PERSONAL, "B", D("200000"), D("0.13"), "fixed", 36, D("6739"), currency="INR")
    return _user([a, b])


def test_c18_tolerance_is_max_500_or_half_a_percent():
    u = _fee_user()
    assert order_tolerance(u, D("10000")) == D("500")
    assert order_tolerance(u, D("1000000")) == D("5000")


@pytest.mark.parametrize("fixed_cost,keeps_greedy", [("99999", True), ("99600", True), ("99000", False)])
def test_c18_order_changes_only_beyond_the_tolerance(fixed_cost, keeps_greedy):
    u = _fee_user()
    choice, _ = choose_order(u, D("0"), run_greedy=lambda: _Res("100000"),
                             run_fixed=lambda order: _Res(fixed_cost))
    assert (choice.order is None) == keeps_greedy
    if keeps_greedy and D("100000") - D(fixed_cost) > 1:
        assert choice.note and "within rounding" in choice.note
