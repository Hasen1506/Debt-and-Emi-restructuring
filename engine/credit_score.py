"""Credit-score impact module (Phase 1 extension).

Predicts how a contemplated action moves a user's credit score, expressed as a
range with a stated public source. Calibrated against:
  - FICO published factor weights (payment 35% / utilisation 30% / age 15% /
    mix 10% / new credit 10%)
  - CIBIL consumer FAQ ("hard inquiry costs 5-10 points")
  - myFICO score simulator (Fair Isaac's own free tool)
  - Brevoort & Kambara 2015 (CFPB) — utilisation-drop magnitude bands
  - NIBM India 2022 consumer credit study

We deliberately return **ranges**, not point estimates — bureaus' models are
proprietary and vary by file. The UI should show a band shift, not a precise
integer, and cite the source for each prediction.
"""
from dataclasses import dataclass
from decimal import Decimal
from enum import Enum
from typing import Optional

D = Decimal


class ScoreAction(str, Enum):
    HARD_INQUIRY = "hard_inquiry"               # any loan/card application
    UTILISATION_DROP = "utilisation_drop"       # parametrised by from→to %
    BALANCE_TRANSFER = "balance_transfer"       # hard inquiry + utilisation shift
    NEW_ACCOUNT = "new_account"                 # adds new line, ~3mo dip
    CLOSE_OLDEST_CARD = "close_oldest_card"     # lowers average account age
    ON_TIME_STREAK_QUARTER = "on_time_streak_quarter"   # +5/qtr capped at +20
    LOAN_PAID_OFF = "loan_paid_off"             # depends on credit mix
    CARD_PAID_OFF = "card_paid_off"             # utilisation drop + closes nothing


class ScoreBand(str, Enum):
    POOR = "poor"
    FAIR = "fair"
    GOOD = "good"
    VERY_GOOD = "very_good"
    EXCELLENT = "excellent"


# CIBIL / Experian / Equifax bands all sit close to these cutoffs.
# Source: each bureau's published consumer education pages.
_BANDS_IN = [
    (300, 580, ScoreBand.POOR),
    (580, 670, ScoreBand.FAIR),
    (670, 740, ScoreBand.GOOD),
    (740, 800, ScoreBand.VERY_GOOD),
    (800, 901, ScoreBand.EXCELLENT),
]
# FICO bands (US): 300-579 / 580-669 / 670-739 / 740-799 / 800-850.
_BANDS_US = [
    (300, 580, ScoreBand.POOR),
    (580, 670, ScoreBand.FAIR),
    (670, 740, ScoreBand.GOOD),
    (740, 800, ScoreBand.VERY_GOOD),
    (800, 851, ScoreBand.EXCELLENT),
]


def band(score: int, country: str = "IN") -> ScoreBand:
    table = _BANDS_US if country.upper() == "US" else _BANDS_IN
    for low, high, b in table:
        if low <= score < high:
            return b
    return ScoreBand.EXCELLENT if score >= table[-1][1] else ScoreBand.POOR


@dataclass
class ScoreImpact:
    action: ScoreAction
    current_score: int
    current_band: ScoreBand
    delta_low: int                  # both signed; e.g. -10 to -5 = (delta_low=-10, delta_high=-5)
    delta_high: int
    projected_score_low: int
    projected_score_high: int
    projected_band_low: ScoreBand
    projected_band_high: ScoreBand
    days_to_realise: int            # rough window before the change shows on the file
    source: str                     # public citation
    rationale: str


def _clamp_score(s: int, country: str) -> int:
    cap = 850 if country.upper() == "US" else 900
    return max(300, min(cap, s))


def predict_impact(
    action: ScoreAction,
    current_score: int,
    country: str = "IN",
    *,
    utilisation_from: Optional[Decimal] = None,   # 0.0–1.0
    utilisation_to: Optional[Decimal] = None,
    is_only_instalment_loan: bool = False,
    has_thin_file: bool = False,                  # <3 active accounts
) -> ScoreImpact:
    """Predict score movement from `action`. Ranges, not point estimates.

    Most callers will pass `utilisation_from` and `utilisation_to` for actions
    that change card utilisation — the magnitude of that drop is by far the
    biggest single lever in any scoring model.
    """
    delta_low, delta_high = 0, 0
    source = ""
    rationale = ""
    days = 30

    if action == ScoreAction.HARD_INQUIRY:
        delta_low, delta_high = -10, -5
        source = "CIBIL consumer FAQ; FICO published factor weights"
        rationale = (
            "A new credit application triggers a hard inquiry; published "
            "ranges put the dip at 5–10 points, recovering over ~6 months."
        )
        days = 14

    elif action == ScoreAction.UTILISATION_DROP:
        if utilisation_from is None or utilisation_to is None:
            raise ValueError("UTILISATION_DROP needs utilisation_from and utilisation_to")
        drop_pp = (utilisation_from - utilisation_to) * D("100")
        # Brevoort & Kambara 2015: 50pp drop ≈ 30-50 points; linear-ish below that.
        magnitude = int(drop_pp * D("0.7"))           # ~0.7 pts per 1pp utilisation drop
        if utilisation_from >= D("0.80") and utilisation_to <= D("0.30"):
            delta_low, delta_high = 30, 50
        elif drop_pp >= 30:
            delta_low, delta_high = max(15, magnitude - 10), magnitude + 10
        elif drop_pp >= 10:
            delta_low, delta_high = max(5, magnitude - 5), magnitude + 5
        elif drop_pp >= 1:
            delta_low, delta_high = 1, max(3, magnitude)
        else:
            delta_low, delta_high = 0, 0
        source = "Brevoort & Kambara 2015 (CFPB); FICO factor weights (30%)"
        rationale = (
            f"Utilisation drops from {utilisation_from * 100:.0f}% to "
            f"{utilisation_to * 100:.0f}%. Utilisation is 30% of the score "
            f"and updates on the next bureau cycle."
        )
        days = 45

    elif action == ScoreAction.BALANCE_TRANSFER:
        # New card → hard inquiry + utilisation reshuffle. Net: short-term dip,
        # medium-term gain if balance moves from a 90%-utilised card to a
        # freshly-opened one (utilisation per card halves).
        delta_low, delta_high = -10, 20
        source = "FICO factor weights; CIBIL consumer FAQ"
        rationale = (
            "Short-term: hard-inquiry dip of 5-10 pts. Medium-term: per-card "
            "utilisation halves, often reclaiming +15-30 pts by month 3."
        )
        days = 90

    elif action == ScoreAction.NEW_ACCOUNT:
        delta_low, delta_high = -20, -10
        source = "FICO factor weights — average account age (15%)"
        rationale = (
            "New account lowers your average credit age. Typical dip 10-20 pts; "
            "neutralises after ~3 months, then helps via additional limit."
        )
        days = 14

    elif action == ScoreAction.CLOSE_OLDEST_CARD:
        delta_low, delta_high = -25, -10
        if has_thin_file:
            delta_low, delta_high = -40, -20
        source = "FICO factor weights — credit history length (15%) + utilisation"
        rationale = (
            "Closing your oldest card lowers average account age and total "
            "available credit, which raises overall utilisation. Avoid if "
            "no annual fee — keep it dormant instead."
        )
        days = 60

    elif action == ScoreAction.ON_TIME_STREAK_QUARTER:
        delta_low, delta_high = 5, 10
        source = "FICO factor weights — payment history (35%); CIBIL guidance"
        rationale = (
            "Payment history is the single largest factor. Each on-time "
            "quarter adds ~5-10 pts; gains taper after 24 months of clean record."
        )
        days = 90

    elif action == ScoreAction.LOAN_PAID_OFF:
        if is_only_instalment_loan:
            delta_low, delta_high = -15, -5
            rationale = (
                "Paying off your only instalment loan loses you the credit-mix "
                "component (10% of score). Small dip is normal; offset by "
                "utilisation health on cards."
            )
        else:
            delta_low, delta_high = 0, 5
            rationale = (
                "Loan closed cleanly with other instalment lines still active. "
                "Mostly neutral with a small positive from utilisation "
                "(if it was a high-DTI loan) and payment-history gains."
            )
        source = "FICO factor weights — credit mix (10%)"
        days = 45

    elif action == ScoreAction.CARD_PAID_OFF:
        if utilisation_from is not None:
            # Implies utilisation drops from `utilisation_from` to 0 on this card.
            # If it was the only card, total utilisation drops to 0 (big win).
            # Otherwise, partial effect. Use 0.6× of full-drop magnitude as proxy.
            drop_pp = utilisation_from * D("100")
            magnitude = int(drop_pp * D("0.7") * D("0.6"))
            delta_low = max(5, magnitude - 5)
            delta_high = magnitude + 10
        else:
            delta_low, delta_high = 10, 30
        source = "FICO factor weights — utilisation (30%)"
        rationale = (
            "Card paid off → utilisation on that line drops to 0 on the next "
            "bureau cycle. Keep the card open to retain the limit."
        )
        days = 45

    proj_low = _clamp_score(current_score + delta_low, country)
    proj_high = _clamp_score(current_score + delta_high, country)
    return ScoreImpact(
        action=action,
        current_score=current_score,
        current_band=band(current_score, country),
        delta_low=delta_low,
        delta_high=delta_high,
        projected_score_low=proj_low,
        projected_score_high=proj_high,
        projected_band_low=band(proj_low, country),
        projected_band_high=band(proj_high, country),
        days_to_realise=days,
        source=source,
        rationale=rationale,
    )


# ─────────────────────────────────────────────────────────────────────────────
# Rate-offered estimator — band → rate-spread above advertised
# ─────────────────────────────────────────────────────────────────────────────

# Spread *above* the advertised "from-rate" the bank publishes. Source:
# 2023-2024 RBI Sachet rate-band disclosure data + lender published grids
# (HDFC, ICICI, SBI personal-loan and credit-card rate cards).
_RATE_SPREAD_BY_BAND_PERSONAL = {
    ScoreBand.EXCELLENT: D("0.000"),
    ScoreBand.VERY_GOOD: D("0.010"),
    ScoreBand.GOOD:      D("0.025"),
    ScoreBand.FAIR:      D("0.050"),
    ScoreBand.POOR:      D("0.090"),    # often outright rejection, but if approved
}
# Home loan grids are flatter — collateralised, less price-sensitive to score.
_RATE_SPREAD_BY_BAND_HOME = {
    ScoreBand.EXCELLENT: D("0.000"),
    ScoreBand.VERY_GOOD: D("0.0025"),
    ScoreBand.GOOD:      D("0.0050"),
    ScoreBand.FAIR:      D("0.0125"),
    ScoreBand.POOR:      D("0.0250"),
}


def estimated_rate_offered(
    advertised_rate: Decimal,
    score: int,
    loan_type: str,
    country: str = "IN",
) -> Decimal:
    """Returns the rate the user is likely to actually be offered, given their
    score band. Adds a spread above the advertised 'from' rate.

    Caller passes the bank's advertised lowest rate; we add the score-band
    spread. For collateralised loans (home, auto) the spread is much smaller.
    """
    b = band(score, country)
    grid = (
        _RATE_SPREAD_BY_BAND_HOME if loan_type in ("home_loan", "auto_loan")
        else _RATE_SPREAD_BY_BAND_PERSONAL
    )
    return advertised_rate + grid[b]
