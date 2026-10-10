"""Decision sub-modules — §8a, 8b, 8d, 8e (§8f Right time retired in roadmap PR I)."""
from decimal import Decimal
from engine.decisions import (
    allocate_windfall, evaluate_new_debt, quick_recompute, cash_yield_check,
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
    assert "The dearest debt" in out.rationale


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
    """₹2L sitting at 0.5% with a liquid fund at 6.5% → ₹12,000 a year more."""
    alert = cash_yield_check(
        idle_balance=D("200000"), current_yield=D("0.005"),
        country=Country.IN, top_loan_effective_rate=D("0.085"),
    )
    assert alert is not None
    assert alert.annual_uplift == D("12000")


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
    # The fee and its 18% GST (₹216) come out of the price up front.
    assert D("0.04") < v.effective_apr < D("0.045")
    assert v.total_real_cost == D("1415") and v.gst == D("215.82")


def test_real_cost_includes_interest():
    """An ordinary 14% loan: the real cost is the interest plus the fee, not just the fee."""
    from engine.formulas import emi
    payment = emi(D("500000"), D("0.14"), 36).quantize(D("0.01"))
    v = evaluate_new_debt(
        list_price=D("500000"), cash_price_elsewhere=D("500000"),
        emi_offer_months=36, emi_offer_monthly_payment=payment,
        processing_fee=D("5000"),
    )
    # A bank loan's interest carries no GST; its fee does.
    assert v.total_real_cost == (payment * 36 + 5000 + 900 - 500000).quantize(D("1"))
    assert v.gst == D("900.00") and v.total_real_cost > D("100000")
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


def _card(balance, usual="0"):
    return Loan(loan_type=LoanType.CREDIT_CARD, bank="Axis Bank", outstanding=D(balance),
                nominal_rate=D("0.34"), rate_type="fixed", tenure_months_remaining=0,
                scheduled_emi=D(usual))


def test_card_interest_avoided_runs_to_the_card_clearing():
    """₹85,000 off a 34% card was "₹2,408 over the loan's remaining life":
    one month's interest, because a card (no tenure) was treated as cleared
    in a month. Paying the bank's minimum (5%, ₹200 floor) it takes years."""
    from engine.decisions import interest_basis
    card = _card("85000")
    saved = interest_saved_by_prepaying(card, D("85000"))
    assert saved > 12 * D("2408")
    # Worked by hand: 34%/12 interest, then the larger of 5% and ₹200 paid.
    bal, total = D("85000"), D("0")
    while bal > 0:
        i = bal * D("0.34") / 12
        total += i
        pay = max(bal * D("0.05"), D("200"), i + bal * D("0.01"))
        bal = bal + i - min(pay, bal + i)
    assert abs(saved - total) <= 1
    assert interest_basis(card) == "until the card is cleared, paying the bank's minimum each month"


def test_card_interest_avoided_uses_the_usual_payment_when_higher():
    from engine.decisions import interest_basis
    card = _card("85000", usual="10000")
    assert interest_saved_by_prepaying(card, D("85000")) < interest_saved_by_prepaying(_card("85000"), D("85000"))
    assert "your usual ₹10,000 a month" in interest_basis(card)


def test_windfall_reports_what_its_interest_figure_assumes():
    home, card = _loans()
    rates = {id(home): D("0.085"), id(card): D("0.4248")}
    out = allocate_windfall(D("50000"), [home, card], rates, [], D("0.046"))
    assert out.interest_basis.startswith("until the card is cleared")


# ─── §8b affordability: the EMI has to fit what's left each month ─────────

def test_new_debt_emi_above_monthly_room_is_not_take():
    """The audit case: $4,500 income, $3,200 costs, a $12,000 card (≈$240
    minimum) leaves ~$1,060; a $300,000 personal loan at a 14% median over
    60 months is ~$7,294/mo. It was "Take the EMI"."""
    v = evaluate_new_debt(
        list_price=D("300000"), cash_price_elsewhere=D("300000"),
        emi_offer_months=60, emi_offer_monthly_payment=D("7293.82"),
        user_savings_after_efund=D("0"), country=Country.US,
        monthly_room=D("1060"),
    )
    assert v.verdict == "cant_afford"
    assert "$6,234" in v.detail and "short" in v.detail


def test_new_debt_unaffordable_but_savings_cover_it_says_pay_cash():
    v = evaluate_new_debt(
        list_price=D("50000"), cash_price_elsewhere=D("50000"),
        emi_offer_months=12, emi_offer_monthly_payment=D("4200"),
        user_savings_after_efund=D("60000"), country=Country.IN,
        monthly_room=D("2000"),
    )
    assert v.verdict == "pay_cash"
    assert "doesn't fit" in v.detail


def test_new_debt_take_says_what_is_left():
    v = evaluate_new_debt(
        list_price=D("50000"), cash_price_elsewhere=D("50000"),
        emi_offer_months=12, emi_offer_monthly_payment=D("4400"),
        user_savings_after_efund=D("0"), country=Country.IN,
        monthly_room=D("20000"),
    )
    assert v.verdict == "take"
    assert "₹15,600 a month" in v.detail and "budget allows" not in v.detail


def _pl(**terms):
    return Loan(loan_type=LoanType.PERSONAL, bank="Example Bank", outstanding=D("100000"),
                nominal_rate=D("0.12"), rate_type="fixed", tenure_months_remaining=40,
                scheduled_emi=D("3000"), **terms)


def test_windfall_skips_a_locked_loan():
    """Audit round 4: a loan in a three-month lock-in got "₹20,000 → pay
    down". The plan won't prepay it, so Spare Cash doesn't either."""
    pl = _pl(prepay_lock_in_months=3, prepayment_penalty_pct=D("0.05"))
    out = allocate_windfall(D("20000"), [pl], {id(pl): D("0.12")}, [], D("0.046"))
    assert out.to_loan_id is None and out.amount == 0 and out.leftover == D("20000")
    assert "locked against prepayment for 3 more months" in out.rationale
    # A second, open loan takes it instead, and the locked one is named.
    home, card = _loans()
    rates = {id(pl): D("0.50"), id(card): D("0.4248"), id(home): D("0.085")}
    out = allocate_windfall(D("20000"), [pl, card, home], rates, [], D("0.046"))
    assert out.to_loan_id == id(card)
    assert out.blocked == ["Example Bank personal loan is locked against prepayment for 3 more months"]


def test_windfall_nets_the_prepayment_fee():
    """5% fee on ₹20,000 is ₹1,000, out of the payment as the plan does:
    ₹19,000 goes to principal, and the saving is shown after the fee."""
    pl = _pl(prepayment_penalty_pct=D("0.05"))
    out = allocate_windfall(D("20000"), [pl], {id(pl): D("0.12")}, [], D("0.046"))
    assert out.amount == D("20000") and out.fee == D("1000.00")
    plain = _pl()
    no_fee = allocate_windfall(D("19000"), [plain], {id(plain): D("0.12")}, [], D("0.046"))
    assert out.interest_avoided == no_fee.interest_avoided
    assert out.net_benefit == out.interest_avoided - D("1000")
    assert "prepayment fee takes ₹1,000" in out.rationale


def test_windfall_fee_above_the_saving_keeps_the_cash():
    """A 1-month loan: the interest a prepayment saves is less than a 5% fee."""
    pl = Loan(loan_type=LoanType.PERSONAL, bank="X", outstanding=D("10000"),
              nominal_rate=D("0.12"), rate_type="fixed", tenure_months_remaining=2,
              scheduled_emi=D("5100"), prepayment_penalty_pct=D("0.05"))
    out = allocate_windfall(D("5000"), [pl], {id(pl): D("0.12")}, [], D("0.046"))
    assert out.to_loan_id is None and out.leftover == D("5000")
    assert "fee is more than the interest" in out.rationale


def test_card_emi_pays_gst_on_its_interest():
    """India: 18% GST on each month's interest in a card EMI."""
    from engine.formulas import emi
    payment = emi(D("60000"), D("0.16"), 12).quantize(D("0.01"))
    v = evaluate_new_debt(
        list_price=D("60000"), cash_price_elsewhere=D("60000"),
        emi_offer_months=12, emi_offer_monthly_payment=payment, card_emi=True,
    )
    interest = payment * 12 - 60000
    assert abs(v.gst - interest * D("0.18")) < D("1")
    # GST on the interest raises the real rate by about 18% of it.
    assert D("0.185") < v.effective_apr < D("0.195")


def test_no_cost_card_emi_is_not_free():
    """The discount behind a 'no-cost' EMI is the bank's interest, and GST is
    charged on it, so the real cost is above zero even with no fee."""
    v = evaluate_new_debt(
        list_price=D("60000"), cash_price_elsewhere=D("60000"),
        emi_offer_months=6, emi_offer_monthly_payment=D("10000"), card_emi=True,
    )
    assert D("300") < v.gst < D("600") and v.total_real_cost == v.gst.quantize(D("1"))
    assert D("0") < v.effective_apr < D("0.04")
    us = evaluate_new_debt(
        list_price=D("600"), cash_price_elsewhere=D("600"), country=Country.US,
        emi_offer_months=6, emi_offer_monthly_payment=D("100"), card_emi=True,
    )
    assert us.gst == 0 and us.effective_apr == 0


def test_pay_cash_when_borrowing_costs_more_than_savings_earn():
    from engine.formulas import emi
    payment = emi(D("100000"), D("0.08"), 12).quantize(D("0.01"))
    kw = dict(list_price=D("100000"), cash_price_elsewhere=D("100000"), emi_offer_months=12,
              emi_offer_monthly_payment=payment, user_savings_after_efund=D("200000"))
    # 8% beats savings that earn 4.4% after tax...
    v = evaluate_new_debt(**kw, savings_return=D("0.044"))
    assert v.verdict == "pay_cash" and "4.4% your savings earn" in v.detail
    # ...but not savings that earn 9%.
    assert evaluate_new_debt(**kw, savings_return=D("0.09")).verdict == "take"


def test_savings_go_to_a_dearer_debt_first():
    from engine.formulas import emi
    payment = emi(D("100000"), D("0.12"), 12).quantize(D("0.01"))
    v = evaluate_new_debt(
        list_price=D("100000"), cash_price_elsewhere=D("100000"), emi_offer_months=12,
        emi_offer_monthly_payment=payment, user_savings_after_efund=D("200000"),
        savings_return=D("0.044"), dearest_debt=("credit card", D("0.6252")),
    )
    assert v.verdict == "take" and "62.5% your credit card costs" in v.detail


def test_a_cheaper_bank_is_named_and_lenders_ceiling_is_flagged():
    from engine.formulas import emi
    payment = emi(D("300000"), D("0.19"), 36).quantize(D("0.01"))
    v = evaluate_new_debt(
        list_price=D("300000"), cash_price_elsewhere=D("300000"), emi_offer_months=36,
        emi_offer_monthly_payment=payment, cheaper_loan=("ICICI Bank", D("0.0999")),
        take_home=D("40000"), current_payments=D("12000"),
    )
    assert v.verdict == "take"
    assert "ICICI Bank advertises loans like this from 10.0%" in v.detail
    assert "lenders rarely approve past about half" in v.detail
