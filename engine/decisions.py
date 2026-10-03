"""Decision sub-modules — Tools surface §8a–§8f (excluding §8c, in asset_liquidation.py).

Each returns a single decision with the key number. Inputs are kept narrow so
each can be wired to a focused UI screen.
"""
from decimal import ROUND_HALF_UP, Decimal
from dataclasses import dataclass, field, replace
from datetime import date
from typing import Optional
from engine.models import Loan, Country, LoanType, InvestmentOption, LiquidityClass
from engine.formulas import emi, effective_rate, prepay_recommended
from engine.minimum_payments import compute_minimum_payment
from engine.loan_check import _inr
from engine.ordering import Strategy, rank_loans

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

    ranked = rank_loans(active, effective_rates, strategy, country=country)
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
    rate_ok = [
        l for l in ranked
        if best is None or prepay_recommended(effective_rates[id(l)], best_return, inflation)
    ]
    # A fee bigger than the interest the payment saves makes prepaying a loss.
    worth = [l for l in rate_ok if net_of_fee(l)[2] > net_of_fee(l)[1]]

    if not worth:
        top = max(ranked, key=lambda l: effective_rates[id(l)])
        top_rate = effective_rates[id(top)]
        if rate_ok:
            return WindfallAllocation(
                to_loan_id=None, loan_label=f"{top.bank} {top.loan_type.value}", amount=D("0"),
                rationale="The prepayment fee is more than the interest the payment would save. "
                          + (f"Keep the money in {best.name}." if best else "Keep the money in savings."),
                interest_avoided=D("0"), leftover=amount, blocked=blocked,
            )
        return WindfallAllocation(
            to_loan_id=None, loan_label=f"{top.bank} {top.loan_type.value}", amount=amount,
            rationale=f"Best liquid return {best_return*100:.2f}% beats your costliest loan ({top_rate*100:.2f}%) after inflation",
            interest_avoided=interest_saved_by_prepaying(top, min(amount, top.outstanding), country),
            invest_instead=True, investment_name=best.name, investment_return=best_return,
            interest_basis=interest_basis(top, country), blocked=blocked,
        )

    top = worth[0]
    top_rate = effective_rates[id(top)]
    label = f"{top.bank} {top.loan_type.value}"
    to_loan, fee, avoided = net_of_fee(top)

    leftover = amount - to_loan
    if strategy == Strategy.AVALANCHE or top is max(ranked, key=lambda l: effective_rates[id(l)]):
        rationale = f"Highest effective rate ({top_rate*100:.2f}%)"
    elif strategy == Strategy.SNOWBALL:
        rationale = f"Smallest balance first, your chosen order ({top_rate*100:.2f}%)"
    else:
        rationale = f"Next in your hybrid order ({top_rate*100:.2f}%)"
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
    # processing fee and any interest in the EMIs. Never negative.
    total_real_cost: Decimal
    monthly_emi: Decimal
    effective_apr: Decimal                  # solved so NPV(payments) = cash price − fee
    verdict: str                            # "take" | "pay_cash" | "delay" | "cant_afford"
    detail: str


MAX_APR = D("10")                           # 1000%: beyond this, say "over"


def _effective_apr_for_emi(monthly_emi: Decimal, months: int, principal: Decimal) -> Decimal:
    """Bisect for the annual rate r where EMI matches. Principal here is what
    the buyer effectively borrows: the cash price less any fee paid up front.
    Returns 0 when the payments add up to no more than the principal, and
    MAX_APR when the rate is higher still.
    """
    if principal <= 0 or monthly_emi <= 0 or months <= 0:
        return D("0")
    if monthly_emi * months <= principal:
        return D("0")
    lo, hi = D("0"), MAX_APR
    if emi(principal, hi, months) < monthly_emi:
        return MAX_APR
    for _ in range(80):
        mid = (lo + hi) / D("2")
        guess = emi(principal, mid, months)
        if guess > monthly_emi:
            hi = mid
        else:
            lo = mid
    return (lo + hi) / D("2")


def evaluate_new_debt(
    list_price: Decimal,
    cash_price_elsewhere: Decimal,
    emi_offer_months: int,
    emi_offer_monthly_payment: Decimal,
    processing_fee: Decimal = D("0"),
    user_savings_after_efund: Decimal = D("0"),
    country: Country = Country.IN,
    monthly_room: Optional[Decimal] = None,
) -> NewDebtVerdict:
    """§8b — compares take-EMI vs pay-cash vs delay. Returns the dominant verdict.

    `cash_price_elsewhere` is the price the user *could* pay in cash (often lower
    than list_price for 0%-EMI items). If unknown, pass the same value as
    list_price (then foregone_discount=0).

    A processing fee paid up front means the buyer borrows less than the
    cash price for the same EMIs, so it raises the effective APR; a
    "no-cost" EMI with a fee is never 0%.

    `monthly_room` is what's left each month after costs and the payments
    already owed (income − expenses − EMIs and card minimums; negative when
    short). When given, an EMI above it is never "take": a $7,294 EMI on a
    $1,300 room read "Take the EMI … if the budget allows".
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

    foregone = max(D("0"), list_price - cash_price_elsewhere)
    cash_equivalent = cash_price_elsewhere
    paid = emi_offer_monthly_payment * emi_offer_months + processing_fee
    total_real_cost = max(D("0"), paid - cash_equivalent).quantize(D("1"), rounding=ROUND_HALF_UP)
    apr = _effective_apr_for_emi(emi_offer_monthly_payment, emi_offer_months, cash_equivalent - processing_fee)
    apr_text = "over 1000%" if apr >= MAX_APR else f"about {apr*100:.1f}%"
    cost = money(total_real_cost, country)

    can_pay_cash = user_savings_after_efund >= cash_equivalent
    fits = monthly_room is None or emi_offer_monthly_payment <= monthly_room
    emi_text = money(emi_offer_monthly_payment, country)
    if can_pay_cash and apr > D("0.10"):
        verdict = "pay_cash"
        detail = f"Borrowing really costs {apr_text} a year. Paying cash saves {cost}."
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
    elif apr > D("0.20"):
        verdict = "delay"
        detail = f"Borrowing really costs {apr_text} a year: too dear. Save up first; the loan costs {cost} more than cash."
    else:
        verdict = "take"
        budget = (
            "Check the EMI fits your budget." if monthly_room is None else
            f"The {emi_text} EMI leaves {money(monthly_room - emi_offer_monthly_payment, country)} "
            f"a month after your costs and payments."
        )
        detail = (
            f"Borrowing really costs {apr_text} a year, which is reasonable. {budget} "
            f"It costs {cost} more than paying cash."
            if total_real_cost > 0 else
            f"Borrowing costs no more than paying cash. {budget}"
        )

    return NewDebtVerdict(
        list_price=list_price, cash_price=cash_price_elsewhere,
        foregone_discount=foregone, processing_fee=processing_fee,
        total_real_cost=total_real_cost,
        monthly_emi=emi_offer_monthly_payment,
        effective_apr=apr, verdict=verdict, detail=detail,
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


# Country defaults (Sep 2026) — caller can override. A liquid fund's yield
# to maturity was about 6.5% in early Sep 2026 (repo 5.25%); top online
# savings accounts paid about 4.25%.
DEFAULT_BEST_LIQUID = {
    Country.IN: (D("0.065"), "Liquid mutual fund ~6.5%"),    # short-duration liquid fund
    Country.US: (D("0.0425"), "HYSA top-tier ~4.25%"),
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


# ─────────────────────────────────────────────────────────────────────────────
# §8f  Right-Time-to-Borrow Advisor
# ─────────────────────────────────────────────────────────────────────────────

@dataclass
class BorrowTimingVerdict:
    current_rate: Decimal
    six_month_avg: Decimal
    consensus_change_bps: int             # negative = cut expected; positive = hike
    months_to_decision: int
    urgency: str                          # "now" | "3m_ok" | "6m_ok"
    verdict: str                          # "borrow_now" | "wait" | "cant_afford"
    estimated_savings: Decimal            # principal × (Δr) × tenure_years
    detail: str
    monthly_payment: Decimal = D("0")     # the EMI at today's rate
    monthly_room: Optional[Decimal] = None
    # Filled when the verdict comes from market odds (right_time_from_odds).
    cut_chance: Optional[Decimal] = None      # chance of a net cut by wait_until
    rise_chance: Optional[Decimal] = None
    saving_if_cut: Optional[Decimal] = None   # the saving if the cut comes
    wait_until: Optional[date] = None         # the decision the odds run to
    rate_floats: bool = False


def _fits(verdict: str, detail: str, payment: Decimal, monthly_room: Optional[Decimal],
          country: Country) -> tuple[str, str]:
    """The EMI against what is left each month: `cant_afford` when it
    doesn't fit, whatever the timing said."""
    if monthly_room is None:
        return verdict, detail + " This judges the timing only: it doesn't know your income, costs or other payments."
    if payment > monthly_room:
        room = max(D("0"), monthly_room)
        room_text = f"only {money(room, country)} a month is left" if room > 0 else "nothing is left each month"
        return "cant_afford", (
            f"The {money(payment, country)} EMI doesn't fit: {room_text} after your costs and "
            f"payments, {money(payment - monthly_room, country)} a month short. Borrow less or "
            f"over longer, or free up room first. On timing alone: {detail}"
        )
    return verdict, detail + (
        f" The {money(payment, country)} EMI leaves {money(monthly_room - payment, country)} "
        f"a month after your costs and payments."
    )


def right_time_to_borrow(
    current_rate: Decimal,
    six_month_avg: Decimal,
    consensus_change_bps: int,
    months_to_decision: int,
    urgency: str,
    principal: Decimal,
    tenure_months: int,
    country: Country = Country.IN,
    monthly_room: Optional[Decimal] = None,
) -> BorrowTimingVerdict:
    """§8f — three inputs from market context, one from the user (urgency).

    Verdict is `wait` only if: (a) user can wait AND (b) cut is meaningful AND
    (c) decision is soon enough that delay cost < expected savings.

    `monthly_room` is what the user has left each month after costs and
    current payments. An EMI above it is `cant_afford` whatever the timing:
    "borrow now" used to go to a $7,294 EMI on $1,300 of room. Without it
    the verdict says it only judged the timing.
    """
    bps_delta = D(consensus_change_bps) / D("10000")
    # Interest saved over the loan if the rate is lower by the expected cut:
    # EMIs at both rates times the tenure. "Cut × principal × years" charged
    # the cut on the whole principal every year, about double for a long
    # loan, because the balance falls as it is repaid.
    estimated_savings = D("0")
    if bps_delta < 0 and principal > 0 and tenure_months > 0:
        lower = max(D("0"), current_rate + bps_delta)
        estimated_savings = max(
            D("0"),
            (emi(principal, current_rate, tenure_months) - emi(principal, lower, tenure_months))
            * D(tenure_months),
        ).quantize(D("1"), rounding=ROUND_HALF_UP)
    worth_waiting = D("5000") if country == Country.IN else D("100")

    can_wait = urgency in ("3m_ok", "6m_ok")
    # Moves in plain percent: "a 0.25% cut", never "25bps".
    move = f"{D(abs(consensus_change_bps)) / D(100):.2f}%"
    months = f"{months_to_decision} month{'' if months_to_decision == 1 else 's'}"
    if can_wait and consensus_change_bps <= -25 and months_to_decision <= 6 and estimated_savings > worth_waiting:
        verdict = "wait"
        detail = (f"A {move} cut is expected in {months}. Waiting for it saves about "
                  f"{money(estimated_savings, country)} over the loan.")
    else:
        verdict = "borrow_now"
        if not can_wait:
            detail = "You need it now, so borrow now and lock in today's rate."
        elif consensus_change_bps > 0:
            detail = f"A {move} rise is expected. Borrow now to lock in today's rate."
        elif consensus_change_bps == 0:
            detail = "No change is expected. Borrow now."
        elif consensus_change_bps > -25:
            detail = f"Only a {move} cut is expected, too small to wait for. Borrow now."
        # A real cut that is too far off, or too small to matter, used to
        # read "no meaningful change expected" as well.
        elif months_to_decision > 6:
            detail = f"A {move} cut is expected in {months}, too long to put the loan off. Borrow now."
        else:
            detail = (f"A {move} cut would save only about {money(estimated_savings, country)} "
                      f"over the loan, not worth waiting for. Borrow now.")

    payment = (
        emi(principal, current_rate, tenure_months).quantize(D("0.01"), rounding=ROUND_HALF_UP)
        if principal > 0 and tenure_months > 0 else D("0")
    )
    verdict, detail = _fits(verdict, detail, payment, monthly_room, country)

    return BorrowTimingVerdict(
        current_rate=current_rate, six_month_avg=six_month_avg,
        consensus_change_bps=consensus_change_bps,
        months_to_decision=months_to_decision, urgency=urgency,
        verdict=verdict, estimated_savings=estimated_savings, detail=detail,
        monthly_payment=payment, monthly_room=monthly_room,
    )


@dataclass(frozen=True)
class MeetingMoves:
    """One upcoming rate decision and the market's chance of each move:
    (change in basis points, chance), the chances summing to 1."""
    day: date
    moves: tuple[tuple[int, Decimal], ...]


# How long each urgency can put the loan off.
_WAIT_DAYS = {"now": 0, "3m_ok": 92, "6m_ok": 183}


def _combined(meetings: list[MeetingMoves]) -> dict[int, Decimal]:
    """The total move over several decisions, taking each as independent."""
    dist = {0: D("1")}
    for m in meetings:
        nxt: dict[int, Decimal] = {}
        for a, pa in dist.items():
            for b, pb in m.moves:
                nxt[a + b] = nxt.get(a + b, D("0")) + pa * pb
        dist = nxt
    return dist


def _day(d: date) -> str:
    return f"{d.day:02d} {d.strftime('%b %Y')}"


def _pct(p: Decimal) -> str:
    return f"{int((p * 100).quantize(D('1'), rounding=ROUND_HALF_UP))}%"


def right_time_from_odds(
    current_rate: Decimal,
    principal: Decimal,
    tenure_months: int,
    urgency: str,
    meetings: Optional[list[MeetingMoves]],
    today: date,
    country: Country = Country.IN,
    monthly_room: Optional[Decimal] = None,
    rate_floats: bool = False,
    next_meeting: Optional[date] = None,
) -> BorrowTimingVerdict:
    """Borrow now or wait, on the market's odds rather than a guess.

    Asking people what they expect the central bank to do asked them for
    the answer. Prediction markets price each outcome of each decision;
    `meetings` carries those odds (None when none could be had).

    - A floating rate follows the policy rate after you borrow, cuts and
      rises alike, so timing gains nothing: borrow when you need it.
    - A fixed rate is set the day you borrow. Waiting pays when a cut is
      more likely than not by a decision you can wait for, and the saving
      on the odds (rises counted against it) is worth having.

    The saving is the EMI at today's rate less the EMI after the move, over
    the whole term, weighted by each move's chance; the decision the odds
    run to is the first at which a cut becomes more likely than not.
    """
    bank = "RBI" if country == Country.IN else "Fed"
    worth_waiting = D("5000") if country == Country.IN else D("100")
    can_wait = urgency in ("3m_ok", "6m_ok")
    horizon = today.toordinal() + _WAIT_DAYS.get(urgency, 0)
    upcoming = sorted((m for m in (meetings or []) if m.day >= today), key=lambda m: m.day)
    in_window = [m for m in upcoming if m.day.toordinal() <= horizon]

    def saving(bps: int) -> Decimal:
        """Interest saved over the loan if the rate moves by `bps` (a rise
        saves a negative amount)."""
        if principal <= 0 or tenure_months <= 0:
            return D("0")
        moved = max(D("0"), current_rate + D(bps) / D("10000"))
        return (emi(principal, current_rate, tenure_months) - emi(principal, moved, tenure_months)) * D(tenure_months)

    # Run the odds to the first decision where a cut is more likely than
    # not; failing that, to the last one before the loan is needed.
    upto = in_window
    for k in range(1, len(in_window) + 1):
        dist = _combined(in_window[:k])
        if sum((p for b, p in dist.items() if b < 0), D("0")) >= D("0.5"):
            upto = in_window[:k]
            break
    dist = _combined(upto) if upto else {0: D("1")}
    cut = sum((p for b, p in dist.items() if b < 0), D("0"))
    rise = sum((p for b, p in dist.items() if b > 0), D("0"))
    expected_bps = sum((p * b for b, p in dist.items()), D("0"))
    expected = sum((p * saving(b) for b, p in dist.items()), D("0")).quantize(D("1"), rounding=ROUND_HALF_UP)
    if_cut = (
        (sum((p * saving(b) for b, p in dist.items() if b < 0), D("0")) / cut).quantize(D("1"), rounding=ROUND_HALF_UP)
        if cut > 0 else None
    )
    until = upto[-1].day if upto else None
    by = f"by the {bank} decision on {_day(until)}" if until else ""

    first = upcoming[0] if upcoming else None
    first_cut = (
        sum((p for b, p in first.moves if b < 0), D("0")) if first else D("0")
    )

    verdict = "borrow_now"
    if meetings is None:
        detail = (f"No market odds for the next {bank} decision right now, so this goes on "
                  f"today's rate: borrow now. Check again in a day or two.")
    elif rate_floats:
        detail = (f"The rate on this loan floats with the {bank} rate, so a cut reaches it after you "
                  f"borrow too, and so would a rise. Timing gains nothing: borrow when you need it.")
    elif not can_wait:
        if first and first_cut >= D("0.5"):
            detail = (f"You need it now, so borrow now. Markets give a {_pct(first_cut)} chance of a "
                      f"{bank} cut on {_day(first.day)}: a floating rate would follow it down, a fixed one won't.")
        else:
            detail = "You need it now, so borrow now and lock in today's rate."
    elif not in_window:
        nxt = first.day if first else next_meeting
        detail = (f"No {bank} decision falls before you need the loan"
                  + (f" (the next is on {_day(nxt)})" if nxt else "") + ". Borrow now.")
    elif cut >= D("0.5") and expected > worth_waiting:
        verdict = "wait"
        detail = (f"Markets give a {_pct(cut)} chance of a cut {by}. On those odds, waiting until then "
                  f"saves about {money(expected, country)} over the loan"
                  + (f" ({money(if_cut, country)} if the cut comes)" if if_cut else "") + ".")
    elif rise > cut:
        detail = (f"Markets lean to a rise: a {_pct(rise)} chance {by}, against {_pct(cut)} for a cut. "
                  f"Borrow now to lock in today's rate.")
    elif cut < D("0.5"):
        detail = (f"Markets give only a {_pct(cut)} chance of a cut {by}, so waiting most likely "
                  f"gains nothing. Borrow now.")
    else:
        detail = (f"A cut is likely ({_pct(cut)} {by}), but on those odds it saves only about "
                  f"{money(max(expected, D('0')), country)} over the loan, not worth waiting for. Borrow now.")

    payment = (
        emi(principal, current_rate, tenure_months).quantize(D("0.01"), rounding=ROUND_HALF_UP)
        if principal > 0 and tenure_months > 0 else D("0")
    )
    verdict, detail = _fits(verdict, detail, payment, monthly_room, country)
    if len(upto) > 1:
        detail += " Combined odds assume the meetings are independent; decisions can affect later meetings, so this is an estimate."
    months = max(0, round((until.toordinal() - today.toordinal()) / 30.4)) if until else 0
    return BorrowTimingVerdict(
        current_rate=current_rate, six_month_avg=current_rate,
        consensus_change_bps=int(expected_bps.quantize(D("1"), rounding=ROUND_HALF_UP)),
        months_to_decision=months, urgency=urgency,
        # A floating rate gets the cut anyway, and "now" can't wait for it.
        verdict=verdict,
        estimated_savings=max(expected, D("0")) if can_wait and not rate_floats else D("0"),
        detail=detail, monthly_payment=payment, monthly_room=monthly_room,
        cut_chance=cut.quantize(D("0.0001")) if upto else None,
        rise_chance=rise.quantize(D("0.0001")) if upto else None,
        saving_if_cut=if_cut, wait_until=until, rate_floats=rate_floats,
    )
