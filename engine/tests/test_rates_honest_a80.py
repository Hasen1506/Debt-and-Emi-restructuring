"""Rates the app quotes are sourced, dated, and never someone else's best case.

Audit 80+ (14 Oct 2026):
- E1: Home's "Cheaper rates" quoted each bank's floor (HDFC 9.99% of
  9.99–24.00%, Wells Fargo 6.74% of 6.74–23.99%) as the user's own rate.
  Every consolidation and refinance is now costed at the middle of the
  target bank's published range, and carries the range and the saving at
  each end.
- A21: "industry norm" figures (rate_cards.py LoanTerms "2026-05 industry
  norms", extrapolated Tier-B/C cards) are deleted or labelled "typical,
  unverified", and never quoted to a borrower as a lender's rate.
"""
from decimal import Decimal

from hypothesis import HealthCheck, given, settings
from hypothesis import strategies as st

from engine import rate_cards
from engine.loan_check import find_lender
from engine.models import Country, IncomeType, Loan, LoanType, User
from engine.rate_cards import (
    ALL_INSTITUTIONS, INDIA_TIER_A, UNVERIFIED_LABEL, USA_TIER_A, lookup_loan_terms, lookup_rate,
)
from engine.restructuring_scan import scan

D = Decimal


# ── E1: never the floor ─────────────────────────────────────────────────────

def _user(country, loans, score, income_type):
    return User(
        country=country, income_type=income_type, annual_income=D("1800000"),
        monthly_income=D("150000"), fixed_expenses=D("40000"), savings_balance=D("0"),
        primary_bank="", credit_score=score, loans=loans,
    )


_card = st.builds(
    lambda bal, apr: Loan(LoanType.CREDIT_CARD, "Some Card", D(bal), D(apr) / 100, "fixed", 0, D("0")),
    st.integers(20_000, 400_000), st.integers(30, 48),
)
_pl = st.builds(
    lambda bal, apr: Loan(LoanType.PERSONAL, "Some NBFC", D(bal), D(apr) / 100, "fixed", 36,
                          D(bal) / 30),
    st.integers(50_000, 800_000), st.integers(14, 32),
)
_home = st.builds(
    lambda bal, rate: Loan(LoanType.HOME, "Some Local Bank", D(bal), D(rate) / 1000, "floating", 240,
                           D(bal) / 120),
    st.integers(1_000_000, 8_000_000), st.integers(95, 130),
)


@settings(max_examples=80, deadline=None, suppress_health_check=[HealthCheck.too_slow])
@given(
    loans=st.lists(st.one_of(_card, _pl, _home), min_size=2, max_size=4),
    score=st.one_of(st.none(), st.integers(650, 850)),
    income_type=st.sampled_from([IncomeType.SALARIED, IncomeType.BUSINESS_OWNER]),
    country=st.sampled_from([Country.IN, Country.US]),
)
def test_no_move_is_priced_below_the_middle_of_the_banks_range(loans, score, income_type, country):
    result = scan(_user(country, loans, score, income_type))
    for o in result.opportunities:
        if o.kind == "balance_transfer":
            continue   # a promo offer is quoted as the bank prints it
        loan_type = LoanType.PERSONAL if o.kind == "consolidation" else LoanType(
            loans[o.affected_loan_indices[0]].loan_type)
        r = lookup_rate(o.target_bank, loan_type)
        assert r is not None
        assert o.target_rate == r.median, (o.target_bank, o.target_rate, r)
        assert D(o.detail["range_low"]) == r.low and D(o.detail["range_high"]) == r.high
        # Cheaper at the low end, dearer at the high end.
        assert D(o.detail["saving_at_range_low"]) >= D(o.detail["saving_at_range_high"])


def test_chennai_revolver_is_not_offered_hdfcs_floor():
    """The audit's persona: three cards at 42/40/39% and a BNPL loan; Home
    offered HDFC at 9.99%, the floor of 9.99–24.00%."""
    loans = [
        Loan(LoanType.CREDIT_CARD, "Card A", D("85000"), D("0.42"), "fixed", 0, D("0")),
        Loan(LoanType.CREDIT_CARD, "Card B", D("60000"), D("0.40"), "fixed", 0, D("0")),
        Loan(LoanType.CREDIT_CARD, "Card C", D("35000"), D("0.39"), "fixed", 0, D("0")),
    ]
    user = User(country=Country.IN, income_type=IncomeType.SALARIED, annual_income=D("504000"),
                monthly_income=D("42000"), fixed_expenses=D("30000"), savings_balance=D("0"),
                primary_bank="", loans=loans)
    for o in scan(user).opportunities:
        if o.kind == "consolidation":
            r = lookup_rate(o.target_bank, LoanType.PERSONAL)
            assert o.target_rate > r.low and o.target_rate == r.median
            assert "middle of the bank's range" in o.rationale


# ── A21: no unsourced figure is quoted as a lender's ────────────────────────

def test_no_loan_terms_carry_industry_norm_figures():
    for country in (Country.IN, Country.US):
        for lt in LoanType:
            for rt in ("floating", "fixed"):
                t = lookup_loan_terms("", country, lt, rate_type=rt)
                assert "industry" not in t.last_verified.lower(), (country, lt, rt, t.last_verified)
                if t.is_indicative:
                    # An indicative term is "not known", never a guessed number.
                    assert t.prepayment_penalty_pct is None and t.prepay_lock_in_months is None
    assert rate_cards.LoanTerms().last_verified == UNVERIFIED_LABEL


def test_extrapolated_cards_are_labelled_and_never_used_by_loan_check():
    indicative = [c for c in ALL_INSTITUTIONS.values() if c.is_indicative]
    assert indicative, "the registry still carries Tier-B/C extrapolations"
    for c in indicative:
        assert c.verification == UNVERIFIED_LABEL
        if c.country == Country.IN:
            assert find_lender(c.name) is None, c.name
    for c in INDIA_TIER_A + USA_TIER_A:
        assert not c.is_indicative and c.verification.startswith("checked 20")
    assert find_lender("SBI") is not None


def test_us_education_loan_cites_the_statute():
    t = lookup_loan_terms("", Country.US, LoanType.EDUCATION)
    assert "1650(e)" in t.last_verified and t.prepayment_penalty_pct == 0
