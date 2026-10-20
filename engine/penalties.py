"""Late/missed payment penalty estimator.

Used by the Activity ledger to show "had you missed this EMI, you'd have
been charged ~₹X" alongside user-recorded payment events. Bank-specific
values from `engine.rate_cards.InstitutionRateCard.late_payment_*` win
when present; otherwise we fall back to country/loan-type defaults
sourced from public bank Schedules of Charges (links archived against
`last_verified`).

Two components per missed event:
  • flat_fee — fixed ₹/$ hit assessed once per missed EMI
  • penal_interest — extra annualised rate added to nominal on the overdue
    principal+interest, accrued from `days_late`

GST at 18% applies in India to both the flat fee and any penal-interest
component on consumer credit (cards, personal/auto/education loans).
Home loans are GST-exempt. US figures are gross — no equivalent tax
hangs off domestic consumer interest.

Sources (May 2026 snapshot, verified against public Schedule of Charges
PDFs from HDFC / SBI / ICICI / Axis / Kotak / Citi / Chase / Discover):
  • IN cards: ₹400-700 median late fee, no separate penal rate (card APR
    already continues to accrue on the unpaid balance)
  • IN home loans: ₹500 + 2%/yr penal (RBI guideline)
  • IN personal/auto loans: 2-3%/month penal (24-36%/yr) + ~₹500 flat
  • US cards: $30 first late, ~$41 subsequent (CARD Act cap), penal APR
    up to 29.99%
"""
from decimal import Decimal
from dataclasses import dataclass
from typing import Optional
from engine.models import Country, LoanType
from engine.rate_cards import InstitutionRateCard

D = Decimal

# ─── Country defaults — flat fee + penal rate by loan type ──────────────────

@dataclass(frozen=True)
class _DefaultPenalty:
    flat_fee: Decimal           # currency-native (₹ for IN, $ for US)
    penal_rate_annual: Decimal  # annualised, applied to overdue amount


_IN_DEFAULTS: dict[LoanType, _DefaultPenalty] = {
    LoanType.HOME: _DefaultPenalty(flat_fee=D("500"), penal_rate_annual=D("0.02")),
    LoanType.AUTO: _DefaultPenalty(flat_fee=D("500"), penal_rate_annual=D("0.24")),
    LoanType.PERSONAL: _DefaultPenalty(flat_fee=D("500"), penal_rate_annual=D("0.24")),
    LoanType.CREDIT_CARD: _DefaultPenalty(flat_fee=D("500"), penal_rate_annual=D("0")),
    LoanType.EDUCATION: _DefaultPenalty(flat_fee=D("250"), penal_rate_annual=D("0.02")),
    LoanType.GOLD: _DefaultPenalty(flat_fee=D("0"), penal_rate_annual=D("0.02")),
    LoanType.BNPL: _DefaultPenalty(flat_fee=D("200"), penal_rate_annual=D("0.36")),
    # A person, family or chit is not a bank: no statutory late fee.
    LoanType.PEOPLE: _DefaultPenalty(flat_fee=D("0"), penal_rate_annual=D("0")),
}

_US_DEFAULTS: dict[LoanType, _DefaultPenalty] = {
    LoanType.HOME: _DefaultPenalty(flat_fee=D("0"), penal_rate_annual=D("0.05")),
    LoanType.AUTO: _DefaultPenalty(flat_fee=D("25"), penal_rate_annual=D("0.05")),
    LoanType.PERSONAL: _DefaultPenalty(flat_fee=D("25"), penal_rate_annual=D("0.05")),
    LoanType.CREDIT_CARD: _DefaultPenalty(flat_fee=D("30"), penal_rate_annual=D("0.2999")),
    LoanType.EDUCATION: _DefaultPenalty(flat_fee=D("25"), penal_rate_annual=D("0.06")),
    # GOLD + BNPL are India-centric; provide reasonable fallbacks anyway.
    LoanType.GOLD: _DefaultPenalty(flat_fee=D("0"), penal_rate_annual=D("0.05")),
    LoanType.BNPL: _DefaultPenalty(flat_fee=D("15"), penal_rate_annual=D("0.30")),
    LoanType.PEOPLE: _DefaultPenalty(flat_fee=D("0"), penal_rate_annual=D("0")),
}

# Round 3 (#10): the newer kinds take the defaults of the nearest older one.
_LIKE: dict[LoanType, LoanType] = {
    LoanType.LAP: LoanType.HOME, LoanType.HOME_TOPUP: LoanType.HOME,
    LoanType.TWO_WHEELER: LoanType.AUTO, LoanType.MEDICAL: LoanType.PERSONAL,
}

# GST at 18% on consumer-finance penalties in India.
# Home loans are exempt by the GST schedule.
from engine.tax.gst import GST_RATE_IN as _GST_RATE_IN  # noqa: E402
_GST_EXEMPT_LOAN_TYPES: set[LoanType] = {LoanType.HOME}


@dataclass(frozen=True)
class PenaltyEstimate:
    flat_fee: Decimal
    penal_interest: Decimal
    gst: Decimal
    total: Decimal
    source: str  # 'bank_specific' | 'country_default'


def estimate_late_fee(
    *,
    loan_type: LoanType,
    country: Country,
    overdue_amount: Decimal,
    days_late: int,
    bank_card: Optional[InstitutionRateCard] = None,
) -> PenaltyEstimate:
    """Estimate the all-in penalty for missing/under-paying a single EMI.

    `overdue_amount` is the principal+interest portion the user didn't pay
    (e.g. the full EMI for a missed event, or `EMI − amount_paid` for a
    partial). `days_late` accrues penal interest over the period before
    they catch up — clamp to >=1 since a 0-day "miss" isn't a miss.
    """
    if overdue_amount < D("0"):
        overdue_amount = D("0")
    days_late = max(1, days_late)

    if bank_card is not None and bank_card.late_payment_flat_fee is not None:
        flat = bank_card.late_payment_flat_fee
        source = "bank_specific"
    else:
        defaults = _IN_DEFAULTS if country == Country.IN else _US_DEFAULTS
        flat = defaults[_LIKE.get(loan_type, loan_type)].flat_fee
        source = "country_default"

    if bank_card is not None and bank_card.late_payment_penal_rate is not None:
        penal_rate = bank_card.late_payment_penal_rate
        # If only one of the two fields is bank-specific, surface that.
        source = "bank_specific"
    else:
        defaults = _IN_DEFAULTS if country == Country.IN else _US_DEFAULTS
        penal_rate = defaults[_LIKE.get(loan_type, loan_type)].penal_rate_annual

    # Penal interest accrues over `days_late` on the overdue amount at the
    # extra annualised rate. Simple interest is fine — penal-rate periods
    # are short and the compounding effect is negligible vs the inputs'
    # uncertainty.
    penal_interest = (
        overdue_amount * penal_rate * D(days_late) / D("365")
    )

    if country == Country.IN and _LIKE.get(loan_type, loan_type) not in _GST_EXEMPT_LOAN_TYPES:
        gst = (flat + penal_interest) * _GST_RATE_IN
    else:
        gst = D("0")

    total = flat + penal_interest + gst
    return PenaltyEstimate(
        flat_fee=flat,
        penal_interest=penal_interest,
        gst=gst,
        total=total,
        source=source,
    )
