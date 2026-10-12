"""Core financial formulas — design spec §4.1–§4.23."""
from decimal import Decimal
from engine.models import Loan, Country, TaxRegimeIN, LoanType
from engine.tax.gst import GST_RATE_IN

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
    factor = (D("1") + r) ** tenure_months
    if factor - D("1") == 0:
        # A positive rate so small that (1+r)^n rounds to 1 at Decimal
        # precision: the loan is effectively interest-free (P2-20).
        return principal / D(tenure_months)
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

def country_cap_home_loan(country: Country, regime: TaxRegimeIN, property_use: str,
                          loan: Loan | None = None) -> Decimal:
    """Home-loan interest that lowers tax on the user's income in a year
    (India; P2-06, sprint G2). Income-tax Act 2025 numbers, 1961 in brackets.

    - Self-occupied: ₹2L per taxpayer in the old regime (s.22(2)(a), [24(b)]),
      ₹30k when the house wasn't finished within 5 years of borrowing
      (s.22(2)(b)); nothing in the new regime (s.202(2)(a)(v), [115BAC]).
    - Let-out: the interest is deducted from the rent (after 30%,
      s.22(1)(a)); a loss beyond that lowers other income only up to ₹2L in
      the old regime (s.109(1)(b), [71(3A)]) and not at all in the new one
      (s.202(2)(b)(ii)). With `loan.annual_rent` the rent part counts;
      without it only the set-off does ("simplified" in the app).
    """
    if country != Country.IN:
        return D("Infinity")
    from engine.tax import india
    share = max(D("0"), min(D("1"), loan.tax_share)) if loan is not None else D("1")
    if property_use == "let_out":
        return india.let_out_room(regime, loan.annual_rent if loan is not None else None, share)
    return india.self_occupied_cap(regime, loan.sec24_full_cap if loan is not None else True)


US_MORTGAGE_DEBT_LIMIT = D("750000")      # IRC §163(h)(3)(F), post-2017 loans
US_STUDENT_LOAN_INTEREST_MAX = D("2500")  # IRC §221


def gst_component(loan_type: LoanType, nominal_rate: Decimal,
                  processing_fee_rate: Decimal) -> Decimal:
    """India GST contribution to effective rate. 18% on credit-card interest;
    18% on the processing fee for personal/home/auto.

    `processing_fee_rate` is the fee already spread over the tenure as a
    yearly rate (`Loan.processing_fee_amortised`). It used to be divided
    again by balance × years as if it were a rupee amount, which made the
    GST on the fee about zero.
    """
    if loan_type == LoanType.CREDIT_CARD:
        return nominal_rate * GST_RATE_IN
    if loan_type in (LoanType.PERSONAL, LoanType.HOME, LoanType.AUTO):
        return processing_fee_rate * GST_RATE_IN
    return D("0")


DEDUCTIBLE_LOAN_TYPES_IN = {LoanType.HOME, LoanType.EDUCATION}
DEDUCTIBLE_LOAN_TYPES_US = {LoanType.HOME, LoanType.EDUCATION}    # mortgage: itemisers; student loan: above the line


def tax_shield_fraction(
    loan: Loan,
    marginal_tax_rate: Decimal,
    country: Country,
    tax_regime: TaxRegimeIN | None = None,
    itemises: bool = True,
    itemised_share: Decimal = D("1"),
    home_interest_total: Decimal | None = None,
    mortgage_debt_total: Decimal | None = None,
    us_student_interest_total: Decimal | None = None,
    magi: Decimal | None = None,
    filing_status=None,
) -> Decimal:
    """Share of each unit of this loan's interest the user gets back in tax
    (0 – marginal rate): §4.1's shield, used by `effective_rate` and by the
    marginal cost of prepaying (engine/marginal_cost.py, roadmap PR J).
    See `effective_rate` for the rules."""
    nominal = loan.nominal_rate
    annual_interest = loan.outstanding * nominal
    regime = tax_regime or TaxRegimeIN.NEW

    deductible_set = DEDUCTIBLE_LOAN_TYPES_IN if country == Country.IN else DEDUCTIBLE_LOAN_TYPES_US
    if loan.loan_type not in deductible_set or annual_interest <= 0:
        shield_pct = D("0")
    elif country == Country.IN and loan.loan_type == LoanType.EDUCATION and regime == TaxRegimeIN.NEW:
        shield_pct = D("0")
    elif country == Country.US and loan.loan_type == LoanType.EDUCATION:
        total = max(annual_interest, us_student_interest_total or D("0"))
        allowed = min(total, US_STUDENT_LOAN_INTEREST_MAX)
        if magi is not None:
            from engine.tax.usa import student_loan_interest_deduction
            from engine.models import FilingStatusUS
            allowed = student_loan_interest_deduction(total, magi, filing_status or FilingStatusUS.SINGLE)
        shield_pct = (allowed / total) * marginal_tax_rate if total > 0 else D("0")
    elif country == Country.US and not itemises:
        shield_pct = D("0")
    elif country == Country.IN and loan.loan_type == LoanType.EDUCATION and loan.tax_deduction_months_left == 0:
        # s.129(2) [80E]: the 8-tax-year window has ended.
        shield_pct = D("0")
    elif country == Country.IN and loan.loan_type == LoanType.HOME:
        # The user's share of the interest (co-borrower), within the year's
        # cap. Self-occupied homes share one cap pro rata
        # (`home_interest_total`: the user's share of interest plus
        # pre-construction instalments across them).
        share = max(D("0"), min(D("1"), loan.tax_share))
        use = loan.property_use or "self_occupied"
        cap = country_cap_home_loan(country, regime, use, loan)
        own = (annual_interest + loan.pre_construction_interest_annual) * share
        total = own if use == "let_out" else max(own, home_interest_total or D("0"))
        if cap <= 0 or total <= 0:
            shield_pct = D("0")
        else:
            shield_pct = share * (min(total, cap) / total) * marginal_tax_rate
    else:
        # US: the itemised share. India (an education loan, s.129 / 80E,
        # no cap): the user's share of the loan's interest.
        share = itemised_share if country == Country.US else loan.tax_share
        shield_pct = marginal_tax_rate * max(D("0"), min(D("1"), share))
        if country == Country.US and loan.loan_type == LoanType.HOME:
            debt = max(loan.outstanding, mortgage_debt_total or D("0"))
            if debt > US_MORTGAGE_DEBT_LIMIT:
                shield_pct = shield_pct * US_MORTGAGE_DEBT_LIMIT / debt

    return shield_pct


def effective_rate(
    loan: Loan,
    marginal_tax_rate: Decimal,
    country: Country,
    tax_regime: TaxRegimeIN | None = None,
    itemises: bool = True,
    itemised_share: Decimal = D("1"),
    home_interest_total: Decimal | None = None,
    mortgage_debt_total: Decimal | None = None,
    us_student_interest_total: Decimal | None = None,
    magi: Decimal | None = None,
    filing_status=None,
) -> Decimal:
    """§4.1 effective rate = nominal × [1 − shield_fraction × marginal_rate] + fees + GST.

    Tax shield only applies to home loan (Sec 24(b) India / IRC §163 US) and
    education loan (Sec 80E India, interest-only). Non-deductible loan types
    (credit card, personal, auto, gold, BNPL) get zero shield.

    - India, new regime (s.202 of the 2025 Act, [115BAC]): no 80E (s.129),
      so an education loan gets no shield; self-occupied home interest gets
      none; a let-out home's interest still lowers the tax on its rent
      (`loan.annual_rent`). Old regime: s.22 [24(b)] within the caps, s.129
      [80E] for 8 tax years (`loan.tax_deduction_months_left`), each on the
      user's share of the loan (`loan.tax_share`, co-borrowers).
    - US: mortgage interest only helps someone who itemises, and then only
      the part of their itemised deductions above the standard deduction
      does: `itemised_share` (0–1) is that part as a share of the mortgage
      interest. A $350k loan at 6.75% ($23,625 interest, $16,100 standard
      deduction) saves tax on $7,525 of it, not all of it. Callers pass
      `user.itemises` and `user.itemised_share`; the defaults keep older
      direct callers unchanged.
    - Caps are per taxpayer, not per loan: `home_interest_total` (India,
      the user's share of interest and pre-construction instalments across
      self-occupied home loans) shares the ₹2L s.22(2) cap, and
      `mortgage_debt_total` (US, balances across home loans) applies the
      $750k §163 debt limit (P2-05). Each defaults to this loan alone.
    - US student loans get the §221 above-the-line deduction (P2-25): up to
      $2,500 of interest a year (shared via `us_student_interest_total`),
      phased out by `magi` when given. No itemising needed.
    """
    nominal = loan.nominal_rate
    shield_pct = tax_shield_fraction(
        loan, marginal_tax_rate, country, tax_regime, itemises, itemised_share,
        home_interest_total, mortgage_debt_total, us_student_interest_total, magi, filing_status,
    )
    base = nominal * (D("1") - shield_pct)

    gst = gst_component(
        loan.loan_type, nominal, loan.processing_fee_amortised,
    ) if loan_market(loan, country) == Country.IN else D("0")

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


def after_tax_return(pre_tax_return: Decimal, marginal_tax_rate: Decimal) -> Decimal:
    """A taxable yield after income tax at the user's marginal rate.

    Liquid/debt funds (India, slab-taxed since Apr 2023), FDs, HYSA and
    T-bill interest are all taxed as ordinary income. Clamped to [0, 1).
    """
    m = max(D("0"), min(marginal_tax_rate, D("0.99")))
    return pre_tax_return * (D("1") - m)


def prepay_recommended(
    loan_effective_rate: Decimal,
    best_liquid_return: Decimal,
    inflation: Decimal,
    invest_tax_rate: Decimal = D("0"),
    hurdle: Decimal | None = None,
) -> bool:
    """§4.6: prepay if the loan's after-tax cost beats the investment's
    AFTER-TAX return by the 0.5pp risk premium.

    `loan_effective_rate` is already net of any tax shield (80E / 24(b) /
    §163), so the investment side must be taxed too (H1): comparing a
    shielded loan rate with a pre-tax yield told a 30%-bracket borrower to
    invest at 4.55% net rather than prepay a 6.3%-net education loan.
    `invest_tax_rate` is the marginal rate applied to `best_liquid_return`
    (pass 0 when the caller already supplies a post-tax yield).

    Inflation hits both sides equally, so it cancels; it is kept in the
    signature for callers but does not change the answer.
    LOCKED instruments must be excluded from `liquid_options` before calling this.
    """
    del inflation  # cancels out of (loan - i) > (invest - i) + premium
    invest_net = after_tax_return(best_liquid_return, invest_tax_rate)
    # `hurdle`: the user's own margin (roadmap PR D); default +0.5pp.
    return loan_effective_rate > invest_net + (PREPAY_RISK_PREMIUM if hurdle is None else hurdle)


GST_ON_CARD_INTEREST_IN = GST_RATE_IN


def prepayment_beats_fee(monthly_rate: Decimal, fee_pct: Decimal, months_left: int | None) -> bool:
    """True when paying 1 extra unit now saves more interest than the
    bank's prepayment fee takes.

    Of each extra unit, `fee_pct` goes to the fee and `1 - fee_pct` to
    principal. That principal would otherwise have grown at `monthly_rate`
    for the `months_left` the loan still runs, so the prepayment is worth
    it only when (1 - fee) x (1 + r)^k > 1. `months_left=None` means the
    loan never clears on its current payment (any fee below 100% pays off).

    Found by the property suite (engine/tests/test_property_invariants.py): a 0.51% loan with a 0.28%
    fee and 12 months left was still prepaid, so the "optimised" plan cost
    more than paying only the minimums.
    """
    if fee_pct <= 0:
        return True
    if fee_pct >= 1:
        return False
    if months_left is None:
        return True
    if months_left <= 0 or monthly_rate <= 0:
        return False
    return (D("1") - fee_pct) * (D("1") + monthly_rate) ** int(months_left) > D("1")


def loan_market(loan: Loan, country: Country) -> Country:
    """The market a loan's rules come from: its currency when tagged
    (an INR card held by a US resident is still an Indian card), else the
    user's country."""
    ccy = (loan.currency or "").upper()
    if ccy == "INR":
        return Country.IN
    if ccy == "USD":
        return Country.US
    return country


def monthly_interest_charge(loan: Loan, country: Country) -> Decimal:
    """This month's finance charge on a loan, in the loan's currency.

    Indian card statements add 18% GST on the finance charge (P2-13); the
    ranking already counted it via `gst_component`, the cash flow did not.
    """
    interest = loan.outstanding * loan.nominal_rate / D("12")
    if loan.loan_type == LoanType.CREDIT_CARD and loan_market(loan, country) == Country.IN:
        interest = interest * (D("1") + GST_ON_CARD_INTEREST_IN)
    return interest
