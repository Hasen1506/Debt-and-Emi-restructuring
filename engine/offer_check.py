"""“Don't sign that”: a loan offer checked against the user's own plan (audit 80+ add list).

Banks and apps push three kinds of offer at people who already owe: a
top-up on the home loan, a pre-approved personal loan, and a "no-cost" or
low-cost EMI at checkout. Vijay's question: "for top-up offers, where do we
compare against?". The answer depends on what the money is for, so the
check asks that first and compares against the user's real alternatives:

1. Every offer: its true yearly cost (APR: the rate at which what is paid
   back is worth the cash actually received, after the processing fee and
   18% GST on it). This is the figure the lender's Key Facts Statement must
   show (RBI/2024-25/18, 15 Apr 2024, para 3(c): APR "includes interest rate
   and all other charges").
2. Money to pay off debts the user already has (purpose "repay"): against
   keeping those debts on the current plan. Both are run on the same
   simulator; the difference in what the plan pays beyond principal, net of
   tax, plus the offer's fee and GST, is the saving or the cost. A top-up
   at 9% clearing a 42% card saves; one clearing a 10.5% car loan over 15
   years usually costs more, because the interest runs for longer.
3. Money to spend (purpose "spend"): against (a) paying from savings above
   the emergency fund, (b) saving it up from the plan's spare cash (how many
   months), and (c) a personal loan at the banks' published typical rate.
   And what it does to the plan: the new EMI is added, so the debt-free date
   moves and, if the EMI doesn't fit, a monthly gap opens.
4. A "no-cost" / card EMI: the existing New debt check engine
   (decisions.evaluate_new_debt: foregone discount, fee, GST on the hidden
   interest) plus the effect on the plan.
5. Lenders' ceiling: with the new EMI, loan payments as a share of
   take-home; past about half, expect a smaller loan or a refusal
   (decisions.PAYMENTS_SHARE_LIMIT).

A top-up or personal loan at a floating rate to an individual for a
non-business purpose can be prepaid without charge (RBI Pre-payment
Charges Directions, 2 July 2025: engine/citations.PREPAYMENT_NO_CHARGE); a
fixed-rate one may carry the foreclosure charge in its KFS, which is an
input here. No tax benefit is counted on a top-up.
"""
from __future__ import annotations

from engine.plan_end import shown_debt_free_month

from copy import deepcopy
from dataclasses import dataclass, field
from decimal import ROUND_CEILING, ROUND_HALF_UP, Decimal
from typing import Callable, Optional

from engine.consolidation import PublishedRange, _plan_cost, _window_cost, loan_amount
from engine.decisions import PAYMENTS_SHARE_LIMIT, _irr_annual, evaluate_new_debt
from engine.formulas import emi
from engine.models import Country, Loan, LoanType, User
from engine.tax.gst import GST_RATE_IN

D = Decimal

KINDS = ("top_up", "personal_loan", "no_cost_emi")
# A plan that never clears (a short month borrowed at card rates) compounds
# without end; costs are then compared over at most this many months.
SHORT_WINDOW_MONTHS = 36
PURPOSES = ("repay", "spend")


class OfferCheckInputError(ValueError):
    def __init__(self, field_name: str, message: str):
        super().__init__(message)
        self.field = field_name


def _q(x: Decimal) -> Decimal:
    return x.quantize(D("1"), rounding=ROUND_HALF_UP)


@dataclass(frozen=True)
class Offer:
    kind: str                         # top_up | personal_loan | no_cost_emi
    purpose: str                      # repay | spend
    amount: Decimal                   # loan amount; for an EMI offer, the price financed
    tenure_months: int
    rate: Optional[Decimal] = None    # loans: the offered yearly rate
    fee_pct: Decimal = D("0")
    fee_flat: Decimal = D("0")
    foreclosure_pct: Decimal = D("0")
    floating: bool = False
    monthly_emi: Optional[Decimal] = None   # EMI offers: the instalment shown at checkout
    cash_price: Optional[Decimal] = None    # EMI offers: the price paying in full
    repay_indices: tuple[int, ...] = ()     # purpose repay: the user's loans it would clear


@dataclass
class Comparison:
    against: str                      # keep_debts | savings | save_up | typical_loan
    label: str
    cost_difference: Optional[Decimal]   # offer cost - alternative cost (positive: the offer costs more)
    detail: str


@dataclass
class OfferCheck:
    apr: Decimal
    monthly_emi: Decimal
    fee_total: Decimal                # fee + GST
    total_cost: Decimal               # everything paid beyond the cash received
    comparisons: list[Comparison]
    debt_free_before: Optional[int]
    debt_free_after: Optional[int]
    gap_before: Decimal
    gap_after: Decimal
    payments_share: Optional[Decimal]
    verdict: str                      # checks_out | costs_more | doesnt_fit
    headline: str
    notes: list[str] = field(default_factory=list)


def _validate(o: Offer, user: User) -> None:
    if o.kind not in KINDS:
        raise OfferCheckInputError("kind", "Pick the kind of offer.")
    if o.purpose not in PURPOSES:
        raise OfferCheckInputError("purpose", "Say what the money is for.")
    if o.amount <= 0:
        raise OfferCheckInputError("amount", "Enter the amount above zero.")
    if not (1 <= o.tenure_months <= 360):
        raise OfferCheckInputError("tenure_months", "Enter a tenure between 1 and 360 months.")
    if o.kind != "no_cost_emi" and (o.rate is None or not (D("0") < o.rate <= D("0.6"))):
        raise OfferCheckInputError("rate", "Enter the offered rate, between 0% and 60% a year.")
    if o.kind == "no_cost_emi" and (o.monthly_emi is None or o.monthly_emi <= 0):
        raise OfferCheckInputError("monthly_emi", "Enter the monthly instalment shown at checkout.")
    if not (D("0") <= o.fee_pct <= D("0.05")):
        raise OfferCheckInputError("fee_pct", "A processing fee between 0% and 5%.")
    if o.purpose == "repay":
        if not o.repay_indices:
            raise OfferCheckInputError("repay_indices", "Pick the loans or cards it would pay off.")
        if any(not (0 <= i < len(user.loans)) or user.loans[i].outstanding <= 0 for i in o.repay_indices):
            raise OfferCheckInputError("repay_indices", "Pick loans that still have a balance.")


def check_offer(
    user: User,
    offer: Offer,
    run: Callable[[User], object],
    marginal_rate: Decimal,
    money: Callable[[Decimal], str],
    published: Optional[PublishedRange] = None,
    month_label: Callable[[int], str] = lambda m: f"month {m}",
) -> OfferCheck:
    _validate(offer, user)
    india = user.country == Country.IN
    gst = GST_RATE_IN if india else D("0")
    base = run(user)
    after_user = deepcopy(user)
    notes: list[str] = []
    comparisons: list[Comparison] = []

    if offer.kind == "no_cost_emi":
        cash = offer.cash_price or offer.amount
        verdict_nd = evaluate_new_debt(
            offer.amount, cash, offer.tenure_months, offer.monthly_emi, offer.fee_flat, country=user.country,
            card_emi=True,
        )
        apr = verdict_nd.effective_apr
        new_emi = offer.monthly_emi
        fee_total = _q(offer.fee_flat * (1 + gst))
        total_cost = verdict_nd.total_real_cost
        notes.append(verdict_nd.detail)
        new_loan = Loan(LoanType.PERSONAL, "EMI offer", cash, max(apr, D("0.0001")), "fixed", offer.tenure_months, new_emi)
        principal = cash
    else:
        if offer.purpose == "repay":
            target = sum((user.loans[i].outstanding for i in offer.repay_indices), D("0"))
            principal, fee, fee_gst = loan_amount(target, offer.fee_pct, offer.fee_flat, india)
            if offer.amount < target:
                notes.append(f"The offer is {money(offer.amount)} but the balances you picked come to {money(target)}; "
                             f"checked as a loan of {money(principal)}, enough to clear them after the fee.")
        else:
            principal = offer.amount
            fee = (principal * offer.fee_pct + offer.fee_flat).quantize(D("0.01"))
            fee_gst = (fee * gst).quantize(D("0.01"))
        new_emi = emi(principal, offer.rate, offer.tenure_months).quantize(D("1"), rounding=ROUND_CEILING)
        fee_total = _q(fee + fee_gst)
        received = principal - fee - fee_gst
        apr = _irr_annual(received, [new_emi] * offer.tenure_months)
        total_cost = _q(new_emi * offer.tenure_months - received)
        new_loan = Loan(LoanType.HOME if offer.kind == "top_up" else LoanType.PERSONAL,
                        "Top-up offer" if offer.kind == "top_up" else "Loan offer",
                        principal, offer.rate, "floating" if offer.floating else "fixed", offer.tenure_months, new_emi,
                        prepayment_penalty_pct=D("0") if offer.floating else offer.foreclosure_pct)
        if offer.kind == "top_up":
            # No 24(b) break is counted on a top-up: it isn't the loan that bought the house.
            new_loan.tax_share = D("0")
        if offer.floating:
            notes.append("Floating rate to an individual, not for business: no prepayment or foreclosure charge (RBI, 2 July 2025).")
        elif offer.foreclosure_pct > 0:
            notes.append(f"Paying it off early costs {offer.foreclosure_pct * 100:.1f}% (as entered from the KFS); the plan counts it.")
        else:
            notes.append("Fixed rate: check the KFS for a foreclosure charge before you sign; none is counted here.")

    if offer.purpose == "repay":
        for i in offer.repay_indices:
            after_user.loans[i].outstanding = D("0")
    after_user.loans.append(new_loan)
    after = run(after_user)

    gap_b = base.months[0].shortfall if base.months else D("0")
    gap_a = after.months[0].shortfall if after.months else D("0")
    share = None
    if user.monthly_income and user.monthly_income > 0:
        pays = sum((l.scheduled_emi for i, l in enumerate(user.loans) if l.outstanding > 0 and l.loan_type != LoanType.CREDIT_CARD
                    and (offer.purpose != "repay" or i not in offer.repay_indices)), D("0"))
        share = ((pays + new_emi) / user.monthly_income).quantize(D("0.0001"))

    window = None
    if offer.purpose == "repay":
        window = None if (shown_debt_free_month(base) and shown_debt_free_month(after)) else min(offer.tenure_months, SHORT_WINDOW_MONTHS)
        cost_b = _plan_cost(user, base, marginal_rate) if window is None else _window_cost(base, window)
        cost_a = (_plan_cost(after_user, after, marginal_rate) if window is None else _window_cost(after, window))
        cost_a += principal - sum((user.loans[i].outstanding for i in offer.repay_indices), D("0"))
        diff = _q(cost_a - cost_b)
        span = f" over the next {window} months" if window else " over your plan"
        comparisons.append(Comparison(
            "keep_debts", "Keeping those debts on your plan", diff,
            (f"Costs {money(diff)} more{span} than keeping them, fee and GST counted." if diff > 0 else
             f"Saves {money(-diff)}{span} against keeping them, fee and GST counted." if diff < 0 else
             "Costs the same as keeping them."),
        ))
    else:
        spare_after_fund = max(D("0"), user.savings_balance)
        if spare_after_fund >= principal:
            comparisons.append(Comparison(
                "savings", "Paying from savings", _q(total_cost),
                f"Your savings outside the emergency fund cover it; borrowing costs {money(total_cost)} more."))
        spare = base.months[0].available_surplus if base.months else D("0")
        if spare > 0:
            months = int((principal / spare).to_integral_value(rounding=ROUND_CEILING))
            comparisons.append(Comparison(
                "save_up", "Saving it up first", _q(total_cost),
                f"At your spare cash of {money(spare)} a month it takes about {months} months to save; "
                f"borrowing now costs {money(total_cost)} for not waiting."))
        if published is not None and india and offer.kind != "no_cost_emi":
            alt_emi = emi(principal, published.typical, offer.tenure_months)
            alt_cost = alt_emi * offer.tenure_months - principal
            d = _q(total_cost - alt_cost)
            comparisons.append(Comparison(
                "typical_loan", f"A personal loan at the banks' typical {published.typical * 100:.1f}%", d,
                (f"Costs {money(d)} more than that." if d > 0 else f"Costs {money(-d)} less than that." if d < 0
                 else "Costs about the same as that.") + f" (Banks' own published rates, {published.period}.)"))

    doesnt_fit = gap_a > gap_b + D("0.5") or (share is not None and share > PAYMENTS_SHARE_LIMIT and offer.kind != "no_cost_emi")
    keep = next((c for c in comparisons if c.against == "keep_debts"), None)
    if doesnt_fit:
        verdict = "doesnt_fit"
        reason = ((f"it widens your monthly gap by {money(gap_a - gap_b)}" if gap_b >= D("1") else
                   f"it leaves you {money(gap_a)} a month short") if gap_a > gap_b + D("0.5") else
                  f"loan payments would take {share * 100:.0f}% of your take-home, past the half lenders usually allow")
        head = f"Don't sign that yet: {reason}."
    elif keep is not None:
        verdict = "checks_out" if (keep.cost_difference or 0) < 0 else "costs_more"
        span = f" over the next {window} months" if window else ""
        closes = (f", and closes {money(gap_b - gap_a)} of your monthly gap" if gap_b - gap_a >= D("1") else "")
        head = (f"This one checks out: it saves {money(-keep.cost_difference)}{span} against keeping those debts{closes}."
                if verdict == "checks_out" else
                f"Don't sign that: it costs {money(keep.cost_difference)} more{span} than keeping those debts{closes}.")
    else:
        verdict = "costs_more" if total_cost > 0 else "checks_out"
        delay = ""
        b_dfm, a_dfm = shown_debt_free_month(base), shown_debt_free_month(after)
        if b_dfm and a_dfm and a_dfm > b_dfm:
            delay = f" and moves your debt-free date from {month_label(b_dfm)} to {month_label(a_dfm)}"
        head = (f"Before you sign: it really costs {apr * 100:.1f}% a year, {money(total_cost)} in all{delay}."
                if total_cost > 0 else f"It costs no more than paying cash{delay}.")
    return OfferCheck(
        apr=apr.quantize(D("0.0001")), monthly_emi=_q(new_emi), fee_total=fee_total, total_cost=_q(total_cost),
        comparisons=comparisons, debt_free_before=shown_debt_free_month(base), debt_free_after=shown_debt_free_month(after),
        gap_before=_q(gap_b), gap_after=_q(gap_a), payments_share=share, verdict=verdict, headline=head, notes=notes,
    )
