"""Loans behind on payments or with a collection agency, in the monthly plan.

Founder decision 17 Oct 2026 (docs/FOUNDER-RECORDS.md B17):

* **Behind.** Spare cash goes first to clearing what is overdue on each
  behind loan, before the emergency fund, goals and the avalanche /
  snowball order. Once the overdue amount is paid the normal plan resumes.
  The overdue amount is the user's figure (`Loan.overdue_amount`); left
  blank it is estimated as one month's EMI or minimum (`estimated`).
  Secured loans (house, vehicle, gold) are caught up first, then the
  dearest.
* **With a collection agency.** The plan puts no automatic extra on it.
  The extra the order would have sent it is kept in a *settlement pot*
  (user's currency), at most the loan's balance, and is not counted as
  paid: the loan's balance doesn't move. Paying a collector in bits weakens
  the user's hand when negotiating a settlement. A pot whose loan clears is
  released back to the plan the next month; a pot still held when the run
  ends stays with the user (counted as invested, like the lock-in pot).
* **The user's own choice wins.** A collections loan the user pinned or put
  in their own payoff order (`Loan.extra_ok`, set by the API) is paid like
  any other.
"""
from __future__ import annotations

from decimal import Decimal

from engine.models import Loan, LoanType, User
from engine.surplus import from_user_currency, to_user_currency

D = Decimal
BEHIND = "behind"
COLLECTIONS = "collections"
SECURED = {LoanType.HOME, LoanType.LAP, LoanType.HOME_TOPUP, LoanType.AUTO, LoanType.TWO_WHEELER, LoanType.GOLD}


def is_held(loan: Loan) -> bool:
    """A collections loan the plan keeps its extra off (not the user's pick)."""
    return loan.debt_status == COLLECTIONS and not loan.extra_ok


def overdue_of(loan: Loan, minimum: Decimal) -> tuple[Decimal, bool]:
    """(overdue amount in the loan's currency, estimated?) for a behind loan."""
    typed = loan.overdue_amount
    if typed is not None:
        return max(D("0"), D(typed)), False
    return max(D("0"), minimum), True


class DebtStatusPlan:
    """Per-run state: the catch-up left on each behind loan and each pot."""

    def __init__(self, loans: list[Loan], position: dict[int, int], user: User):
        self.user = user
        self.position = position
        self.behind = [l for l in loans if l.debt_status == BEHIND]
        self.left: dict[int, Decimal] | None = None   # filled on the first month (needs minimums)
        self.pots: dict[int, Decimal] = {}             # id(loan) -> user currency
        self.loans = {id(l): l for l in loans}

    @property
    def active(self) -> bool:
        return bool(self.behind) or any(is_held(l) for l in self.loans.values())

    def take_catch_up(self, open_loans: list[Loan], minimums: dict[int, Decimal],
                      spare: Decimal) -> tuple[dict[int, Decimal], Decimal]:
        """Pay overdue amounts from `spare` (user currency). Returns
        ({id(loan): paid in loan currency}, total paid in user currency)."""
        if not self.behind:
            return {}, D("0")
        if self.left is None:
            self.left = {id(l): overdue_of(l, minimums.get(id(l), l.scheduled_emi))[0] for l in self.behind}
        out: dict[int, Decimal] = {}
        total = D("0")
        is_open = {id(l) for l in open_loans}
        order = sorted(self.behind, key=lambda l: (l.loan_type not in SECURED, -l.nominal_rate, self.position[id(l)]))
        for l in order:
            left = self.left.get(id(l), D("0"))
            if spare <= 0 or left <= 0 or id(l) not in is_open or l.pre_emi_months_remaining > 0:
                continue
            # Never more than the loan still owes after this month's minimum.
            room = max(D("0"), l.outstanding - minimums.get(id(l), D("0")))
            pay = min(left, room, from_user_currency(spare, l, self.user))
            if pay <= 0:
                continue
            out[id(l)] = pay
            self.left[id(l)] = left - pay
            used = to_user_currency(pay, l, self.user)
            spare -= used
            total += used
        return out, total

    def fill_pots(self, order: list[Loan], amount: Decimal, can_pay) -> Decimal:
        """Walk the payoff order: while the next open loan is a held
        collections loan, its share goes to its pot (up to its balance).
        Returns what is left for the normal plan (user currency)."""
        for l in order:
            if amount <= 0 or not can_pay(l):
                continue
            if not is_held(l):
                break
            room = max(D("0"), to_user_currency(l.outstanding, l, self.user) - self.pots.get(id(l), D("0")))
            put = min(amount, room)
            if put > 0:
                self.pots[id(l)] = self.pots.get(id(l), D("0")) + put
                amount -= put
        return amount

    def release_cleared(self) -> Decimal:
        """A pot never holds more than its loan still owes (the minimums keep
        paying it down): the excess, or the whole pot of a cleared loan, goes
        back to the plan."""
        back = D("0")
        for lid in list(self.pots):
            l = self.loans[lid]
            over = self.pots[lid] - max(D("0"), to_user_currency(l.outstanding, l, self.user))
            if over > 0:
                self.pots[lid] -= over
                back += over
            if self.pots[lid] <= 0:
                del self.pots[lid]
        return back

    def pots_by_position(self) -> dict[int, Decimal]:
        return {self.position[k]: v for k, v in self.pots.items() if v > 0}

    def total_pot(self) -> Decimal:
        return sum(self.pots.values(), D("0"))
