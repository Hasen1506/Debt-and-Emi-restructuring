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
  lender tier, and only for loans sanctioned or renewed on or after
  1 Jan 2026:
  (a) a commercial bank other than a small finance bank, regional rural
  bank or local area bank, a Tier 4 urban co-operative bank, an NBFC-UL
  and an AIFI: no charge, any amount;
  (b) a small finance bank, a regional rural bank, a Tier 3 urban
  co-operative bank, a state or central co-operative bank and an NBFC-ML:
  no charge when the sanctioned amount or limit is up to ₹50 lakh.
  The ₹50 lakh line is the sanctioned amount, not the balance left
  (Directions para 5(ii)(b)). An HFC is an NBFC and sits in the middle
  layer unless it is upper layer, so a floating business loan from an HFC
  is 0% up to ₹50 lakh from 2026 (upper layer would be 0% at any amount;
  above ₹50 lakh a middle-layer HFC may charge, so that case is asked).
  A co-operative bank's tier is not something the borrower knows, and an
  NBFC's layer (base / middle / upper) decides whether a charge can apply,
  so those are "Not known" and the form asks. Before 2026 the 2019
  circular kept the bar to non-business loans, so a business loan
  sanctioned earlier is asked too.
  A dual-rate loan follows the rate it is on when prepaid (5(iv)): the
  loan's current rate type is what counts here.
* **Fixed rate: the bar does not apply.** Para 5 is floating-rate loans
  only. Para 6 leaves every other case, including a fixed rate, to the
  lender's board-approved policy, charged on the amount prepaid. The 2012
  and 2014 circulars were floating-rate only as well. One older exception
  stays in the HFC Directions para 85.6(a) (not repealed): an HFC may not
  charge for closing a fixed-rate housing loan with the borrower's own
  funds. The app does not know the source of funds, so a fixed-rate loan
  is still asked, under More options, and nothing is filled in.
* **Unknown, no fee assumed**, for fixed-rate loans, credit cards, a
  lender RBI does not regulate, and US loans: there is no rule that fixes
  the number, so nothing is assumed (0% in the math) and the form asks
  under More options. A figure the user or a Key Facts Statement already
  holds is kept. Where the rule above says the charge is forbidden, a
  stored figure is ignored and the fee the plan uses is 0.

No lender-specific fee is ever filled in here.

The same rule is in web/src/lib/prepayment-fee.ts; both are tested against
the same table.
"""
from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal

RBI_RULE = "RBI (Pre-payment Charges on Loans) Directions, 2025, para 5(i), 2 July 2025"
RBI_AS_OF = "2026-10-19"   # text read from the RBI page on this date
# The one line the form shows where the law sets the charge to zero.
ZERO_NOTE = "No prepayment charge on floating-rate loans (RBI rule)"
# Floating-rate home loans: DBOD.No.Dir.BC.107/13.03.00/2011-12, 5 June 2012.
# The 2025 Directions annex lists it; the 7 May 2014 circular cites it. The
# 2014 page is the one RBI still serves at the URL below.
# All floating-rate term loans to individual borrowers, scheduled commercial
# banks excluding RRBs: DBOD.Dir.BC.No.110/13.03.00/2013-14, 7 May 2014.
RBI_2014_URL = "https://www.rbi.org.in/Scripts/NotificationUser.aspx?Id=8868&Mode=0"
# Clarifies the bar is non-business, with or without co-obligants, and
# addresses small finance banks and local area banks as well:
# DBR.Dir.BC.No.08/13.03.00/2019-20, 2 August 2019.
RBI_2019_URL = "https://www.rbi.org.in/scripts/NotificationUser.aspx?Id=11646&Mode=0"
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
BUSINESS_RRB_REASON = (
    "Assumed 0%: RBI bars prepayment charges on floating-rate business loans up to ₹50 lakh from regional "
    "rural banks, sanctioned from 1 January 2026 (RBI Directions, 2 July 2025, para 5(ii)(b))."
)
BUSINESS_HFC_REASON = (
    "Assumed 0%: an HFC is an NBFC in the middle layer unless it is upper layer, so RBI bars prepayment "
    "charges on its floating-rate business loans up to ₹50 lakh sanctioned from 1 January 2026 "
    "(RBI Directions, 2 July 2025, para 5(ii)(b))."
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
# Names the loan-check catalogue uses, accepted as well as LENDER_TYPES.
_COMMERCIAL = frozenset({"bank", "commercial_bank"})
_CAP_50 = {
    "small_finance_bank": BUSINESS_SMALL_REASON,
    "regional_rural_bank": BUSINESS_RRB_REASON,
    "hfc": BUSINESS_HFC_REASON,
}
RULE_START_YEAR = 2026                    # para 3(ii): sanctioned/renewed on or after 1 Jan 2026
SMALL_LENDER_BUSINESS_CAP = Decimal("5000000")   # para 5(ii)(b): ₹50 lakh


def _canon_lender(lender_type: str | None) -> str | None:
    if lender_type in (None, "", "unknown"):
        return None
    return lender_type


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
    loan was sanctioned or last renewed, `sanctioned_amount` in rupees.
    Where this returns status "assumed", the law fixes the charge at 0 even
    if a fee was typed or read from a Key Facts Statement."""
    lt = loan_type.value if hasattr(loan_type, "value") else loan_type
    mk = market.value if hasattr(market, "value") else market
    lender = _canon_lender(lender_type)
    # Para 5 is floating rate only. Fixed rate, cards and other markets: para 6.
    if not (mk == "IN" and rate_type == "floating" and lt != "credit_card"):
        return FeeDefault(Decimal("0"), "unknown", UNKNOWN_REASON)
    if lender == "other":
        return FeeDefault(Decimal("0"), "unknown", OTHER_LENDER_REASON)
    # 2012 home loans, 2014 term loans, 2019 non-business clarification, 2025 para 5(i).
    if not business_purpose:
        return FeeDefault(Decimal("0"), "assumed", ASSUMED_REASON)
    # A business loan: para 5(ii), loans sanctioned or renewed from 2026 only.
    new_rule = sanction_year is not None and sanction_year >= RULE_START_YEAR
    if new_rule and lender in _COMMERCIAL:
        return FeeDefault(Decimal("0"), "assumed", BUSINESS_BANK_REASON)
    cap_reason = _CAP_50.get(lender or "")
    if (new_rule and cap_reason and sanctioned_amount is not None
            and sanctioned_amount <= SMALL_LENDER_BUSINESS_CAP):
        return FeeDefault(Decimal("0"), "assumed", cap_reason)
    return FeeDefault(Decimal("0"), "unknown", BUSINESS_REASON)


def fee_lender_from_bank(bank: str | None) -> str | None:
    """The prepayment-rule bucket for a lender name we know, or None."""
    from engine.lenders import LenderType, resolve
    found = resolve(bank)
    if found is None:
        return None
    return {
        LenderType.COMMERCIAL_BANK: "bank",
        LenderType.SMALL_FINANCE_BANK: "small_finance_bank",
        LenderType.REGIONAL_RURAL_BANK: "regional_rural_bank",
        LenderType.COOPERATIVE_BANK: "cooperative_bank",
        LenderType.HFC: "hfc",
        LenderType.NBFC: "nbfc",
    }.get(found.type)


def _loan_default(loan, country) -> FeeDefault:
    from engine.formulas import loan_market
    mk = loan_market(loan, country)
    mk = mk.value if hasattr(mk, "value") else mk
    lender = _canon_lender(getattr(loan, "lender_type", None)) or fee_lender_from_bank(getattr(loan, "bank", None))
    amount = getattr(loan, "sanctioned_amount", None)
    return prepayment_fee_default(
        loan.loan_type, loan.rate_type, mk, lender,
        getattr(loan, "business_purpose", None),
        getattr(loan, "sanction_year", None),
        amount,
    )


def chargeable_prepayment_pct(loan, country) -> Decimal:
    """The fee the plan, the order and the comparisons actually use.

    0 when RBI forbids a prepayment or foreclosure charge, whatever figure
    was stored. Otherwise the figure on the loan (blank is 0)."""
    if _loan_default(loan, country).status == "assumed":
        return Decimal("0")
    return loan.prepayment_penalty_pct or Decimal("0")


def chargeable_lock_in_months(loan, country) -> int:
    """Months an extra payment is refused. Para 5(iii) bars a lock-in on a
    loan the 2025 Directions cover (sanctioned or renewed from 2026)."""
    months = int(loan.prepay_lock_in_months or 0)
    rule = _loan_default(loan, country)
    year = getattr(loan, "sanction_year", None)
    if rule.status == "assumed" and year is not None and year >= RULE_START_YEAR:
        return 0
    return months


def apply_statutory_prepayment(loan, country) -> None:
    """Write the statutory fee (and, from 2026, the lock-in) onto `loan`
    so every later read of the fields sees the rule."""
    if _loan_default(loan, country).status != "assumed":
        return
    loan.prepayment_penalty_pct = Decimal("0")
    year = getattr(loan, "sanction_year", None)
    if year is not None and year >= RULE_START_YEAR:
        loan.prepay_lock_in_months = 0
