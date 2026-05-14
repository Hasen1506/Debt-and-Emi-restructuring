"""Layer 1 restructuring scans — §4.7. Three scans: balance transfer, consolidation,
refinance. All thresholds stored as decimals (e.g. 24% = 0.24)."""
from decimal import Decimal
from dataclasses import dataclass
from engine.models import Loan, LoanType

D = Decimal


# Thresholds from spec §4.7 (decimal-consistent)
BT_RATE_THRESHOLD = D("0.24")       # card must be > 24% to bother
BT_NET_SAVING_HURDLE = D("0.05")    # BT offer must be ≥ 5pp cheaper than card rate
CONSOLIDATION_RATE_THRESHOLD = D("0.15")     # only unsecured at >15% qualify
CONSOLIDATION_DEBT_COUNT_MIN = 2
CONSOLIDATION_SAVINGS_HURDLE = D("0.03")     # blended − consolidated ≥ 3pp
REFI_RATE_GAP = D("0.015")          # 1.5pp above market median
REFI_BENEFIT_RATIO = D("1.0")       # (interest_saved − refi_costs) / refi_costs > 1.0


@dataclass
class BTCandidate:
    loan: Loan
    bt_offer_rate: Decimal
    bt_fee_pct: Decimal
    promo_months: int
    effective_bt_apr: Decimal       # post-fee amortised over promo period


@dataclass
class ConsolidationCandidate:
    loans: list[Loan]
    blended_avg_rate: Decimal
    consolidated_rate: Decimal       # market personal loan rate × (1 + fee_amortised)


@dataclass
class RefinanceCandidate:
    loan: Loan
    current_rate: Decimal
    market_median_rate: Decimal
    interest_saved: Decimal
    refi_costs: Decimal


def scan_balance_transfer(
    card: Loan,
    card_effective_rate: Decimal,
    bt_offer_rate: Decimal,
    bt_fee_pct: Decimal,
    promo_months: int,
) -> BTCandidate | None:
    """§4.7 — candidate if card effective > 24% AND BT-effective < card-effective − 5pp.

    BT-effective amortises the fee over the promo period: fee paid upfront →
    amortised cost-per-month = fee_pct / promo_months × 12 (annualised).
    """
    if card.loan_type != LoanType.CREDIT_CARD:
        return None
    if card_effective_rate <= BT_RATE_THRESHOLD:
        return None
    amortised_fee_rate = bt_fee_pct / D(promo_months) * D("12") if promo_months else D("0")
    effective_bt_apr = bt_offer_rate + amortised_fee_rate
    if effective_bt_apr >= card_effective_rate - BT_NET_SAVING_HURDLE:
        return None
    return BTCandidate(card, bt_offer_rate, bt_fee_pct, promo_months, effective_bt_apr)


def scan_consolidation(
    unsecured_loans: list[Loan],
    effective_rates: dict[int, Decimal],
    market_personal_loan_rate: Decimal,
    fee_amortised: Decimal,
) -> ConsolidationCandidate | None:
    """§4.7 — candidate if ≥2 unsecured loans at effective_rate > 15% AND
    consolidated rate × (1 + fee) < blended_avg − 3pp."""
    high_rate = [l for l in unsecured_loans
                 if effective_rates[id(l)] > CONSOLIDATION_RATE_THRESHOLD]
    if len(high_rate) < CONSOLIDATION_DEBT_COUNT_MIN:
        return None

    total_balance = sum((l.outstanding for l in high_rate), D("0"))
    if total_balance == 0:
        return None
    blended = sum((effective_rates[id(l)] * l.outstanding for l in high_rate), D("0")) / total_balance
    consolidated = market_personal_loan_rate * (D("1") + fee_amortised)
    if consolidated >= blended - CONSOLIDATION_SAVINGS_HURDLE:
        return None
    return ConsolidationCandidate(high_rate, blended, consolidated)


def scan_refinance(
    loan: Loan,
    market_median_rate: Decimal,
    interest_saved: Decimal,
    refi_costs: Decimal,
) -> RefinanceCandidate | None:
    """§4.7 — refinance candidate if current rate > market median + 1.5pp AND
    (interest_saved − refi_costs) / refi_costs > 1.0."""
    if loan.loan_type not in (LoanType.HOME, LoanType.AUTO):
        return None
    if loan.nominal_rate <= market_median_rate + REFI_RATE_GAP:
        return None
    if refi_costs <= 0:
        return None
    benefit_ratio = (interest_saved - refi_costs) / refi_costs
    if benefit_ratio <= REFI_BENEFIT_RATIO:
        return None
    return RefinanceCandidate(loan, loan.nominal_rate, market_median_rate,
                              interest_saved, refi_costs)
