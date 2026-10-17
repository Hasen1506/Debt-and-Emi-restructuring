"""What you owe today: the one figure every screen shows (UX walkthrough fix 4).

The plan starts at the beginning of this month, before this month's EMIs,
and pays them in its first month. A borrower who has already paid this
month's EMI (entered the balance after it went out, or marked it paid)
owes less than that opening balance: the EMI less the month's interest in
it. Home showed ₹48,85,000, Plan ₹49,01,430 "you owe today" and the
lump-sum box ₹50,09,516 for a ₹50,00,000 loan. This module defines the
figure once:

    owed today = opening balance, less (EMI - one month's interest) on each
                 instalment loan whose EMI for this month is already paid.

That is ``afterOneEmi`` in web/src/lib/roll-forward.ts, the balance Home
shows after a paid EMI, and the exact inverse of the add-back the plan's
opening balance gets when a balance is entered after the EMI. Cards, flat-
rate and pre-EMI loans are unchanged (their principal doesn't fall by the
reducing-balance formula), as in Home. The gap between the two figures is
the principal those EMIs repaid; ``interest_in_paid`` is the interest part.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from decimal import ROUND_HALF_UP, Decimal
from typing import Iterable

from engine.models import LoanType, User
from engine.surplus import to_user_currency

D = Decimal


@dataclass(frozen=True)
class OwedToday:
    total: Decimal                      # user's currency, whole units
    start_of_month: Decimal             # the plan's opening balance, same currency
    emi_paid: Decimal                   # this month's EMIs already paid
    interest_in_paid: Decimal           # the interest inside them
    by_loan: dict[int, Decimal] = field(default_factory=dict)   # each loan, its own currency, to the paisa/cent


def _paid_down(l) -> bool:
    return (l.loan_type != LoanType.CREDIT_CARD and l.scheduled_emi > 0 and l.outstanding > 0
            and getattr(l, "rate_basis", "reducing") != "flat" and getattr(l, "pre_emi_months_remaining", 0) <= 0)


def owed_today(user: User, paid_emi_this_month: Iterable[int] = ()) -> OwedToday:
    paid = set(paid_emi_this_month)
    by_loan: dict[int, Decimal] = {}
    total = start = emi_paid = interest = D("0")
    for i, l in enumerate(user.loans):
        b = l.outstanding
        if i in paid and _paid_down(l):
            month_interest = b * l.nominal_rate / D("12")
            after = max(D("0"), b + month_interest - l.scheduled_emi)
            emi_paid += to_user_currency(min(l.scheduled_emi, b + month_interest), l, user)
            interest += to_user_currency(month_interest, l, user)
            b = after
        by_loan[i] = b.quantize(D("0.01"), rounding=ROUND_HALF_UP)
        total += to_user_currency(b, l, user)
        start += to_user_currency(l.outstanding, l, user)
    q = lambda x: x.quantize(D("1"), rounding=ROUND_HALF_UP)  # noqa: E731
    return OwedToday(total=q(total), start_of_month=q(start), emi_paid=q(emi_paid), interest_in_paid=q(interest),
                     by_loan=by_loan)
