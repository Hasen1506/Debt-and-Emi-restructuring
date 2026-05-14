"""Institution rate cards — Phase 1 (India 30 + USA 15) per design spec §7.1.

Tier-A banks are populated with indicative ranges verified May 2026 (post-RBI
cut to 5.25%; Fed funds 3.50-3.75%). Tier-B and Tier-C entries are scaffolded
with `None` rate ranges — data ops fills these from per-bank pages.

All rates are Decimal in [0, 1]. Use the `low`/`high` ends for sensitivity
sliders; the median is what the optimiser uses by default.
"""
from decimal import Decimal
from dataclasses import dataclass, field
from typing import Optional
from engine.models import Country, LoanType

D = Decimal


@dataclass
class RateRange:
    low: Decimal
    high: Decimal

    @property
    def median(self) -> Decimal:
        return (self.low + self.high) / D("2")


@dataclass
class CreditCardCard:
    apr_low: Decimal
    apr_high: Decimal
    cash_advance_low: Optional[Decimal] = None
    cash_advance_high: Optional[Decimal] = None
    bt_promo_rate: Optional[Decimal] = None
    bt_promo_months: Optional[int] = None
    bt_fee_pct: Optional[Decimal] = None


@dataclass
class InstitutionRateCard:
    institution_id: str
    country: Country
    name: str
    scrape_tier: str                # "A" | "B" | "C"
    home_loan: Optional[RateRange] = None
    personal_loan: Optional[RateRange] = None
    auto_loan: Optional[RateRange] = None
    education_loan: Optional[RateRange] = None
    credit_card: Optional[CreditCardCard] = None
    processing_fee_pct: Optional[Decimal] = None         # personal/home/auto
    prepayment_penalty_floating: Decimal = D("0")        # RBI: 0 for floating
    last_verified: str = "2026-05-14"


# ─────────────────────────────────────────────────────────────────────────────
# India — Tier A (6 institutions, indicative May 2026)
# ─────────────────────────────────────────────────────────────────────────────

INDIA_TIER_A: list[InstitutionRateCard] = [
    InstitutionRateCard(
        institution_id="IN_SBI", country=Country.IN, name="SBI", scrape_tier="A",
        home_loan=RateRange(D("0.0750"), D("0.0870")),
        personal_loan=RateRange(D("0.1030"), D("0.1485")),
        auto_loan=RateRange(D("0.0810"), D("0.0905")),
        credit_card=CreditCardCard(
            apr_low=D("0.2388"), apr_high=D("0.42"),
            cash_advance_low=D("0.36"), cash_advance_high=D("0.48"),
        ),
        processing_fee_pct=D("0.0050"),
    ),
    InstitutionRateCard(
        institution_id="IN_HDFC", country=Country.IN, name="HDFC Bank", scrape_tier="A",
        home_loan=RateRange(D("0.0775"), D("0.0815")),
        personal_loan=RateRange(D("0.1050"), D("0.2400")),
        auto_loan=RateRange(D("0.0850"), D("0.0920")),
        credit_card=CreditCardCard(
            apr_low=D("0.30"), apr_high=D("0.432"),
            cash_advance_low=D("0.36"), cash_advance_high=D("0.48"),
            bt_promo_rate=D("0"), bt_promo_months=6, bt_fee_pct=D("0.015"),
        ),
        processing_fee_pct=D("0.0050"),
    ),
    InstitutionRateCard(
        institution_id="IN_ICICI", country=Country.IN, name="ICICI Bank", scrape_tier="A",
        home_loan=RateRange(D("0.0750"), D("0.0885")),
        personal_loan=RateRange(D("0.1065"), D("0.1900")),
        auto_loan=RateRange(D("0.0880"), D("0.0980")),
        credit_card=CreditCardCard(
            apr_low=D("0.2988"), apr_high=D("0.45"),
            cash_advance_low=D("0.36"), cash_advance_high=D("0.48"),
            bt_promo_rate=D("0"), bt_promo_months=6, bt_fee_pct=D("0.015"),
        ),
        processing_fee_pct=D("0.0050"),
    ),
    InstitutionRateCard(
        institution_id="IN_AXIS", country=Country.IN, name="Axis Bank", scrape_tier="A",
        home_loan=RateRange(D("0.0765"), D("0.0980")),
        personal_loan=RateRange(D("0.1049"), D("0.2200")),
        auto_loan=RateRange(D("0.0865"), D("0.0950")),
        credit_card=CreditCardCard(
            apr_low=D("0.288"), apr_high=D("0.408"),
        ),
        processing_fee_pct=D("0.0050"),
    ),
    InstitutionRateCard(
        institution_id="IN_KOTAK", country=Country.IN, name="Kotak Mahindra", scrape_tier="A",
        home_loan=RateRange(D("0.0799"), D("0.0935")),
        personal_loan=RateRange(D("0.1099"), D("0.2400")),
        auto_loan=RateRange(D("0.0849"), D("0.0950")),
        credit_card=CreditCardCard(
            apr_low=D("0.372"), apr_high=D("0.42"),
        ),
        processing_fee_pct=D("0.0050"),
    ),
    InstitutionRateCard(
        institution_id="IN_PNB", country=Country.IN, name="PNB", scrape_tier="A",
        home_loan=RateRange(D("0.0770"), D("0.0915")),
        personal_loan=RateRange(D("0.1100"), D("0.1700")),
        auto_loan=RateRange(D("0.0825"), D("0.0975")),
        processing_fee_pct=D("0.0050"),
    ),
]


# ─────────────────────────────────────────────────────────────────────────────
# India — Tier B (10) and Tier C (14): scaffolded; rate ranges pending data ops
# ─────────────────────────────────────────────────────────────────────────────

_INDIA_TIER_B_NAMES = [
    "Bank of Baroda", "Canara Bank", "Bank of India", "Union Bank",
    "Indian Bank", "Central Bank", "IDBI", "Yes Bank", "IDFC First", "IndusInd Bank",
]
_INDIA_TIER_C_NAMES = [
    "Federal Bank", "South Indian Bank", "RBL Bank", "Bandhan Bank",
    "AU SFB", "UCO Bank", "Bank of Maharashtra", "Punjab & Sind",
    "Karnataka Bank", "Karur Vysya", "City Union", "J&K Bank",
    "Ujjivan SFB", "Suryoday SFB",
]

INDIA_TIER_B: list[InstitutionRateCard] = [
    InstitutionRateCard(
        institution_id=f"IN_{name.upper().replace(' ', '_')}",
        country=Country.IN, name=name, scrape_tier="B",
    )
    for name in _INDIA_TIER_B_NAMES
]
INDIA_TIER_C: list[InstitutionRateCard] = [
    InstitutionRateCard(
        institution_id=f"IN_{name.upper().replace(' ', '_').replace('&', 'AND')}",
        country=Country.IN, name=name, scrape_tier="C",
    )
    for name in _INDIA_TIER_C_NAMES
]


# ─────────────────────────────────────────────────────────────────────────────
# USA — Tier A (6 institutions, indicative May 2026, Fed 3.50-3.75%)
# ─────────────────────────────────────────────────────────────────────────────

USA_TIER_A: list[InstitutionRateCard] = [
    InstitutionRateCard(
        institution_id="US_CHASE", country=Country.US, name="JPMorgan Chase", scrape_tier="A",
        home_loan=RateRange(D("0.0650"), D("0.0700")),       # 30yr fixed
        personal_loan=RateRange(D("0.0699"), D("0.2499")),
        auto_loan=RateRange(D("0.0569"), D("0.1369")),
        credit_card=CreditCardCard(
            apr_low=D("0.2024"), apr_high=D("0.2924"),
        ),
        processing_fee_pct=D("0.01"),
    ),
    InstitutionRateCard(
        institution_id="US_BOFA", country=Country.US, name="Bank of America", scrape_tier="A",
        home_loan=RateRange(D("0.0655"), D("0.0705")),
        personal_loan=RateRange(D("0.0749"), D("0.2499")),
        auto_loan=RateRange(D("0.0549"), D("0.1074")),
        credit_card=CreditCardCard(
            apr_low=D("0.1799"), apr_high=D("0.2899"),
        ),
    ),
    InstitutionRateCard(
        institution_id="US_WFC", country=Country.US, name="Wells Fargo", scrape_tier="A",
        home_loan=RateRange(D("0.0645"), D("0.0695")),
        personal_loan=RateRange(D("0.0749"), D("0.2399")),
        auto_loan=RateRange(D("0.0574"), D("0.1174")),
        credit_card=CreditCardCard(
            apr_low=D("0.1999"), apr_high=D("0.2899"),
        ),
    ),
    InstitutionRateCard(
        institution_id="US_CITI", country=Country.US, name="Citibank", scrape_tier="A",
        home_loan=RateRange(D("0.0660"), D("0.0710")),
        personal_loan=RateRange(D("0.1149"), D("0.2049")),
        credit_card=CreditCardCard(
            apr_low=D("0.1974"), apr_high=D("0.2974"),
        ),
    ),
    InstitutionRateCard(
        institution_id="US_USBANK", country=Country.US, name="U.S. Bank", scrape_tier="A",
        home_loan=RateRange(D("0.0660"), D("0.0710")),
        personal_loan=RateRange(D("0.0849"), D("0.2199")),
        auto_loan=RateRange(D("0.0599"), D("0.1199")),
        credit_card=CreditCardCard(
            apr_low=D("0.1949"), apr_high=D("0.2899"),
        ),
    ),
    InstitutionRateCard(
        institution_id="US_COF", country=Country.US, name="Capital One", scrape_tier="A",
        auto_loan=RateRange(D("0.0479"), D("0.0979")),
        credit_card=CreditCardCard(
            apr_low=D("0.1974"), apr_high=D("0.2974"),
        ),
    ),
]

_USA_TIER_B_NAMES = [
    "American Express", "Discover", "Goldman Sachs", "Ally Financial",
    "Truist", "PNC Financial",
]
_USA_TIER_C_NAMES = ["TD Bank", "Navy Federal Credit Union", "SoFi"]

USA_TIER_B: list[InstitutionRateCard] = [
    InstitutionRateCard(
        institution_id=f"US_{name.upper().replace(' ', '_').replace('.', '')}",
        country=Country.US, name=name, scrape_tier="B",
    )
    for name in _USA_TIER_B_NAMES
]
USA_TIER_C: list[InstitutionRateCard] = [
    InstitutionRateCard(
        institution_id=f"US_{name.upper().replace(' ', '_').replace('.', '')}",
        country=Country.US, name=name, scrape_tier="C",
    )
    for name in _USA_TIER_C_NAMES
]


# ─────────────────────────────────────────────────────────────────────────────
# Combined index for lookup
# ─────────────────────────────────────────────────────────────────────────────

ALL_INSTITUTIONS: dict[str, InstitutionRateCard] = {
    card.name: card
    for card in (
        INDIA_TIER_A + INDIA_TIER_B + INDIA_TIER_C
        + USA_TIER_A + USA_TIER_B + USA_TIER_C
    )
}


def lookup_rate(bank: str, loan_type: LoanType) -> RateRange | None:
    """Returns the indicative rate range for `bank`'s `loan_type` product.
    Returns None if the bank/product combination has no populated data yet.
    """
    card = ALL_INSTITUTIONS.get(bank)
    if card is None:
        return None
    if loan_type == LoanType.HOME:
        return card.home_loan
    if loan_type == LoanType.PERSONAL:
        return card.personal_loan
    if loan_type == LoanType.AUTO:
        return card.auto_loan
    if loan_type == LoanType.EDUCATION:
        return card.education_loan
    if loan_type == LoanType.CREDIT_CARD:
        cc = card.credit_card
        return RateRange(cc.apr_low, cc.apr_high) if cc else None
    return None


def market_median(country: Country, loan_type: LoanType) -> Decimal | None:
    """Median across all populated Tier-A entries in `country`. Used by
    restructuring.scan_refinance() as the market reference."""
    pool = INDIA_TIER_A if country == Country.IN else USA_TIER_A
    medians: list[Decimal] = []
    for card in pool:
        r = lookup_rate(card.name, loan_type)
        if r is not None:
            medians.append(r.median)
    if not medians:
        return None
    medians.sort()
    n = len(medians)
    return medians[n // 2] if n % 2 == 1 else (medians[n // 2 - 1] + medians[n // 2]) / D("2")
