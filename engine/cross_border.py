"""Cross-border / FX exposure module (Phase 1 extension).

Models the NRI archetype: user earns in one currency, services loans in another.
Two questions answered:
  1. What does the loan actually cost in user-currency terms, after expected FX drift?
  2. Should the user prepay from foreign-currency savings, or invest there instead?

All math in Decimal. FX rates are *home-currency per foreign-currency*
(e.g. user_currency=USD, loan_currency=INR → fx_rate ≈ 0.012 USD per INR).
"""
from dataclasses import dataclass
from decimal import Decimal

D = Decimal


@dataclass
class CrossBorderInputs:
    loan_balance: Decimal                # in loan_currency
    loan_nominal_rate: Decimal           # e.g. 0.0850 for 8.5%
    loan_tenure_months: int
    fx_rate: Decimal                     # user-currency per 1 unit of loan-currency
    user_savings_yield: Decimal          # post-tax expected return in user-currency
    user_marginal_tax: Decimal           # on savings yield (0 if already post-tax)
    expected_fx_drift_annual: Decimal    # +ve = loan-currency strengthens vs user-currency
    inflation_user_country: Decimal


@dataclass
class CrossBorderVerdict:
    effective_loan_cost_in_user_currency: Decimal   # annualised, after FX drift
    user_post_tax_yield: Decimal
    spread: Decimal                                  # loan_cost − post_tax_yield (positive = prepay)
    verdict: str                                     # "prepay" | "invest" | "marginal"
    rationale: str
    loan_emi_user_currency: Decimal                  # current FX, no drift
    loan_emi_user_currency_y5: Decimal               # after 5y of drift


def _emi(principal: Decimal, monthly_rate: Decimal, n_months: int) -> Decimal:
    """Standard EMI formula. Returns Decimal."""
    if monthly_rate == 0:
        return principal / D(n_months)
    r = monthly_rate
    pow_term = (D("1") + r) ** n_months
    return principal * r * pow_term / (pow_term - D("1"))


def evaluate_cross_border(inp: CrossBorderInputs) -> CrossBorderVerdict:
    """§FX-1 — prepay vs invest decision with FX drift in the loop.

    The intuition:
      - Loan rate in user terms ≈ (1 + r_loan)(1 + drift) − 1
        (drift > 0 means loan-currency appreciates → loan gets *more* expensive to service)
      - Post-tax yield in user terms = yield * (1 − marginal_tax)
      - If loan_cost > yield → prepay. Spread > 1pp triggers strong recommendation.
    """
    drift = inp.expected_fx_drift_annual
    loan_cost = (D("1") + inp.loan_nominal_rate) * (D("1") + drift) - D("1")
    post_tax_yield = inp.user_savings_yield * (D("1") - inp.user_marginal_tax)
    spread = loan_cost - post_tax_yield

    cost = (
        f"Counting how the exchange rate tends to move, the loan costs you "
        f"{loan_cost * 100:.2f}% a year in your currency"
    )
    earn = f"your savings earn {post_tax_yield * 100:.2f}% after tax"
    if spread > D("0.01"):
        verdict = "prepay"
        rationale = (
            f"{cost}; {earn}. Each amount prepaid saves more than it would earn."
        )
    elif spread < D("-0.01"):
        verdict = "invest"
        rationale = (
            f"{cost}; {earn}. Keep paying the EMI and leave the savings where "
            f"they earn more."
        )
    else:
        verdict = "marginal"
        rationale = (
            f"{cost}; {earn}: less than a point apart. Keep enough savings to "
            f"fall back on, and prepay only what you wouldn't miss."
        )

    monthly_rate = inp.loan_nominal_rate / D("12")
    emi_local = _emi(inp.loan_balance, monthly_rate, inp.loan_tenure_months)
    emi_user_now = emi_local * inp.fx_rate
    # FX rate 5 years out under expected drift
    fx_y5 = inp.fx_rate * (D("1") + drift) ** 5
    emi_user_y5 = emi_local * fx_y5

    return CrossBorderVerdict(
        effective_loan_cost_in_user_currency=loan_cost,
        user_post_tax_yield=post_tax_yield,
        spread=spread,
        verdict=verdict,
        rationale=rationale,
        loan_emi_user_currency=emi_user_now,
        loan_emi_user_currency_y5=emi_user_y5,
    )


# How fast the rupee has lost value against each currency, a year, over
# the 20 years to October 2026, compounded and rounded to the nearest half
# point. Rupees per unit, ECB reference rates (https://api.frankfurter.dev,
# 1 Sep 2006 → 9 Oct 2026, read 2026-10-12 for sprint G10):
#   USD 46.45 → 96.73 (3.7%/yr)   EUR 59.53 → 108.40 (3.0%)
#   GBP 88.48 → 127.89 (1.9%)     AUD 35.54 → 67.53 (3.2%)
#   CAD 42.03 → 68.00 (2.4%)      SGD 29.55 → 75.55 (4.8%)
# The dirham is pegged to the dollar (3.6725 since 1997), so it moves with it.
# Update rule: re-read both ends and re-round once a year (the 20-year
# window moves slowly; a single year's swing shouldn't move the default).
# USD and AED were 3.0% and SGD 4.5% before this check.
INR_SLIDE_A_YEAR: dict[str, Decimal] = {
    "USD": D("0.035"),
    "AED": D("0.035"),
    "EUR": D("0.030"),
    "GBP": D("0.020"),
    "AUD": D("0.030"),
    "CAD": D("0.025"),
    "SGD": D("0.050"),
}


def historical_drift_default(loan_currency: str, user_currency: str) -> Decimal:
    """Historical annualised drift of (loan_currency / user_currency).
    Positive = loan-currency *strengthens* (loan gets more expensive in user terms).
    Negative = loan-currency *weakens* (good for the NRI prepaying from abroad).

    Only pairs with the rupee have a default; any other pair is taken as flat.
    """
    loan, user = loan_currency.upper(), user_currency.upper()
    if loan == "INR" and user in INR_SLIDE_A_YEAR:
        return -INR_SLIDE_A_YEAR[user]
    if user == "INR" and loan in INR_SLIDE_A_YEAR:
        return INR_SLIDE_A_YEAR[loan]
    return D("0")
