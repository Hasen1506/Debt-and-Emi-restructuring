"""What if the bank stretched one loan over more months? (live test #26)

The Plan page told a short-of-cash user to "ask the bank for a lower payment
(a longer tenure)" but never showed what that would do. This runs the user's
own plan with one loan re-amortised over a longer tenure, using the engine's
EMI formula, so the what-if shows the lower EMI, whether the monthly gap
closes, and what the extra months cost in interest.

What the bank has to offer: RBI's circular "Reset of Floating Interest Rate
on Equated Monthly Instalments (EMI) based Personal Loans" (RBI/2023-24/55,
18 Aug 2023, updated 1 Oct 2025), para 2(iii): at a rate reset, borrowers
"shall also be given the choice to opt for (i) enhancement in EMI or
elongation of tenor or for a combination of both options". It applies to
banks, co-operative banks and NBFCs including housing finance companies,
and para 2(v) says elongation must not cause negative amortisation.
https://www.rbi.org.in/Scripts/NotificationUser.aspx?Id=12529 (read 12 Oct 2026).
Outside a reset, a longer tenure is the lender's decision (its own policy,
age limits, charges), so the screen says "ask", never "you're owed".
"""
from __future__ import annotations

from copy import deepcopy
from dataclasses import dataclass
from decimal import Decimal

from engine.formulas import emi
from engine.models import LoanType, User

D = Decimal

RBI_RESET_CIRCULAR_URL = "https://www.rbi.org.in/Scripts/NotificationUser.aspx?Id=12529"


@dataclass(frozen=True)
class TenureChange:
    loan_index: int
    old_tenure: int
    new_tenure: int
    old_emi: Decimal
    new_emi: Decimal


def stretch_tenure(user: User, loan_index: int, extra_months: int) -> tuple[User, TenureChange]:
    """A copy of `user` with loan `loan_index` re-amortised over
    `extra_months` more months at its current rate. Raises ValueError for a
    card (no EMI to stretch) or an index out of range."""
    if not 0 <= loan_index < len(user.loans):
        raise ValueError("loan_index out of range")
    if extra_months < 1:
        raise ValueError("extra_months must be at least 1")
    loan = user.loans[loan_index]
    if loan.loan_type == LoanType.CREDIT_CARD:
        raise ValueError("A card has no EMI or tenure to stretch")
    if loan.outstanding <= 0 or loan.tenure_months_remaining <= 0:
        raise ValueError("The loan has nothing left to stretch")
    new_tenure = loan.tenure_months_remaining + extra_months
    new_emi = emi(loan.outstanding, loan.nominal_rate, new_tenure)
    # Never above today's EMI (a longer tenure only ever lowers it), and
    # never below the month's interest (that would be negative amortisation,
    # which para 2(v) of the circular rules out).
    floor = loan.outstanding * loan.nominal_rate / D("12")
    new_emi = max(min(new_emi, loan.scheduled_emi), floor)
    scenario = deepcopy(user)
    sl = scenario.loans[loan_index]
    sl.tenure_months_remaining = new_tenure
    sl.scheduled_emi = new_emi
    return scenario, TenureChange(loan_index, loan.tenure_months_remaining, new_tenure, loan.scheduled_emi, new_emi)
