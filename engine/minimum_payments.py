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
    # C14 (audit 80): sourced from the issuer's current MITC (FORMULA_SOURCE).
    # SBI Card: 100% of GST, EMI, fees, finance charges + over-limit + 2% of
    # the remaining balance; ₹200 a month at least (MITC illustration).
    "SBI Card":      {"type": "interest_fees_plus_pct",
                      "pct": D("0.02"), "floor": D("200")},
    # Axis: all instalments, fees, interest, taxes + over-limit + 2% of the
    # remaining balance, at least ₹100.
    "Axis Bank":     {"type": "interest_fees_plus_pct",
                      "pct": D("0.02"), "floor": D("100")},
    "Yes Bank":      {"type": "greater_of_pct_floor",
                      "pct": D("0.05"), "floor": D("200")},
    "IndusInd Bank": {"type": "greater_of_pct_floor",
                      "pct": D("0.05"), "floor": D("200")},
    "RBL Bank":      {"type": "greater_of_pct_floor",
                      "pct": D("0.05"), "floor": D("100")},
    "AmEx India":    {"type": "greater_of_pct_floor",
                      "pct": D("0.02"), "floor": D("100")},
    # HDFC (from the June 2025 statement): GST + EMI + fees + over-limit +
    # the larger of 5% of (finance charge + balance) and finance charge +
    # 5% of the balance; ₹200 at least.
    "HDFC Bank":     {"type": "pct_of_balance_and_interest",
                      "pct": D("0.05"), "floor": D("200")},
    # Kotak: 5% + interest + fees
    "Kotak Mahindra": {"type": "pct_plus_interest_fees",
                       "pct": D("0.05"), "floor": D("200")},
    # ICICI (from 1 Mar 2026): the same rule as HDFC's. The ₹100 floor is the
    # old registry's and is NOT in the MITC text read (source note below).
    # Founder (round 2, 15 Oct 2026): keep the floor, tagged verify=True until
    # it is confirmed from a statement (docs/VERIFY-RECORDS.md).
    "ICICI Bank":    {"type": "pct_of_balance_and_interest",
                      "pct": D("0.05"), "floor": D("100"), "verify": True,
                      "verify_note": "₹100 floor kept from the old registry; not in the ICICI MITC "
                                     "(w.e.f. 1 Mar 2026) read 14 Oct 2026. Confirm from a statement."},
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

# Provenance of the formulas above (grill #26). None = no source on file:
# the formula is an estimate and the UI says "use the minimum on your statement".
FORMULA_SOURCE: dict[str, dict] = {
    bank: {"source_url": None, "as_of": None, "verified": False}
    for bank in (*INDIA_MIN_PAYMENT_FORMULAS, *USA_MIN_PAYMENT_FORMULAS)
}
# C14: the big issuers' MITCs, read 14 Oct 2026. Everything else stays an
# estimate (the UI says "use the minimum on your statement").
FORMULA_SOURCE.update({
    "SBI Card": {"source_url": "https://www.sbicard.com/en/most-important-terms-and-conditions.page",
                 "as_of": "2026-10-14", "verified": True},
    "Axis Bank": {"source_url": "https://www.axis.bank.in/docs/default-source/default-document-library/mitc-credit-cards.pdf",
                  "as_of": "2026-10-14", "verified": True},
    "HDFC Bank": {"source_url": "https://v.hdfc.bank.in/htdocs/common/mad-communication.html",
                  "as_of": "2026-10-14", "verified": True},
    "ICICI Bank": {"source_url": "https://www.icici.bank.in/content/dam/icicibank/india/managed-assets/revamp-page-images/docs/pdf/mitc-cc-gk-t.pdf",
                   "as_of": "2026-10-14", "verified": True,
                   "note": "formula from the MITC (w.e.f. 1 Mar 2026); the ₹100 floor is not in the text read",
                   "verify": True},
})
STATEMENT_MIN_ADVICE = (
    "Estimated. Use the minimum amount due on your card statement: type it in once and the plan uses it."
)
# C22: the 2022 Master Direction (id=12300) was consolidated on 28 Nov 2025
# into the Reserve Bank of India (Commercial Banks – Credit Cards and Debit
# Cards: Issuance and Conduct) Directions, 2025 (id=13155, updated 1 Oct
# 2026) and the NBFC equivalent (id=12956), which keeps the same rule: the
# minimum due must not cause negative amortisation and unpaid taxes / charges
# are not capitalised (text checked on id=12956, 14 Oct 2026).
RBI_MIN_DUE_RULE = (
    "RBI (Commercial Banks – Credit Cards and Debit Cards: Issuance and Conduct) Directions, 2025 "
    "(was Master Direction 2022, para 9(b)(ii))"
)
RBI_MIN_DUE_URL = "https://www.rbi.org.in/Scripts/BS_ViewMasDirections.aspx?id=13155"
RBI_MIN_DUE_URL_NBFC = "https://www.rbi.org.in/Scripts/BS_ViewMasDirections.aspx?id=12956"


def minimum_basis(loan: Loan) -> str:
    """"statement" when the user typed the statement's minimum, else
    "estimated" (a formula with no verified source)."""
    if loan.min_payment_override is not None and loan.min_payment_override > D("0"):
        return "statement"
    return "estimated"


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
    if t == "interest_fees_plus_pct":
        # Interest (GST included for an Indian card), fees, over-limit and the
        # instalments in full, plus pct of the balance (C14).
        return max(interest + fees + current_emi + over_limit + past_due + outstanding * formula["pct"],
                   formula["floor"])
    if t == "pct_of_balance_and_interest":
        # HDFC / ICICI: GST, EMIs, fees in full, then the larger of pct of
        # (finance charge + balance) and finance charge + pct of balance.
        # `interest` carries 18% GST for an Indian card; split it back out.
        fc = interest / D("1.18")
        gst = interest - fc
        core = max(formula["pct"] * (fc + outstanding), fc + formula["pct"] * outstanding)
        return max(gst + fees + current_emi + over_limit + past_due + core, formula["floor"])
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
    if country == Country.IN:
        # RBI MD 2022 para 9(b)(ii) + Annex: no negative amortisation, so the
        # minimum covers the month's interest (GST included in
        # `interest_accrued` for an Indian card) and charges. A "2% of the
        # balance" estimate on a 42% card (4.13% a month with GST) fell short.
        minimum = max(minimum, interest_accrued + fees + over_limit + past_due)
    # A $35 floor on a $20 balance is a $20 bill (plus its interest and fees).
    owed = loan.outstanding + interest_accrued + fees + current_emi + over_limit + past_due
    return min(minimum, max(owed, D("0")))
