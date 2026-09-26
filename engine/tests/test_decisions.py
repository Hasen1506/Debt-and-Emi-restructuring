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
        urgency="3m_ok", principal=D("1000000"), tenure_months=36,
    )
    assert v.verdict == "wait"
    assert v.estimated_savings > D("0")


def test_borrow_saving_is_on_the_falling_balance():
    """₹5L over 36 months, 50bps cut: the EMIs differ by about ₹120, so
    about ₹4,300 over the loan. The old "cut × principal × years" said
    ₹7,500 and told the user to wait for less than the ₹5,000 bar."""
    v = right_time_to_borrow(
        current_rate=D("0.13"), six_month_avg=D("0.124"),
        consensus_change_bps=-50, months_to_decision=3,
        urgency="3m_ok", principal=D("500000"), tenure_months=36,
    )
    assert D("4000") < v.estimated_savings < D("4600")
    assert v.verdict == "borrow_now"


def test_borrow_detail_uses_the_users_currency():
    v = right_time_to_borrow(
        current_rate=D("0.07"), six_month_avg=D("0.07"),
        consensus_change_bps=-50, months_to_decision=3,
        urgency="3m_ok", principal=D("400000"), tenure_months=360,
        country=Country.US,
    )
    assert v.verdict == "wait"
    assert "$" in v.detail and "₹" not in v.detail
    small = right_time_to_borrow(
        current_rate=D("0.07"), six_month_avg=D("0.07"),
        consensus_change_bps=-10, months_to_decision=3,
        urgency="3m_ok", principal=D("400000"), tenure_months=360,
    )
    assert "(-10bps)" in small.detail


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


def test_borrow_now_says_why_when_the_cut_is_real_but_small():
    """A 50bps cut on ₹5L over 3 years saves ~₹4,180 — below the ₹5,000 bar.
    It used to say 'No meaningful change expected (-50bps)'."""
    v = right_time_to_borrow(
        current_rate=D("0.09"), six_month_avg=D("0.09"),
        consensus_change_bps=-50, months_to_decision=3,
        urgency="6m_ok", principal=D("500000"), tenure_months=36,
    )
    assert v.verdict == "borrow_now"
    assert "No meaningful change" not in v.detail
    assert "save only" in v.detail and "₹4,180" in v.detail


def test_borrow_now_says_why_when_the_cut_is_far_off():
    v = right_time_to_borrow(
        current_rate=D("0.09"), six_month_avg=D("0.09"),
        consensus_change_bps=-100, months_to_decision=12,
        urgency="6m_ok", principal=D("5000000"), tenure_months=240,
    )
    assert v.verdict == "borrow_now"
    assert "12 months" in v.detail


# ─── Phase 3 review: same bug classes as Loan Check ──────────────────────────

import pytest  # noqa: E402

from engine.decisions import DecisionInputError, interest_saved_by_prepaying, money  # noqa: E402


def _schedule_interest(balance, rate, payment):
    total = D("0")
    while balance > 0:
        i = balance * rate / 12
        total += i
        balance += i - payment
    return total


def test_windfall_interest_uses_the_capped_amount():
    """A ₹1L windfall on a ₹30k card: interest avoided is on ₹30k, not ₹1L."""
    home, card = _loans()
    card.outstanding = D("30000")
    rates = {id(home): D("0.085"), id(card): D("0.4248")}
    out = allocate_windfall(D("100000"), [home, card], rates, [], D("0.046"))
    assert out.amount == D("30000") and out.leftover == D("70000")
    assert "₹70,000 left over" in out.rationale
    assert out.interest_avoided == interest_saved_by_prepaying(card, D("30000"))
    assert out.interest_avoided == interest_saved_by_prepaying(card, D("100000"))


def test_prepayment_interest_is_amortised_not_simple():
    """₹1L off a 20-year 8.5% home loan, EMI kept: worked month by month."""
    home, _ = _loans()
    saved = interest_saved_by_prepaying(home, D("100000"))
    want = (_schedule_interest(home.outstanding, home.nominal_rate, home.scheduled_emi)
            - _schedule_interest(home.outstanding - D("100000"), home.nominal_rate, home.scheduled_emi))
    assert abs(saved - want) <= 1
    assert saved != D("0.085") * D("100000") * 20      # the old rate × amount × years


def test_card_minimum_payment_does_not_hang():
    """A card with no EMI: the months left set the payment."""
    _, card = _loans()
    assert interest_saved_by_prepaying(card, D("10000")) > 0


def test_investing_reports_interest_given_up_as_positive():
    home = Loan(loan_type=LoanType.HOME, bank="X", outstanding=D("4000000"),
                nominal_rate=D("0.07"), rate_type="floating",
                tenure_months_remaining=240, scheduled_emi=D("31012"))
    options = [InvestmentOption(name="Nifty", expected_return=D("0.14"),
                                liquidity_class=LiquidityClass.LIQUID, is_in_pool=True)]
    out = allocate_windfall(D("100000"), [home], {id(home): D("0.07")}, options, D("0.046"))
    assert out.invest_instead and out.interest_avoided > 0
    assert out.investment_return == D("0.14")


@pytest.mark.parametrize("amount", [D("0"), D("-5")])
def test_windfall_rejects_non_positive_amounts(amount):
    home, card = _loans()
    with pytest.raises(DecisionInputError) as e:
        allocate_windfall(amount, [home, card], {id(home): D("0.085"), id(card): D("0.4")}, [], D("0.046"))
    assert e.value.field == "amount"


def test_processing_fee_raises_the_apr():
    """A 'no-cost' EMI with a fee is not 0%."""
    v = evaluate_new_debt(
        list_price=D("60000"), cash_price_elsewhere=D("60000"),
        emi_offer_months=12, emi_offer_monthly_payment=D("5000"),
        processing_fee=D("1199"), user_savings_after_efund=D("0"),
    )
    assert D("0.035") < v.effective_apr < D("0.04")
    assert v.total_real_cost == D("1199")


def test_real_cost_includes_interest():
    """An ordinary 14% loan: the real cost is the interest plus the fee, not just the fee."""
    from engine.formulas import emi
    payment = emi(D("500000"), D("0.14"), 36).quantize(D("0.01"))
    v = evaluate_new_debt(
        list_price=D("500000"), cash_price_elsewhere=D("500000"),
        emi_offer_months=36, emi_offer_monthly_payment=payment,
        processing_fee=D("5000"),
    )
    assert v.total_real_cost == (payment * 36 + 5000 - 500000).quantize(D("1"))
    assert v.total_real_cost > D("100000")
    assert "₹1," in v.detail                           # Indian grouping, e.g. ₹1,20,211
    assert v.verdict == "take" and D("0.14") < v.effective_apr < D("0.15")


def test_new_debt_wording_uses_the_country_currency():
    v = evaluate_new_debt(
        list_price=D("1200"), cash_price_elsewhere=D("1000"),
        emi_offer_months=12, emi_offer_monthly_payment=D("100"),
        user_savings_after_efund=D("5000"), country=Country.US,
    )
    assert "$200" in v.detail and "₹" not in v.detail


def test_high_apr_is_not_capped_at_200_percent():
    v = evaluate_new_debt(
        list_price=D("10000"), cash_price_elsewhere=D("10000"),
        emi_offer_months=2, emi_offer_monthly_payment=D("9000"),
    )
    assert "600.0%" in v.detail and v.verdict == "delay"   # the old solver said 200%
    v = evaluate_new_debt(
        list_price=D("10000"), cash_price_elsewhere=D("10000"),
        emi_offer_months=1, emi_offer_monthly_payment=D("20000"),
    )
    assert "over 1000%" in v.detail


@pytest.mark.parametrize("kw, field", [
    (dict(list_price=D("0")), "list_price"),
    (dict(cash_price_elsewhere=D("-1")), "cash_price_elsewhere"),
    (dict(emi_offer_months=0), "emi_offer_months"),
    (dict(emi_offer_monthly_payment=D("0")), "emi_offer_monthly_payment"),
    (dict(processing_fee=D("-10")), "processing_fee"),
    (dict(processing_fee=D("80000")), "processing_fee"),
    (dict(user_savings_after_efund=D("-1")), "user_savings_after_efund"),
])
def test_new_debt_rejects_bad_input(kw, field):
    base = dict(list_price=D("80000"), cash_price_elsewhere=D("74000"),
                emi_offer_months=12, emi_offer_monthly_payment=D("6667"))
    with pytest.raises(DecisionInputError) as e:
        evaluate_new_debt(**{**base, **kw})
    assert e.value.field == field


def test_money_formats():
    assert money(D("1234567")) == "₹12,34,567"
    assert money(D("1234567"), Country.US) == "$1,234,567"
