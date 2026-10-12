"""India tax, sprint G2: loan deductions and old vs new with loans counted.

Every expected figure is worked by hand from the Income-tax Act, 2025 as
amended by the Finance Act, 2026 (docs/TAX_INDIA.md quotes the clauses).
"""
from __future__ import annotations

import importlib.util
from decimal import Decimal
from pathlib import Path

from engine.formulas import effective_rate, tax_shield_fraction
from engine.marginal_cost import marginal_shield, user_marginal_costs
from engine.models import Country, IncomeType, Loan, LoanType, TaxRegimeIN, User
from engine.tax import india
from engine.tax.india import HomeLoanYear, RegimeInputs, compare_regimes

D = Decimal
ROOT = Path(__file__).resolve().parents[2]


def _home(outstanding="3000000", rate="0.09", **kw) -> Loan:
    return Loan(loan_type=LoanType.HOME, bank="HDFC", outstanding=D(outstanding), nominal_rate=D(rate),
                rate_type="floating", tenure_months_remaining=240, scheduled_emi=D("27000"), **kw)


def _edu(**kw) -> Loan:
    return Loan(loan_type=LoanType.EDUCATION, bank="SBI", outstanding=D("800000"), nominal_rate=D("0.10"),
                rate_type="floating", tenure_months_remaining=84, scheduled_emi=D("13000"), **kw)


def _user(loans, regime=TaxRegimeIN.OLD) -> User:
    return User(country=Country.IN, income_type=IncomeType.SALARIED, annual_income=D("2400000"),
                monthly_income=D("150000"), fixed_expenses=D("40000"), savings_balance=D("0"),
                primary_bank="HDFC", tax_regime=regime, loans=loans)


# ── section numbers ─────────────────────────────────────────────────────────

def test_section_map_has_the_2025_numbers():
    assert india.SECTION_MAP["80C"].startswith("123")
    assert india.SECTION_MAP["80E"] == "129"
    assert india.SECTION_MAP["115BAC"] == "202"
    assert india.SECTION_MAP["87A"] == "156"
    assert india.SECTION_MAP["24(b)"].startswith("22(1)(b)")
    assert india.section_label("80E") == "s.80E (Income-tax Act 2025: s.129)"


# ── #31: 80E window ─────────────────────────────────────────────────────────

def test_80e_window_is_the_initial_tax_year_and_seven_more():
    # First interest Jul 2020 → initial tax year 2020-21; window ends 31 Mar 2028.
    assert india.sec80e_months_left(2020, 7, 2026, 10) == 18
    # First interest Feb 2020 → initial tax year 2019-20; ended 31 Mar 2027.
    assert india.sec80e_months_left(2020, 2, 2026, 10) == 6
    assert india.sec80e_months_left(2015, 5, 2026, 10) == 0


def test_education_loan_in_year_9_gets_no_shield():
    m = D("0.312")
    assert tax_shield_fraction(_edu(), m, Country.IN, TaxRegimeIN.OLD) == m
    assert tax_shield_fraction(_edu(tax_deduction_months_left=0), m, Country.IN, TaxRegimeIN.OLD) == 0
    # Its effective rate is the plain rate once the window has closed.
    assert effective_rate(_edu(tax_deduction_months_left=0), m, Country.IN, TaxRegimeIN.OLD) == D("0.10")


def test_80e_window_closes_inside_the_simulation():
    u = _user([_edu(tax_deduction_months_left=6)])
    m = D("0.312")
    assert user_marginal_costs(u.loans, u, m, month=6)[id(u.loans[0])].tax_benefit > 0
    assert user_marginal_costs(u.loans, u, m, month=7)[id(u.loans[0])].tax_benefit == 0


# ── #7: co-borrower share ───────────────────────────────────────────────────

def test_co_borrower_half_share_halves_the_shield_and_the_cap_room():
    m = D("0.312")
    # ₹30L at 9% = ₹2.7L interest. Whole loan: ₹2L of ₹2.7L shielded.
    whole = tax_shield_fraction(_home(), m, Country.IN, TaxRegimeIN.OLD)
    assert whole == (D("200000") / D("270000")) * m
    # Half: the user's ₹1.35L is all under their own ₹2L, on half the interest.
    half = tax_shield_fraction(_home(tax_share=D("0.5")), m, Country.IN, TaxRegimeIN.OLD)
    assert half == D("0.5") * m


def test_co_borrower_share_at_the_margin():
    m = D("0.312")
    assert marginal_shield("home_loan", "IN", m, "old", interest_total=D("135000"), share=D("0.5")) == D("0.156")
    # Over the cap: the next rupee gives nothing.
    assert marginal_shield("home_loan", "IN", m, "old", interest_total=D("210000"), share=D("0.5")) == 0


# ── #31: let-out, ₹30k, pre-construction ────────────────────────────────────

def test_let_out_with_rent_shields_in_the_new_regime_too():
    m = D("0.208")
    # ₹2.7L interest, ₹3L rent: 70% = ₹2.1L of room in the new regime.
    lo = _home(property_use="let_out", annual_rent=D("300000"))
    assert tax_shield_fraction(lo, m, Country.IN, TaxRegimeIN.NEW) == (D("210000") / D("270000")) * m
    # Old regime adds the ₹2L set-off: room ₹4.1L ≥ ₹2.7L, all of it.
    assert tax_shield_fraction(lo, m, Country.IN, TaxRegimeIN.OLD) == m
    # No rent known: only the set-off (old), nothing (new). "Simplified".
    bare = _home(property_use="let_out")
    assert tax_shield_fraction(bare, m, Country.IN, TaxRegimeIN.NEW) == 0
    assert tax_shield_fraction(bare, m, Country.IN, TaxRegimeIN.OLD) == (D("200000") / D("270000")) * m


def test_late_construction_cap_is_30k():
    m = D("0.312")
    late = _home(outstanding="1000000", sec24_full_cap=False)       # ₹90k interest
    assert tax_shield_fraction(late, m, Country.IN, TaxRegimeIN.OLD) == (D("30000") / D("90000")) * m
    assert marginal_shield("home_loan", "IN", m, "old", interest_total=D("90000"), cap=D("30000")) == 0


def test_pre_construction_instalment_uses_up_the_2L():
    assert india.pre_construction_instalment(D("500000")) == D("100000")
    m = D("0.312")
    # ₹15L at 9% = ₹1.35L interest + ₹1L instalment = ₹2.35L against ₹2L.
    l = _home(outstanding="1500000", pre_construction_interest_annual=D("100000"))
    assert tax_shield_fraction(l, m, Country.IN, TaxRegimeIN.OLD) == (D("200000") / D("235000")) * m
    u = _user([l])
    assert user_marginal_costs(u.loans, u, m)[id(l)].tax_benefit == 0


def test_new_regime_self_occupied_still_zero():
    assert tax_shield_fraction(_home(), D("0.312"), Country.IN, TaxRegimeIN.NEW) == 0


def test_80c_room():
    assert india.sec80c_room(D("100000"), D("30000")) == D("20000")
    assert india.sec80c_room(D("150000"), D("80000")) == 0


# ── #32: old vs new with the loans ──────────────────────────────────────────

def test_regime_comparison_by_hand():
    """₹18L salary, ₹1L other 80C, a home loan with ₹3.5L interest and ₹1.2L principal.

    Old: 18L − 50k = 17.5L; house property −2L (cap); 80C min(1.5L, 1L + 1.2L) = 1.5L
         → taxable 14L: 12,500 + 1,00,000 + 1,20,000 = 2,32,500 × 1.04 = 2,41,800.
    New: 18L − 75k = 17.25L: 20k + 40k + 60k + 25k = 1,45,000 × 1.04 = 1,50,800.
    """
    r = compare_regimes(RegimeInputs(salary=D("1800000"), sec80c_other=D("100000"),
                                     home_loans=[HomeLoanYear(interest=D("350000"), principal=D("120000"))]))
    assert r.old.taxable == D("1400000") and r.old.tax == D("241800")
    assert r.new.taxable == D("1725000") and r.new.tax == D("150800")
    assert r.better == "new" and r.old_saves == D("-91000")
    # The loans take ₹2L (interest) + ₹50k (the principal's 80C room) off old-regime income.
    assert r.old.loan_deductions == D("250000")
    assert r.switch_rule == "yearly"
    assert r.extra_deductions_for_old_to_win is not None


def test_old_regime_wins_with_a_big_home_loan_and_full_deductions():
    r = compare_regimes(RegimeInputs(salary=D("1500000"), hra_exemption=D("240000"), sec80c_other=D("150000"),
                                     sec80d=D("25000"), sec80ccd1b=D("50000"),
                                     home_loans=[HomeLoanYear(interest=D("300000"), principal=D("90000"))]))
    assert r.better == "old"
    assert r.old.tax < r.new.tax


def test_business_income_gets_the_once_only_switch_rule():
    r = compare_regimes(RegimeInputs(salary=D("600000"), business_income=D("900000")))
    assert r.switch_rule == "business_once"


def test_co_owners_each_have_their_own_2L():
    # Two co-owners, 50% each, ₹5L interest: each claims ₹2L of their ₹2.5L.
    r = compare_regimes(RegimeInputs(salary=D("2000000"),
                                     home_loans=[HomeLoanYear(interest=D("500000"), share=D("0.5"))]))
    assert r.old.house_property == D("-200000")


def test_let_out_loss_in_new_regime_does_not_reduce_salary():
    r = compare_regimes(RegimeInputs(salary=D("2000000"), home_loans=[
        HomeLoanYear(interest=D("400000"), let_out=True, annual_rent=D("200000"))]))
    # Rent 2L × 70% = 1.4L − 4L interest = −2.6L: old sets off 2L, new none.
    assert r.old.house_property == D("-200000")
    assert r.new.house_property == 0


def test_senior_old_regime_tables():
    # ₹6L taxable, aged 60-79: (5L−3L)×5% = 10,000 + 1L×20% = 20,000 → 30,000 × 1.04.
    assert india.income_tax_for_age(D("600000"), TaxRegimeIN.OLD, "60_79") == D("31200")
    # 80+: (6L−5L)×20% = 20,000 × 1.04.
    assert india.income_tax_for_age(D("600000"), TaxRegimeIN.OLD, "80_plus") == D("20800")
    # Within ₹5L the s.156(1) rebate still clears it.
    assert india.income_tax_for_age(D("450000"), TaxRegimeIN.OLD, "60_79") == 0


def test_regime_fixture_is_current():
    spec = importlib.util.spec_from_file_location("exp", ROOT / "scripts" / "export_regime_cases.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    assert (ROOT / "engine/tests/fixtures/regime_compare_cases.json").read_text(encoding="utf-8") == mod.render(), (
        "engine/tests/fixtures/regime_compare_cases.json is stale: run python scripts/export_regime_cases.py"
    )


def test_api_carries_the_tax_fields():
    from api.schemas import LoanIn
    l = LoanIn(loan_type="home_loan", bank="HDFC", outstanding="3000000", nominal_rate="0.09",
               tenure_months_remaining=240, scheduled_emi="27000", tax_share="0.5",
               property_use="let_out", annual_rent="300000", pre_construction_interest_annual="10000",
               sec24_full_cap=False).to_engine()
    assert l.tax_share == D("0.5") and l.annual_rent == D("300000")
    assert l.pre_construction_interest_annual == D("10000") and l.sec24_full_cap is False
    e = LoanIn(loan_type="education_loan", bank="SBI", outstanding="800000", nominal_rate="0.1",
               tenure_months_remaining=84, scheduled_emi="13000", tax_deduction_months_left=0).to_engine()
    assert e.tax_deduction_months_left == 0


def test_79_hike_phases_stay_wired_through_the_api():
    """#79 (founder: hike phases are needed): the phases reach the engine and
    each year's hike uses its phase, falling back to the scalar rate."""
    from api.schemas import UserIn
    from engine.simulation import _resolve_hike_rate
    u = UserIn(country="IN", income_type="salaried", annual_income="1800000", monthly_income="120000",
               fixed_expenses="40000", savings_balance="0", primary_bank="HDFC", annual_hike_rate="0.05",
               hike_schedule=[[1, 3, "0.12"], [3, 6, "0.08"]]).to_engine()
    assert [_resolve_hike_rate(u, y) for y in (1, 2, 3, 5, 6)] == [D("0.12"), D("0.12"), D("0.08"), D("0.08"), D("0.05")]
