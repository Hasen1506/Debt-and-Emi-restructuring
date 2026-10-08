"""What to assume for a prepayment / foreclosure fee the user left blank
(roadmap PR K, founder decision 2026-10-08).

Most people don't know their loan's prepayment fee, so the field is optional
and never blocks the plan. A blank fee is read as:

* **0%, assumed**, for a floating-rate loan in India that isn't a credit
  card. The Reserve Bank of India bars prepayment charges on floating-rate
  loans to individuals for purposes other than business:
    Reserve Bank of India (Pre-payment Charges on Loans) Directions, 2025,
    RBI/2025-26/64, DoR.MCS.REC.38/01.01.001/2025-26, dated July 2, 2025,
    paragraph 5(i) ("For all loans granted for purposes other than business
    to individuals, with or without co-obligant(s), an RE shall not levy
    pre-payment charges"), for all floating rate loans and advances, part or
    full prepayment, any source of funds, no lock-in (5(iii)). It applies to
    loans sanctioned or renewed on or after January 1, 2026; for earlier
    loans the repealed circulars it lists stay in force for their period,
    among them DBOD.Dir.BC.No.110/13.03.00/2013-14 of May 7, 2014
    (scheduled commercial banks: no foreclosure charges / pre-payment
    penalties on floating rate term loans sanctioned to individual
    borrowers) and DBR.Dir.BC.No.08/13.03.00/2019-20 of August 2, 2019
    (same subject).
    https://www.rbi.org.in/Scripts/NotificationUser.aspx?Id=8868&Mode=0
    https://www.rbi.org.in/Scripts/NotificationUser.aspx?Id=12878&Mode=0
  RightDue's loans are a person's own (no business loans), so the rule fits
  every non-card floating-rate loan in India. A dual-rate loan follows
  whatever rate it is on when prepaid (5(iv)): the loan's current rate
  type is what counts here too.
* **Unknown, no fee assumed**, for fixed-rate loans, credit cards and US
  loans: there is no rule that fixes the number, so nothing is assumed (0%
  in the math) and the form says, gently, to check the loan agreement.

No lender-specific fee is ever filled in here.

The same rule is in web/src/lib/prepayment-fee.ts; both are tested against
the same table.
"""
from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal

RBI_RULE = "RBI (Pre-payment Charges on Loans) Directions, 2025, para 5(i), 2 July 2025"
RBI_URL = "https://www.rbi.org.in/Scripts/NotificationUser.aspx?Id=12878&Mode=0"

ASSUMED_REASON = (
    "Assumed 0%: RBI bars prepayment charges on floating-rate loans to individuals "
    "(not for business) (RBI Directions, 2 July 2025)."
)
UNKNOWN_REASON = (
    "Not known, so no fee is assumed. If you can, check your loan agreement or "
    "Key Facts Statement for a prepayment charge."
)


@dataclass(frozen=True)
class FeeDefault:
    pct: Decimal          # what the plan uses when the field is blank
    status: str           # "assumed" (a rule fixes it) | "unknown" (nothing assumed)
    reason: str           # one line for the form


def prepayment_fee_default(loan_type: str, rate_type: str, market: str) -> FeeDefault:
    """The fee to use when the user left it blank. `loan_type` is the API
    name ("home_loan", "credit_card", ...), `rate_type` "floating" | "fixed",
    `market` the country whose rules the loan is under ("IN" | "US")."""
    lt = loan_type.value if hasattr(loan_type, "value") else loan_type
    mk = market.value if hasattr(market, "value") else market
    if mk == "IN" and rate_type == "floating" and lt != "credit_card":
        return FeeDefault(Decimal("0"), "assumed", ASSUMED_REASON)
    return FeeDefault(Decimal("0"), "unknown", UNKNOWN_REASON)
