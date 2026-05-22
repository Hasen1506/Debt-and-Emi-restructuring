"""Core financial formulas — design spec §4.1–§4.23."""
from decimal import Decimal
from engine.models import Loan, Country, TaxRegimeIN, LoanType

D = Decimal


# ─────────────────────────────────────────────────────────────────────────────
# §4.13 EMI and remaining balance
# ─────────────────────────────────────────────────────────────────────────────

def emi(principal: Decimal, nominal_rate: Decimal, tenure_months: int) -> Decimal:
    """Standard EMI. nominal_rate is annual decimal (e.g. 0.0825)."""
    if tenure_months <= 0:
        return principal
    r = nominal_rate / D("12")
    if r == 0:
        return principal / D(tenure_months)
    n = D(tenure_months)
    factor = (D("1") + r) ** tenure_months
    return principal * r * factor / (factor - D("1"))


def flat_to_reducing(flat_rate: Decimal, tenure_months: int) -> Decimal:
    """Convert a flat-rate loan quote to its reducing-balance APR equivalent.

    Used at schema → engine boundary for consumer-durable / NBFC loans
    that advertise rates like "flat 8% over 24mo" — mathematically these
    are 1.7-1.9x the equivalent reducing-balance rate. The engine's
    amortisation math assumes reducing-balance, so flat-quote loans get
    converted once at parse time and everything downstream stays
    consistent.

    Derivation: a flat-quote loan of principal P at flat rate f over n
    months charges total interest = P × f × (n/12) and total repayment
    = P × (1 + f × n/12). EMI = total / n. We then solve for the reducing
    rate r whose EMI on principal P over n months matches — Newton's
    method via bisection (closed form is messy; this needs ~20 iters to
    converge to 5dp). Returns the reducing-balance annual rate as a
    Decimal so the result slots into the existing nominal_rate field
    without changing any other math.

    Conservative cap: returns the flat rate unchanged for tenures <= 1
    month (no meaningful difference). Caller should ensure tenure_months
    is positive.
    """
    if tenure_months <= 1 or flat_rate <= 0:
        return flat_rate
    n = tenure_months
    flat_total_repaid = D("1") + flat_rate * D(n) / D("12")
    target_emi = flat_total_repaid / D(n)  # EMI per ₹1 of principal
    lo, hi = D("0"), flat_rate * D("3")    # reducing always within 2-3× flat
    for _ in range(40):
        mid = (lo + hi) / D("2")
        candidate = emi(D("1"), mid, n)
        if candidate < target_emi:
            lo = mid
        else:
            hi = mid
        if hi - lo < D("0.00001"):
            break
    return (lo + hi) / D("2")


def remaining_balance(
    principal: Decimal, nominal_rate: Decimal, tenure_months: int, months_paid: int
) -> Decimal:
    """Outstanding after `months_paid` of the original schedule."""
    if months_paid >= tenure_months:
        return D("0")
    r = nominal_rate / D("12")
    if r == 0:
        return principal * (D("1") - D(months_paid) / D(tenure_months))
    m = emi(principal, nominal_rate, tenure_months)
    factor = (D("1") + r) ** months_paid
    return principal * factor - m * (factor - D("1")) / r


# ─────────────────────────────────────────────────────────────────────────────
# §4.1 / §4.16 — Effective rate with tax shield, fees, GST
# ─────────────────────────────────────────────────────────────────────────────

def country_cap_home_loan(country: Country, regime: TaxRegimeIN, property_use: str) -> Decimal:
    """Sec 24(b) cap for India home loan. New regime self-occupied = 0; old regime self-occupied = ₹2L.
    Let-out: no cap (deductible against rental income, modelled separately).
    """
    if country != Country.IN:
        return D("Infinity")
    if property_use == "let_out":
        return D("Infinity")
    return D("200000") if regime == TaxRegimeIN.OLD else D("0")


def gst_component(loan_type: LoanType, nominal_rate: Decimal, processing_fee: Decimal,
                  principal: Decimal, tenure_years: Decimal) -> Decimal:
    """India GST contribution to effective rate. 18% on credit-card interest;
    18% on processing fee (amortised) for personal/home/auto."""
    if loan_type == LoanType.CREDIT_CARD:
        return nominal_rate * D("0.18")
    if loan_type in (LoanType.PERSONAL, LoanType.HOME, LoanType.AUTO):
        if principal <= 0 or tenure_years <= 0:
            return D("0")
        return (processing_fee * D("0.18")) / (principal * tenure_years)
    return D("0")


DEDUCTIBLE_LOAN_TYPES_IN = {LoanType.HOME, LoanType.EDUCATION}
DEDUCTIBLE_LOAN_TYPES_US = {LoanType.HOME}    # itemisers only — handled via usa.itemisation_benefit


def effective_rate(
    loan: Loan,
    marginal_tax_rate: Decimal,
    country: Country,
    tax_regime: TaxRegimeIN | None = None,
) -> Decimal:
    """§4.1 effective rate = nominal × [1 − shield_fraction × marginal_rate] + fees + GST.

    Tax shield only applies to home loan (Sec 24(b) India / IRC §163 US) and
    education loan (Sec 80E India, interest-only). Non-deductible loan types
    (credit card, personal, auto, gold, BNPL) get zero shield.
    """
    nominal = loan.nominal_rate
    annual_interest = loan.outstanding * nominal

    deductible_set = DEDUCTIBLE_LOAN_TYPES_IN if country == Country.IN else DEDUCTIBLE_LOAN_TYPES_US
    if loan.loan_type not in deductible_set or annual_interest <= 0:
        shield_pct = D("0")
    else:
        if loan.loan_type == LoanType.HOME and country == Country.IN:
            cap = country_cap_home_loan(country, tax_regime or TaxRegimeIN.NEW,
                                        loan.property_use or "self_occupied")
        else:
            cap = D("Infinity")

        if cap == 0:
            shield_pct = D("0")
        elif cap == D("Infinity"):
            shield_pct = marginal_tax_rate
        else:
            deductible = min(annual_interest, cap)
            shield_pct = (deductible / annual_interest) * marginal_tax_rate

    base = nominal * (D("1") - shield_pct)

    tenure_years = D(loan.tenure_months_remaining) / D("12") if loan.tenure_months_remaining else D("1")
    gst = gst_component(
        loan.loan_type, nominal, loan.processing_fee_amortised, loan.outstanding, tenure_years
    ) if country == Country.IN else D("0")

    return base + loan.processing_fee_amortised + loan.insurance_premium_pct + gst


# ─────────────────────────────────────────────────────────────────────────────
# §4.10 — Real value of fixed EMI
# ─────────────────────────────────────────────────────────────────────────────

def real_emi(nominal_emi: Decimal, inflation: Decimal, t_months: int) -> Decimal:
    """real_emi_t = nominal_emi / (1 + inflation)^(t/12)."""
    if t_months <= 0 or inflation == 0:
        return nominal_emi
    years = D(t_months) / D("12")
    # Decimal doesn't support fractional ** directly; convert via float for the exponent
    # then back. For currency precision this is fine since exponent is a fraction in [0, ~30].
    factor = (D("1") + inflation) ** int(t_months // 12)
    fraction = float(years - D(int(t_months // 12)))
    if fraction > 0:
        factor *= D(str((1 + float(inflation)) ** fraction))
    return nominal_emi / factor


# ─────────────────────────────────────────────────────────────────────────────
# §4.17 — EPF/PPF pre-tax equivalent
# ─────────────────────────────────────────────────────────────────────────────

EPF_RATE_FY26 = D("0.0825")    # Retained Mar 2 2026 by EPFO 239th CBT
PPF_RATE_Q1_FY27 = D("0.071")  # Q1 FY2026-27 (Apr-Jun 2026); MoF Mar 30 2026


def pretax_equiv(taxfree_rate: Decimal, marginal_rate: Decimal) -> Decimal:
    """taxfree / (1 - marginal). E.g. EPF 8.25% at 30% bracket = 11.79%."""
    if marginal_rate >= 1:
        raise ValueError("marginal_rate must be < 1")
    return taxfree_rate / (D("1") - marginal_rate)


# ─────────────────────────────────────────────────────────────────────────────
# §4.6 — Layer 3 invest-vs-prepay decision
# ─────────────────────────────────────────────────────────────────────────────

PREPAY_RISK_PREMIUM = D("0.005")   # +0.5pp hurdle (decimals)


def prepay_recommended(
    loan_effective_rate: Decimal,
    best_liquid_return: Decimal,
    inflation: Decimal,
) -> bool:
    """§4.6: prepay if loan_real_rate > user_best_real_return + 0.5pp risk premium.
    LOCKED instruments must be excluded from `liquid_options` before calling this.
    """
    loan_real = loan_effective_rate - inflation
    invest_real = best_liquid_return - inflation
    return loan_real > invest_real + PREPAY_RISK_PREMIUM
