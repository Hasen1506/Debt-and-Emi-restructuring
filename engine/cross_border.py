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

    if spread > D("0.01"):
        verdict = "prepay"
        rationale = (
            f"Loan costs {loan_cost * 100:.2f}% in your currency after FX drift, "
            f"vs {post_tax_yield * 100:.2f}% post-tax yield on savings. "
            f"Prepay — every unit clears debt at the higher rate."
        )
    elif spread < D("-0.01"):
        verdict = "invest"
        rationale = (
            f"Post-tax yield {post_tax_yield * 100:.2f}% beats the FX-adjusted loan cost "
            f"{loan_cost * 100:.2f}%. Keep amortising; deploy savings into the yield."
        )
    else:
        verdict = "marginal"
        rationale = (
            f"Within 1pp ({spread * 100:.2f}pp). Optionality and liquidity should drive — "
            f"keep some buffer, prepay only what you wouldn't miss."
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


def historical_drift_default(loan_currency: str, user_currency: str) -> Decimal:
    """Historical annualised drift of (loan_currency / user_currency).
    Positive = loan-currency *strengthens* (loan gets more expensive in user terms).
    Negative = loan-currency *weakens* (good for the NRI prepaying from USD).

    Sources: RBI monthly FX reference rates 2004-2024; Fed FRED DEXINUS series.
    """
    pair = (loan_currency.upper(), user_currency.upper())
    # INR has steadily depreciated vs USD ~3%/yr over 20y → INR loan held by USD earner
    # gets *cheaper* over time → drift is *negative* in our sign convention.
    if pair == ("INR", "USD"): return D("-0.030")
    if pair == ("USD", "INR"): return D("0.030")
    return D("0")
