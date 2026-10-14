"""Audit 80 W10 — persona scenario suite (engine level).

Nine people the audit and the founder's notes name, run end to end through
the simulator (and the W10 income / NRI modules). Each persona pins a few
golden figures with a hand check and the invariants that must hold for
anyone like them. Known gaps are strict expected-failures that name the
workstream that owns the fix: when that fix merges, the test XPASSes, the
strict marker turns it red, and the marker must be removed (so a gap can't
silently stay open or silently close).

Personas: Chennai card revolver · Bengaluru salaried · NRI (US) · US ·
P-short · P-ok (audit A) · no loans · business owner (seasonal) ·
India → NRI mover.
"""
from decimal import Decimal
from pathlib import Path

import pytest

from engine import cross_border as cb
from engine.income_scenarios import (
    IncomeScenario, SeasonalIncome, build_income_path, income_shape, simulate_with_income,
)
from engine.models import (
    Country, FilingStatusUS, IncomeType, LifecycleEvent, LifecycleEventKind, Loan, LoanType,
    TaxRegimeIN, User,
)
from engine.simulation import Strategy, simulate_plan
from engine.surplus import compute_total_minimums

D = Decimal
REPO = Path(__file__).resolve().parents[2]


def _user(take_home, spend, loans, country=Country.IN, **kw):
    kw.setdefault("savings_balance", D("0"))
    income_type = kw.pop("income_type", IncomeType.SALARIED)
    return User(country=country, income_type=income_type, annual_income=D(take_home) * 12,
                monthly_income=D(take_home), fixed_expenses=D(spend), primary_bank="x",
                loans=loans, **kw)


def card(bank, bal, rate):
    return Loan(LoanType.CREDIT_CARD, bank, D(bal), D(rate), "fixed", 0, D("0"))


# ── 1. Chennai card revolver ────────────────────────────────────────────────

def chennai():
    return _user("45000", "25000", [card("SBI Card", "120000", "0.42"),
                                    card("HDFC Bank", "60000", "0.36")])


def test_chennai_card_revolver():
    """Two cards, ₹20,000 a month spare. Card interest carries 18% GST:
    month 1 pre-GST interest would be 1,20,000×3.5% + 60,000×3% = ₹6,000;
    the engine charges ₹6,810.57 (average-daily-balance interest + GST),
    i.e. more than ₹6,000 and less than ₹6,000 × 1.18 = ₹7,080."""
    r = simulate_plan(chennai(), Strategy.AVALANCHE, horizon_months=120)
    m1 = r.months[0]
    assert D("6000") < m1.interest_paid_month < D("7080")
    assert m1.extra_to_loan_index == 0            # the 42% card first
    assert m1.shortfall == 0
    assert r.debt_free_month == 12                # golden (regression pin)
    snow = simulate_plan(chennai(), Strategy.SNOWBALL, horizon_months=120)
    assert snow.total_interest_paid >= r.total_interest_paid


@pytest.mark.xfail(strict=True, raises=ImportError,
                   reason="W3 owns A6: engine/consolidation.py ('cheaper way to carry this' card) "
                          "is on hark/a80-w03-product, not merged here")
def test_chennai_gets_a_consolidation_finding():
    from engine import consolidation  # noqa: F401


# ── 2. Bengaluru salaried (home + car) ──────────────────────────────────────

def bengaluru():
    return _user("160000", "70000", [
        Loan(LoanType.HOME, "HDFC Bank", D("6000000"), D("0.085"), "floating", 240, D("52069")),
        Loan(LoanType.AUTO, "ICICI Bank", D("800000"), D("0.095"), "fixed", 60, D("16801")),
    ], tax_regime=TaxRegimeIN.NEW)


def test_bengaluru_salaried():
    """New regime, no 24(b) shield: the 9.5% car outranks the 8.5% home
    loan, and with ₹21,130 spare a month the plan ends well inside the
    home loan's 240 months."""
    r = simulate_plan(bengaluru(), Strategy.AVALANCHE, horizon_months=300)
    assert r.months[0].extra_to_loan_index == 1
    assert r.debt_free_month is not None and r.debt_free_month < 240
    assert r.debt_free_month == 109               # golden (regression pin)


@pytest.mark.xfail(strict=True,
                   reason="W1 owns C1: tenure-first on a rate rise is on hark/a80-w01-engine; "
                          "today the EMI jumps to ₹46,497.78")
def test_bengaluru_rate_rise_keeps_emi_by_default():
    """Audit C1 repro: ₹50 L, 8.5%, 240 m, EMI ₹43,391.16; rate to 9.5% in
    month 13. Hand check of today's (wrong) behaviour: emi(bal₁₂, 9.5%,
    228) = ₹46,497.78. The founder chose tenure-first for Indian loans."""
    u = _user("200000", "50000", [
        Loan(LoanType.HOME, "SBI", D("5000000"), D("0.085"), "floating", 240, D("43391.16"))])
    ev = [LifecycleEvent(LifecycleEventKind.FLOATING_RATE_RESET, 13, loan_index=0, new_rate=D("0.095"))]
    r = simulate_plan(u, Strategy.AVALANCHE, horizon_months=30, lifecycle_events=ev, minimums_only=True)
    assert abs(r.months[13].payments_by_loan_index[0] - D("43391.16")) < D("1")


@pytest.mark.xfail(strict=True, raises=ImportError,
                   reason="W3 owns A4: engine/prepay_invest.py (prepay / keep / split) is on "
                          "hark/a80-w03-product, not merged here")
def test_bengaluru_gets_prepay_or_keep_split_once_only_cheap_debt_left():
    from engine import prepay_invest  # noqa: F401


# ── 3. NRI in the US with an Indian home loan ──────────────────────────────

def nri(drift=None):
    loans = [Loan(LoanType.HOME, "SBI", D("4000000"), D("0.085"), "floating", 180, D("39390"),
                  currency="INR"),
             Loan(LoanType.AUTO, "Ally", D("22000"), D("0.075"), "fixed", 48, D("532"))]
    kw = {"fx_drift_annualized": {"INR": D(drift)}} if drift else {}
    return _user("9000", "4500", loans, country=Country.US, is_nri_us=True,
                 fx_to_user_currency={"INR": D("0.0105")}, filing_status=FilingStatusUS.SINGLE, **kw)


def test_nri_plan_counts_rupees_in_dollars():
    """₹40,00,000 × 0.0105 = $42,000, plus the $22,000 car = $64,000 owed
    before month 1's payments; after them the total is below that."""
    r = simulate_plan(nri(), Strategy.AVALANCHE, horizon_months=240, marginal_rate=D("0.22"))
    assert D("55000") < r.months[0].balance_in_user_currency < D("64000")
    # A sliding rupee makes the rupee loan cheaper in dollars: never later.
    slid = simulate_plan(nri("-0.035"), Strategy.AVALANCHE, horizon_months=240, marginal_rate=D("0.22"))
    assert slid.debt_free_month <= r.debt_free_month


def test_nri_prepay_line_is_in_dollars_after_slide_and_cost():
    c = cb.nri_prepay_comparison(loan_rate=D("0.085"), remaining_months=180, marginal_tax=D("0.22"))
    assert c.prepay_return == D("0.0453")         # hand check in test_a80_w10_nri.py


@pytest.mark.xfail(strict=True,
                   reason="W10 follow-up in engine/marginal_cost.py / ordering.py (W1-owned files): "
                          "the payoff order ranks a rupee loan at its rupee rate, ignoring the slide "
                          "and transfer cost that E5 now shows (≈4.5% in USD vs the 7.5% car)")
def test_nri_order_uses_the_dollar_cost_of_a_rupee_loan():
    r = simulate_plan(nri("-0.035"), Strategy.AVALANCHE, horizon_months=240, marginal_rate=D("0.22"))
    assert r.months[0].extra_to_loan_index == 1


# ── 4. US borrower (card + car + unanswered federal student loan) ──────────

def test_us_borrower_extra_never_reaches_unanswered_federal_loan():
    u = _user("5200", "2800", [
        Loan(LoanType.EDUCATION, "MOHELA", D("38000"), D("0.055"), "fixed", 120, D("420")),
        Loan(LoanType.AUTO, "Ally", D("22000"), D("0.075"), "fixed", 48, D("480")),
        card("Chase", "6000", "0.2399"),
    ], country=Country.US, filing_status=FilingStatusUS.SINGLE)
    r = simulate_plan(u, Strategy.AVALANCHE, horizon_months=120, marginal_rate=D("0.22"))
    assert r.months[0].extra_to_loan_index == 2   # the 24% card first
    extra_student = sum((max(D(0), m.payments_by_loan_index.get(0, D(0)) - D("420"))
                         for m in r.months), D(0))
    assert extra_student == 0


# ── 5/6. Audit A personas: P-short and P-ok ────────────────────────────────

def a_loans():
    return [card("SBI Card", "120000", "0.42"),
            Loan(LoanType.PERSONAL, "HDFC Bank", D("300000"), D("0.14"), "fixed", 36, D("10500")),
            Loan(LoanType.HOME, "SBI", D("3500000"), D("0.086"), "floating", 240, D("32000"))]


def test_p_short_is_short_by_exactly_income_minus_outgo():
    """Take-home ₹85,000, spending ₹42,000, EMIs ₹42,500 plus the card's
    minimum: the month-1 shortfall is exactly what's left negative."""
    u = _user("85000", "42000", a_loans())
    r = simulate_plan(u, Strategy.AVALANCHE, horizon_months=120)
    mins = compute_total_minimums(u, u.loans)
    expected = D("85000") - D("42000") - mins
    assert expected < 0
    assert abs(r.months[0].shortfall - (-expected)) < D("1")
    assert r.debt_free_month is None


@pytest.mark.xfail(strict=True,
                   reason="W1 owns C11: gap borrowing has no credit limit here, so a ₹10k/month "
                          "shortfall prints crore-scale card debt; W1 caps it (default 3 months' take-home)")
def test_p_short_gap_debt_stays_within_a_card_limit():
    u = _user("85000", "42000", a_loans())
    r = simulate_plan(u, Strategy.AVALANCHE, horizon_months=120)
    assert max(m.gap_debt for m in r.months) <= D("85000") * 3


def test_p_ok_all_orders_agree():
    """Audit A1/A2: for P-ok every payoff order gives the same date and
    interest, which is why the order question shouldn't be forced."""
    av = simulate_plan(_user("140000", "45000", a_loans()), Strategy.AVALANCHE, horizon_months=360)
    sn = simulate_plan(_user("140000", "45000", a_loans()), Strategy.SNOWBALL, horizon_months=360)
    assert av.debt_free_month == sn.debt_free_month == 50     # golden (regression pin)
    assert abs(av.total_interest_paid - sn.total_interest_paid) <= D("500")
    assert av.months[0].extra_to_loan_index == 0


# ── 7. No loans ─────────────────────────────────────────────────────────────

def test_no_loans_is_debt_free_now_and_never_crashes():
    r = simulate_plan(_user("60000", "30000", []), Strategy.AVALANCHE, horizon_months=12)
    assert r.debt_free_month == 0 and r.total_interest_paid == 0 and r.months == []


# ── 8. Business owner with seasonal income ─────────────────────────────────

FESTIVE = SeasonalIncome(tuple(D(x) for x in [
    "60000", "60000", "90000", "60000", "50000", "40000",
    "40000", "50000", "80000", "200000", "240000", "130000"]))     # avg ₹91,666.67


def business(**kw):
    return _user("91666.67", "55000", [
        Loan(LoanType.PERSONAL, "Bajaj Finance", D("500000"), D("0.16"), "fixed", 36, D("17580")),
        card("Axis Bank", "80000", "0.42"),
    ], income_type=IncomeType.BUSINESS_OWNER, **kw)


def test_business_owner_lean_months_and_buffer():
    """FY from April. Outgo ₹55,000 + EMI ₹17,580 + ~₹4,000 card minimum
    = ₹76,580. April–March income (₹k): 60 50 40 40 50 80 200 240 130 60
    60 90. Month by month against ₹76,580: −16,580 −26,580 −36,580 −36,580
    −26,580, then +3,420 … Running balance from ₹0: −16,580, −43,160,
    −79,740, −1,16,320, −1,42,900 (August), then it climbs. So the lean
    months are Apr–Aug and Jan–Feb, and ₹1,42,900 carries the lean stretch."""
    p = build_income_path(business(), 12, IncomeScenario(seasonal=FESTIVE), simulation_start_month=4)
    s = income_shape(p, D("76580"))
    assert s.lean_months == [1, 2, 3, 4, 5, 10, 11]
    assert s.buffer_needed == D("142900.00")
    assert s.average == D("91666.67")


def test_business_owner_seasonal_plan_shows_the_lean_month_gaps():
    flat = simulate_plan(business(), Strategy.AVALANCHE, horizon_months=36, simulation_start_month=4)
    p = build_income_path(business(), 36, IncomeScenario(seasonal=FESTIVE), simulation_start_month=4)
    lumpy = simulate_with_income(business(), p, Strategy.AVALANCHE, simulation_start_month=4)
    assert sum(m.shortfall for m in lumpy.months) > sum(m.shortfall for m in flat.months)


@pytest.mark.xfail(strict=True,
                   reason="W10 follow-up in engine/simulation.py (W1-owned): with savings equal to the "
                          "lean-season buffer, the plan still pours festive-season cash into a 16% loan "
                          "and then borrows on a 42% card in Jan–Feb; a seasonal earner needs a held reserve")
def test_business_owner_with_buffer_never_borrows_on_a_card():
    s = income_shape(build_income_path(business(), 12, IncomeScenario(seasonal=FESTIVE),
                                       simulation_start_month=4), D("76580"))
    u = business(efund_balance=s.buffer_needed, efund_target=s.buffer_needed)
    p = build_income_path(u, 36, IncomeScenario(seasonal=FESTIVE), simulation_start_month=4)
    r = simulate_with_income(u, p, Strategy.AVALANCHE, simulation_start_month=4)
    assert sum(m.gap_borrowed for m in r.months) == 0


@pytest.mark.xfail(strict=True,
                   reason="W2 owns advance tax for business income: a presumptive-scheme business "
                          "(Income-tax Act 2025 s.58, s.408(2)) pays 100% by 15 March, but "
                          "web/src/lib/advance-tax.ts only knows the 4-instalment schedule")
def test_business_owner_presumptive_scheme_single_instalment():
    src = (REPO / "web/src/lib/advance-tax.ts").read_text(encoding="utf-8").lower()
    assert "presumptive" in src and ("408(2)" in src or "44ad" in src)


# ── 9. India → NRI mover ───────────────────────────────────────────────────

def test_india_to_nri_mover():
    """Salaried in Chennai on ₹1,20,000, home loan; moves to a US job in
    month 7 on $7,000 take-home at ₹95/$ = ₹6,65,000. Hand check of the
    event: 7,000 × 95 = 6,65,000.00. The move only brings debt-free
    sooner, and month 7's surplus jumps by the pay difference."""
    loans = [Loan(LoanType.HOME, "ICICI Bank", D("4500000"), D("0.0875"), "floating", 240, D("39770"))]
    stay = _user("120000", "50000", loans)
    ev = cb.residency_move_event(effective_month=7, new_monthly_take_home=D("7000"),
                                 new_take_home_currency="USD", plan_currency="INR",
                                 fx_plan_per_new=D("95"))
    assert ev.new_monthly_take_home == D("665000.00")
    base = simulate_plan(stay, Strategy.AVALANCHE, horizon_months=300)
    moved = simulate_plan(stay, Strategy.AVALANCHE, horizon_months=300, lifecycle_events=[ev])
    assert moved.debt_free_month < base.debt_free_month
    assert moved.months[5].available_surplus == base.months[5].available_surplus
    assert moved.months[6].available_surplus > base.months[6].available_surplus

    # Residency for the move year (Income-tax Act 2025 s.6): a citizen
    # leaving for a job abroad is tested on 182 days only.
    leaving = cb.india_tax_residency(days_in_india=150, days_in_prev_4_years=1400,
                                     left_for_job_abroad_this_year=True)
    assert leaving.status == "non_resident"
    staying = cb.india_tax_residency(days_in_india=150, days_in_prev_4_years=1400)
    assert staying.status == "resident"
    notes = cb.residency_transition_notes("india_to_nri")
    assert any("NRO" in n.text for n in notes) and all(n.source.startswith("https://") for n in notes)
