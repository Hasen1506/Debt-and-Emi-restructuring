"""Audit 80 W10: NRI accuracy (E5), residency transitions, NRO TDS.

Golden cases are worked by hand in the docstrings; invariants guard the
class (a cost can only lower a return; a slide can only lower it; the line
never tells the user what to do).
"""
import json
from decimal import Decimal

import pytest
from hypothesis import given, settings, strategies as st

from engine import cross_border as cb
from engine.models import LifecycleEventKind

D = Decimal


# ── E5: prepaying from dollars, after the slide and the transfer cost ───────

def test_golden_audit_nri_persona_line():
    """Audit E5 persona: SBI home loan 8.5%, ~15 years left, USD earner.
    Hand check, 15 years, c = 2.45%, drift -3.5%:
      (1 - 0.0245)^(1/15) = 0.998348...
      0.998348 x 1.085 x 0.965 - 1 = 0.045295 -> 4.53%
    vs a US savings account at 3.50% (market-data.json, 9 Oct 2026),
    taxed at 22% -> 2.73%."""
    c = cb.nri_prepay_comparison(loan_rate=D("0.085"), remaining_months=180, marginal_tax=D("0.22"))
    assert c.years == 15
    assert c.drift == D("-0.035") and c.remittance_cost == D("0.0245")
    assert c.prepay_return == D("0.0453")
    assert c.alternative_after_tax == D("0.0273")
    assert c.line == ("Prepaying earns about 4.5% a year in USD terms after 3.5% a year rupee slide "
                      "and a 2.45% transfer cost; a US high-yield savings account pays 2.7% after tax.")
    # The plan used to say "saves 8.84% a year" for this loan: the honest
    # figure in dollars is little more than half of that.
    assert c.prepay_return < D("0.0884") * D("0.55")


def test_funds_already_in_india_have_no_slide_and_no_transfer_cost():
    c = cb.nri_prepay_comparison(loan_rate=D("0.085"), remaining_months=180, funds_in_india=True,
                                 nre_fd_rate=D("0.065"))
    assert c.drift == 0 and c.remittance_cost == 0
    assert c.prepay_return == D("0.0850")
    assert "NRE" in c.line and any("US tax resident" in x for x in c.caveats)


@settings(max_examples=200, deadline=None)
@given(
    r=st.decimals("0.01", "0.30", places=4),
    d=st.decimals("-0.10", "0.05", places=4),
    c=st.decimals("0", "0.10", places=4),
    years=st.integers(1, 30),
)
def test_costs_and_slide_only_lower_the_return(r, d, c, years):
    base = cb.prepay_return_in_user_currency(r, D("0"), D("0"), years)
    with_cost = cb.prepay_return_in_user_currency(r, D("0"), c, years)
    with_both = cb.prepay_return_in_user_currency(r, d, c, years)
    assert with_cost <= base
    if d <= 0:
        assert with_both <= with_cost
    # A one-time cost weighs less the longer it is spread.
    if years < 30:
        assert cb.prepay_return_in_user_currency(r, d, c, years) <= cb.prepay_return_in_user_currency(r, d, c, years + 1)


@pytest.mark.parametrize("months", [1, 12, 13, 180, 360])
def test_line_states_numbers_and_never_an_instruction(months):
    line = cb.nri_prepay_comparison(loan_rate=D("0.09"), remaining_months=months).line.lower()
    for word in ("you should", "we recommend", "better to", "don't prepay", "do prepay"):
        assert word not in line


def test_cross_border_verdict_now_counts_the_transfer_cost():
    """A 1.5-point edge before the cost is under a point after a 5% cost on
    a 3-year horizon, so the verdict softens from prepay to marginal."""
    base = dict(loan_balance=D("3500000"), loan_nominal_rate=D("0.085"), loan_tenure_months=36,
                fx_rate=D("0.0105"), user_savings_yield=D("0.05"), user_marginal_tax=D("0.24"),
                expected_fx_drift_annual=D("-0.03"), inflation_user_country=D("0.025"))
    free = cb.evaluate_cross_border(cb.CrossBorderInputs(**base))
    paid = cb.evaluate_cross_border(cb.CrossBorderInputs(**base, remittance_cost_pct=D("0.05")))
    assert free.verdict == "prepay"
    assert paid.prepay_return_after_remittance < free.prepay_return_after_remittance
    assert paid.verdict in ("marginal", "invest")
    assert "cost to send the money" in paid.rationale


def test_fixture_is_current():
    from scripts.export_a80_w10_cases import OUT_PATH, build
    assert json.loads(OUT_PATH.read_text()) == json.loads(json.dumps(build(), ensure_ascii=False)), \
        "run: python scripts/export_a80_w10_cases.py"


# ── NRO interest TDS and the treaty rate ────────────────────────────────────

def test_nro_tds_and_us_treaty_rate():
    rate, note = cb.nro_interest_tds_rate("US", treaty_papers_filed=False)
    assert rate == D("0.30") and "15%" in note
    rate, note = cb.nro_interest_tds_rate("us", treaty_papers_filed=True)
    assert rate == D("0.15") and "Form 10F" in note
    rate, note = cb.nro_interest_tds_rate("AE", treaty_papers_filed=True)
    assert rate == D("0.30") and "check your country's treaty" in note


# ── Residency (Income-tax Act 2025 s.6) ─────────────────────────────────────

@pytest.mark.parametrize("kw,status", [
    # 182 days: resident, whatever else.
    (dict(days_in_india=182, days_in_prev_4_years=0), "resident"),
    # 60-day rule with 365 days in the four years before.
    (dict(days_in_india=60, days_in_prev_4_years=365), "resident"),
    (dict(days_in_india=59, days_in_prev_4_years=1000), "non_resident"),
    # A citizen leaving for a job abroad is tested on 182 days only.
    (dict(days_in_india=150, days_in_prev_4_years=1400, left_for_job_abroad_this_year=True), "non_resident"),
    # A visiting NRI with Indian income up to ₹15 lakh: 182 days only.
    (dict(days_in_india=150, days_in_prev_4_years=1400, lives_abroad_and_visiting=True,
          indian_income=D("1500000")), "non_resident"),
    # ... over ₹15 lakh: 120 days + 365 → resident but not ordinarily resident.
    (dict(days_in_india=120, days_in_prev_4_years=400, lives_abroad_and_visiting=True,
          indian_income=D("1500001")), "rnor"),
    (dict(days_in_india=119, days_in_prev_4_years=400, lives_abroad_and_visiting=True,
          indian_income=D("2000000")), "non_resident"),
    # Deemed resident: citizen, over ₹15 lakh, taxed nowhere else.
    (dict(days_in_india=10, indian_income=D("2000000"), liable_to_tax_elsewhere=False), "rnor"),
    # Returning NRI, first year back: resident, but NOR (9 of 10 years non-resident).
    (dict(days_in_india=200, nr_years_in_prev_10=9), "rnor"),
    (dict(days_in_india=200, nr_years_in_prev_10=3, days_in_prev_7_years=2000), "resident"),
])
def test_residency_rules(kw, status):
    assert cb.india_tax_residency(**kw).status == status


def test_transition_notes_carry_primary_sources():
    for direction in ("india_to_nri", "nri_to_india"):
        notes = cb.residency_transition_notes(direction)
        assert notes
        for n in notes:
            assert n.source.startswith("https://")
            assert any(host in n.source for host in ("rbi.org.in", "indiacode", "worldbank.org"))
    out = " ".join(n.text for n in cb.residency_transition_notes("india_to_nri"))
    assert "NRO" in out and "original end date" in out
    back = " ".join(n.text for n in cb.residency_transition_notes("nri_to_india"))
    assert "RFC" in back and "FCNR(B)" in back
    with pytest.raises(ValueError):
        cb.residency_transition_notes("sideways")


def test_residency_move_becomes_a_salary_reset_in_the_plan_currency():
    ev = cb.residency_move_event(effective_month=7, new_monthly_take_home=D("6000"),
                                 new_take_home_currency="USD", plan_currency="INR",
                                 fx_plan_per_new=D("95.17"))
    assert ev.kind == LifecycleEventKind.SALARY_RESET and ev.effective_month == 7
    assert ev.new_monthly_take_home == D("571020.00")
    with pytest.raises(ValueError):
        cb.residency_move_event(effective_month=7, new_monthly_take_home=D("6000"),
                                new_take_home_currency="USD", plan_currency="INR")
    same = cb.residency_move_event(effective_month=1, new_monthly_take_home=D("90000"),
                                   new_take_home_currency="inr", plan_currency="INR")
    assert same.new_monthly_take_home == D("90000")
