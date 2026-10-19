"""After a lump-sum prepayment: a lower EMI, or the same EMI and an earlier end?
(UX walkthrough 2, #20)

A part-prepayment lowers the balance. What happens next is a choice, and the
borrower makes it, not the app:

  • reduce_tenure — the EMI stays as it is, so the loan ends sooner. This
    saves the most interest.
  • reduce_emi — the bank re-works the EMI on the lower balance over the
    months that are left, so the end date stays and every month gets cheaper.

India: lenders ask which one. HSBC India: "send HSBC a written instruction
... to reduce the loan tenure or EMI. In case no clear instruction is
received ... we will by default reduce the loan tenure"
(https://www.hsbc.co.in/home-loans/products/home/, read 17 Oct 2026). Axis
Bank: "In the absence of specific instructions, the default impact will be
on the loan tenure"
(https://application.axis.bank.in/webforms/axis-support/sub-issues/loans-home-partpymt-1.aspx).
Bajaj Housing Finance's FAQ: "You have the option to choose whether the
part-prepayment should affect your EMI or tenure" (FAQ English, 17 Dec
2025). So RightDue asks, and says what the bank does when nobody tells it.

USA: an extra principal payment does not change the required payment; the
loan simply ends sooner. A lower payment needs a "recast" (re-amortisation),
which the servicer has to agree to: "Recasting takes your remaining balance
and spreads it over the remaining term of your loan ... FHA, VA and USDA
loans are not eligible for a recast ... Fees may apply"
(https://www.chase.com/personal/mortgage/recast, read 17 Oct 2026; Fannie
Mae's definition of a recast loan: https://singlefamily.fanniemae.com/job-aid/loan-delivery/topic/recast_mortgage.htm).

This module only does the loan's own arithmetic. The plan (engine/sensitivity
with_lump_sum) runs the user's whole plan with the choice applied.
"""
from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal, ROUND_HALF_UP

from engine.formulas import emi, schedule_interest

D = Decimal
_CENT = D("0.01")

REDUCE_TENURE = "reduce_tenure"
REDUCE_EMI = "reduce_emi"
PREPAY_MODES = (REDUCE_TENURE, REDUCE_EMI)

HSBC_INDIA_URL = "https://www.hsbc.co.in/home-loans/products/home/"
AXIS_PART_PAYMENT_URL = "https://application.axis.bank.in/webforms/axis-support/sub-issues/loans-home-partpymt-1.aspx"
CHASE_RECAST_URL = "https://www.chase.com/personal/mortgage/recast"


@dataclass(frozen=True)
class PrepayEffect:
    """One loan after a prepayment, on its own schedule (no plan extras)."""
    mode: str
    old_emi: Decimal
    new_emi: Decimal
    old_months: int
    new_months: int
    # Interest the loan alone saves against not prepaying (same schedule).
    interest_saved: Decimal


def months_to_clear(balance: Decimal, annual_rate: Decimal, payment: Decimal, cap: int = 1200) -> int | None:
    """Months a fixed payment takes to clear `balance`; None when the payment
    never covers the interest (or the cap is reached)."""
    if balance <= 0:
        return 0
    r = annual_rate / D("12")
    if payment <= balance * r or payment <= 0:
        return None
    b = balance
    for m in range(1, cap + 1):
        b = b + b * r - payment
        if b <= D("0.005"):
            return m
    return None


def _interest(balance: Decimal, annual_rate: Decimal, payment: Decimal, months: int) -> Decimal:
    """Interest over `months` at `payment` a month (last month short)."""
    return schedule_interest(balance, annual_rate, payment, months)


def prepay_effect(
    outstanding: Decimal,
    annual_rate: Decimal,
    scheduled_emi: Decimal,
    months_left: int,
    principal_paid: Decimal,
    mode: str,
) -> PrepayEffect:
    """What `principal_paid` off the balance does to the EMI or the end date.

    reduce_tenure keeps `scheduled_emi`; reduce_emi re-amortises the lower
    balance over `months_left` (never above today's EMI). Raises ValueError
    for an unknown mode or nothing to prepay."""
    if mode not in PREPAY_MODES:
        raise ValueError(f"mode must be one of {PREPAY_MODES}")
    if outstanding <= 0 or principal_paid <= 0:
        raise ValueError("Nothing to prepay")
    new_balance = max(D("0"), outstanding - principal_paid)
    old_months = months_to_clear(outstanding, annual_rate, scheduled_emi)
    if old_months is None:
        # The EMI never clears the loan. Compare interest over the months
        # still on the contract; those month counts are that window, not a
        # payoff date. (A prepayment that makes the EMI cover the interest
        # still gets a real new payoff month below.)
        old_months = months_left
    before = _interest(outstanding, annual_rate, scheduled_emi, old_months)
    if new_balance <= 0:
        return PrepayEffect(mode, scheduled_emi, D("0"), old_months, 0, before.quantize(_CENT, ROUND_HALF_UP))
    if mode == REDUCE_TENURE:
        new_emi = scheduled_emi
        new_months = months_to_clear(new_balance, annual_rate, new_emi) or old_months
    else:
        term = max(1, months_left or old_months)
        new_emi = min(scheduled_emi, emi(new_balance, annual_rate, term))
        new_months = months_to_clear(new_balance, annual_rate, new_emi) or term
    after = _interest(new_balance, annual_rate, new_emi, new_months)
    return PrepayEffect(
        mode=mode,
        old_emi=scheduled_emi.quantize(_CENT, ROUND_HALF_UP),
        new_emi=new_emi.quantize(_CENT, ROUND_HALF_UP),
        old_months=old_months,
        new_months=new_months,
        interest_saved=(before - after).quantize(_CENT, ROUND_HALF_UP),
    )
