"""Institution rate cards — Phase 1 (India 30 + USA 15) per design spec §7.1.

Tier-A banks hold ranges read from each bank's own rate pages: India re-checked
9 Oct 2026 (RBI repo 5.50% from 7 Oct 2026), USA 9 Oct 2026 (Fed funds
3.75-4.00% from 16 Sep 2026). An entry whose `last_verified` is older was not
re-read then. Tier-B and Tier-C entries are filled with
*extrapolated* indicative ranges anchored to Tier-A peers and typical product
positioning (PSU spread vs private mid-tier vs SFB) — each is flagged
`is_indicative=True` so data ops can swap in live scrapes incrementally.

Audit 80+ A21 (14 Oct 2026): those extrapolated figures were never read off a
lender's page, so wherever they surface they are labelled UNVERIFIED_LABEL
("typical, unverified") and never quoted as a lender's rate: Loan Check
ignores them (loan_check.find_lender), Home's "Cheaper rates" uses Tier A
only (restructuring_scan._country_pool), and the Profile range hint shows
the label and offers no click-to-fill from them (web RateRangeHint). The
"2026-05 industry norms" LoanTerms figures are gone: a term no rule fixes
and no bank page states is "not known", never a guessed number. How the
cards should be refreshed from primary sources (bank MCLR/EBLR disclosure
pages, RBI DBIE) on the existing cron: docs/RATE-SOURCES.md.

All rates are Decimal in [0, 1]. Use the `low`/`high` ends for sensitivity
sliders; the median is what the optimiser uses by default.
"""
from decimal import Decimal
from dataclasses import dataclass, field, replace
from typing import Optional
from engine.models import Country, LoanType

D = Decimal

# The label for a figure no one read off a lender's own page.
UNVERIFIED_LABEL = "typical, unverified"

# What the Tier-A cards were priced against when last read. The weekly data
# run (scripts/refresh_market_data.py) flags the cards for a re-read once the
# live figure moves away from these: a repo change shifts every Indian
# repo-linked home loan; a quarter point in the 30-year average moves US
# mortgage quotes.
REPO_BASIS_IN = D("0.0550")      # RBI repo from 7 Oct 2026
FED_UPPER_BASIS_US = D("0.0400")  # Fed funds upper bound from 16 Sep 2026
PMMS_BASIS_US = D("0.0740")       # Freddie Mac 30-year average, 8 Oct 2026


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
class LoanTerms:
    """Per-bank, per-loan-type True-APR restructuring triggers — surfaced
    to onboarding as click-to-fill suggestions so users with their sanction
    letter handy don't have to look up every field, while users who skip
    them still get a working plan (defaults to no restrictions).

    Populated from each bank's Schedule of Charges where reliable; otherwise
    falls back to country/loan-type defaults documented in [[lookup_loan_terms]].
    All fields are Decimal/int in the same units as Loan dataclass.

    The `is_indicative` flag mirrors the rate-card pattern — it's True when
    the values came from typical industry norms / training-data knowledge
    rather than a verified read of the bank's current Schedule of Charges
    PDF. The UI uses this to label the suggestion "indicative — confirm
    with sanction letter" so users don't treat the suggestion as ground
    truth. (A21: no entry carries guessed figures any more; an unsourced
    term is None with UNVERIFIED_LABEL, never a number.) Country defaults from `_country_default_terms` are regulatory
    (RBI mandate / CARD Act / QM rule) and pass through as
    is_indicative=False.
    """
    prepayment_penalty_pct: Optional[Decimal] = None
    prepay_lock_in_months: Optional[int] = None
    part_payment_freq_months: Optional[int] = None
    is_indicative: bool = True
    last_verified: str = UNVERIFIED_LABEL


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

    @property
    def verification(self) -> str:
        """How far to trust this card's figures, as the UI says it:
        "checked 2026-10-09" for a Tier-A read, UNVERIFIED_LABEL for an
        extrapolation (whatever its last_verified field holds)."""
        return UNVERIFIED_LABEL if self.is_indicative else f"checked {self.last_verified}"
    # Per-loan-type True-APR triggers. When set, the /api/loan-terms
    # endpoint exposes them as onboarding click-to-fill suggestions for
    # users on this bank + loan type. When None, callers fall through
    # to the country / loan-type default (see lookup_loan_terms).
    home_loan_terms: Optional[LoanTerms] = None
    personal_loan_terms: Optional[LoanTerms] = None
    auto_loan_terms: Optional[LoanTerms] = None
    education_loan_terms: Optional[LoanTerms] = None
    credit_card_terms: Optional[LoanTerms] = None


# ─────────────────────────────────────────────────────────────────────────────
# India — Tier A (6 institutions; bank pages read 9 Oct 2026 unless noted)
# Axis, Kotak and SBI home loans were still quoted on the 5.25% repo rate that
# day; their repo-linked rates carry the 7 Oct hike (+0.25) here.
# ─────────────────────────────────────────────────────────────────────────────

INDIA_TIER_A: list[InstitutionRateCard] = [
    InstitutionRateCard(
        institution_id="IN_SBI", country=Country.IN, name="SBI", scrape_tier="A",
        # Home 7.50% onwards w.e.f. 15 Oct 2026 (re-read 24 Oct 2026).
        # Personal 10.00-15.00% (Xpress Credit, updated 28 Sep 2026); car
        # 8.40-9.35% (updated 16 Sep 2026). SBI Card: 3.75%/mo (45%) on
        # unsecured cards, 2.75%/mo (33%) on secured cards. Its 60-day 0%
        # transfer is left out: the fee isn't published, and a promo with
        # an unknown fee would be scored as free.
        home_loan=RateRange(D("0.0750"), D("0.0870")),
        personal_loan=RateRange(D("0.1000"), D("0.1500")),
        auto_loan=RateRange(D("0.0840"), D("0.0935")),
        credit_card=CreditCardCard(
            apr_low=D("0.33"), apr_high=D("0.45"),
            cash_advance_low=D("0.36"), cash_advance_high=D("0.48"),
        ),
        processing_fee_pct=D("0.0050"),
        last_verified="2026-10-09",
    ),
    InstitutionRateCard(
        institution_id="IN_HDFC", country=Country.IN, name="HDFC Bank", scrape_tier="A",
        # Home: repo 5.50% + 2.50 to + 7.95 = 8.00-13.45%. Personal
        # 9.99-24.00%. Car: 9.00% onwards (rack rate). Cards (MITC): 3.75%/mo
        # = 45% on most cards, 1.99%/mo = 23.88% on Infinia, Diners Black and
        # the like. No 0% balance transfer is offered (a transfer is an EMI
        # loan on the card from 0.84%/mo), so none is listed; processing
        # 1% of the amount, ₹250 at least.
        home_loan=RateRange(D("0.0800"), D("0.1345")),
        personal_loan=RateRange(D("0.0999"), D("0.2400")),
        auto_loan=RateRange(D("0.0900"), D("0.0940")),
        credit_card=CreditCardCard(
            apr_low=D("0.2388"), apr_high=D("0.45"),
            cash_advance_low=D("0.36"), cash_advance_high=D("0.48"),
            bt_fee_pct=D("0.01"),
        ),
        processing_fee_pct=D("0.0050"),
        last_verified="2026-10-09",
        # HDFC PL: ~4% in first 12mo, part-payment ~once per loan-year (typical HDFC PL terms).
    ),
    InstitutionRateCard(
        institution_id="IN_ICICI", country=Country.IN, name="ICICI Bank", scrape_tier="A",
        # Home 8.75-10.05% standard (pre-approved digital offers from
        # 7.55%), on repo 5.50%. Personal 9.99-16.50%. Cards 1.25-3.75%/mo
        # (15-45%); a balance transfer carries the card's own rate, so no
        # 0% promo. Car loan not re-read.
        home_loan=RateRange(D("0.0875"), D("0.1005")),
        personal_loan=RateRange(D("0.0999"), D("0.1650")),
        auto_loan=RateRange(D("0.0880"), D("0.0980")),
        credit_card=CreditCardCard(
            apr_low=D("0.15"), apr_high=D("0.45"),
            cash_advance_low=D("0.36"), cash_advance_high=D("0.48"),
        ),
        processing_fee_pct=D("0.0050"),
        last_verified="2026-10-09",
        # ICICI PL: ~5% in first 6mo per published policy; part-payment ~monthly cap.
    ),
    InstitutionRateCard(
        institution_id="IN_AXIS", country=Country.IN, name="Axis Bank", scrape_tier="A",
        # Home 8.00-8.85% (score 751+) and 8.20-9.10% (750 and below) on the
        # 5.25% repo, +0.25. Personal 9.99-22%. Car and card not re-read.
        home_loan=RateRange(D("0.0825"), D("0.0935")),
        personal_loan=RateRange(D("0.0999"), D("0.2200")),
        auto_loan=RateRange(D("0.0865"), D("0.0950")),
        credit_card=CreditCardCard(
            apr_low=D("0.288"), apr_high=D("0.408"),
        ),
        processing_fee_pct=D("0.0050"),
        # Axis PL: ~4% in first 6mo, part-payment ~biannual (typical Axis PL).
        last_verified="2026-10-09",
    ),
    InstitutionRateCard(
        institution_id="IN_KOTAK", country=Country.IN, name="Kotak Mahindra", scrape_tier="A",
        # Home 7.70-12.00% salaried (to 13.05% self-employed) on the 5.25%
        # repo, +0.25. Cards 3.75%/mo (45%) at the top. Personal and car
        # not re-read (the personal-loan page's range wasn't labelled).
        home_loan=RateRange(D("0.0795"), D("0.1225")),
        personal_loan=RateRange(D("0.1099"), D("0.2400")),
        auto_loan=RateRange(D("0.0849"), D("0.0950")),
        credit_card=CreditCardCard(
            apr_low=D("0.372"), apr_high=D("0.45"),
        ),
        processing_fee_pct=D("0.0050"),
        # Kotak PL: ~5% in first 12mo, quarterly part-payment cap (typical Kotak PL).
        last_verified="2026-10-09",
    ),
    InstitutionRateCard(
        institution_id="IN_PNB", country=Country.IN, name="PNB", scrape_tier="A",
        # Retail loans are RLLR + spread; PNB's RLLR went from 8.10% to
        # 8.35% on 8 Oct 2026 (repo 5.50%), so the May ranges carry +0.25.
        home_loan=RateRange(D("0.0795"), D("0.0940")),
        personal_loan=RateRange(D("0.1125"), D("0.1725")),
        auto_loan=RateRange(D("0.0850"), D("0.1000")),
        processing_fee_pct=D("0.0050"),
        # PNB (PSU) — typically more lenient PL terms; ~2% in first 6mo.
        last_verified="2026-10-10",
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

# Mortgages: each bank's advertised 30-year fixed rate on 9 Oct 2026 (low)
# to half a point above it; Freddie Mac's survey average that week was
# 7.40%. Cards: the variable APR range on each bank's flagship card page.
# Chase and Bank of America make no personal loans (Chase lends only
# against a card's limit, as "My Chase Loan"), so they have no
# personal_loan range: a refinance suggestion must not point at one.
USA_TIER_A: list[InstitutionRateCard] = [
    InstitutionRateCard(
        institution_id="US_CHASE", country=Country.US, name="JPMorgan Chase", scrape_tier="A",
        home_loan=RateRange(D("0.07125"), D("0.07625")),     # 7.125% with 2.2 points
        auto_loan=RateRange(D("0.0569"), D("0.1369")),
        credit_card=CreditCardCard(
            apr_low=D("0.1849"), apr_high=D("0.2799"),        # Freedom Unlimited
        ),
        processing_fee_pct=D("0.01"),
        last_verified="2026-10-09",
    ),
    InstitutionRateCard(
        institution_id="US_BOFA", country=Country.US, name="Bank of America", scrape_tier="A",
        # The mortgage page needs a ZIP code to show a rate: the week's
        # survey average stands in.
        home_loan=RateRange(D("0.0740"), D("0.0790")),
        auto_loan=RateRange(D("0.0549"), D("0.1074")),
        credit_card=CreditCardCard(
            apr_low=D("0.1774"), apr_high=D("0.2774"),        # Customized Cash Rewards
            bt_promo_rate=D("0"), bt_promo_months=15, bt_fee_pct=D("0.03"),
        ),
        last_verified="2026-10-09",
    ),
    InstitutionRateCard(
        institution_id="US_WFC", country=Country.US, name="Wells Fargo", scrape_tier="A",
        home_loan=RateRange(D("0.0750"), D("0.0800")),
        personal_loan=RateRange(D("0.0674"), D("0.2399")),
        auto_loan=RateRange(D("0.0574"), D("0.1174")),
        credit_card=CreditCardCard(
            apr_low=D("0.1999"), apr_high=D("0.2899"),        # not re-read
        ),
        last_verified="2026-10-09",
    ),
    InstitutionRateCard(
        institution_id="US_CITI", country=Country.US, name="Citibank", scrape_tier="A",
        home_loan=RateRange(D("0.07125"), D("0.07625")),     # 0.75 points
        personal_loan=RateRange(D("0.1149"), D("0.2049")),
        credit_card=CreditCardCard(
            apr_low=D("0.1849"), apr_high=D("0.2874"),        # Double Cash
            bt_promo_rate=D("0"), bt_promo_months=18, bt_fee_pct=D("0.03"),
        ),
        last_verified="2026-10-09",
    ),
    InstitutionRateCard(
        institution_id="US_USBANK", country=Country.US, name="U.S. Bank", scrape_tier="A",
        home_loan=RateRange(D("0.07375"), D("0.07875")),
        personal_loan=RateRange(D("0.0849"), D("0.2199")),
        auto_loan=RateRange(D("0.0599"), D("0.1199")),
        credit_card=CreditCardCard(
            apr_low=D("0.1799"), apr_high=D("0.2824"),        # Cash+
            bt_promo_rate=D("0"), bt_promo_months=15, bt_fee_pct=D("0.05"),
        ),
        last_verified="2026-10-09",
    ),
    InstitutionRateCard(
        institution_id="US_COF", country=Country.US, name="Capital One", scrape_tier="A",
        auto_loan=RateRange(D("0.0479"), D("0.0979")),
        credit_card=CreditCardCard(
            apr_low=D("0.1874"), apr_high=D("0.2874"),        # Quicksilver
        ),
        last_verified="2026-10-09",
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
            apr_low=D("0.1774"), apr_high=D("0.2674"),
            bt_promo_rate=D("0"), bt_promo_months=15, bt_fee_pct=D("0.03"),
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


def lookup_rate(bank: str, loan_type: LoanType) -> RateRange | None:
    """Returns the indicative rate range for `bank`'s `loan_type` product.
    Returns None if the bank/product combination has no populated data yet.
    """
    card = ALL_INSTITUTIONS.get(bank)
    if card is None:   # same matching as lookup_loan_terms: case-insensitive
        card = next((c for k, c in ALL_INSTITUTIONS.items()
                     if k.lower() == (bank or "").lower() or c.name.lower() == (bank or "").lower()), None)
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


def _terms_field_for(card: InstitutionRateCard, loan_type: LoanType) -> Optional[LoanTerms]:
    if loan_type == LoanType.HOME:
        return card.home_loan_terms
    if loan_type == LoanType.PERSONAL:
        return card.personal_loan_terms
    if loan_type == LoanType.AUTO:
        return card.auto_loan_terms
    if loan_type == LoanType.EDUCATION:
        return card.education_loan_terms
    if loan_type == LoanType.CREDIT_CARD:
        return card.credit_card_terms
    return None


def _country_default_terms(
    country: Country,
    loan_type: LoanType,
    rate_type: str = "floating",
) -> LoanTerms:
    """Conservative country/loan-type defaults applied when a bank's
    Schedule of Charges hasn't been curated yet. Sourced from regulatory
    mandates (RBI master direction for IN floating retail; CARD Act +
    Reg Z for US cards; QM rule for US mortgages) where available,
    typical industry norms otherwise.

    Regulatory defaults set is_indicative=False (mandate-grade, the user
    can trust them). Typical-industry-norm defaults stay is_indicative=True
    so the UI surfaces the "confirm with sanction letter" caveat.

    These intentionally err toward "less restrictive" (0 penalty, 0
    lock-in, unlimited part-payments) when the regulator is silent —
    a missing field shouldn't make the engine gate against the user.
    Users on bank-specific terms that *are* restrictive enter them
    explicitly via onboarding.
    """
    reg = lambda pp, li, pf, src: LoanTerms(  # noqa: E731
        prepayment_penalty_pct=pp,
        prepay_lock_in_months=li,
        part_payment_freq_months=pf,
        is_indicative=False,
        last_verified=src,
    )
    unknown = lambda: LoanTerms(  # noqa: E731
        prepayment_penalty_pct=None,
        prepay_lock_in_months=None,
        part_payment_freq_months=None,
        is_indicative=True,
        last_verified="not known: check the loan agreement or Key Facts Statement",
    )
    if country == Country.IN:
        if loan_type == LoanType.CREDIT_CARD:
            # A card balance can be paid off any day; there is no loan term
            # to prepay, so no charge exists to suggest.
            return reg(D("0"), 0, None, "cards have no prepayment charge: pay any time")
        if rate_type == "floating":
            # engine/prepayment_fee.py: RBI (Pre-payment Charges on Loans)
            # Directions, 2025, para 5(i), July 2, 2025.
            return reg(D("0"), 0, None, "RBI Pre-payment Charges Directions, 2 Jul 2025, para 5(i)")
        # A fixed-rate loan's fee is whatever its own agreement / Key Facts
        # Statement says; no rule fixes it, so none is suggested (roadmap
        # PR G removed the unsourced 2-5% "industry norm" figures here).
        if loan_type in (LoanType.HOME, LoanType.PERSONAL, LoanType.AUTO):
            return unknown()
        if loan_type == LoanType.EDUCATION:
            return reg(D("0"), 0, None, "RBI master direction")
        # A21: was a guessed "industry norm" of 0; nothing sources it.
        return unknown()
    # US
    if loan_type == LoanType.CREDIT_CARD:
        return reg(D("0"), 0, None, "CARD Act 2009 + Reg Z")
    if loan_type == LoanType.HOME:
        return reg(D("0"), 0, None, "QM rule (Ability-to-Repay 2014)")
    # A21: US auto and personal-loan prepayment terms are set by the loan
    # contract and state law; no federal rule fixes them, so "industry
    # standard" was an unsourced claim. Private education loans: TILA bars
    # prepayment penalties (15 U.S.C. 1650(e), from the Higher Education
    # Opportunity Act 2008); federal student loans never had one.
    if loan_type in (LoanType.AUTO, LoanType.PERSONAL):
        return unknown()
    if loan_type == LoanType.EDUCATION:
        return reg(D("0"), 0, None, "15 U.S.C. 1650(e): no prepayment penalty on education loans")
    return unknown()


def lookup_loan_terms(
    bank: str,
    country: Country,
    loan_type: LoanType,
    rate_type: str = "floating",
) -> LoanTerms:
    """Returns per-bank, per-loan-type True-APR suggestion (merged with
    country default for fields the bank didn't override). Used by the
    /api/loan-terms endpoint to feed the click-to-fill suggestion UX
    in onboarding.

    Lookup order:
      1. Bank-specific entry from the rate-card registry — if the bank
         has set the LoanTerms for this loan_type, those fields take
         priority.
      2. Country/loan-type default from _country_default_terms.
    """
    default = _country_default_terms(country, loan_type, rate_type)
    bank_terms: Optional[LoanTerms] = None
    for card in _country_cards(country):
        if card.name.lower() == bank.lower():
            bank_terms = _terms_field_for(card, loan_type)
            break
    if bank_terms is None:
        return default
    if country == Country.IN and rate_type == "floating" and loan_type != LoanType.CREDIT_CARD:
        # RBI bars a prepayment fee on a floating-rate loan to an individual
        # (engine/prepayment_fee.py); a bank's curated fee can't override it.
        bank_terms = replace(bank_terms, prepayment_penalty_pct=default.prepayment_penalty_pct)
    # The bank entry overrides any field it sets; defaults fill the rest.
    # Resulting `is_indicative` = True if EITHER source is indicative
    # (regulatory mandate beats bank-quoted, but a bank override of a
    # regulatory default is still bank-indicative so flag it).
    return LoanTerms(
        prepayment_penalty_pct=(
            bank_terms.prepayment_penalty_pct
            if bank_terms.prepayment_penalty_pct is not None
            else default.prepayment_penalty_pct
        ),
        prepay_lock_in_months=(
            bank_terms.prepay_lock_in_months
            if bank_terms.prepay_lock_in_months is not None
            else default.prepay_lock_in_months
        ),
        part_payment_freq_months=(
            bank_terms.part_payment_freq_months
            if bank_terms.part_payment_freq_months is not None
            else default.part_payment_freq_months
        ),
        is_indicative=bank_terms.is_indicative or default.is_indicative,
        last_verified=bank_terms.last_verified,
    )


def _country_cards(country: Country) -> list[InstitutionRateCard]:
    """All rate-card entries for the given country, every tier. Used by
    the restructuring scanner to look up the freshest `last_verified`
    timestamp so the UI can surface a 'rates as of {date}' tag."""
    if country == Country.IN:
        return INDIA_TIER_A + INDIA_TIER_B + INDIA_TIER_C + INDIA_FINTECH
    return USA_TIER_A + USA_TIER_B + USA_TIER_C


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


def market_lowest(country: Country, loan_type: LoanType) -> tuple[str, Decimal] | None:
    """Lowest indicative `low` across Tier-A institutions, with the source
    bank name. Used by the goals achievability checker to surface a
    realistic "if you needed a new loan, here's the cheapest typical
    rate" line for the T3 (last-resort) tier.

    Indicative only — the static rate-card refreshes monthly via data ops.
    A future partner-API integration (Paisabazaar / NerdWallet) will
    replace this with live rates; this fallback ships until then.

    Returns (bank_name, low_rate) or None when no entries are populated
    for the (country, loan_type) pair.
    """
    pool = INDIA_TIER_A if country == Country.IN else USA_TIER_A
    best: tuple[str, Decimal] | None = None
    for card in pool:
        r = lookup_rate(card.name, loan_type)
        if r is None:
            continue
        if best is None or r.low < best[1]:
            best = (card.name, r.low)
    return best
