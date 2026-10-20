"""Cross-border / FX exposure module (Phase 1 extension).

Models the NRI archetype: user earns in one currency, services loans in another.
Two questions answered:
  1. What does the loan actually cost in user-currency terms, after expected FX drift?
  2. Should the user prepay from foreign-currency savings, or invest there instead?

All math in Decimal. FX rates are *home-currency per foreign-currency*
(e.g. user_currency=USD, loan_currency=INR → fx_rate ≈ 0.012 USD per INR).
"""
from dataclasses import dataclass, field
from decimal import Decimal
from typing import Optional

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
    # E5 (audit 80): what moving the money costs, as a share of the amount
    # sent (fee + exchange-rate margin), paid once. 0 = the money is
    # already in the loan's currency (e.g. an NRE/NRO balance).
    remittance_cost_pct: Decimal = Decimal("0")


@dataclass
class CrossBorderVerdict:
    effective_loan_cost_in_user_currency: Decimal   # annualised, after FX drift
    user_post_tax_yield: Decimal
    spread: Decimal                                  # loan_cost − post_tax_yield (positive = prepay)
    verdict: str                                     # "prepay" | "invest" | "marginal"
    rationale: str
    loan_emi_user_currency: Decimal                  # current FX, no drift
    loan_emi_user_currency_y5: Decimal               # after 5y of drift
    # E5: the prepayment's yearly return in the user's currency once the
    # one-time remittance cost is spread over the years it keeps saving
    # interest (equals effective_loan_cost when the cost is 0).
    prepay_return_after_remittance: Decimal = Decimal("0")
    remittance_cost_pct: Decimal = Decimal("0")


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
    if inp.loan_tenure_months < 1:
        raise ValueError("loan_tenure_months must be at least 1")
    drift = inp.expected_fx_drift_annual
    loan_cost = (D("1") + inp.loan_nominal_rate) * (D("1") + drift) - D("1")
    post_tax_yield = inp.user_savings_yield * (D("1") - inp.user_marginal_tax)
    years = max(1, -(-inp.loan_tenure_months // 12))
    prepay_return = prepay_return_in_user_currency(
        inp.loan_nominal_rate, drift, inp.remittance_cost_pct, years,
    )
    # The decision compares what a prepaid unit really earns (after the
    # transfer cost) with what it earns left where it is.
    spread = prepay_return - post_tax_yield

    cost = (
        f"Counting how the exchange rate tends to move, the loan costs you "
        f"{loan_cost * 100:.2f}% a year in your currency"
    )
    if inp.remittance_cost_pct > 0:
        cost += (
            f"; after a {inp.remittance_cost_pct * 100:.2f}% cost to send the money, "
            f"prepaying returns {prepay_return * 100:.2f}% a year"
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
        prepay_return_after_remittance=prepay_return,
        remittance_cost_pct=inp.remittance_cost_pct,
    )


def prepay_return_in_user_currency(
    loan_rate: Decimal, drift: Decimal, remittance_cost: Decimal, years: int,
) -> Decimal:
    """Yearly return, in the earner's currency, of sending one unit home and
    prepaying a loan in the other currency (E5, audit 80).

    One unit sent arrives as (1 − c) after the transfer cost c. Prepaid, it
    saves the loan's rate r a year in the loan's currency; converted back,
    the loan currency moves by `drift` a year (negative = it weakens, which
    makes the saving worth less to the earner). Over `years`:

        ((1 − c)^(1/years) · (1 + r) · (1 + drift)) − 1

    The cost is paid once, so a short horizon feels it most. Rounded to
    0.01% (basis-point precision is all the inputs support)."""
    if years < 1:
        raise ValueError("years must be at least 1")
    if not (D("0") <= remittance_cost < D("1")):
        raise ValueError("remittance_cost must be in [0, 1)")
    kept = D(str(float(D("1") - remittance_cost) ** (1 / years)))
    out = kept * (D("1") + loan_rate) * (D("1") + drift) - D("1")
    return out.quantize(D("0.0001"))


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


# ─────────────────────────────────────────────────────────────────────────────
# E5 (audit 80): what sending money home costs, and the plan's one-line
# comparison for an NRI prepaying a rupee loan from foreign pay.
# ─────────────────────────────────────────────────────────────────────────────

# World Bank Remittance Prices Worldwide, corridor United States → India,
# Q3 2025 (collected 4–28 Aug 2025), read 2026-10-14:
#   https://remittanceprices.worldbank.org/corridor/United-States/India
#   $200 sent: total average cost 3.68% (fee $5.64 + 0.85% FX margin)
#   $500 sent: total average cost 2.45%; the cheapest online money-transfer
#   operators listed 0.42–0.87% (Wise 0.84% by bank transfer), banks 1.17–7%.
# Default: the $500 average, the closest published basket to a monthly
# prepayment. It is shown, never hidden, and the user can enter their own
# provider's cost. Re-read each quarter (data_freshness).
REMITTANCE_COST_DEFAULT: dict[str, Decimal] = {"USD": D("0.0245")}
REMITTANCE_COST_LOW_ONLINE: dict[str, Decimal] = {"USD": D("0.0042")}
REMITTANCE_SOURCE = "https://remittanceprices.worldbank.org/corridor/United-States/India"
REMITTANCE_AS_OF = "2025-Q3 (read 2026-10-14)"


def default_remittance_cost(user_currency: str) -> Optional[Decimal]:
    """The published average cost of sending money from `user_currency`
    to India, or None when no corridor is on file (the UI then asks)."""
    return REMITTANCE_COST_DEFAULT.get(user_currency.upper())


@dataclass
class NriPrepayComparison:
    """E5: the plan's line for a foreign earner prepaying a rupee loan."""
    loan_rate: Decimal                 # the loan's rate, in rupees
    drift: Decimal                     # yearly rupee move vs the earner's currency (−ve = weakens)
    remittance_cost: Decimal           # one-time share of the amount sent
    years: int                         # years the prepayment keeps saving interest
    prepay_return: Decimal             # in the earner's currency, a year
    alternative_name: str              # e.g. "a US high-yield savings account"
    alternative_rate: Decimal          # before tax
    alternative_after_tax: Decimal
    edge: Decimal                      # prepay_return − alternative_after_tax
    funds_in_india: bool               # money already in an NRE/NRO account
    line: str
    caveats: list[str] = field(default_factory=list)
    sources: dict[str, str] = field(default_factory=dict)


def nri_prepay_comparison(
    *,
    loan_rate: Decimal,
    remaining_months: int,
    user_currency: str = "USD",
    drift: Optional[Decimal] = None,
    remittance_cost: Optional[Decimal] = None,
    alternative_rate: Optional[Decimal] = None,
    alternative_name: Optional[str] = None,
    marginal_tax: Decimal = D("0"),
    funds_in_india: bool = False,
    nre_fd_rate: Optional[Decimal] = None,
) -> NriPrepayComparison:
    """One honest line for an NRI's plan: what a prepayment really earns in
    their own currency, beside the plain alternative of keeping the money.

    - From foreign pay (default): the rupee's drift (historical default,
      INR_SLIDE_A_YEAR) and the transfer cost (World Bank average) both
      come off the loan's rate; the alternative is a US savings account
      (market-data.json "hysa_us"), taxed at `marginal_tax`.
    - `funds_in_india=True`: the money is already in rupees in an NRE/NRO
      account, so there is no transfer and no currency move between the two
      choices; the alternative is an NRE deposit (`nre_fd_rate`), tax-free
      in India while non-resident (Income-tax Act 2025 Schedule IV item 1,
      formerly s.10(4)(ii)) but reportable to the IRS by a US tax resident.

    Neutral by design: it states both numbers and never says "prepay"."""
    from engine.market_data import safe_rate

    ccy = user_currency.upper()
    years = max(1, -(-int(remaining_months) // 12))
    caveats: list[str] = []
    sources = {"remittance": REMITTANCE_SOURCE}
    if funds_in_india:
        d = D("0")
        c = D("0")
        alt_rate = nre_fd_rate if nre_fd_rate is not None else D("0")
        alt_name = alternative_name or "an NRE fixed deposit"
        alt_after_tax = alt_rate * (D("1") - marginal_tax)
        caveats.append(
            "NRE interest is tax-free in India while you are non-resident, but a US tax "
            "resident reports it on the US return."
        )
        sources["nre_exempt"] = "https://www.incometaxindia.gov.in/w/what-is-the-applicable-tds-rate-for-nris-on-interest-income-earned-from-fixed-deposits-made-in-indian-banks-"
    else:
        d = drift if drift is not None else historical_drift_default("INR", ccy)
        c = remittance_cost if remittance_cost is not None else (default_remittance_cost(ccy) or D("0"))
        if ccy == "USD":
            alt_rate = alternative_rate if alternative_rate is not None else safe_rate("hysa_us")
            alt_name = alternative_name or "a US high-yield savings account"
            sources["alternative"] = "https://www.marcus.com/us/en/savings/high-yield-savings"
        else:
            alt_rate = alternative_rate if alternative_rate is not None else D("0")
            alt_name = alternative_name or "savings where you live"
        alt_after_tax = alt_rate * (D("1") - marginal_tax)
        if remittance_cost is None and default_remittance_cost(ccy) is None:
            caveats.append("No published transfer cost for this currency: enter your provider's.")
        caveats.append(
            "The rupee's yearly move is an assumption from its 20-year average, not a "
            "forecast; a single year can swing far more."
        )
        caveats.append(
            "Pay from an NRE or NRO account or by inward remittance: RBI's rules for "
            "loans to non-residents (Master Direction – Borrowing and Lending, para 7.1)."
        )
        sources["fema_repayment"] = "https://www.rbi.org.in/Scripts/BS_ViewMasDirections.aspx?id=10191"
    prepay = prepay_return_in_user_currency(loan_rate, d, c, years)
    alt_after_tax = alt_after_tax.quantize(D("0.0001"))
    edge = prepay - alt_after_tax

    def pct(x: Decimal) -> str:
        return f"{(x * 100).quantize(D('0.1'))}%"

    if funds_in_india:
        line = (
            f"Prepaying from rupees already in India saves {pct(prepay)} a year; "
            f"{alt_name} pays {pct(alt_after_tax)}"
            + (" after tax." if marginal_tax > 0 else ".")
        )
    else:
        bits = []
        if d != 0:
            bits.append(f"{pct(abs(d))} a year {'rupee slide' if d < 0 else 'rupee rise'}")
        if c != 0:
            bits.append(f"a {format((c * 100).quantize(D('0.01')).normalize(), 'f')}% transfer cost")
        after = f" after {' and '.join(bits)}" if bits else ""
        line = (
            f"Prepaying earns about {pct(prepay)} a year in {ccy} terms{after}; "
            f"{alt_name} pays {pct(alt_after_tax)}"
            + (" after tax." if marginal_tax > 0 else ".")
        )
    return NriPrepayComparison(
        loan_rate=loan_rate, drift=d, remittance_cost=c, years=years,
        prepay_return=prepay, alternative_name=alt_name, alternative_rate=alt_rate,
        alternative_after_tax=alt_after_tax, edge=edge, funds_in_india=funds_in_india,
        line=line, caveats=caveats, sources=sources,
    )


# ─────────────────────────────────────────────────────────────────────────────
# Residency transitions (India → NRI and back) as profile life events.
# ─────────────────────────────────────────────────────────────────────────────
# Income-tax Act 2025 s.6 (in force 1 Apr 2026), read 2026-10-14:
#   https://indiacode.ecourtsindia.com/income-tax-act-2025/section/6/
#   https://www.incometax.gov.in/iec/foportal/help/all-topics/e-filing-services/non-resident
# (2)(a) 182+ days in the tax year → resident; (2)(b) 60+ days and 365+ days
# in the four years before → resident. (3) (b) doesn't apply to a citizen
# who leaves India that year for a job abroad (or as crew of an Indian
# ship). (4)/(5) a citizen or PIO who lives abroad and visits: (b) doesn't
# apply, unless Indian income (not from foreign sources) exceeds ₹15 lakh,
# when "60 days" reads "120 days". (7) deemed resident: a citizen with
# Indian income over ₹15 lakh who isn't liable to tax anywhere else.
# Not ordinarily resident (RNOR): non-resident in 9 of the 10 years before,
# or 729 days or less in India in the 7 years before; also the 120-day
# visitor and the deemed resident (PwC summary of s.6,
# https://taxsummaries.pwc.com/india/individual/residence).
DEEMED_RESIDENT_INCOME = D("1500000")


@dataclass
class ResidencyResult:
    status: str               # "resident" | "rnor" | "non_resident"
    rule: str                 # which test decided it, in plain words
    deemed: bool = False


def india_tax_residency(
    *,
    days_in_india: int,
    days_in_prev_4_years: int = 0,
    citizen_or_pio: bool = True,
    lives_abroad_and_visiting: bool = False,
    left_for_job_abroad_this_year: bool = False,
    indian_income: Decimal = D("0"),
    liable_to_tax_elsewhere: bool = True,
    nr_years_in_prev_10: Optional[int] = None,
    days_in_prev_7_years: Optional[int] = None,
) -> ResidencyResult:
    """Residential status for one Indian tax year (Income-tax Act 2025 s.6).

    A planning aid, not a ruling: day counts and "liable to tax elsewhere"
    are the user's own; a treaty tie-breaker can still override it."""
    if days_in_india < 0 or days_in_prev_4_years < 0:
        raise ValueError("days can't be negative")
    over_15l = indian_income > DEEMED_RESIDENT_INCOME

    def rnor_or_resident(rule: str, forced_rnor: bool = False) -> ResidencyResult:
        rnor = forced_rnor or (
            (nr_years_in_prev_10 is not None and nr_years_in_prev_10 >= 9)
            or (days_in_prev_7_years is not None and days_in_prev_7_years <= 729)
        )
        return ResidencyResult("rnor" if rnor else "resident", rule)

    if days_in_india >= 182:
        return rnor_or_resident("182 days or more in India this tax year")
    second_test = True
    threshold = 60
    if citizen_or_pio and left_for_job_abroad_this_year:
        second_test = False
    elif citizen_or_pio and lives_abroad_and_visiting:
        if over_15l:
            threshold = 120
        else:
            second_test = False
    if second_test and days_in_india >= threshold and days_in_prev_4_years >= 365:
        rule = f"{threshold}+ days this year and 365+ days in the four years before"
        return rnor_or_resident(rule, forced_rnor=(threshold == 120))
    if citizen_or_pio and over_15l and not liable_to_tax_elsewhere:
        r = ResidencyResult(
            "rnor",
            "deemed resident: Indian income over ₹15 lakh and not taxed anywhere else",
            deemed=True,
        )
        return r
    return ResidencyResult("non_resident", "neither day test met")


@dataclass
class TransitionNote:
    text: str
    source: str


def residency_transition_notes(direction: str) -> list[TransitionNote]:
    """What changes for a borrower moving 'india_to_nri' or 'nri_to_india'.
    Every line carries its primary source; nothing here is a figure."""
    rbi_faq = "https://www.rbi.org.in/SCRIPTs/FAQDisplay.aspx?Id=52"
    loans_md = "https://www.rbi.org.in/Scripts/BS_ViewMasDirections.aspx?id=10191"
    s6 = "https://indiacode.ecourtsindia.com/income-tax-act-2025/section/6/"
    if direction == "india_to_nri":
        return [
            TransitionNote(
                "Your rupee loans can continue to their original end date if the lender agrees; "
                "while you live abroad, EMIs must come from an NRE, NRO or FCNR account or by "
                "inward remittance (RBI Master Direction – Borrowing and Lending, para 7.1).",
                loans_md),
            TransitionNote(
                "Tell your bank: your resident savings account is re-designated as an NRO account.",
                rbi_faq),
            TransitionNote(
                "Your loan stays in rupees while your pay is now in another currency, so each EMI "
                "carries an exchange rate and a transfer cost. The plan converts at the rate you "
                "enter and can add the rupee's yearly slide.",
                REMITTANCE_SOURCE),
            TransitionNote(
                "Tax: whether you are non-resident for the year depends on days in India "
                "(182, or 60/120 with the 4-year rule; a citizen leaving for a job abroad is "
                "tested on 182 only). As a non-resident, India taxes only Indian income, and "
                "NRO interest has 30% TDS unless you file for the treaty rate.",
                s6),
        ]
    if direction == "nri_to_india":
        return [
            TransitionNote(
                "On return, NRE accounts are re-designated as resident accounts or moved to an RFC "
                "(foreign currency) account; NRO accounts become resident accounts; FCNR(B) "
                "deposits may run to maturity at the contracted rate.",
                rbi_faq),
            TransitionNote(
                "Your first years back may be 'not ordinarily resident' (non-resident in 9 of the "
                "10 years before, or 729 days or fewer in India in the 7 years before): foreign "
                "income then stays outside Indian tax.",
                s6),
            TransitionNote(
                "Pay switches to rupees, so a rupee loan no longer carries exchange-rate or "
                "transfer costs; a loan abroad (US card, car or student loan) now does.",
                REMITTANCE_SOURCE),
        ]
    raise ValueError("direction must be 'india_to_nri' or 'nri_to_india'")


def residency_move_event(
    *,
    effective_month: int,
    new_monthly_take_home: Decimal,
    new_take_home_currency: str,
    plan_currency: str,
    fx_plan_per_new: Optional[Decimal] = None,
):
    """A residency move as a plan life event: the pay from the move month,
    converted into the plan's currency (the engine plans in one currency).

    Returns a SALARY_RESET LifecycleEvent. `fx_plan_per_new` is units of
    the plan currency per unit of the new pay's currency (e.g. ₹ per $);
    required when the currencies differ. Loans keep their own currency."""
    from engine.models import LifecycleEvent, LifecycleEventKind

    if effective_month < 1:
        raise ValueError("effective_month must be 1 or later")
    if new_monthly_take_home < 0:
        raise ValueError("take-home can't be negative")
    if new_take_home_currency.upper() == plan_currency.upper():
        amount = new_monthly_take_home
    else:
        if fx_plan_per_new is None or fx_plan_per_new <= 0:
            raise ValueError("an exchange rate is needed when the new pay is in another currency")
        amount = (new_monthly_take_home * fx_plan_per_new).quantize(D("0.01"))
    return LifecycleEvent(
        kind=LifecycleEventKind.SALARY_RESET,
        effective_month=effective_month,
        new_monthly_take_home=amount,
    )
