"""Decision sub-modules — Tools surface §8a–§8f (excluding §8c, in asset_liquidation.py).

Each returns a single decision with the key number. Inputs are kept narrow so
each can be wired to a focused UI screen.
"""
from decimal import ROUND_HALF_UP, Decimal
from dataclasses import dataclass, field
from datetime import date
from engine.models import Loan, Country, LoanType, InvestmentOption, LiquidityClass
from engine.formulas import emi, effective_rate, prepay_recommended
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


def interest_saved_by_prepaying(loan: Loan, prepay: Decimal) -> Decimal:
    """Interest avoided by paying `prepay` off `loan` now, keeping the EMI so
    the loan finishes sooner (the usual default after a part-payment).

    Works the loan month by month. If the scheduled EMI is missing or does
    not cover the interest (a card's minimum payment), the EMI that clears
    the balance over the months left (at least one) is used instead.
    """
    balance, rate = loan.outstanding, loan.nominal_rate
    prepay = min(prepay, balance)
    if prepay <= 0 or rate <= 0:
        return D("0")
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
    # Interest the prepayment avoids over the loan's remaining life. When
    # investing wins, the interest given up by not prepaying. Never negative.
    interest_avoided: Decimal
    invest_instead: bool = False
    investment_name: str | None = None
    investment_return: Decimal | None = None
    leftover: Decimal = D("0")              # windfall beyond the loan's balance


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

    # Layer 3 — invest-vs-prepay gate, loan by loan: the windfall goes to
    # the first loan in payoff order that beats the best liquid return.
    # Checking only the first loan told snowball users to invest while a
    # 42% card was still open, because a small cheap loan came first.
    liquid = [o for o in investment_options
              if o.liquidity_class == LiquidityClass.LIQUID and o.is_in_pool]
    best_return = max((o.expected_return for o in liquid), default=D("0"))
    best = next((o for o in liquid if o.expected_return == best_return), None)
    worth = [
        l for l in ranked
        if best is None or prepay_recommended(effective_rates[id(l)], best_return, inflation)
    ]

    if not worth:
        top = max(ranked, key=lambda l: effective_rates[id(l)])
        top_rate = effective_rates[id(top)]
        return WindfallAllocation(
            to_loan_id=None, loan_label=f"{top.bank} {top.loan_type.value}", amount=amount,
            rationale=f"Best liquid return {best_return*100:.2f}% beats your costliest loan ({top_rate*100:.2f}%) after inflation",
            interest_avoided=interest_saved_by_prepaying(top, min(amount, top.outstanding)),
            invest_instead=True, investment_name=best.name, investment_return=best_return,
        )

    top = worth[0]
    top_rate = effective_rates[id(top)]
    label = f"{top.bank} {top.loan_type.value}"
    to_loan = min(amount, top.outstanding)
    avoided = interest_saved_by_prepaying(top, to_loan)

    leftover = amount - to_loan
    if strategy == Strategy.AVALANCHE or top is max(ranked, key=lambda l: effective_rates[id(l)]):
        rationale = f"Highest effective rate ({top_rate*100:.2f}%)"
    elif strategy == Strategy.SNOWBALL:
        rationale = f"Smallest balance first, your chosen order ({top_rate*100:.2f}%)"
    else:
        rationale = f"Next in your hybrid order ({top_rate*100:.2f}%)"
    if leftover > 0:
        rationale += f"; clears it with {money(leftover, country)} left over"
    return WindfallAllocation(
        to_loan_id=id(top), loan_label=label, amount=to_loan,
        rationale=rationale, interest_avoided=avoided, leftover=leftover,
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
    verdict: str                            # "take" | "pay_cash" | "delay"
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
) -> NewDebtVerdict:
    """§8b — compares take-EMI vs pay-cash vs delay. Returns the dominant verdict.

    `cash_price_elsewhere` is the price the user *could* pay in cash (often lower
    than list_price for 0%-EMI items). If unknown, pass the same value as
    list_price (then foregone_discount=0).

    A processing fee paid up front means the buyer borrows less than the
    cash price for the same EMIs, so it raises the effective APR; a
    "no-cost" EMI with a fee is never 0%.
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
    apr_text = "over 1000%" if apr >= MAX_APR else f"≈ {apr*100:.1f}%"
    cost = money(total_real_cost, country)

    can_pay_cash = user_savings_after_efund >= cash_equivalent
    if can_pay_cash and apr > D("0.10"):
        verdict = "pay_cash"
        detail = f"Real APR {apr_text}. Paying cash saves {cost} over the EMI plan."
    elif apr > D("0.20"):
        verdict = "delay"
        detail = f"Real APR {apr_text}: too costly. Save up first; the EMI plan costs {cost} more than cash."
    else:
        verdict = "take"
        detail = (
            f"Real APR {apr_text}. Acceptable; take the EMI if the budget allows. "
            f"It costs {cost} more than paying cash."
            if total_real_cost > 0 else
            f"Real APR {apr_text}. The EMI plan costs no more than paying cash; take it if the budget allows."
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
    alt_name: str                       # "HYSA at 4.5%" / "Liquid fund at 6.8%"
    annual_uplift: Decimal              # (best − current) × idle_balance
    beats_top_loan: bool                # uplift > prepaying highest-rate loan on same $$
    rationale: str


# Country defaults (May 2026, verified) — caller can override
DEFAULT_BEST_LIQUID = {
    Country.IN: (D("0.068"), "Liquid mutual fund ~6.8%"),    # short-duration liquid fund
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
    verdict: str                          # "borrow_now" | "wait"
    estimated_savings: Decimal            # principal × (Δr) × tenure_years
    detail: str


def right_time_to_borrow(
    current_rate: Decimal,
    six_month_avg: Decimal,
    consensus_change_bps: int,
    months_to_decision: int,
    urgency: str,
    principal: Decimal,
    tenure_months: int,
    country: Country = Country.IN,
) -> BorrowTimingVerdict:
    """§8f — three inputs from market context, one from the user (urgency).

    Verdict is `wait` only if: (a) user can wait AND (b) cut is meaningful AND
    (c) decision is soon enough that delay cost < expected savings.
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
    if can_wait and consensus_change_bps <= -25 and months_to_decision <= 6 and estimated_savings > worth_waiting:
        verdict = "wait"
        detail = (f"Rates {current_rate*100:.2f}% now vs {six_month_avg*100:.2f}% avg. "
                  f"Cut of {-consensus_change_bps}bps expected in {months_to_decision}m → "
                  f"save ~{money(estimated_savings, country)} over tenure. Defer if possible.")
    else:
        verdict = "borrow_now"
        if not can_wait:
            detail = "User flagged urgent — borrow now; locking the current rate is the right call."
        elif consensus_change_bps > 0:
            detail = f"Hike of {consensus_change_bps}bps expected — borrow now to lock current rate."
        else:
            detail = f"No meaningful change expected ({consensus_change_bps:+d}bps). Borrow now."

    return BorrowTimingVerdict(
        current_rate=current_rate, six_month_avg=six_month_avg,
        consensus_change_bps=consensus_change_bps,
        months_to_decision=months_to_decision, urgency=urgency,
        verdict=verdict, estimated_savings=estimated_savings, detail=detail,
    )
