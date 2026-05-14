"""Decision sub-modules — Tools surface §8a–§8f (excluding §8c, in asset_liquidation.py).

Each returns a single decision with the key number. Inputs are kept narrow so
each can be wired to a focused UI screen.
"""
from decimal import Decimal
from dataclasses import dataclass, field
from datetime import date
from engine.models import Loan, Country, LoanType, InvestmentOption, LiquidityClass
from engine.formulas import emi, effective_rate, prepay_recommended
from engine.ordering import Strategy, rank_loans

D = Decimal


# ─────────────────────────────────────────────────────────────────────────────
# §8a  Windfall Handler
# ─────────────────────────────────────────────────────────────────────────────

@dataclass
class WindfallAllocation:
    to_loan_id: int | None
    loan_label: str
    amount: Decimal
    rationale: str                          # e.g. "highest effective rate (38.4%)"
    interest_avoided: Decimal               # estimated interest avoided across loan tenure
    invest_instead: bool = False
    investment_name: str | None = None


def allocate_windfall(
    amount: Decimal,
    loans: list[Loan],
    effective_rates: dict[int, Decimal],
    investment_options: list[InvestmentOption],
    inflation: Decimal,
    strategy: Strategy = Strategy.AVALANCHE,
) -> WindfallAllocation:
    """§8a — single decision, not a plan. Runs Layer 1 logic (already done at scan
    time), then Layer 2 ranking, then Layer 3 invest-vs-prepay gate on the top
    candidate.
    """
    active = [l for l in loans if l.outstanding > 0]
    if not active or amount <= 0:
        return WindfallAllocation(
            to_loan_id=None, loan_label="—", amount=amount,
            rationale="No outstanding debt", interest_avoided=D("0"),
        )

    ranked = rank_loans(active, effective_rates, strategy)
    top = ranked[0]
    top_rate = effective_rates[id(top)]

    # Layer 3 — invest-vs-prepay gate
    liquid = [o for o in investment_options
              if o.liquidity_class == LiquidityClass.LIQUID and o.is_in_pool]
    best_return = max((o.expected_return for o in liquid), default=D("0"))
    best = next((o for o in liquid if o.expected_return == best_return), None)

    if best is not None and not prepay_recommended(top_rate, best_return, inflation):
        # Invest instead
        years_horizon = D("3")    # short-horizon comparison
        interest_avoided_if_paid = top_rate * amount * years_horizon
        return WindfallAllocation(
            to_loan_id=None, loan_label=f"{top.bank} {top.loan_type.value}",
            amount=amount,
            rationale=f"Best liquid return {best_return*100:.2f}% beats loan effective {top_rate*100:.2f}% post-inflation",
            interest_avoided=interest_avoided_if_paid * D("-1"),
            invest_instead=True, investment_name=best.name,
        )

    # Estimate interest avoided: rate × amount × remaining-tenure-years
    years_remaining = D(top.tenure_months_remaining) / D("12") if top.tenure_months_remaining else D("1")
    interest_avoided = top_rate * amount * years_remaining
    cap = min(amount, top.outstanding)
    return WindfallAllocation(
        to_loan_id=id(top), loan_label=f"{top.bank} {top.loan_type.value}",
        amount=cap,
        rationale=f"Highest effective rate ({top_rate*100:.2f}%)",
        interest_avoided=interest_avoided,
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
    total_real_cost: Decimal                # foregone_discount + processing_fee
    monthly_emi: Decimal
    effective_apr: Decimal                  # solved so NPV(payments)=cash_price
    verdict: str                            # "take" | "pay_cash" | "delay"
    detail: str


def _effective_apr_for_emi(monthly_emi: Decimal, months: int, principal: Decimal) -> Decimal:
    """Bisect for the annual rate r where EMI matches. Principal here is the
    true cash equivalent (cash_price), not list_price.
    """
    if principal <= 0 or monthly_emi <= 0 or months <= 0:
        return D("0")
    lo, hi = D("0"), D("2")        # 0% to 200% APR brackets
    for _ in range(64):
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
) -> NewDebtVerdict:
    """§8b — compares take-EMI vs pay-cash vs delay. Returns the dominant verdict.

    `cash_price_elsewhere` is the price the user *could* pay in cash (often lower
    than list_price for 0%-EMI items). If unknown, pass the same value as
    list_price (then foregone_discount=0).
    """
    foregone = max(D("0"), list_price - cash_price_elsewhere)
    total_real_cost = foregone + processing_fee
    cash_equivalent = cash_price_elsewhere
    apr = _effective_apr_for_emi(emi_offer_monthly_payment, emi_offer_months, cash_equivalent)

    can_pay_cash = user_savings_after_efund >= cash_equivalent
    if can_pay_cash and apr > D("0.10"):
        verdict = "pay_cash"
        detail = (f"Real APR ≈ {apr*100:.1f}%. Pay cash, save ₹{total_real_cost:,.0f} "
                  f"vs the 'no-cost' EMI.")
    elif apr > D("0.20"):
        verdict = "delay"
        detail = f"APR ≈ {apr*100:.1f}% — too costly. Save up first."
    else:
        verdict = "take"
        detail = f"APR ≈ {apr*100:.1f}%. Acceptable; take the EMI if budget allows."

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
    rationale = f"Moving from {current_yield*100:.2f}% → {best_alt_yield*100:.2f}% earns +{uplift:,.0f}/yr."
    if top_loan_effective_rate is not None:
        # Prepaying the loan would save `top_loan_effective_rate × idle_balance` in interest
        prepay_uplift = top_loan_effective_rate * idle_balance
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
) -> BorrowTimingVerdict:
    """§8f — three inputs from market context, one from the user (urgency).

    Verdict is `wait` only if: (a) user can wait AND (b) cut is meaningful AND
    (c) decision is soon enough that delay cost < expected savings.
    """
    bps_delta = D(consensus_change_bps) / D("10000")
    tenure_years = D(tenure_months) / D("12")
    estimated_savings = max(D("0"), -bps_delta) * principal * tenure_years

    can_wait = urgency in ("3m_ok", "6m_ok")
    if can_wait and consensus_change_bps <= -25 and months_to_decision <= 6 and estimated_savings > D("5000"):
        verdict = "wait"
        detail = (f"Rates {current_rate*100:.2f}% now vs {six_month_avg*100:.2f}% avg. "
                  f"Cut of {-consensus_change_bps}bps expected in {months_to_decision}m → "
                  f"save ~₹{estimated_savings:,.0f} over tenure. Defer if possible.")
    else:
        verdict = "borrow_now"
        if not can_wait:
            detail = "User flagged urgent — borrow now; locking the current rate is the right call."
        elif consensus_change_bps > 0:
            detail = f"Hike of {consensus_change_bps}bps expected — borrow now to lock current rate."
        else:
            detail = f"No meaningful change expected (±{consensus_change_bps}bps). Borrow now."

    return BorrowTimingVerdict(
        current_rate=current_rate, six_month_avg=six_month_avg,
        consensus_change_bps=consensus_change_bps,
        months_to_decision=months_to_decision, urgency=urgency,
        verdict=verdict, estimated_savings=estimated_savings, detail=detail,
    )
