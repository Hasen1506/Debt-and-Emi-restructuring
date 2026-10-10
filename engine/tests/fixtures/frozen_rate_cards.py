"""FROZEN COPY for tests: the rate cards as of 14 May 2026.

Tests that check what the engine does with a bank's rates read these, so
refreshing the live cards in engine/rate_cards.py (by hand or by the
scheduled update) never changes their expected numbers. Do not update.
"""
from decimal import Decimal

from engine.models import Country
from engine.rate_cards import CreditCardCard, InstitutionRateCard, LoanTerms, RateRange

D = Decimal


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
        # HDFC PL: ~4% in first 12mo, part-payment ~once per loan-year (typical HDFC PL terms).
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
        # ICICI PL: ~5% in first 6mo per published policy; part-payment ~monthly cap.
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
        # Axis PL: ~4% in first 6mo, part-payment ~biannual (typical Axis PL).
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
        # Kotak PL: ~5% in first 12mo, quarterly part-payment cap (typical Kotak PL).
    ),
    InstitutionRateCard(
        institution_id="IN_PNB", country=Country.IN, name="PNB", scrape_tier="A",
        home_loan=RateRange(D("0.0770"), D("0.0915")),
        personal_loan=RateRange(D("0.1100"), D("0.1700")),
        auto_loan=RateRange(D("0.0825"), D("0.0975")),
        processing_fee_pct=D("0.0050"),
        # PNB (PSU) — typically more lenient PL terms; ~2% in first 6mo.
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
# India — Fintech & aggregator brands (KreditBee, GPay, Cred, PaisaBazaar)
# These aren't banks — they're NBFCs or aggregator front-ends — but users
# routinely think of them as their lender ("my KreditBee loan"). Personal
# loan is the only product surface; rates wider than bank Tier-C because
# distribution-heavy and risk-priced. No prepay penalty is typical post a
# short cool-off. All indicative; confirm in the user's actual loan doc.
# ─────────────────────────────────────────────────────────────────────────────

INDIA_FINTECH: list[InstitutionRateCard] = [
    InstitutionRateCard(
        institution_id="IN_KREDITBEE", country=Country.IN, name="KreditBee", scrape_tier="C",
        is_indicative=True,
        personal_loan=RateRange(D("0.1700"), D("0.3000")),
        processing_fee_pct=D("0.0250"),
    ),
    InstitutionRateCard(
        institution_id="IN_CRED", country=Country.IN, name="Cred", scrape_tier="C",
        is_indicative=True,
        personal_loan=RateRange(D("0.1200"), D("0.1800")),
        processing_fee_pct=D("0.0100"),
    ),
    InstitutionRateCard(
        institution_id="IN_GPAY", country=Country.IN, name="Google Pay", scrape_tier="C",
        is_indicative=True,
        personal_loan=RateRange(D("0.1200"), D("0.2400")),
        processing_fee_pct=D("0.0200"),
    ),
    InstitutionRateCard(
        institution_id="IN_PAISABAZAAR", country=Country.IN, name="PaisaBazaar", scrape_tier="C",
        is_indicative=True,
        personal_loan=RateRange(D("0.1100"), D("0.2400")),
        processing_fee_pct=D("0.0200"),
    ),
]


# ─────────────────────────────────────────────────────────────────────────────
# USA — Tier A (6 institutions, indicative May 2026, Fed 3.50-3.75%)
# ─────────────────────────────────────────────────────────────────────────────

# Chase and Bank of America make no personal loans (Chase lends only
# against a card's limit, as "My Chase Loan"), so they have no
# personal_loan range: a refinance suggestion must not point at one.
USA_TIER_A: list[InstitutionRateCard] = [
    InstitutionRateCard(
        institution_id="US_CHASE", country=Country.US, name="JPMorgan Chase", scrape_tier="A",
        home_loan=RateRange(D("0.0650"), D("0.0700")),       # 30yr fixed
        auto_loan=RateRange(D("0.0569"), D("0.1369")),
        credit_card=CreditCardCard(
            apr_low=D("0.2024"), apr_high=D("0.2924"),
        ),
        processing_fee_pct=D("0.01"),
    ),
    InstitutionRateCard(
        institution_id="US_BOFA", country=Country.US, name="Bank of America", scrape_tier="A",
        home_loan=RateRange(D("0.0655"), D("0.0705")),
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
# Goldman stopped making personal loans in 2023 and Ally sold its lending
# arm to Synchrony in 2024, so neither has a personal_loan range, and Ally
# took its last mortgage applications on 31 Jan 2025. Discover's personal
# loans carry on under Capital One (6.99–24.99%, 2026);
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
        personal_loan=RateRange(D("0.0699"), D("0.2499")),
        credit_card=CreditCardCard(
            apr_low=D("0.1824"), apr_high=D("0.2824"),
            bt_promo_rate=D("0"), bt_promo_months=18, bt_fee_pct=D("0.03"),
        ),
    ),
    InstitutionRateCard(
        institution_id="US_GS", country=Country.US, name="Goldman Sachs", scrape_tier="B",
        is_indicative=True,
        credit_card=CreditCardCard(apr_low=D("0.1924"), apr_high=D("0.2924")),  # Apple Card
    ),
    InstitutionRateCard(
        institution_id="US_ALLY", country=Country.US, name="Ally Financial", scrape_tier="B",
        is_indicative=True,
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
        INDIA_TIER_A + INDIA_TIER_B + INDIA_TIER_C + INDIA_FINTECH
        + USA_TIER_A + USA_TIER_B + USA_TIER_C
    )
}
