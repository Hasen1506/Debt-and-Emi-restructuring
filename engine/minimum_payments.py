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
    "Chase":            {"type": "greater_of_pct_floor", "pct": D("0.02"), "floor": D("35")},
    "Bank of America":  {"type": "interest_plus_pct_plus_fees_floor", "pct": D("0.01"), "floor": D("35")},
    "Citibank":         {"type": "greater_of_pct_floor", "pct": D("0.02"), "floor": D("25")},
    "Capital One":      {"type": "greater_of_pct_floor", "pct": D("0.02"), "floor": D("25")},
    "Discover":         {"type": "greater_of_pct_floor", "pct": D("0.02"), "floor": D("35")},
    "American Express": {"type": "interest_plus_pct_plus_fees_floor", "pct": D("0.01"), "floor": D("35")},
    "Goldman Sachs":    {"type": "interest_plus_pct_plus_fees_floor", "pct": D("0.01"), "floor": D("35")},
    "Synchrony":        {"type": "greater_of_pct_floor", "pct": D("0.02"), "floor": D("25")},
}

DEFAULT_FORMULA = {
    Country.IN: {"type": "greater_of_pct_floor", "pct": D("0.05"), "floor": D("200")},
    Country.US: {"type": "greater_of_pct_floor", "pct": D("0.02"), "floor": D("35")},
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

    Simple Mode uses the country default (5%/₹200 India, 2%/$35 US). Detailed Mode
    uses the bank-specific formula from the registry. Hard floor — never violated.
    """
    if loan.loan_type != LoanType.CREDIT_CARD:
        return loan.scheduled_emi

    # User override wins over the bank-specific formula. Honoured even in
    # Simple Mode — the override is an explicit user choice, not a heuristic.
    if loan.min_payment_override is not None and loan.min_payment_override > D("0"):
        return loan.min_payment_override

    if simple_mode:
        formula = DEFAULT_FORMULA[country]
    else:
        registry = INDIA_MIN_PAYMENT_FORMULAS if country == Country.IN else USA_MIN_PAYMENT_FORMULAS
        formula = registry.get(loan.bank, DEFAULT_FORMULA[country])

    return _evaluate(formula, loan.outstanding, interest_accrued, fees,
                     current_emi, over_limit, past_due)
