"""Decision sub-modules — §8a, 8b, 8d, 8e, 8f."""
from decimal import Decimal
from engine.decisions import (
    allocate_windfall, evaluate_new_debt, quick_recompute, cash_yield_check,
    right_time_to_borrow,
)
from engine.models import Loan, LoanType, Country, InvestmentOption, LiquidityClass
from engine.ordering import Strategy

D = Decimal


def _loans():
    home = Loan(loan_type=LoanType.HOME, bank="HDFC Bank",
                outstanding=D("4000000"), nominal_rate=D("0.085"),
                rate_type="floating", tenure_months_remaining=240, scheduled_emi=D("34713"))
    card = Loan(loan_type=LoanType.CREDIT_CARD, bank="ICICI Bank",
                outstanding=D("100000"), nominal_rate=D("0.36"),
                rate_type="fixed", tenure_months_remaining=12, scheduled_emi=D("0"))
    return home, card


# ─── §8a Windfall ─────────────────────────────────────────────────────────────

def test_windfall_routes_to_highest_rate_loan():
    home, card = _loans()
    rates = {id(home): D("0.085"), id(card): D("0.4248")}
    out = allocate_windfall(
        amount=D("50000"), loans=[home, card], effective_rates=rates,
        investment_options=[], inflation=D("0.046"),
    )
    assert out.to_loan_id == id(card)
    assert out.invest_instead is False
    assert "Highest effective rate" in out.rationale


def test_windfall_invests_when_loan_rate_too_low():
    """Only a 7% home loan, 14% liquid return → invest, not prepay."""
    home = Loan(loan_type=LoanType.HOME, bank="X", outstanding=D("4000000"),
                nominal_rate=D("0.07"), rate_type="floating",
                tenure_months_remaining=240, scheduled_emi=D("31000"))
    rates = {id(home): D("0.07")}
    options = [InvestmentOption(name="Nifty", expected_return=D("0.14"),
                                liquidity_class=LiquidityClass.LIQUID, is_in_pool=True)]
    out = allocate_windfall(D("100000"), [home], rates, options, D("0.046"))
    assert out.invest_instead is True
    assert out.investment_name == "Nifty"


def test_windfall_amount_capped_by_loan_balance():
    """Windfall larger than balance → only the balance is allocated."""
    home, card = _loans()
    card.outstanding = D("30000")
    rates = {id(home): D("0.085"), id(card): D("0.4248")}
    out = allocate_windfall(D("100000"), [home, card], rates, [], D("0.046"))
    assert out.amount == D("30000")


# ─── §8b New Debt Check ───────────────────────────────────────────────────────

def test_no_cost_emi_unmasks_real_apr():
    """iPhone ₹80k list, ₹74k cash elsewhere, 12-month 0%-EMI → real APR ≈ 16%."""
    v = evaluate_new_debt(
        list_price=D("80000"), cash_price_elsewhere=D("74000"),
        emi_offer_months=12, emi_offer_monthly_payment=D("6667"),
        processing_fee=D("0"), user_savings_after_efund=D("200000"),
    )
    assert v.foregone_discount == D("6000")
    assert v.effective_apr > D("0.14") and v.effective_apr < D("0.20")
    assert v.verdict == "pay_cash"


def test_truly_zero_cost_when_cash_price_matches():
    """If cash_price == list_price, foregone discount is zero and APR is near zero."""
    v = evaluate_new_debt(
        list_price=D("60000"), cash_price_elsewhere=D("60000"),
        emi_offer_months=12, emi_offer_monthly_payment=D("5000"),
        processing_fee=D("0"), user_savings_after_efund=D("100000"),
    )
    assert v.foregone_discount == D("0")
    assert v.effective_apr < D("0.01")
    assert v.verdict == "take"


# ─── §8d Quick Recompute ──────────────────────────────────────────────────────

def test_quick_recompute_diff():
    out = quick_recompute(
        old_total_interest=D("100000"), new_total_interest=D("85000"),
        old_debt_free_month=24, new_debt_free_month=20,
    )
    assert out.interest_saved == D("15000")
    assert out.months_pulled_forward == 4


# ─── §8e Cash Yield Check ─────────────────────────────────────────────────────

def test_cash_yield_alerts_on_idle_cash():
    """₹2L sitting at 0.5% with HYSA at 7% → ~₹13k uplift."""
    alert = cash_yield_check(
        idle_balance=D("200000"), current_yield=D("0.005"),
        country=Country.IN, top_loan_effective_rate=D("0.085"),
    )
    assert alert is not None
    assert alert.annual_uplift > D("12000")


def test_cash_yield_skips_small_balances():
    """Below threshold → no alert (no nudge spam)."""
    alert = cash_yield_check(
        idle_balance=D("5000"), current_yield=D("0.005"), country=Country.IN,
    )
    assert alert is None


def test_cash_yield_skips_when_gap_too_small():
    """Already at 6% with alt at 6.5% → gap < 1pp, skip."""
    alert = cash_yield_check(
        idle_balance=D("200000"), current_yield=D("0.06"),
        country=Country.IN, best_alt_yield=D("0.065"), alt_name="HYSA",
    )
    assert alert is None


def test_cash_yield_flags_when_loan_beats_alt():
    """Loan at 12% > liquid 7% on same ₹2L → flag that loan prepay is better."""
    alert = cash_yield_check(
        idle_balance=D("200000"), current_yield=D("0.01"),
        country=Country.IN, top_loan_effective_rate=D("0.12"),
        best_alt_yield=D("0.07"), alt_name="HYSA",
    )
    assert alert is not None
    assert alert.beats_top_loan is False    # loan wins; alert says so


# ─── §8f Right-Time-to-Borrow ─────────────────────────────────────────────────

def test_borrow_wait_when_cut_expected_and_user_flexible():
    """50bps cut expected in 3 months, user can wait 3m → wait."""
    v = right_time_to_borrow(
        current_rate=D("0.13"), six_month_avg=D("0.124"),
        consensus_change_bps=-50, months_to_decision=3,
        urgency="3m_ok", principal=D("500000"), tenure_months=36,
    )
    assert v.verdict == "wait"
    assert v.estimated_savings > D("0")


def test_borrow_now_when_user_urgent():
    """Even if a cut is expected, urgent user borrows now."""
    v = right_time_to_borrow(
        current_rate=D("0.13"), six_month_avg=D("0.124"),
        consensus_change_bps=-50, months_to_decision=3,
        urgency="now", principal=D("500000"), tenure_months=36,
    )
    assert v.verdict == "borrow_now"


def test_borrow_now_when_hike_expected():
    v = right_time_to_borrow(
        current_rate=D("0.13"), six_month_avg=D("0.124"),
        consensus_change_bps=+25, months_to_decision=3,
        urgency="6m_ok", principal=D("500000"), tenure_months=36,
    )
    assert v.verdict == "borrow_now"
