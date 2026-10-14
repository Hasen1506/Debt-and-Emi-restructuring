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
  "A person's own loan" means a loan to an individual for a purpose other
  than business (a home, a car, studies, personal needs). Para 4 covers
  every lender RBI regulates here: commercial banks (not payments banks),
  co-operative banks, NBFCs (an HFC is an NBFC; the HFC Master Direction
  para 85.7 is among the repealed instructions) and All India Financial
  Institutions, and the repealed circulars covered banks, UCBs, RRBs,
  HFCs and NBFCs for older loans too, so 0% is assumed for any RBI-
  regulated lender (`lender_type` bank / small_finance_bank /
  cooperative_bank / nbfc / hfc, or not given). A lender RBI doesn't
  regulate (`lender_type="other"`: an employer, a chit fund, a private
  lender) gets "Not known".
* **Business purpose** (`business_purpose=True`, grill #28): para 5(ii)
  covers floating-rate business loans to individuals and MSEs only by
  lender tier, and only for loans sanctioned on or after 1 Jan 2026:
  (a) commercial banks other than small finance, regional rural and local
  area banks, Tier 4 UCBs, NBFC-UL and AIFIs: no charge; (b) small finance
  banks, RRBs, Tier 3 UCBs, state and central co-operative banks and
  NBFC-ML: no charge up to ₹50 lakh sanctioned. Otherwise the lender's own
  policy applies (para 6). RightDue assumes 0% only for a business loan from
  a commercial bank (`bank`) sanctioned in 2026 or later, or from a small
  finance bank up to ₹50 lakh; a co-op bank, NBFC or HFC depends on a tier
  or layer the user rarely knows, so it reads "Not known" and asks.
  A dual-rate loan follows whatever rate it is on when prepaid (5(iv)):
  the loan's current rate type is what counts here too.
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
RBI_AS_OF = "2026-10-12"   # text read from the RBI page on this date
# C22 (14 Oct 2026): the Pre-payment Charges on Loans Directions, 2025 (2 Jul 2025, in force for loans
# from 1 Jan 2026) were not found inside the 28 Nov 2025 consolidated Directions read (Commercial
# Banks – Interest Rates on Advances id=13149; NBFC – Credit Facilities id=12957), so the standalone
# notification stays the citation. Re-check when RBI next updates its Master Directions.
RBI_URL = "https://www.rbi.org.in/Scripts/NotificationUser.aspx?Id=12878&Mode=0"

ASSUMED_REASON = (
    "Assumed 0%: RBI bars prepayment charges on floating-rate loans to individuals "
    "(not for business) (RBI Directions, 2 July 2025)."
)
BUSINESS_REASON = (
    "Not known: RBI's no-prepayment-charge rule covers business loans only from some lenders, "
    "and only for loans sanctioned from 1 January 2026. Check your loan agreement or Key Facts Statement."
)
BUSINESS_BANK_REASON = (
    "Assumed 0%: RBI bars prepayment charges on floating-rate business loans from commercial banks "
    "sanctioned from 1 January 2026 (RBI Directions, 2 July 2025, para 5(ii)(a))."
)
BUSINESS_SMALL_REASON = (
    "Assumed 0%: RBI bars prepayment charges on floating-rate business loans up to ₹50 lakh from small "
    "finance banks, sanctioned from 1 January 2026 (RBI Directions, 2 July 2025, para 5(ii)(b))."
)
OTHER_LENDER_REASON = (
    "Not known: RBI's no-prepayment-charge rule covers banks, co-operative banks and NBFCs/HFCs, "
    "not other lenders. Check your loan agreement."
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


# Lender types the form offers (grill #28). "other" = a lender RBI's
# directions don't cover.
LENDER_TYPES = ("bank", "small_finance_bank", "cooperative_bank", "nbfc", "hfc", "other")
RULE_START_YEAR = 2026                    # para 3(ii): sanctioned/renewed on or after 1 Jan 2026
SMALL_LENDER_BUSINESS_CAP = Decimal("5000000")   # para 5(ii)(b): ₹50 lakh


def prepayment_fee_default(
    loan_type: str,
    rate_type: str,
    market: str,
    lender_type: str | None = None,
    business_purpose: bool | None = None,
    sanction_year: int | None = None,
    sanctioned_amount: Decimal | None = None,
) -> FeeDefault:
    """The fee to use when the user left it blank. `loan_type` is the API
    name ("home_loan", "credit_card", ...), `rate_type` "floating" | "fixed",
    `market` the country whose rules the loan is under ("IN" | "US").
    `lender_type` one of LENDER_TYPES (None = not given), `business_purpose`
    the answer to "Is this loan for a business?" (None = not answered, read
    as a personal loan, the app's usual case), `sanction_year` the year the
    loan was sanctioned or last renewed, `sanctioned_amount` in rupees."""
    lt = loan_type.value if hasattr(loan_type, "value") else loan_type
    mk = market.value if hasattr(market, "value") else market
    if not (mk == "IN" and rate_type == "floating" and lt != "credit_card"):
        return FeeDefault(Decimal("0"), "unknown", UNKNOWN_REASON)
    if lender_type == "other":
        return FeeDefault(Decimal("0"), "unknown", OTHER_LENDER_REASON)
    if not business_purpose:
        return FeeDefault(Decimal("0"), "assumed", ASSUMED_REASON)
    # A business loan: para 5(ii), loans from 2026 only.
    new_rule = sanction_year is not None and sanction_year >= RULE_START_YEAR
    if new_rule and lender_type == "bank":
        return FeeDefault(Decimal("0"), "assumed", BUSINESS_BANK_REASON)
    if (new_rule and lender_type == "small_finance_bank" and sanctioned_amount is not None
            and sanctioned_amount <= SMALL_LENDER_BUSINESS_CAP):
        return FeeDefault(Decimal("0"), "assumed", BUSINESS_SMALL_REASON)
    return FeeDefault(Decimal("0"), "unknown", BUSINESS_REASON)
