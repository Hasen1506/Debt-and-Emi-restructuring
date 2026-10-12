"""US market rules (sprint G3; grill #33, #34, #79 and the SALT cap).

Each test names the rule and its primary source (see engine/us_loans.py)."""
from copy import deepcopy
from decimal import Decimal

import pytest

from engine import us_loans
from engine.decisions import prepay_block
from engine.marginal_cost import user_marginal_costs
from engine.models import Country, FilingStatusUS, IncomeType, Loan, LoanType, User
from engine.ordering import Strategy
from engine.simulation import simulate_plan
from engine.surplus import compute_total_minimums
from engine.tax import usa

D = Decimal


def _us_user(loans, **kw) -> User:
    base = dict(
        country=Country.US, income_type=IncomeType.SALARIED,
        annual_income=D("96000"), monthly_income=D("8000"),
        fixed_expenses=D("3000"), savings_balance=D("0"), primary_bank="JPMorgan Chase",
        filing_status=FilingStatusUS.SINGLE, loans=loans,
    )
    base.update(kw)
    return User(**base)


def _edu(**kw) -> Loan:
    base = dict(loan_type=LoanType.EDUCATION, bank="MOHELA", outstanding=D("40000"),
                nominal_rate=D("0.068"), rate_type="fixed", tenure_months_remaining=120,
                scheduled_emi=D("460"))
    base.update(kw)
    return Loan(**base)


def _auto(**kw) -> Loan:
    base = dict(loan_type=LoanType.AUTO, bank="Ally", outstanding=D("15000"),
                nominal_rate=D("0.05"), rate_type="fixed", tenure_months_remaining=48,
                scheduled_emi=D("345"))
    base.update(kw)
    return Loan(**base)


def _home(**kw) -> Loan:
    base = dict(loan_type=LoanType.HOME, bank="Wells Fargo", outstanding=D("285000"),
                nominal_rate=D("0.065"), rate_type="fixed", tenure_months_remaining=348,
                scheduled_emi=D("1896"), pmi_monthly=D("150"), original_home_value=D("300000"))
    base.update(kw)
    return Loan(**base)


def _extra_by_loan(res, idx, emi):
    return sum((max(D("0"), m.payments_by_loan_index.get(idx, D("0")) - emi) for m in res.months[:24]), D("0"))


# ── #33 federal student loans ───────────────────────────────────────────────

def test_pslf_loan_gets_no_extra_payment_and_the_extra_goes_elsewhere():
    """PSLF forgives the rest after 120 qualifying payments (studentaid.gov):
    extra on that loan only shrinks the forgiveness. The 6.8% PSLF loan would
    otherwise be first in avalanche order ahead of the 5% car loan."""
    user = _us_user([_edu(student_loan_kind="federal", forgiveness_track="pslf"), _auto()])
    res = simulate_plan(user, Strategy.AVALANCHE, horizon_months=60, marginal_rate=D("0.22"))
    assert _extra_by_loan(res, 0, D("460")) == 0
    assert _extra_by_loan(res, 1, D("345")) > 0


def test_federal_loan_without_a_forgiveness_track_is_prepaid_normally():
    user = _us_user([_edu(student_loan_kind="federal"), _auto()])
    res = simulate_plan(user, Strategy.AVALANCHE, horizon_months=60, marginal_rate=D("0.22"))
    assert _extra_by_loan(res, 0, D("460")) > 0


def test_idr_track_blocks_extra_and_says_why():
    l = _edu(forgiveness_track="idr")      # not marked: treated as federal
    why = prepay_block(l)
    assert why and "income-driven" in why
    assert us_loans.forgiveness_prepay_block(l) == why


def test_private_or_rupee_loan_ignores_a_forgiveness_track():
    """Only federal Direct Loans qualify for PSLF / IDR; a private or an
    Indian education loan can't be on such a track."""
    assert us_loans.forgiveness_prepay_block(_edu(student_loan_kind="private", forgiveness_track="pslf")) is None
    assert us_loans.forgiveness_prepay_block(_edu(currency="INR", forgiveness_track="pslf")) is None
    assert prepay_block(_edu(student_loan_kind="federal")) is None


def test_unmarked_us_student_loan_is_treated_as_federal_for_refinancing():
    assert us_loans.is_federal_or_unknown_student_loan(_edu(), Country.US)
    assert us_loans.is_federal_or_unknown_student_loan(_edu(student_loan_kind="federal"), Country.US)
    assert not us_loans.is_federal_or_unknown_student_loan(_edu(student_loan_kind="private"), Country.US)
    assert not us_loans.is_federal_or_unknown_student_loan(_edu(currency="INR"), Country.US)
    assert not us_loans.is_federal_or_unknown_student_loan(_edu(), Country.IN)


def test_scan_never_offers_a_private_refinance_of_a_federal_student_loan(monkeypatch):
    """CFPB: refinancing federal loans privately loses IDR, PSLF and other
    protections. Even when a private lender's rate is lower, the scan holds
    it back with that reason instead of recommending it."""
    from engine import restructuring_scan as rs
    real = rs._best_market_rate

    def fake(country, loan_type, *a, **k):
        if loan_type == LoanType.EDUCATION:
            return ("Some Private Lender", D("0.045"))
        return real(country, loan_type, *a, **k)

    monkeypatch.setattr(rs, "_best_market_rate", fake)
    user = _us_user([_edu(student_loan_kind="federal"), _auto()])
    result = rs.scan(user, marginal_rate=D("0.22"))
    assert not any(0 in o.affected_loan_indices for o in result.opportunities)
    held = [h for h in result.held_back if h.reason == "federal_protections"]
    assert held and held[0].affected_loan_indices == [0]
    assert "federal protections" in held[0].note and "Public Service Loan Forgiveness" in held[0].note

    # A loan the user marks private gets no such hold.
    user2 = _us_user([_edu(student_loan_kind="private"), _auto()])
    assert not [h for h in rs.scan(user2, marginal_rate=D("0.22")).held_back if h.reason == "federal_protections"]


def test_student_loan_explainer_states_the_2026_rules():
    lines = " ".join(us_loans.student_loan_explainer(_edu(forgiveness_track="idr")))
    assert "taxable" in lines and "1 January 2026" in lines
    lines = " ".join(us_loans.student_loan_explainer(_edu(student_loan_kind="federal", forgiveness_track="pslf")))
    assert "120 qualifying payments" in lines and "isn't taxed" in lines
    lines = " ".join(us_loans.student_loan_explainer(_edu(student_loan_kind="federal")))
    assert "RAP" in lines and "1 July 2026" in lines


# ── #34 PMI, FHA MIP, escrow ────────────────────────────────────────────────

def test_pmi_due_stops_at_80_percent_of_original_value():
    """HPA via CFPB: you can ask to cancel at 80% of original value."""
    assert us_loans.pmi_due(_home(outstanding=D("240001"))) == D("150")
    assert us_loans.pmi_due(_home(outstanding=D("240000"))) == 0
    # No original value: we can't tell, so it keeps running.
    assert us_loans.pmi_due(_home(original_home_value=None)) == D("150")


def test_fha_mip_ignores_ltv_and_counts_down_months():
    """HUD: FHA annual MIP runs 11 years or the loan term, not to 78/80%."""
    fha = _home(outstanding=D("200000"), mortgage_insurance_kind="fha_mip")
    assert us_loans.pmi_due(fha) == D("150")
    assert us_loans.pmi_due(_home(mortgage_insurance_kind="fha_mip", pmi_months_remaining=0)) == 0
    user = _us_user([_home(mortgage_insurance_kind="fha_mip", pmi_months_remaining=6)])
    res = simulate_plan(user, Strategy.AVALANCHE, horizon_months=24, marginal_rate=D("0.22"))
    assert res.pmi_end_months == {0: 6}


def test_pmi_is_a_monthly_cost_until_it_ends():
    with_pmi = _us_user([_home()])
    without = _us_user([_home(pmi_monthly=D("0"))])
    assert compute_total_minimums(with_pmi, with_pmi.loans) - compute_total_minimums(without, without.loans) == D("150")


def test_paying_extra_ends_pmi_sooner_than_the_schedule():
    """The plan's PMI drop is a lifecycle event; extra principal reaches 80%
    of original value (and the end of PMI) earlier than minimums only."""
    user = _us_user([_home()])
    plan = simulate_plan(user, Strategy.AVALANCHE, horizon_months=360, marginal_rate=D("0.22"))
    mins = simulate_plan(user, Strategy.AVALANCHE, horizon_months=360, marginal_rate=D("0.22"), minimums_only=True)
    a = us_loans.pmi_analysis(_home())
    assert mins.pmi_end_months[0] == a.months_to_request
    assert plan.pmi_end_months[0] < mins.pmi_end_months[0]
    # PMI saved shows up in the plan's surplus: none of the months after the
    # drop pay it.
    drop = plan.pmi_end_months[0]
    assert plan.months[drop].available_surplus > plan.months[drop - 2].available_surplus


def test_pmi_analysis_numbers():
    a = us_loans.pmi_analysis(_home())
    assert a.request_balance == D("240000.00")
    assert a.auto_balance == D("234000.00")
    assert a.extra_to_request_now == D("45000.00")
    assert a.months_to_request is not None and a.months_to_auto > a.months_to_request
    assert a.annual == D("1800")
    assert a.pmi_return_pct == (D("1800") / D("45000")).quantize(D("0.0001"))
    assert any("78%" in n for n in a.notes) and any("$109,000" in n for n in a.notes)
    fha = us_loans.pmi_analysis(_home(mortgage_insurance_kind="fha_mip"))
    assert fha.request_balance is None and "11 years" in fha.notes[0]
    assert us_loans.pmi_analysis(_home(pmi_monthly=D("0"))) is None
    assert "Escrow" in us_loans.ESCROW_NOTE


# ── #79 state treatment of mortgage interest ────────────────────────────────

@pytest.mark.parametrize("state,kind", [
    ("TX", "no_income_tax"), ("FL", "no_income_tax"), ("NH", "no_income_tax"), ("WA", "no_income_tax"),
    ("PA", "no_deduction"), ("ma", "no_deduction"), ("CA", "unverified"), (None, "unknown"),
])
def test_state_mortgage_treatment(state, kind):
    t = us_loans.state_mortgage_treatment(state)
    assert t.kind == kind
    assert t.modelled == (kind in ("no_income_tax", "no_deduction"))
    if t.modelled:
        assert t.source_url and t.source_url.startswith("https://")


def test_pa_mortgage_saves_only_federal_tax_in_the_payoff_order():
    """PA DOR: no itemised deductions, so a PA mortgage's interest saves only
    federal tax; the caller's marginal rate (federal + state) is cut back."""
    home = _home(pmi_monthly=D("0"))
    pa = _us_user([home], state="PA", state_marginal_rate=D("0.0307"), itemises=True)
    ca = _us_user([deepcopy(home)], state="CA", state_marginal_rate=D("0.0307"), itemises=True)
    mc_pa = user_marginal_costs(pa.loans, pa, D("0.2507"))[id(pa.loans[0])]
    mc_ca = user_marginal_costs(ca.loans, ca, D("0.2507"))[id(ca.loans[0])]
    assert mc_pa.tax_benefit < mc_ca.tax_benefit
    assert us_loans.us_mortgage_marginal_rate(D("0.2507"), "PA", D("0.0307")) == D("0.22")
    assert us_loans.us_mortgage_marginal_rate(D("0.2507"), "CA", D("0.0307")) == D("0.2507")


# ── SALT cap (IRC §164(b)(7), P.L. 119-21 §70120) ───────────────────────────

def test_salt_cap_schedule_by_year():
    assert usa.salt_cap_for_year(2025) == D("40000")
    assert usa.salt_cap_for_year(2026) == D("40400")
    assert usa.salt_cap_for_year(2027) == D("40804")
    assert usa.salt_cap_for_year(2029) == D("40400") * D("1.01") ** 3
    assert usa.salt_cap_for_year(2030) == D("10000")
    assert usa.salt_cap_for_year(2026, married_separately=True) == D("20200")


def test_salt_phasedown_and_floor():
    assert usa.salt_cap_for_year(2026, D("505000")) == D("40400")
    assert usa.salt_cap_for_year(2026, D("600000")) == D("11900")
    assert usa.salt_cap_for_year(2026, D("2000000")) == D("10000")
    assert usa.salt_cap_for_year(2026, D("2000000"), married_separately=True) == D("5000")
    # 2027 threshold is 101% of $505,000.
    assert usa.salt_cap_for_year(2027, D("510050")) == D("40804")
    assert usa.salt_cap_for_year(2030, D("2000000")) == D("10000")
    assert usa.salt_cap(D("600000")) == D("11900")


def test_forgiveness_track_on_an_indian_residents_loan_is_ignored():
    """A rupee-market loan (IN resident, no currency) can't be on PSLF/IDR."""
    l = _edu(forgiveness_track="pslf")
    assert us_loans.forgiveness_prepay_block(l, Country.IN) is None
    assert us_loans.forgiveness_prepay_block(l, Country.US) is not None
