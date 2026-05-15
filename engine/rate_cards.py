"""Institution rate cards — Phase 1 (India 30 + USA 15) per design spec §7.1.

Tier-A banks are populated with indicative ranges verified May 2026 (post-RBI
cut to 5.25%; Fed funds 3.50-3.75%). Tier-B and Tier-C entries are filled with
*extrapolated* indicative ranges anchored to Tier-A peers and typical product
positioning (PSU spread vs private mid-tier vs SFB) — each is flagged
`is_indicative=True` so data ops can swap in live scrapes incrementally.

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
    # Late-payment fields, all optional. When None we fall back to the
    # country/loan-type defaults in `engine.penalties`. Each is sourced from
    # the bank's published Schedule of Charges (links archived alongside
    # `last_verified`); for Tier-B/C indicative entries these stay None and
    # the defaults apply.
    late_payment_flat_fee: Optional[Decimal] = None      # ₹ / $ — flat hit per missed EMI
    late_payment_penal_rate: Optional[Decimal] = None    # annualised; added to nominal on overdue principal
    last_verified: str = "2026-05-14"
    is_indicative: bool = False     # True for Tier-B/C extrapolations


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
# India — Tier B (10): PSU and private mid-tier (indicative, extrapolated)
# Spread vs Tier-A: PSU home loans ≈ peer; private mid-tier personal/cards
# slightly higher than top-private (HDFC/ICICI) to reflect distribution costs.
# ─────────────────────────────────────────────────────────────────────────────

INDIA_TIER_B: list[InstitutionRateCard] = [
    InstitutionRateCard(
        institution_id="IN_BOB", country=Country.IN, name="Bank of Baroda", scrape_tier="B",
        is_indicative=True,
        home_loan=RateRange(D("0.0745"), D("0.0895")),
        personal_loan=RateRange(D("0.1105"), D("0.1875")),
        auto_loan=RateRange(D("0.0815"), D("0.1050")),
        credit_card=CreditCardCard(apr_low=D("0.33"), apr_high=D("0.44")),
        processing_fee_pct=D("0.0050"),
    ),
    InstitutionRateCard(
        institution_id="IN_CANARA", country=Country.IN, name="Canara Bank", scrape_tier="B",
        is_indicative=True,
        home_loan=RateRange(D("0.0755"), D("0.0985")),
        personal_loan=RateRange(D("0.1105"), D("0.1555")),
        auto_loan=RateRange(D("0.0805"), D("0.1085")),
        credit_card=CreditCardCard(apr_low=D("0.33"), apr_high=D("0.44")),
        processing_fee_pct=D("0.0050"),
    ),
    InstitutionRateCard(
        institution_id="IN_BOI", country=Country.IN, name="Bank of India", scrape_tier="B",
        is_indicative=True,
        home_loan=RateRange(D("0.0755"), D("0.0950")),
        personal_loan=RateRange(D("0.1120"), D("0.1650")),
        auto_loan=RateRange(D("0.0840"), D("0.1085")),
        credit_card=CreditCardCard(apr_low=D("0.30"), apr_high=D("0.42")),
        processing_fee_pct=D("0.0050"),
    ),
    InstitutionRateCard(
        institution_id="IN_UNION_BANK", country=Country.IN, name="Union Bank", scrape_tier="B",
        is_indicative=True,
        home_loan=RateRange(D("0.0755"), D("0.0920")),
        personal_loan=RateRange(D("0.1140"), D("0.1520")),
        auto_loan=RateRange(D("0.0840"), D("0.1100")),
        processing_fee_pct=D("0.0050"),
    ),
    InstitutionRateCard(
        institution_id="IN_INDIAN_BANK", country=Country.IN, name="Indian Bank", scrape_tier="B",
        is_indicative=True,
        home_loan=RateRange(D("0.0760"), D("0.0885")),
        personal_loan=RateRange(D("0.1150"), D("0.1695")),
        auto_loan=RateRange(D("0.0840"), D("0.1090")),
        processing_fee_pct=D("0.0050"),
    ),
    InstitutionRateCard(
        institution_id="IN_CENTRAL_BANK", country=Country.IN, name="Central Bank", scrape_tier="B",
        is_indicative=True,
        home_loan=RateRange(D("0.0795"), D("0.0940")),
        personal_loan=RateRange(D("0.1155"), D("0.1550")),
        auto_loan=RateRange(D("0.0855"), D("0.1120")),
        processing_fee_pct=D("0.0050"),
    ),
    InstitutionRateCard(
        institution_id="IN_IDBI", country=Country.IN, name="IDBI", scrape_tier="B",
        is_indicative=True,
        home_loan=RateRange(D("0.0785"), D("0.1010")),
        personal_loan=RateRange(D("0.1100"), D("0.1750")),
        auto_loan=RateRange(D("0.0880"), D("0.1125")),
        credit_card=CreditCardCard(apr_low=D("0.28"), apr_high=D("0.42")),
        processing_fee_pct=D("0.0050"),
    ),
    InstitutionRateCard(
        institution_id="IN_YES_BANK", country=Country.IN, name="Yes Bank", scrape_tier="B",
        is_indicative=True,
        home_loan=RateRange(D("0.0845"), D("0.1050")),
        personal_loan=RateRange(D("0.1099"), D("0.2200")),
        auto_loan=RateRange(D("0.0900"), D("0.1140")),
        credit_card=CreditCardCard(
            apr_low=D("0.30"), apr_high=D("0.48"),
            cash_advance_low=D("0.36"), cash_advance_high=D("0.48"),
        ),
        processing_fee_pct=D("0.0099"),
    ),
    InstitutionRateCard(
        institution_id="IN_IDFC_FIRST", country=Country.IN, name="IDFC First", scrape_tier="B",
        is_indicative=True,
        home_loan=RateRange(D("0.0845"), D("0.1050")),
        personal_loan=RateRange(D("0.0999"), D("0.2399")),
        auto_loan=RateRange(D("0.0940"), D("0.1190")),
        credit_card=CreditCardCard(
            apr_low=D("0.275"), apr_high=D("0.462"),
            bt_promo_rate=D("0"), bt_promo_months=3, bt_fee_pct=D("0.0149"),
        ),
        processing_fee_pct=D("0.0099"),
    ),
    InstitutionRateCard(
        institution_id="IN_INDUSIND", country=Country.IN, name="IndusInd Bank", scrape_tier="B",
        is_indicative=True,
        home_loan=RateRange(D("0.0850"), D("0.1085")),
        personal_loan=RateRange(D("0.1049"), D("0.2300")),
        auto_loan=RateRange(D("0.0910"), D("0.1200")),
        credit_card=CreditCardCard(
            apr_low=D("0.264"), apr_high=D("0.432"),
            bt_promo_rate=D("0"), bt_promo_months=3, bt_fee_pct=D("0.0149"),
        ),
        processing_fee_pct=D("0.0099"),
    ),
]


# ─────────────────────────────────────────────────────────────────────────────
# India — Tier C (14): regional private + SFBs (indicative, extrapolated)
# Small finance banks (SFB) target retail+MSME; rates wider than Tier-B and
# home-loan coverage thin. PSU regionals (UCO/BoM/P&SB) priced like Tier-B PSUs.
# ─────────────────────────────────────────────────────────────────────────────

INDIA_TIER_C: list[InstitutionRateCard] = [
    InstitutionRateCard(
        institution_id="IN_FEDERAL", country=Country.IN, name="Federal Bank", scrape_tier="C",
        is_indicative=True,
        home_loan=RateRange(D("0.0800"), D("0.1060")),
        personal_loan=RateRange(D("0.1149"), D("0.1950")),
        auto_loan=RateRange(D("0.0920"), D("0.1150")),
        credit_card=CreditCardCard(apr_low=D("0.30"), apr_high=D("0.42")),
        processing_fee_pct=D("0.0050"),
    ),
    InstitutionRateCard(
        institution_id="IN_SOUTH_INDIAN", country=Country.IN, name="South Indian Bank", scrape_tier="C",
        is_indicative=True,
        home_loan=RateRange(D("0.0795"), D("0.1020")),
        personal_loan=RateRange(D("0.1145"), D("0.2065")),
        auto_loan=RateRange(D("0.0910"), D("0.1120")),
        processing_fee_pct=D("0.0075"),
    ),
    InstitutionRateCard(
        institution_id="IN_RBL", country=Country.IN, name="RBL Bank", scrape_tier="C",
        is_indicative=True,
        home_loan=RateRange(D("0.0910"), D("0.1175")),
        personal_loan=RateRange(D("0.1400"), D("0.2300")),
        credit_card=CreditCardCard(
            apr_low=D("0.30"), apr_high=D("0.45"),
            cash_advance_low=D("0.36"), cash_advance_high=D("0.48"),
        ),
        processing_fee_pct=D("0.0199"),
    ),
    InstitutionRateCard(
        institution_id="IN_BANDHAN", country=Country.IN, name="Bandhan Bank", scrape_tier="C",
        is_indicative=True,
        home_loan=RateRange(D("0.0865"), D("0.1300")),
        personal_loan=RateRange(D("0.1155"), D("0.2000")),
        auto_loan=RateRange(D("0.0950"), D("0.1200")),
        processing_fee_pct=D("0.0100"),
    ),
    InstitutionRateCard(
        institution_id="IN_AU_SFB", country=Country.IN, name="AU SFB", scrape_tier="C",
        is_indicative=True,
        home_loan=RateRange(D("0.0850"), D("0.1150")),
        personal_loan=RateRange(D("0.1199"), D("0.2400")),
        auto_loan=RateRange(D("0.0945"), D("0.1300")),
        credit_card=CreditCardCard(apr_low=D("0.30"), apr_high=D("0.46")),
        processing_fee_pct=D("0.0150"),
    ),
    InstitutionRateCard(
        institution_id="IN_UCO", country=Country.IN, name="UCO Bank", scrape_tier="C",
        is_indicative=True,
        home_loan=RateRange(D("0.0765"), D("0.0880")),
        personal_loan=RateRange(D("0.1130"), D("0.1465")),
        auto_loan=RateRange(D("0.0835"), D("0.1040")),
        processing_fee_pct=D("0.0050"),
    ),
    InstitutionRateCard(
        institution_id="IN_BANK_OF_MAHARASHTRA", country=Country.IN, name="Bank of Maharashtra", scrape_tier="C",
        is_indicative=True,
        home_loan=RateRange(D("0.0765"), D("0.0910")),
        personal_loan=RateRange(D("0.1105"), D("0.1485")),
        auto_loan=RateRange(D("0.0835"), D("0.1070")),
        processing_fee_pct=D("0.0050"),
    ),
    InstitutionRateCard(
        institution_id="IN_PUNJAB_AND_SIND", country=Country.IN, name="Punjab & Sind", scrape_tier="C",
        is_indicative=True,
        home_loan=RateRange(D("0.0785"), D("0.0890")),
        personal_loan=RateRange(D("0.1145"), D("0.1540")),
        auto_loan=RateRange(D("0.0865"), D("0.1085")),
        processing_fee_pct=D("0.0050"),
    ),
    InstitutionRateCard(
        institution_id="IN_KARNATAKA", country=Country.IN, name="Karnataka Bank", scrape_tier="C",
        is_indicative=True,
        home_loan=RateRange(D("0.0840"), D("0.1065")),
        personal_loan=RateRange(D("0.1159"), D("0.2095")),
        auto_loan=RateRange(D("0.0920"), D("0.1185")),
        processing_fee_pct=D("0.0075"),
    ),
    InstitutionRateCard(
        institution_id="IN_KARUR_VYSYA", country=Country.IN, name="Karur Vysya", scrape_tier="C",
        is_indicative=True,
        home_loan=RateRange(D("0.0915"), D("0.1095")),
        personal_loan=RateRange(D("0.1250"), D("0.1950")),
        auto_loan=RateRange(D("0.0940"), D("0.1200")),
        processing_fee_pct=D("0.0075"),
    ),
    InstitutionRateCard(
        institution_id="IN_CITY_UNION", country=Country.IN, name="City Union", scrape_tier="C",
        is_indicative=True,
        home_loan=RateRange(D("0.0905"), D("0.1105")),
        personal_loan=RateRange(D("0.1200"), D("0.2050")),
        auto_loan=RateRange(D("0.0950"), D("0.1225")),
        processing_fee_pct=D("0.0075"),
    ),
    InstitutionRateCard(
        institution_id="IN_JANDK", country=Country.IN, name="J&K Bank", scrape_tier="C",
        is_indicative=True,
        home_loan=RateRange(D("0.0850"), D("0.0985")),
        personal_loan=RateRange(D("0.1150"), D("0.1595")),
        auto_loan=RateRange(D("0.0920"), D("0.1150")),
        processing_fee_pct=D("0.0050"),
    ),
    InstitutionRateCard(
        institution_id="IN_UJJIVAN_SFB", country=Country.IN, name="Ujjivan SFB", scrape_tier="C",
        is_indicative=True,
        personal_loan=RateRange(D("0.1450"), D("0.2400")),
        credit_card=CreditCardCard(apr_low=D("0.30"), apr_high=D("0.48")),
        processing_fee_pct=D("0.0200"),
    ),
    InstitutionRateCard(
        institution_id="IN_SURYODAY_SFB", country=Country.IN, name="Suryoday SFB", scrape_tier="C",
        is_indicative=True,
        personal_loan=RateRange(D("0.1500"), D("0.2700")),
        processing_fee_pct=D("0.0250"),
    ),
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

# ─────────────────────────────────────────────────────────────────────────────
# USA — Tier B (6): card networks + neobanks + regional majors (indicative)
# Amex/Discover/GS are card-first (no home/auto); Ally is auto-focused;
# Truist/PNC are full-service regionals priced near Tier-A.
# ─────────────────────────────────────────────────────────────────────────────

USA_TIER_B: list[InstitutionRateCard] = [
    InstitutionRateCard(
        institution_id="US_AMEX", country=Country.US, name="American Express", scrape_tier="B",
        is_indicative=True,
        personal_loan=RateRange(D("0.0691"), D("0.1997")),
        credit_card=CreditCardCard(
            apr_low=D("0.1999"), apr_high=D("0.2999"),
            bt_promo_rate=D("0"), bt_promo_months=15, bt_fee_pct=D("0.03"),
        ),
    ),
    InstitutionRateCard(
        institution_id="US_DISCOVER", country=Country.US, name="Discover", scrape_tier="B",
        is_indicative=True,
        personal_loan=RateRange(D("0.0799"), D("0.2499")),
        credit_card=CreditCardCard(
            apr_low=D("0.1824"), apr_high=D("0.2824"),
            bt_promo_rate=D("0"), bt_promo_months=18, bt_fee_pct=D("0.03"),
        ),
    ),
    InstitutionRateCard(
        institution_id="US_GS", country=Country.US, name="Goldman Sachs", scrape_tier="B",
        is_indicative=True,
        personal_loan=RateRange(D("0.0999"), D("0.2999")),
        credit_card=CreditCardCard(apr_low=D("0.1924"), apr_high=D("0.2924")),  # Apple Card
    ),
    InstitutionRateCard(
        institution_id="US_ALLY", country=Country.US, name="Ally Financial", scrape_tier="B",
        is_indicative=True,
        home_loan=RateRange(D("0.0645"), D("0.0695")),
        personal_loan=RateRange(D("0.0999"), D("0.2599")),
        auto_loan=RateRange(D("0.0539"), D("0.1349")),
    ),
    InstitutionRateCard(
        institution_id="US_TRUIST", country=Country.US, name="Truist", scrape_tier="B",
        is_indicative=True,
        home_loan=RateRange(D("0.0655"), D("0.0705")),
        personal_loan=RateRange(D("0.0839"), D("0.1849")),
        auto_loan=RateRange(D("0.0579"), D("0.1299")),
        credit_card=CreditCardCard(apr_low=D("0.1849"), apr_high=D("0.2849")),
        processing_fee_pct=D("0.01"),
    ),
    InstitutionRateCard(
        institution_id="US_PNC", country=Country.US, name="PNC Financial", scrape_tier="B",
        is_indicative=True,
        home_loan=RateRange(D("0.0655"), D("0.0705")),
        personal_loan=RateRange(D("0.0899"), D("0.2299")),
        auto_loan=RateRange(D("0.0584"), D("0.1324")),
        credit_card=CreditCardCard(apr_low=D("0.1924"), apr_high=D("0.2824")),
        processing_fee_pct=D("0.01"),
    ),
]


# ─────────────────────────────────────────────────────────────────────────────
# USA — Tier C (3): regional + credit union + fintech (indicative)
# Navy Federal CU very competitive on auto/CC due to member model; SoFi
# tracks the online-lender personal-loan band.
# ─────────────────────────────────────────────────────────────────────────────

USA_TIER_C: list[InstitutionRateCard] = [
    InstitutionRateCard(
        institution_id="US_TD", country=Country.US, name="TD Bank", scrape_tier="C",
        is_indicative=True,
        home_loan=RateRange(D("0.0665"), D("0.0715")),
        personal_loan=RateRange(D("0.0949"), D("0.2349")),
        auto_loan=RateRange(D("0.0604"), D("0.1354")),
        credit_card=CreditCardCard(apr_low=D("0.1999"), apr_high=D("0.2999")),
        processing_fee_pct=D("0.01"),
    ),
    InstitutionRateCard(
        institution_id="US_NAVY_FEDERAL", country=Country.US, name="Navy Federal Credit Union", scrape_tier="C",
        is_indicative=True,
        home_loan=RateRange(D("0.0620"), D("0.0675")),
        personal_loan=RateRange(D("0.0849"), D("0.1800")),
        auto_loan=RateRange(D("0.0459"), D("0.0999")),
        credit_card=CreditCardCard(apr_low=D("0.1174"), apr_high=D("0.18"), bt_fee_pct=D("0")),
    ),
    InstitutionRateCard(
        institution_id="US_SOFI", country=Country.US, name="SoFi", scrape_tier="C",
        is_indicative=True,
        home_loan=RateRange(D("0.0640"), D("0.0690")),
        personal_loan=RateRange(D("0.0899"), D("0.2999")),
        credit_card=CreditCardCard(apr_low=D("0.1499"), apr_high=D("0.2999")),
    ),
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
