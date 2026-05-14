"""Layer 1 restructuring scans (§4.7) — BT / consolidation / refinance."""
from decimal import Decimal
from engine.restructuring import (
    scan_balance_transfer, scan_consolidation, scan_refinance,
)
from engine.models import Loan, LoanType

D = Decimal


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
