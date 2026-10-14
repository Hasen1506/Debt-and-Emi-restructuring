"""Loan Check for the hike cycle (audit 80+ items A11, A19).

RBI raised the repo rate 25 bps to 5.50% on 7 Oct 2026 (MPC resolution,
https://www.rbi.org.in/Scripts/BS_PressReleaseDisplay.aspx?prid=63742, read
14 Oct 2026). These tests guard:

- a golden case for every Loan Check finding kind, with the new ones
  (rate_rise, choice_not_offered, asymmetric_pass_through, the MCLR switch
  saving) hand-checked against the closed-form EMI formula;
- the class invariant "no finding claims money when the rate path is
  consistent with the repo moves" (Hypothesis);
- EMI-or-tenure arithmetic invariants for any rise, cut or no move;
- the "EMI raised without the choice" letter: no money, no "you", the
  right rule per lender type.

The clock is frozen through `as_of`; nothing reads the network.
"""
from datetime import date
from decimal import Decimal

import pytest
from hypothesis import HealthCheck, given, settings
from hypothesis import strategies as st

from engine import policy_rates
from engine.complaints_in import NoResetChoiceIssue, reset_choice_letter, stray_you
from engine.lenders import LenderType
from engine.loan_check import (
    BankAction, Benchmark, ChoiceOffered, LoanCheckInput, LoanCheckInputError, SpreadChange,
    check_loan,
)
from engine.models import Country
from engine.rate_reset import pass_through, rate_move_impact, switch_saving

D = Decimal
TODAY = date(2026, 10, 14)


def emi_closed_form(p: float, annual: float, n: int) -> float:
    """Independent EMI: P r (1+r)^n / ((1+r)^n - 1), in floats."""
    r = annual / 12
    f = (1 + r) ** n
    return p * r * f / (f - 1)


def loan(**kw) -> LoanCheckInput:
    base = dict(
        loan_start=date(2023, 6, 1), start_rate=D("0.0915"), current_rate=D("0.0815"),
        outstanding=D("5000000"), tenure_months_remaining=240, as_of=TODAY,
        benchmark=Benchmark.REPO, spread_changed=SpreadChange.NO,
    )
    base.update(kw)
    return LoanCheckInput(**base)


def kinds(r) -> list[str]:
    return [f.kind for f in r.findings]


# ── the policy-rate table carries the 7 Oct 2026 rise ───────────────────────

def test_table_has_the_october_2026_rise():
    assert policy_rates.rate_on(Country.IN, date(2026, 10, 7)) == D("0.0550")
    assert policy_rates.rate_on(Country.IN, date(2026, 10, 6)) == D("0.0525")


# ── (a) EMI or tenure: golden, hand-checked ────────────────────────────────

def test_golden_rate_move_impact_50_lakh_7_90_to_8_15():
    im = rate_move_impact(D("5000000"), D("0.0790"), D("0.0815"), 240)
    # Hand check: closed form gives 41,511.0 and 42,289.6.
    assert round(emi_closed_form(5_000_000, 0.0790, 240)) == 41511
    assert round(emi_closed_form(5_000_000, 0.0815, 240)) == 42290
    assert im.emi_before == D("41511") and im.emi_after == D("42290")
    assert im.emi_change == D("779")
    # Same EMI at 8.15%: n = -ln(1 - P r / E) / ln(1 + r) = 251.2 → 252 payments.
    assert im.months_after == 252 and im.months_change == 12
    # Interest on the EMI option ≈ 42,290 × 240 − 50 L = 51.50 L.
    assert abs(im.interest_emi_option - (D("42290") * 240 - D("5000000"))) < 200
    assert im.tenure_premium == im.interest_tenure_option - im.interest_emi_option > 0
    assert im.prepay_to_keep_both == D("92057")


def test_rate_rise_finding_pending_before_the_reset_reaches_the_loan():
    # The audit's live case: SBI repo-linked, 9.15% in Jun 2023, now 7.90%,
    # i.e. the 7 Oct rise has not reached it yet.
    r = check_loan(loan(current_rate=D("0.0790"), lender="SBI"))
    assert r.claim_amount == 0 and r.status == "no_issue"
    assert r.rate_rise is not None and r.rate_rise.status == "pending"
    assert r.rate_rise.reach_by == date(2027, 1, 6)
    assert (r.rate_rise.impact.rate_before, r.rate_rise.impact.rate_after) == (D("0.0790"), D("0.0815"))
    f = next(f for f in r.findings if f.kind == "rate_rise")
    assert f.headline == "Rate up 0.25%: your new EMI or tenure, and the choice your bank must offer you"
    assert "₹41,511 to ₹42,290" in f.detail and "12 months longer" in f.detail
    assert not f.claimable and f.amount_this_year == 0
    assert "rise" in r.summary


def test_rate_rise_applied_when_rate_already_carries_it():
    r = check_loan(loan())                      # 8.15% = 9.15% + (5.50 − 6.50)
    assert r.verdict == "matches" and r.rate_rise.status == "applied"
    assert r.rate_rise.impact.rate_before == D("0.0790")


def test_no_rate_rise_for_a_loan_priced_after_the_rise():
    r = check_loan(loan(loan_start=date(2026, 11, 1), start_rate=D("0.0815"), as_of=date(2026, 12, 1)))
    assert r.rate_rise is None and "rate_rise" not in kinds(r)


def test_no_rate_rise_six_months_after():
    r = check_loan(loan(as_of=date(2027, 5, 1)))
    assert r.rate_rise is None


def test_tenure_option_impossible_when_emi_below_interest():
    im = rate_move_impact(D("5000000"), D("0.0790"), D("0.0815"), 240, emi=D("33000"))
    assert not im.tenure_option_possible and im.months_after is None
    assert im.emi_after > 0


def test_tenure_extended_applied_measures_from_the_old_end_date():
    r = check_loan(loan(tenure_months_remaining=252, bank_action=BankAction.TENURE_EXTENDED,
                        choice_offered=ChoiceOffered.NO))
    im = r.rate_rise.impact
    assert r.rate_rise.status == "applied"
    assert im.months_before < 252 and im.months_after == 252


# ── choice_not_offered + letter ────────────────────────────────────────────

def test_golden_choice_not_offered_and_letter():
    inp = loan(lender="SBI", bank_action=BankAction.EMI_RAISED, choice_offered=ChoiceOffered.NO)
    r = check_loan(inp)
    f = next(f for f in r.findings if f.kind == "choice_not_offered")
    assert f.headline == "SBI raised your EMI without offering you the choice"
    assert not f.claimable and r.claim_amount == 0
    L = reset_choice_letter(inp, r, "tenure")
    text = L.text()
    assert stray_you(text) is None
    assert L.claim_amount == 0 and L.kind == "reset_choice"
    assert "paragraph 349" in text and "negative amortisation" in text
    assert "keep the EMI unchanged and extend the tenure" in text
    assert "refund" not in text.lower()


@pytest.mark.parametrize("lt,rule,where", [
    (LenderType.HFC, "paragraph 176(3)", "National Housing Bank"),
    (LenderType.NBFC, "paragraph 31", "RBI Ombudsman"),
    (LenderType.REGIONAL_RURAL_BANK, "RBI/2023-24/55", "RBI Ombudsman"),
])
def test_letter_quotes_the_rule_for_the_lender_type(lt, rule, where):
    inp = loan(lender_type=lt, bank_action=BankAction.BOTH, choice_offered=ChoiceOffered.NO)
    r = check_loan(inp)
    assert "choice_not_offered" in kinds(r)
    text = reset_choice_letter(inp, r).text()
    assert rule in text and where in text and stray_you(text) is None


@pytest.mark.parametrize("action,offered", [
    (BankAction.EMI_RAISED, ChoiceOffered.YES),
    (BankAction.EMI_RAISED, ChoiceOffered.UNSURE),
    (BankAction.NONE_YET, ChoiceOffered.NO),
    (BankAction.UNKNOWN, ChoiceOffered.NO),
])
def test_no_choice_finding_without_both_answers(action, offered):
    inp = loan(bank_action=action, choice_offered=offered)
    r = check_loan(inp)
    assert "choice_not_offered" not in kinds(r)
    with pytest.raises(NoResetChoiceIssue):
        reset_choice_letter(inp, r)


# ── (b) MCLR → repo-linked switch ──────────────────────────────────────────

def test_golden_mclr_switch_saving_with_quoted_rate_and_cost():
    r = check_loan(loan(loan_start=date(2017, 4, 1), start_rate=D("0.0850"), current_rate=D("0.0925"),
                        benchmark=Benchmark.MCLR, outstanding=D("3000000"), tenure_months_remaining=180,
                        switch_rate=D("0.0815"), switch_cost=D("5000")))
    assert r.verdict == "old_benchmark" and r.claim_amount == 0
    sw = r.switch
    # Year one, hand check: interest at 9.25% vs 8.15% on a balance that
    # starts at 30 L and falls to about 28.7 L ≈ 1.10% × 29.4 L ≈ ₹32,300–₹33,800.
    assert D("32000") <= sw.interest_saved_12m <= D("34000")
    assert sw.net_saving_rest == sw.interest_saved_rest - D("5000") and sw.months_saved > 0
    f = r.findings[0]
    assert f.kind == "old_benchmark" and not f.claimable
    assert "future rises reach you sooner" in f.detail
    assert "rate_rise" in kinds(r)                       # if_passed_on for MCLR
    assert r.rate_rise.status == "if_passed_on"


def test_switch_saves_nothing_when_quote_is_not_lower():
    sw = switch_saving(D("3000000"), D("0.0815"), D("0.0850"), 180)
    assert sw.interest_saved_12m == 0 and sw.interest_saved_rest == 0 and sw.months_saved == 0


# ── (c) rises vs cuts ──────────────────────────────────────────────────────

def _follow(start: date, start_rate: D, lags: dict) -> list[tuple[date, D]]:
    """A rate history that follows every repo move after `start`, each
    `lags.get(decision, 1)` months later."""
    out, rate = [], start_rate
    for d, old, new in policy_rates.changes_between(Country.IN, start, TODAY):
        rate += new - old
        lag = lags.get(d, 1)
        m = date(d.year + (d.month - 1 + lag) // 12, (d.month - 1 + lag) % 12 + 1, 1)
        if m <= TODAY.replace(day=1):
            out.append((m, rate))
    return out


def test_golden_late_cuts_found():
    start = date(2022, 1, 1)
    # Every move followed a month later, except the 2025 cuts of Feb (0.25),
    # Apr (0.25) and Jun (0.50), all applied together in Sep 2025 (-1.00).
    hist = _follow(start, D("0.0700"), {date(2025, 2, 7): 7, date(2025, 4, 9): 5, date(2025, 6, 6): 3})
    hist = list(dict(hist).items())        # one entry per month: the rate after the last move
    r = check_loan(loan(loan_start=start, start_rate=D("0.0700"), current_rate=D("0.0850"),
                        outstanding=D("4000000"), rate_history=hist))
    pt = r.pass_through
    by = {m.decided: m for m in pt.moves}
    assert pt.asymmetric and pt.late_cuts == 2
    assert (by[date(2025, 2, 7)].lag_months, by[date(2025, 2, 7)].late_months) == (7, 4)
    assert (by[date(2025, 4, 9)].lag_months, by[date(2025, 4, 9)].late_months) == (5, 2)
    assert (by[date(2025, 6, 6)].lag_months, by[date(2025, 6, 6)].late_months) == (3, 0)
    # Hand check: ₹40 L × (0.25% × 4 + 0.25% × 2) ÷ 12 = ₹5,000.
    assert pt.late_cut_interest == D("5000")
    assert pt.avg_rise_lag == D("1.0") and pt.avg_cut_lag > pt.avg_rise_lag
    f = next(f for f in r.findings if f.kind == "asymmetric_pass_through")
    assert not f.claimable and f.overcharged_so_far == 0 and "₹5,000" in f.detail
    assert r.claim_amount == 0


def test_no_asymmetry_when_every_move_follows_within_the_window():
    start = date(2022, 1, 1)
    hist = _follow(start, D("0.0700"), {})
    r = check_loan(loan(loan_start=start, start_rate=D("0.0700"), current_rate=D("0.0800"),
                        outstanding=D("4000000"), rate_history=hist))
    assert not r.pass_through.asymmetric and "asymmetric_pass_through" not in kinds(r)


def test_rate_history_validation():
    with pytest.raises(LoanCheckInputError) as e:
        check_loan(loan(rate_history=[(date(2027, 1, 1), D("0.08"))]))
    assert e.value.field == "rate_history"
    with pytest.raises(LoanCheckInputError):
        check_loan(loan(rate_history=[(date(2024, 1, 1), D("8.5"))]))


# ── existing kinds still produced (golden smoke for every kind) ────────────

@pytest.mark.parametrize("kw,kind", [
    (dict(current_rate=D("0.0890")), "missed_rate_cut"),
    (dict(current_rate=D("0.0790"), lender="SBI"), "pricing_gap"),
    (dict(current_rate=D("0.0770")), "below_expected"),
    (dict(benchmark=Benchmark.MCLR), "old_benchmark"),
    (dict(lender_type=LenderType.HFC), "rule_not_binding"),
    (dict(current_rate=D("0.0790")), "rate_rise"),
    (dict(bank_action=BankAction.EMI_RAISED, choice_offered=ChoiceOffered.NO), "choice_not_offered"),
])
def test_every_finding_kind_has_a_case(kw, kind):
    r = check_loan(loan(**kw))
    assert kind in kinds(r)
    # Only a missed cut is ever claimable.
    assert all(f.claimable == (f.kind == "missed_rate_cut") for f in r.findings)


# ── property: a consistent rate path claims no money ───────────────────────

_starts = st.dates(min_value=date(2019, 10, 1), max_value=date(2026, 9, 1)).map(lambda d: d.replace(day=1))


@settings(max_examples=150, deadline=None, suppress_health_check=[HealthCheck.too_slow])
@given(
    start=_starts,
    spread=st.integers(min_value=150, max_value=450).map(lambda b: D(b) / 10000),
    outstanding=st.integers(min_value=200_000, max_value=50_000_000).map(D),
    months=st.integers(min_value=12, max_value=360),
    lt=st.sampled_from([LenderType.COMMERCIAL_BANK, LenderType.SMALL_FINANCE_BANK, LenderType.HFC]),
    action=st.sampled_from(list(BankAction)),
    offered=st.sampled_from(list(ChoiceOffered)),
    with_history=st.booleans(),
)
def test_consistent_rate_path_never_claims_money(start, spread, outstanding, months, lt, action,
                                                 offered, with_history):
    """The loan's rate is its starting spread over the repo rate, moved
    one-for-one with every repo change: whatever else is answered, nothing
    is claimable, the claim is ₹0, and no rises-vs-cuts finding appears."""
    repo_start = min(policy_rates.rates_between(
        Country.IN, date(start.year - (1 if start.month <= 2 else 0), (start.month - 3) % 12 + 1, 1), start))
    start_rate = repo_start + spread
    window_from = date(TODAY.year, TODAY.month - 3, 1)
    current = start_rate + (max(policy_rates.rates_between(Country.IN, window_from, TODAY)) - repo_start)
    hist = _follow(start, start_rate, {}) if with_history else []
    r = check_loan(loan(
        loan_start=start, start_rate=start_rate, current_rate=current, outstanding=outstanding,
        tenure_months_remaining=months, lender_type=lt, bank_action=action, choice_offered=offered,
        rate_history=hist,
    ))
    assert r.claim_amount == 0 and r.amount_at_stake_this_year == 0
    assert not any(f.claimable for f in r.findings)
    assert all(f.overcharged_so_far == 0 for f in r.findings)
    assert "asymmetric_pass_through" not in kinds(r)


@settings(max_examples=200, deadline=None)
@given(
    outstanding=st.integers(min_value=100_000, max_value=50_000_000).map(D),
    rate=st.integers(min_value=600, max_value=1400).map(lambda b: D(b) / 10000),
    move=st.integers(min_value=-100, max_value=100).map(lambda b: D(b) / 10000),
    months=st.integers(min_value=12, max_value=360),
)
def test_rate_move_impact_signs(outstanding, rate, move, months):
    im = rate_move_impact(outstanding, rate, rate + move, months)
    if move > 0:
        assert im.emi_change >= 0 and im.interest_emi_option >= im.interest_before
        if im.tenure_option_possible:
            assert im.months_change >= 0 and im.tenure_premium >= -1
    elif move < 0:
        assert im.emi_change <= 0 and im.prepay_to_keep_both == 0
        assert im.tenure_option_possible and im.months_change <= 0
    else:
        assert im.emi_change == 0 and im.months_change == 0 and im.prepay_to_keep_both == 0


def test_pass_through_matches_one_loan_change_to_several_rises():
    # 2022: rises of 0.40 (May) and 0.50 (Jun) passed on together in Jul.
    changes = [c for c in policy_rates.changes_between(Country.IN, date(2022, 1, 1), date(2022, 7, 31))]
    pt = pass_through(date(2022, 1, 1), D("0.0700"), [(date(2022, 7, 1), D("0.0790"))], changes,
                      date(2022, 8, 1), D("1000000"))
    assert [m.reached for m in pt.moves] == [date(2022, 7, 1), date(2022, 7, 1)]
    assert pt.late_cuts == 0 and not pt.asymmetric
