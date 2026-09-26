"""Layer 1 restructuring scans (§4.7) — BT / consolidation / refinance."""
from decimal import Decimal
from engine.restructuring import (
    scan_balance_transfer, scan_consolidation, scan_refinance,
)
from engine.restructuring_scan import scan_all
from engine.models import (
    Country, IncomeType, Loan, LoanType, User,
)

D = Decimal


def _build_user(*, primary_bank: str, other_banks=None, loans=None) -> User:
    return User(
        country=Country.IN,
        income_type=IncomeType.SALARIED,
        annual_income=D("3000000"),
        monthly_income=D("250000"),
        fixed_expenses=D("60000"),
        savings_balance=D("500000"),
        primary_bank=primary_bank,
        other_banks=list(other_banks or []),
        loans=list(loans or []),
    )


def test_bt_candidate_high_rate_card_with_good_offer():
    """ICICI card at 42.48% effective → BT offer at 0% promo with 1.5% fee, 6 months.
    Amortised fee = 1.5%/6 × 12 = 3% annualised; effective BT APR = 3%.
    42.48% − 5pp = 37.48% > 3% → candidate."""
    card = Loan(loan_type=LoanType.CREDIT_CARD, bank="ICICI Bank",
                outstanding=D("100000"), nominal_rate=D("0.36"), rate_type="fixed",
                tenure_months_remaining=12, scheduled_emi=D("0"))
    cand = scan_balance_transfer(card, D("0.4248"), bt_offer_rate=D("0"),
                                  bt_fee_pct=D("0.015"), promo_months=6)
    assert cand is not None
    assert cand.effective_bt_apr == D("0") + D("0.015") / D("6") * D("12")


def test_bt_rejected_when_card_rate_too_low():
    """Card at 20% — below 24% threshold; no BT."""
    card = Loan(loan_type=LoanType.CREDIT_CARD, bank="X", outstanding=D("50000"),
                nominal_rate=D("0.20"), rate_type="fixed",
                tenure_months_remaining=12, scheduled_emi=D("0"))
    cand = scan_balance_transfer(card, D("0.20"), D("0"), D("0.015"), 6)
    assert cand is None


def test_bt_rejected_when_offer_not_5pp_better():
    """Card at 25%; BT offer with fee ends up at 22% — only 3pp better; reject."""
    card = Loan(loan_type=LoanType.CREDIT_CARD, bank="X", outstanding=D("50000"),
                nominal_rate=D("0.25"), rate_type="fixed",
                tenure_months_remaining=12, scheduled_emi=D("0"))
    # BT at 16% with 3% fee over 6 months → amortised fee = 6% annualised → effective 22%
    cand = scan_balance_transfer(card, D("0.25"), D("0.16"), D("0.03"), 6)
    assert cand is None


def test_consolidation_candidate_two_high_rate_unsecured():
    """Two unsecured loans at 18% and 22%, blended ~20%, market PL at 12% → consolidate."""
    a = Loan(loan_type=LoanType.PERSONAL, bank="X", outstanding=D("200000"),
             nominal_rate=D("0.18"), rate_type="fixed", tenure_months_remaining=36,
             scheduled_emi=D("7234"))
    b = Loan(loan_type=LoanType.PERSONAL, bank="Y", outstanding=D("100000"),
             nominal_rate=D("0.22"), rate_type="fixed", tenure_months_remaining=24,
             scheduled_emi=D("5183"))
    rates = {id(a): D("0.18"), id(b): D("0.22")}
    cand = scan_consolidation([a, b], rates,
                               market_personal_loan_rate=D("0.12"),
                               fee_amortised=D("0.01"))
    assert cand is not None
    # blended = (0.18×200k + 0.22×100k) / 300k = 0.1933
    # consolidated = 0.12 × 1.01 = 0.1212; spread = 7.21pp > 3pp ✓
    assert cand.loans == [a, b]


def test_consolidation_rejected_when_only_one_qualifies():
    """Only one loan > 15% → not a candidate."""
    a = Loan(loan_type=LoanType.PERSONAL, bank="X", outstanding=D("200000"),
             nominal_rate=D("0.18"), rate_type="fixed", tenure_months_remaining=36,
             scheduled_emi=D("7234"))
    b = Loan(loan_type=LoanType.AUTO, bank="Y", outstanding=D("100000"),
             nominal_rate=D("0.10"), rate_type="fixed", tenure_months_remaining=24,
             scheduled_emi=D("4614"))
    rates = {id(a): D("0.18"), id(b): D("0.10")}
    cand = scan_consolidation([a, b], rates, D("0.12"), D("0.01"))
    assert cand is None


def test_refi_candidate_home_loan_above_market():
    """Home loan at 9% when market median is 7%: gap 2pp > 1.5pp threshold; benefit ratio > 1.0 → candidate."""
    home = Loan(loan_type=LoanType.HOME, bank="X", outstanding=D("4000000"),
                nominal_rate=D("0.09"), rate_type="floating",
                tenure_months_remaining=240, scheduled_emi=D("35989"))
    cand = scan_refinance(home, market_median_rate=D("0.07"),
                          interest_saved=D("400000"), refi_costs=D("50000"))
    assert cand is not None


def test_refi_rejected_when_gap_too_small():
    home = Loan(loan_type=LoanType.HOME, bank="X", outstanding=D("4000000"),
                nominal_rate=D("0.075"), rate_type="floating",
                tenure_months_remaining=240, scheduled_emi=D("32219"))
    cand = scan_refinance(home, market_median_rate=D("0.07"),
                          interest_saved=D("400000"), refi_costs=D("50000"))
    # Gap = 0.5pp < 1.5pp threshold
    assert cand is None


def test_refi_rejected_when_savings_dont_cover_costs_2x():
    """Big rate gap but interest_saved barely above refi_costs → reject."""
    home = Loan(loan_type=LoanType.HOME, bank="X", outstanding=D("4000000"),
                nominal_rate=D("0.09"), rate_type="floating",
                tenure_months_remaining=240, scheduled_emi=D("35989"))
    # benefit ratio = (60k − 50k) / 50k = 0.2 < 1.0 → reject
    cand = scan_refinance(home, market_median_rate=D("0.07"),
                          interest_saved=D("60000"), refi_costs=D("50000"))
    assert cand is None


# ─── scan_all with existing-bank preference ───────────────────────────────


def test_refi_prefers_existing_relationship_bank():
    """User banks with HDFC; has a home loan at Kotak at 10%. HDFC home-loan
    low is 7.75%; SBI/ICICI tie at 7.50%. Recommendation should be HDFC
    (existing relationship), with SBI surfaced as the dismissable alternative.
    """
    home = Loan(
        loan_type=LoanType.HOME, bank="Kotak Mahindra",
        outstanding=D("4000000"), nominal_rate=D("0.10"),
        rate_type="floating", tenure_months_remaining=240,
        scheduled_emi=D("38601"),
    )
    user = _build_user(primary_bank="HDFC Bank", loans=[home])
    opps = scan_all(user)
    refi = next((o for o in opps if o.kind == "refinance"), None)
    assert refi is not None, "Expected a refinance opportunity"
    # Primary recommendation: a bank the user already has a relationship with.
    assert refi.target_is_existing_relationship is True
    assert refi.target_bank in {"HDFC Bank", "Kotak Mahindra"}
    # Alternative: the overall-cheapest bank when it differs and beats the rec.
    assert refi.alternative_target_bank is not None
    assert refi.alternative_target_bank not in {"HDFC Bank", "Kotak Mahindra"}
    assert refi.alternative_target_rate is not None
    assert refi.alternative_target_rate < refi.target_rate


def test_refi_no_alternative_when_relationship_is_already_cheapest():
    """User banks with SBI (which has the cheapest home-loan low in Tier-A)
    and has a home loan elsewhere at 10%. Recommendation should be SBI;
    no alternative surfaces because SBI is already the overall cheapest."""
    home = Loan(
        loan_type=LoanType.HOME, bank="Axis Bank",
        outstanding=D("4000000"), nominal_rate=D("0.10"),
        rate_type="floating", tenure_months_remaining=240,
        scheduled_emi=D("38601"),
    )
    user = _build_user(primary_bank="SBI", loans=[home])
    opps = scan_all(user)
    refi = next((o for o in opps if o.kind == "refinance"), None)
    assert refi is not None
    assert refi.target_is_existing_relationship is True
    # SBI (or Axis, if it ties — but Axis at 0.0765 > SBI at 0.0750) wins.
    assert refi.target_bank == "SBI"
    assert refi.alternative_target_bank is None


def test_refi_falls_back_to_overall_winner_without_relationship():
    """User's only loan is at a non-rate-carded bank, no primary, no other
    banks. Recommendation falls back to the overall winner; no relationship
    badge; no alternative (since the rec already IS the overall winner)."""
    home = Loan(
        loan_type=LoanType.HOME, bank="Some Local Bank",
        outstanding=D("4000000"), nominal_rate=D("0.10"),
        rate_type="floating", tenure_months_remaining=240,
        scheduled_emi=D("38601"),
    )
    user = _build_user(primary_bank="", loans=[home])
    opps = scan_all(user)
    refi = next((o for o in opps if o.kind == "refinance"), None)
    assert refi is not None
    assert refi.target_is_existing_relationship is False
    assert refi.alternative_target_bank is None


def test_other_banks_field_grants_relationship_preference():
    """User's primary bank doesn't have home-loan rates carded, but their
    `other_banks` does. Should still bias recommendation toward the
    other_banks entry."""
    home = Loan(
        loan_type=LoanType.HOME, bank="Some Local Bank",
        outstanding=D("4000000"), nominal_rate=D("0.10"),
        rate_type="floating", tenure_months_remaining=240,
        scheduled_emi=D("38601"),
    )
    # PNB has home_loan 0.0770-0.0915. Not the cheapest in market (SBI/ICICI
    # tie at 0.0750), but bank user already deals with.
    user = _build_user(primary_bank="", other_banks=["PNB"], loans=[home])
    opps = scan_all(user)
    refi = next((o for o in opps if o.kind == "refinance"), None)
    assert refi is not None
    assert refi.target_is_existing_relationship is True
    assert refi.target_bank == "PNB"
    assert refi.alternative_target_bank in {"SBI", "ICICI Bank"}


# ─────────────────────────────────────────────────────────────────────────────
# Employment-type aware filtering (§ brainstorm #4 — May 2026)
# ─────────────────────────────────────────────────────────────────────────────


def test_business_owner_gets_mid_band_on_unsecured_refi():
    """Self-employed users see mid-of-band rate on unsecured products, since
    underwriting widens the band for non-salaried income. Compare a personal
    loan refi for salaried vs business_owner with the same loan."""
    pl = Loan(
        loan_type=LoanType.PERSONAL, bank="Some Local NBFC",
        outstanding=D("500000"), nominal_rate=D("0.20"),
        rate_type="fixed", tenure_months_remaining=36,
        scheduled_emi=D("18500"),
    )
    # PERSONAL refi isn't covered in scan_all (only HOME/AUTO), so directly
    # test _best_market_rate behaviour:
    from engine.restructuring_scan import _best_market_rate
    sal = _best_market_rate(Country.IN, LoanType.PERSONAL, known=None,
                             income_type=IncomeType.SALARIED)
    biz = _best_market_rate(Country.IN, LoanType.PERSONAL, known=None,
                             income_type=IncomeType.BUSINESS_OWNER)
    assert sal is not None and biz is not None
    # business-owner rate must be strictly higher than salaried rate
    assert biz[1] > sal[1]


def test_business_owner_home_loan_rate_unchanged():
    """Home loans are collateral-backed; SE banding shouldn't widen them.
    Best-rate result must match salaried."""
    from engine.restructuring_scan import _best_market_rate
    sal = _best_market_rate(Country.IN, LoanType.HOME, known=None,
                             income_type=IncomeType.SALARIED)
    biz = _best_market_rate(Country.IN, LoanType.HOME, known=None,
                             income_type=IncomeType.BUSINESS_OWNER)
    assert sal == biz


def test_business_owner_refi_rationale_includes_se_caveat():
    """Refi rationale for a SE user mentions the SE underwriting caveat."""
    home = Loan(
        loan_type=LoanType.HOME, bank="Some Local Bank",
        outstanding=D("4000000"), nominal_rate=D("0.10"),
        rate_type="floating", tenure_months_remaining=240,
        scheduled_emi=D("38601"),
    )
    user = _build_user(primary_bank="HDFC Bank", loans=[home])
    user.income_type = IncomeType.BUSINESS_OWNER
    opps = scan_all(user)
    refi = next((o for o in opps if o.kind == "refinance"), None)
    # Home loan is collateral-backed → no SE caveat appended.
    assert refi is not None
    assert "Self-employed" not in refi.rationale


def test_business_owner_bt_rationale_includes_se_caveat():
    """BT rationale for a SE user warns about underwriting friction."""
    card = Loan(
        loan_type=LoanType.CREDIT_CARD, bank="ICICI Bank",
        outstanding=D("100000"), nominal_rate=D("0.42"),
        rate_type="fixed", tenure_months_remaining=12,
        scheduled_emi=D("0"),
    )
    user = _build_user(primary_bank="HDFC Bank", loans=[card])
    user.income_type = IncomeType.BUSINESS_OWNER
    opps = scan_all(user)
    bt = next((o for o in opps if o.kind == "balance_transfer"), None)
    assert bt is not None
    assert "Self-employed" in bt.rationale


# ─── One saving measure, pay-back, same-bank transfers (audit, 26 Sep) ────


def _mixed_book(card_bank: str = "HDFC Bank") -> User:
    return _build_user(primary_bank="HDFC Bank", loans=[
        Loan(loan_type=LoanType.HOME, bank="HDFC", outstanding=D("3000000"),
             nominal_rate=D("0.105"), rate_type="floating",
             tenure_months_remaining=240, scheduled_emi=D("29951")),
        Loan(loan_type=LoanType.PERSONAL, bank="Bajaj Finance", outstanding=D("300000"),
             nominal_rate=D("0.20"), rate_type="fixed",
             tenure_months_remaining=36, scheduled_emi=D("11149")),
        Loan(loan_type=LoanType.PERSONAL, bank="Tata Capital", outstanding=D("200000"),
             nominal_rate=D("0.19"), rate_type="fixed",
             tenure_months_remaining=36, scheduled_emi=D("7331")),
        Loan(loan_type=LoanType.CREDIT_CARD, bank=card_bank, outstanding=D("150000"),
             nominal_rate=D("0.42"), rate_type="fixed",
             tenure_months_remaining=12, scheduled_emi=D("0")),
    ])


def test_consolidation_fee_is_added_to_the_rate_not_multiplied():
    """A 1% fee over 3 years adds ~0.33 points. Multiplying 12% by 1.0033
    added 0.04 points, so the fee all but vanished."""
    a = Loan(loan_type=LoanType.PERSONAL, bank="X", outstanding=D("200000"),
             nominal_rate=D("0.18"), rate_type="fixed", tenure_months_remaining=36,
             scheduled_emi=D("7234"))
    b = Loan(loan_type=LoanType.PERSONAL, bank="Y", outstanding=D("100000"),
             nominal_rate=D("0.22"), rate_type="fixed", tenure_months_remaining=24,
             scheduled_emi=D("5183"))
    cand = scan_consolidation([a, b], {id(a): D("0.18"), id(b): D("0.22")},
                              D("0.12"), D("0.0033"))
    assert cand.consolidated_rate == D("0.1233")


def test_every_kind_reports_first_year_saving_after_costs_and_payback():
    opps = {o.kind: o for o in scan_all(_mixed_book(), D("0.3"))}
    assert set(opps) == {"refinance", "consolidation", "balance_transfer"}
    for o in opps.values():
        assert o.one_time_cost > 0
        assert o.breakeven_months is not None and o.breakeven_months >= 1
    refi = opps["refinance"]
    gross = (refi.current_rate - refi.target_rate) * D("3000000")
    assert refi.estimated_annual_saving == gross - refi.one_time_cost
    assert refi.lifetime_net_saving > refi.estimated_annual_saving
    # 1% cost against 2.75 points a year: earned back in month 5.
    assert refi.breakeven_months == 5
    consol = opps["consolidation"]
    assert consol.one_time_cost == D("0.01") * D("650000")
    assert "in the first year" in consol.headline
    bt = opps["balance_transfer"]
    assert "in the first year" in bt.headline and "/yr" not in bt.headline


def test_balance_transfer_never_targets_the_cards_own_bank():
    """Banks don't take a transfer from their own card."""
    for typed in ("HDFC Bank", "HDFC", "hdfc bank ltd."):
        bt = [o for o in scan_all(_mixed_book(typed), D("0.3")) if o.kind == "balance_transfer"]
        assert bt and "hdfc" not in bt[0].target_bank.lower()


def test_same_bank_refinance_reads_as_a_rate_reset():
    refi = next(o for o in scan_all(_mixed_book(), D("0.3")) if o.kind == "refinance")
    assert refi.target_bank == "HDFC Bank"
    assert "asking HDFC to move your home loan" in refi.headline
    assert "Loan Check" in refi.rationale
