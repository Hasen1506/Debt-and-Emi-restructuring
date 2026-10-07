"""Bank-specific credit-card minimum payment formulas — brainstorm §24 / spec §4.22.

Each bank's formula is a dict with a "type" tag. Engine dispatches on the tag.
"""
from decimal import Decimal
from engine.models import Loan, LoanType, Country

D = Decimal


# ─────────────────────────────────────────────────────────────────────────────
# Bank-specific minimum-payment formula registry (brainstorm §24.1, §24.2)
# ─────────────────────────────────────────────────────────────────────────────

INDIA_MIN_PAYMENT_FORMULAS = {
    # Simple 5% / ₹200 banks
    "SBI Card":      {"type": "greater_of_pct_floor_plus_interest_fees",
                      "pct": D("0.05"), "floor": D("200")},
    "Axis Bank":     {"type": "greater_of_pct_floor",
                      "pct": D("0.05"), "floor": D("200")},
    "Yes Bank":      {"type": "greater_of_pct_floor",
                      "pct": D("0.05"), "floor": D("200")},
    "IndusInd Bank": {"type": "greater_of_pct_floor",
                      "pct": D("0.05"), "floor": D("200")},
    "RBL Bank":      {"type": "greater_of_pct_floor",
                      "pct": D("0.05"), "floor": D("100")},
    "AmEx India":    {"type": "greater_of_pct_floor",
                      "pct": D("0.02"), "floor": D("100")},
    # HDFC: 5% + current-month EMI + over-limit + past-due
    "HDFC Bank":     {"type": "hdfc_compound",
                      "pct": D("0.05"), "floor": D("200")},
    # Kotak: 5% + interest + fees
    "Kotak Mahindra": {"type": "pct_plus_interest_fees",
                       "pct": D("0.05"), "floor": D("200")},
    # ICICI: max(interest + fees + 1% principal, 5% outstanding, ₹100)
    "ICICI Bank":    {"type": "icici_three_way",
                      "principal_pct": D("0.01"), "outstanding_pct": D("0.05"),
                      "floor": D("100")},
}

USA_MIN_PAYMENT_FORMULAS = {
    # Large US issuers charge 1% of the balance plus the month's interest
    # and fees, so a card on minimums always pays some principal; a flat
    # "2% of the balance" left a card at 24% APR or more never clearing.
    "Chase":            {"type": "interest_plus_pct_plus_fees_floor", "pct": D("0.01"), "floor": D("40")},
    "Bank of America":  {"type": "interest_plus_pct_plus_fees_floor", "pct": D("0.01"), "floor": D("35")},
    "Citibank":         {"type": "interest_plus_pct_plus_fees_floor", "pct": D("0.01"), "floor": D("41")},
    "Capital One":      {"type": "interest_plus_pct_plus_fees_floor", "pct": D("0.01"), "floor": D("25")},
    # Discover: the greatest of 2% of the balance, $20 + interest + fees, or $35.
    "Discover":         {"type": "greatest_of", "balance_pct": D("0.02"),
                         "fixed_plus_interest": D("20"), "floor": D("35")},
    "American Express": {"type": "interest_plus_pct_plus_fees_floor", "pct": D("0.01"), "floor": D("40")},
    # Apple Card: 1% of the balance plus interest, or $25.
    "Goldman Sachs":    {"type": "interest_plus_pct_plus_fees_floor", "pct": D("0.01"), "floor": D("25")},
    # Synchrony: the greatest of 3.5% of the balance, 1% + interest + fees, or $25.
    "Synchrony":        {"type": "greatest_of", "balance_pct": D("0.035"),
                         "principal_pct": D("0.01"), "floor": D("25")},
}

DEFAULT_FORMULA = {
    Country.IN: {"type": "greater_of_pct_floor", "pct": D("0.05"), "floor": D("200")},
    Country.US: {"type": "interest_plus_pct_plus_fees_floor", "pct": D("0.01"), "floor": D("35")},
}


def _evaluate(formula: dict, outstanding: Decimal, interest: Decimal, fees: Decimal,
              current_emi: Decimal, over_limit: Decimal, past_due: Decimal) -> Decimal:
    """Dispatch on formula type and return the minimum payment."""
    t = formula["type"]
    if t == "greater_of_pct_floor":
        return max(outstanding * formula["pct"], formula["floor"])
    if t == "greater_of_pct_floor_plus_interest_fees":
        base = max(outstanding * formula["pct"], formula["floor"])
        return base + interest + fees
    if t == "hdfc_compound":
        base = max(outstanding * formula["pct"], formula["floor"])
        return base + current_emi + over_limit + past_due
    if t == "pct_plus_interest_fees":
        base = max(outstanding * formula["pct"], formula["floor"])
        return base + interest + fees
    if t == "icici_three_way":
        a = interest + fees + outstanding * formula["principal_pct"]
        b = outstanding * formula["outstanding_pct"]
        return max(a, b, formula["floor"])
    if t == "interest_plus_pct_plus_fees_floor":
        return max(interest + outstanding * formula["pct"] + fees, formula["floor"])
    if t == "greatest_of":
        arms = [formula["floor"]]
        if "balance_pct" in formula:
            arms.append(outstanding * formula["balance_pct"])
        if "principal_pct" in formula:
            arms.append(outstanding * formula["principal_pct"] + interest + fees)
        if "fixed_plus_interest" in formula:
            arms.append(formula["fixed_plus_interest"] + interest + fees)
        return max(arms)
    raise ValueError(f"Unknown formula type: {t}")


def compute_minimum_payment(
    loan: Loan,
    country: Country,
    interest_accrued: Decimal = D("0"),
    fees: Decimal = D("0"),
    current_emi: Decimal = D("0"),
    over_limit: Decimal = D("0"),
    past_due: Decimal = D("0"),
    simple_mode: bool = False,
) -> Decimal:
    """Spec §4.22. For non-credit-card loans returns the scheduled EMI (no ambiguity).

    Simple Mode uses the country default (5%/₹200 India; 1% + interest + fees
    or $35 US). Detailed Mode uses the bank-specific formula from the registry.
    The floor holds unless the card owes less: then the minimum is the lot.
    """
    if loan.loan_type != LoanType.CREDIT_CARD:
        if loan.pre_emi_months_remaining > 0:
            # Pre-EMI: the bank collects interest only (P2-14). Counting the
            # full EMI as committed made the difference vanish each month.
            return interest_accrued if interest_accrued > 0 else loan.outstanding * loan.nominal_rate / D("12")
        return loan.scheduled_emi

    # The card's own market sets its rules (M3): a USD card held by an
    # Indian resident follows US issuer formulas, not a ₹200 floor in $.
    ccy = (loan.currency or "").upper()
    if ccy == "INR":
        country = Country.IN
    elif ccy == "USD":
        country = Country.US

    # User override wins over the bank-specific formula. Honoured even in
    # Simple Mode — the override is an explicit user choice, not a heuristic.
    if loan.min_payment_override is not None and loan.min_payment_override > D("0"):
        return loan.min_payment_override

    if simple_mode:
        formula = DEFAULT_FORMULA[country]
    else:
        registry = INDIA_MIN_PAYMENT_FORMULAS if country == Country.IN else USA_MIN_PAYMENT_FORMULAS
        formula = registry.get(loan.bank, DEFAULT_FORMULA[country])

    minimum = _evaluate(formula, loan.outstanding, interest_accrued, fees,
                        current_emi, over_limit, past_due)
    # A $35 floor on a $20 balance is a $20 bill (plus its interest and fees).
    owed = loan.outstanding + interest_accrued + fees + current_emi + over_limit + past_due
    return min(minimum, max(owed, D("0")))
