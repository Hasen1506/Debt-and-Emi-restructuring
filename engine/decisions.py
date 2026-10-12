"""Decision sub-modules — Tools surface §8a–§8f (excluding §8c, in asset_liquidation.py).

Each returns a single decision with the key number. Inputs are kept narrow so
each can be wired to a focused UI screen.
"""
from decimal import ROUND_HALF_UP, Decimal
from dataclasses import dataclass, field, replace
from typing import Optional
from engine.market_data import approx_pct, safe_rate
from engine.models import Loan, Country, LoanType, InvestmentOption, LiquidityClass, PayoffRules
from engine.formulas import after_tax_return, emi, effective_rate, prepay_recommended
from engine.minimum_payments import compute_minimum_payment
from engine.loan_check import _inr
from engine.ordering import Strategy, rank_loans
from engine.marginal_cost import why_first

D = Decimal


# ─────────────────────────────────────────────────────────────────────────────
# §8a  Windfall Handler
# ─────────────────────────────────────────────────────────────────────────────

class DecisionInputError(ValueError):
    """Bad input to a decision tool, naming the field the user must fix."""

    def __init__(self, field: str, message: str):
        super().__init__(message)
        self.field = field


def money(amount: Decimal, country: Country = Country.IN) -> str:
    """₹12,34,567 for India, $1,234,567 for the US; whole units."""
    if country == Country.US:
        n = int(amount.quantize(D("1"), rounding=ROUND_HALF_UP))
        return f"{'-' if n < 0 else ''}${abs(n):,}"
    return _inr(amount)


def _interest_to_clear(balance: Decimal, rate: Decimal, payment: Decimal) -> Decimal:
    """Interest paid clearing `balance` at `payment` a month (monthly rest)."""
    monthly = rate / D("12")
    total = D("0")
    for _ in range(1200):
        if balance <= 0:
            break
        i = balance * monthly
        total += i
        balance = balance + i - payment
    return total


def _card_interest_to_clear(loan: Loan, balance: Decimal, country: Country) -> Decimal:
    """Interest paid clearing a card balance, paying each month the larger
    of the user's usual payment and the bank's minimum (and at least 1% of
    the balance above the interest, so a minimum that only covers the
    interest still clears it)."""
    monthly = loan.nominal_rate / D("12")
    usual = loan.scheduled_emi or D("0")
    total = D("0")
    for _ in range(1200):
        if balance <= 0:
            break
        i = balance * monthly
        total += i
        minimum = compute_minimum_payment(replace(loan, outstanding=balance), country, interest_accrued=i)
        pay = max(usual, minimum, i + balance * D("0.01"))
        balance = balance + i - min(pay, balance + i)
    return total


def interest_basis(loan: Loan, country: Country = Country.IN) -> str:
    """What `interest_saved_by_prepaying` assumes, in words for the page."""
    if loan.loan_type == LoanType.CREDIT_CARD:
        if loan.scheduled_emi and loan.scheduled_emi > 0:
            return (f"until the card is cleared, paying your usual {money(loan.scheduled_emi, country)} "
                    "a month (or the minimum, if higher)")
        return "until the card is cleared, paying the bank's minimum each month"
    return "over the loan's remaining life, EMI kept, so it ends sooner"


def interest_saved_by_prepaying(loan: Loan, prepay: Decimal, country: Country = Country.IN) -> Decimal:
    """Interest avoided by paying `prepay` off `loan` now, keeping the EMI so
    the loan finishes sooner (the usual default after a part-payment).

    Works the loan month by month. A card is paid down at the larger of the
    usual payment and the bank's minimum; it used to be treated as cleared
    within the month (a card has no tenure), so ₹85,000 off a 34% card
    avoided "₹2,408", one month's interest. For other loans, if the EMI is
    missing or does not cover the interest, the EMI that clears the balance
    over the months left is used.
    """
    balance, rate = loan.outstanding, loan.nominal_rate
    prepay = min(prepay, balance)
    if prepay <= 0 or rate <= 0:
        return D("0")
    if loan.loan_type == LoanType.CREDIT_CARD:
        saved = (_card_interest_to_clear(loan, balance, country)
                 - _card_interest_to_clear(loan, balance - prepay, country))
        return max(D("0"), saved.quantize(D("1"), rounding=ROUND_HALF_UP))
    payment = loan.scheduled_emi or D("0")
    if payment <= balance * rate / D("12"):
        payment = emi(balance, rate, max(loan.tenure_months_remaining or 0, 1))
    saved = _interest_to_clear(balance, rate, payment) - _interest_to_clear(balance - prepay, rate, payment)
    return max(D("0"), saved.quantize(D("1"), rounding=ROUND_HALF_UP))


@dataclass
class WindfallAllocation:
    to_loan_id: int | None
    loan_label: str
    amount: Decimal                         # what goes to the loan (capped at its balance)
    rationale: str                          # e.g. "highest effective rate (38.4%)"
    # Interest the prepayment avoids over the loan's remaining life (a card:
    # until it's cleared at the usual or minimum payment). When investing
    # wins, the interest given up by not prepaying. Never negative.
    interest_avoided: Decimal
    invest_instead: bool = False
    investment_name: str | None = None
    investment_return: Decimal | None = None
    leftover: Decimal = D("0")              # windfall beyond the loan's balance
    # What interest_avoided assumes, e.g. "until the card is cleared, paying
    # the bank's minimum each month".
    interest_basis: str = ""
    # The loan's prepayment fee on `amount` (taken out of it, as the plan
    # does), and interest_avoided less that fee.
    fee: Decimal = D("0")
    net_benefit: Decimal = D("0")
    # Loans passed over because their terms bar an extra payment now.
    blocked: list[str] = field(default_factory=list)


def prepay_block(loan: Loan) -> str | None:
    """Why the loan can't take an extra payment this month, or None. The
    same gates as the plan's simulator: a lock-in (months from now) and a
    pre-EMI period. A part-payment frequency limit isn't known to be used
    up, so it's a caveat, not a block."""
    if loan.pre_emi_months_remaining > 0:
        return "is still in its pre-EMI period"
    if loan.prepay_lock_in_months > 0:
        n = loan.prepay_lock_in_months
        return f"is locked against prepayment for {n} more month{'' if n == 1 else 's'}"
    return None


def _prepay_split(loan: Loan, amount: Decimal) -> tuple[Decimal, Decimal]:
    """(cash paid, fee) for putting up to `amount` into `loan`. The fee is a
    share of the payment and comes out of it, so it takes a little more than
    the balance to clear the loan."""
    pct = loan.prepayment_penalty_pct or D("0")
    need = loan.outstanding / (D("1") - pct) if pct < 1 else loan.outstanding
    paid = min(amount, need)
    return paid, (paid * pct).quantize(D("0.01"), rounding=ROUND_HALF_UP)


def allocate_windfall(
    amount: Decimal,
    loans: list[Loan],
    effective_rates: dict[int, Decimal],
    investment_options: list[InvestmentOption],
    inflation: Decimal,
    strategy: Strategy = Strategy.AVALANCHE,
    country: Country = Country.IN,
    marginal_tax_rate: Decimal = D("0"),
    rules: PayoffRules | None = None,
    prepay_hurdle: Decimal | None = None,
    marginal_costs: dict | None = None,
) -> WindfallAllocation:
    """§8a — single decision, not a plan. Runs Layer 1 logic (already done at scan
    time), then Layer 2 ranking, then Layer 3 invest-vs-prepay gate on the top
    candidate.
    """
    if amount <= 0:
        raise DecisionInputError("amount", "Enter an amount above zero.")
    active = [l for l in loans if l.outstanding > 0]
    if not active:
        return WindfallAllocation(
            to_loan_id=None, loan_label="—", amount=D("0"),
            rationale="No outstanding debt", interest_avoided=D("0"), leftover=amount,
        )

    # The rules name loans by their position in the list the caller passed.
    index_of = {id(l): i for i, l in enumerate(loans)}
    # Payoff order: the marginal cost of the next unit prepaid (roadmap PR J)
    # when the caller has it ({id(loan): MarginalCost}), else the effective rate.
    order = (
        {k: mc.order_key for k, mc in marginal_costs.items()} if marginal_costs
        else effective_rates
    )
    ranked = rank_loans(active, order, strategy, country=country, rules=rules, index_of=index_of)
    # A loan whose terms bar an extra payment now (a lock-in) isn't offered:
    # Spare Cash used to send ₹20,000 to a loan the plan itself wouldn't pay.
    blocked = [
        f"{l.bank} {l.loan_type.value.replace('_', ' ')} {prepay_block(l)}"
        for l in ranked if prepay_block(l)
    ]
    ranked = [l for l in ranked if not prepay_block(l)]
    if not ranked:
        return WindfallAllocation(
            to_loan_id=None, loan_label="—", amount=D("0"),
            rationale="None of your loans can take an extra payment yet: "
                      + "; ".join(blocked) + ". Keep the money in savings until then.",
            interest_avoided=D("0"), leftover=amount, blocked=blocked,
        )

    def net_of_fee(l: Loan) -> tuple[Decimal, Decimal, Decimal]:
        paid, fee = _prepay_split(l, amount)
        avoided = interest_saved_by_prepaying(l, paid - fee, country)
        return paid, fee, avoided

    # Layer 3 — invest-vs-prepay gate, loan by loan: the windfall goes to
    # the first loan in payoff order that beats the best liquid return.
    # Checking only the first loan told snowball users to invest while a
    # 42% card was still open, because a small cheap loan came first.
    liquid = [o for o in investment_options
              if o.liquidity_class == LiquidityClass.LIQUID and o.is_in_pool]
    best_return = max((o.expected_return for o in liquid), default=D("0"))
    best = next((o for o in liquid if o.expected_return == best_return), None)
    # The gate compares what the debt costs from here on (the marginal cost's
    # annual_cost: compounded interest + GST − the tax break at the margin),
    # the same number the payoff order uses, not the all-in effective rate,
    # which counts a processing fee already paid (grill #36, sprint G1).
    def gate_rate(l: Loan) -> Decimal:
        mc = (marginal_costs or {}).get(id(l))
        return mc.annual_cost if mc is not None else effective_rates[id(l)]

    rate_ok = [
        l for l in ranked
        if best is None or prepay_recommended(gate_rate(l), best_return, inflation, marginal_tax_rate, prepay_hurdle)
    ]
    # A fee bigger than the interest the payment saves makes prepaying a loss.
    worth = [l for l in rate_ok if net_of_fee(l)[2] > net_of_fee(l)[1]]

    if not worth:
        top = max(ranked, key=gate_rate)
        top_rate = gate_rate(top)
        if rate_ok:
            return WindfallAllocation(
                to_loan_id=None, loan_label=f"{top.bank} {top.loan_type.value}", amount=D("0"),
                rationale="The prepayment fee is more than the interest the payment would save. "
                          + (f"Keep the money in {best.name}." if best else "Keep the money in savings."),
                interest_avoided=D("0"), leftover=amount, blocked=blocked,
            )
        return WindfallAllocation(
            to_loan_id=None, loan_label=f"{top.bank} {top.loan_type.value}", amount=amount,
            rationale=(
                f"{best.name} at {best_return*100:.2f}% "
                + (f"({after_tax_return(best_return, marginal_tax_rate)*100:.2f}% after tax) " if marginal_tax_rate > 0 else "")
                + f"beats your dearest loan ({top_rate*100:.2f}% after any tax benefit)"
            ),
            interest_avoided=interest_saved_by_prepaying(top, min(amount, top.outstanding), country),
            invest_instead=True, investment_name=best.name, investment_return=best_return,
            interest_basis=interest_basis(top, country), blocked=blocked,
        )

    top = worth[0]
    top_rate = effective_rates[id(top)]
    label = f"{top.bank} {top.loan_type.value}"
    to_loan, fee, avoided = net_of_fee(top)

    leftover = amount - to_loan
    nominal = f"{top.nominal_rate*100:.2f}% a year"
    mc = (marginal_costs or {}).get(id(top))
    if mc is not None and (strategy == Strategy.AVALANCHE or top is max(ranked, key=lambda l: order[id(l)])):
        rationale = f"The dearest debt left. {why_first(mc)}"
    elif strategy == Strategy.AVALANCHE or top is max(ranked, key=lambda l: effective_rates[id(l)]):
        if top_rate - top.nominal_rate >= D("0.005"):
            extra = (
                "GST on the interest"
                if country == Country.IN and top.loan_type == LoanType.CREDIT_CARD
                else "its fees and insurance"
            )
            rationale = f"The dearest debt left: {nominal}, {top_rate*100:.2f}% counting {extra}"
        else:
            rationale = f"The dearest debt left, at {nominal}"
    elif strategy == Strategy.SNOWBALL:
        rationale = f"The smallest balance, first in the snowball order you chose ({nominal})"
    else:
        rationale = f"Next in the order your rules set ({nominal})"
    if leftover > 0:
        rationale += f"; clears it with {money(leftover, country)} left over"
    if fee > 0:
        rationale += (
            f"; its {top.prepayment_penalty_pct * 100:.4g}% prepayment fee takes {money(fee, country)}, "
            f"leaving {money(avoided - fee, country)} saved"
        )
    if top.part_payment_freq_months and top.part_payment_freq_months > 1:
        rationale += (
            f"; its terms allow one part-payment every {top.part_payment_freq_months} months, "
            f"so check when you last made one"
        )
    return WindfallAllocation(
        to_loan_id=id(top), loan_label=label, amount=to_loan,
        rationale=rationale, interest_avoided=avoided, leftover=leftover,
        interest_basis=interest_basis(top, country),
        fee=fee, net_benefit=avoided - fee, blocked=blocked,
    )


# ─────────────────────────────────────────────────────────────────────────────
# §8b  New Debt Check  (incl. §4.9 no-cost EMI true cost)
# ─────────────────────────────────────────────────────────────────────────────

@dataclass
class NewDebtVerdict:
    list_price: Decimal
    cash_price: Decimal                     # net of any "EMI-only" discount
    foregone_discount: Decimal
    processing_fee: Decimal
    # Everything paid beyond the cash price: the foregone discount, the
    # processing fee, GST and any interest in the EMIs. Never negative.
    total_real_cost: Decimal
    monthly_emi: Decimal
    effective_apr: Decimal                  # the rate at which what's paid is worth the cash in hand
    verdict: str                            # "take" | "pay_cash" | "delay" | "cant_afford"
    detail: str
    # India: 18% GST on the processing fee, and on a card EMI's interest
    # (a "no-cost" EMI's too: its interest is the discount behind it).
    gst: Decimal = D("0")


MAX_APR = D("10")                           # 1000%: beyond this, say "over"
# A card's "no-cost" EMI hides the bank's rate in the merchant's discount;
# GST is still charged on that interest. Card EMI rates run about 13-16% a
# year in India; 15% is used to estimate it.
NO_COST_EMI_BANK_RATE = D("0.15")
# Lenders' usual ceiling on all loan payments as a share of take-home
# (India's FOIR); the US norm is about 43% of gross pay, which is more
# than that share of take-home, so half of take-home is a fair warning line.
PAYMENTS_SHARE_LIMIT = D("0.50")
# A loan this much dearer than the cheapest bank's advertised rate is worth
# a second quote.
CHEAPER_QUOTE_GAP = D("0.02")


def _pv(payment: Decimal, rate: Decimal, months: int) -> Decimal:
    if rate <= 0:
        return payment * months
    m = rate / D("12")
    return payment * (D("1") - (D("1") + m) ** -months) / m


def _irr_annual(received: Decimal, outflows: list[Decimal]) -> Decimal:
    """The yearly rate (monthly × 12, like an EMI rate) at which the
    payments are worth what was received. 0 when they add up to no more
    than it; MAX_APR when the rate is higher still."""
    if received <= 0 or not outflows or sum(outflows) <= received:
        return D("0")

    def pv(r: Decimal) -> Decimal:
        m, f, total = r / D("12"), D("1"), D("0")
        for out in outflows:
            f /= (D("1") + m)
            total += out * f
        return total

    if pv(MAX_APR) > received:
        return MAX_APR
    lo, hi = D("0"), MAX_APR
    for _ in range(80):
        mid = (lo + hi) / D("2")
        if pv(mid) > received:
            lo = mid
        else:
            hi = mid
    return (lo + hi) / D("2")


def _effective_apr_for_emi(monthly_emi: Decimal, months: int, principal: Decimal) -> Decimal:
    """The yearly rate at which `months` EMIs repay `principal` (what the
    buyer effectively borrows: the cash price less any fee paid up front)."""
    if months <= 0 or monthly_emi <= 0:
        return D("0")
    return _irr_annual(principal, [monthly_emi] * months)


def _card_emi_gst(cash_price: Decimal, monthly_emi: Decimal, months: int) -> list[Decimal]:
    """GST on each month's interest in a card EMI (India). The bank's
    interest is what the EMIs pay over the price it financed; on a
    "no-cost" EMI that's hidden in the discount, so it's estimated at the
    usual card EMI rate."""
    from engine.tax.gst import GST_RATE_IN
    if monthly_emi * months > cash_price:
        principal = cash_price
        rate = _effective_apr_for_emi(monthly_emi, months, principal)
    else:
        rate = NO_COST_EMI_BANK_RATE
        principal = _pv(monthly_emi, rate, months)
    m, balance, out = rate / D("12"), principal, []
    for _ in range(months):
        interest = balance * m
        out.append(interest * GST_RATE_IN)
        balance -= monthly_emi - interest
    return out


def _pct1(r: Decimal) -> str:
    return f"{r * 100:.1f}%"


def evaluate_new_debt(
    list_price: Decimal,
    cash_price_elsewhere: Decimal,
    emi_offer_months: int,
    emi_offer_monthly_payment: Decimal,
    processing_fee: Decimal = D("0"),
    user_savings_after_efund: Decimal = D("0"),
    country: Country = Country.IN,
    monthly_room: Optional[Decimal] = None,
    *,
    card_emi: bool = False,
    savings_return: Optional[Decimal] = None,
    dearest_debt: Optional[tuple[str, Decimal]] = None,
    cheaper_loan: Optional[tuple[str, Decimal]] = None,
    take_home: Optional[Decimal] = None,
    current_payments: Optional[Decimal] = None,
) -> NewDebtVerdict:
    """§8b — compares take-EMI vs pay-cash vs delay. Returns the dominant verdict.

    `cash_price_elsewhere` is the price the user *could* pay in cash (often lower
    than list_price for 0%-EMI items). If unknown, pass the same value as
    list_price (then foregone_discount=0).

    A processing fee paid up front means the buyer borrows less than the
    cash price for the same EMIs, so it raises the effective APR; a
    "no-cost" EMI with a fee is never 0%. In India 18% GST is added to the
    fee, and to a card EMI's interest each month (`card_emi`).

    `monthly_room` is what's left each month after costs and the payments
    already owed (income − expenses − EMIs and card minimums; negative when
    short). When given, an EMI above it is never "take": a $7,294 EMI on a
    $1,300 room read "Take the EMI … if the budget allows".

    `savings_return` is what savings earn a year after tax: paying cash is
    better whenever borrowing costs more than that (10% when not given).
    `dearest_debt` (name, yearly cost) is the user's costliest debt: savings
    clear that first when it costs more than this loan. `cheaper_loan`
    (bank, rate) is the lowest advertised rate for a loan like this one.
    `take_home` and `current_payments` (a month) test the lenders' ceiling.
    """
    if list_price <= 0:
        raise DecisionInputError("list_price", "Enter the price above zero.")
    if cash_price_elsewhere <= 0:
        raise DecisionInputError("cash_price_elsewhere", "Enter the cash price above zero.")
    if not (1 <= emi_offer_months <= 480):
        raise DecisionInputError("emi_offer_months", "The number of EMIs must be between 1 and 480.")
    if emi_offer_monthly_payment <= 0:
        raise DecisionInputError("emi_offer_monthly_payment", "Enter the EMI above zero.")
    if processing_fee < 0:
        raise DecisionInputError("processing_fee", "The processing fee can't be negative.")
    if processing_fee >= cash_price_elsewhere:
        raise DecisionInputError("processing_fee", "The processing fee is more than the price. Check the numbers.")
    if user_savings_after_efund < 0:
        raise DecisionInputError("user_savings_after_efund", "Savings can't be negative.")

    from engine.tax.gst import GST_RATE_IN
    india = country == Country.IN
    foregone = max(D("0"), list_price - cash_price_elsewhere)
    cash_equivalent = cash_price_elsewhere
    months = emi_offer_months
    fee_gst = processing_fee * GST_RATE_IN if india else D("0")
    interest_gst = (
        _card_emi_gst(cash_equivalent, emi_offer_monthly_payment, months)
        if india and card_emi else [D("0")] * months
    )
    gst = fee_gst + sum(interest_gst)
    outflows = [emi_offer_monthly_payment + g for g in interest_gst]
    paid = sum(outflows) + processing_fee + fee_gst
    total_real_cost = max(D("0"), paid - cash_equivalent).quantize(D("1"), rounding=ROUND_HALF_UP)
    apr = _irr_annual(cash_equivalent - processing_fee - fee_gst, outflows)
    apr_text = "over 1000%" if apr >= MAX_APR else f"about {apr*100:.1f}%"
    cost = money(total_real_cost, country)
    gst_text = f", {money(gst.quantize(D('1')), country)} of it GST" if gst >= D("1") else ""

    can_pay_cash = user_savings_after_efund >= cash_equivalent
    fits = monthly_room is None or emi_offer_monthly_payment <= monthly_room
    emi_text = money(emi_offer_monthly_payment, country)
    hurdle = savings_return if savings_return is not None else D("0.10")
    dearer = dearest_debt if dearest_debt is not None and dearest_debt[1] > apr and dearest_debt[1] > hurdle else None
    if can_pay_cash and apr > hurdle and dearer is None:
        verdict = "pay_cash"
        earn = (
            f", more than the {_pct1(savings_return)} your savings earn after tax"
            if savings_return is not None else ""
        )
        detail = f"Borrowing really costs {apr_text} a year{earn}. Paying cash saves {cost}{gst_text}."
    elif not fits:
        room = max(D("0"), monthly_room)
        room_text = (
            f"only {money(room, country)} a month is left"
            if room > 0 else "nothing is left each month"
        )
        if can_pay_cash:
            verdict = "pay_cash"
            detail = (
                f"The {emi_text} EMI doesn't fit: {room_text} after your costs and "
                f"current payments. Your savings cover the price, so pay cash."
            )
        else:
            verdict = "cant_afford"
            detail = (
                f"The {emi_text} EMI doesn't fit: {room_text} after your costs and "
                f"current payments, so it would leave you "
                f"{money(emi_offer_monthly_payment - monthly_room, country)} a month short. "
                f"Borrow less, over more months, or save up first."
            )
    elif apr > D("0.20") and dearer is None:
        verdict = "delay"
        detail = f"Borrowing really costs {apr_text} a year: too dear. Save up first; the loan costs {cost} more than cash{gst_text}."
    else:
        verdict = "take"
        budget = (
            "Check the EMI fits your budget." if monthly_room is None else
            f"The {emi_text} EMI leaves {money(monthly_room - emi_offer_monthly_payment, country)} "
            f"a month after your costs and payments."
        )
        if dearer is not None and can_pay_cash:
            detail = (
                f"Borrowing costs {apr_text} a year, less than the {_pct1(dearer[1])} "
                f"your {dearer[0]} costs. Put your savings on that and take this EMI. {budget}"
            )
        elif total_real_cost > 0:
            detail = f"Borrowing really costs {apr_text} a year. {budget} It costs {cost} more than paying cash{gst_text}."
        else:
            detail = f"Borrowing costs no more than paying cash. {budget}"
        if cheaper_loan is not None and apr - cheaper_loan[1] >= CHEAPER_QUOTE_GAP:
            detail += (
                f" {cheaper_loan[0]} advertises loans like this from {_pct1(cheaper_loan[1])}: "
                f"worth asking for a quote."
            )
    # A card EMI is drawn on the card's limit: no lender approves it.
    if (not card_emi and take_home is not None and take_home > 0
            and current_payments is not None and verdict != "pay_cash"):
        share = (current_payments + emi_offer_monthly_payment) / take_home
        if share > PAYMENTS_SHARE_LIMIT:
            detail += (
                f" With it, loan payments take {share * 100:.0f}% of your take-home; "
                f"lenders rarely approve past about half, so expect a smaller loan or a refusal."
            )

    return NewDebtVerdict(
        list_price=list_price, cash_price=cash_price_elsewhere,
        foregone_discount=foregone, processing_fee=processing_fee,
        total_real_cost=total_real_cost,
        monthly_emi=emi_offer_monthly_payment,
        effective_apr=apr, verdict=verdict, detail=detail,
        gst=gst.quantize(D("0.01")),
    )


# ─────────────────────────────────────────────────────────────────────────────
# §8d  Quick Recompute  ("I just paid ₹X extra")
# ─────────────────────────────────────────────────────────────────────────────

@dataclass
class QuickRecomputeResult:
    old_debt_free_month: int | None
    new_debt_free_month: int | None
    months_pulled_forward: int
    interest_saved: Decimal


def quick_recompute(
    old_total_interest: Decimal,
    new_total_interest: Decimal,
    old_debt_free_month: int | None,
    new_debt_free_month: int | None,
) -> QuickRecomputeResult:
    """§8d — caller runs simulate_plan() before/after applying the extra payment
    and passes the two summaries in. This module just diffs them for the UI.
    """
    pulled = D("0")
    if old_debt_free_month and new_debt_free_month:
        pulled = old_debt_free_month - new_debt_free_month
    interest_saved = old_total_interest - new_total_interest
    return QuickRecomputeResult(
        old_debt_free_month=old_debt_free_month,
        new_debt_free_month=new_debt_free_month,
        months_pulled_forward=int(pulled) if isinstance(pulled, Decimal) else pulled,
        interest_saved=interest_saved,
    )


# ─────────────────────────────────────────────────────────────────────────────
# §8e  Cash Yield Check
# ─────────────────────────────────────────────────────────────────────────────

@dataclass
class CashYieldAlert:
    idle_balance: Decimal
    current_yield: Decimal
    best_alt_yield: Decimal
    alt_name: str                       # "HYSA at 4.25%" / "Liquid fund at 6.5%"
    annual_uplift: Decimal              # (best − current) × idle_balance
    beats_top_loan: bool                # uplift > prepaying highest-rate loan on same $$
    rationale: str


# Country defaults — caller can override. From market-data.json, re-read
# weekly: India, the 91-day T-bill cut-off (about what a liquid fund earns
# before its fees); US, a top online savings account's APY.
DEFAULT_BEST_LIQUID = {
    Country.IN: (safe_rate("liquid_in"), f"Liquid fund {approx_pct(safe_rate('liquid_in'))}"),
    Country.US: (safe_rate("hysa_us"), f"HYSA top-tier {approx_pct(safe_rate('hysa_us'))}"),
}


def cash_yield_check(
    idle_balance: Decimal,
    current_yield: Decimal,
    country: Country,
    top_loan_effective_rate: Decimal | None = None,
    best_alt_yield: Decimal | None = None,
    alt_name: str | None = None,
    minimum_idle_threshold: Decimal = D("10000"),
) -> CashYieldAlert | None:
    """§8e — nudges idle cash to a higher-yield home. Returns None if either
    idle_balance is below threshold or the gap is < 1pp (not worth the friction).
    """
    if idle_balance < minimum_idle_threshold:
        return None
    if best_alt_yield is None:
        best_alt_yield, alt_name = DEFAULT_BEST_LIQUID[country]

    gap = best_alt_yield - current_yield
    if gap < D("0.01"):
        return None

    uplift = gap * idle_balance
    beats_loan = False
    rationale = (
        f"Moving from {current_yield*100:.2f}% → {best_alt_yield*100:.2f}% "
        f"earns +{money(uplift, country)}/yr."
    )
    if top_loan_effective_rate is not None:
        # Both options give up the current yield: moving the cash gains
        # (alt − current), prepaying gains (loan rate − current). Comparing
        # the gap with the whole loan rate always favoured prepaying.
        prepay_uplift = (top_loan_effective_rate - current_yield) * idle_balance
        if uplift > prepay_uplift:
            beats_loan = True
            rationale += f" Beats prepaying your top loan ({top_loan_effective_rate*100:.2f}%)."
        else:
            rationale += f" Note: prepaying top loan at {top_loan_effective_rate*100:.2f}% would save more."

    return CashYieldAlert(
        idle_balance=idle_balance, current_yield=current_yield,
        best_alt_yield=best_alt_yield, alt_name=alt_name or "",
        annual_uplift=uplift, beats_top_loan=beats_loan, rationale=rationale,
    )
