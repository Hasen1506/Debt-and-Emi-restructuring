"""Marginal cost of the next rupee prepaid (roadmap PR J, founder decision 2026-10-07).

The payoff order ranks loans by what the NEXT rupee (or dollar) of extra
payment saves on each loan, looking forward only:

    marginal cost = interest, compounded monthly        (1 + r/12)^12 − 1
                  + GST on that interest, not compounding (Indian credit cards: 18%)
                  − tax benefit the prepayment gives up (24(b) / 80E / US mortgage
                                                         and student-loan interest)
                  − the prepayment / foreclosure fee,   fee% × 12 / months left
                    spread over the months it saves

Sunk costs are left out on purpose: the upfront processing fee (and its GST)
and insurance already paid do not change whatever you pay next, so they
don't change which loan the next rupee should go to. (`effective_rate` and
the true APR still include them, because they describe what the loan
costs in total.)

A loan still in its prepayment lock-in can't take the rupee at all. It is
ranked after every open loan (by its own marginal cost among the locked
ones): `order_key` subtracts LOCKED_OFFSET.

The same function is in web/src/lib/marginal-cost.ts; the differential
test (engine/tests/fixtures/marginal_cost_cases.json) keeps them equal.
"""
from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal

from engine.models import Country, Loan, LoanType
from engine.tax.gst import GST_RATE_IN

D = Decimal

# India's GST on card interest: the one rate in engine/tax/gst.py.
GST_ON_CARD_INTEREST_IN = GST_RATE_IN
# Pushes a locked loan below every open one; marginal costs are < 100 (10,000%).
LOCKED_OFFSET = D("100")
# Deduction caps (engine/formulas.py: country_cap_home_loan, US_* limits).
IN_HOME_INTEREST_CAP = D("200000")
US_MORTGAGE_DEBT_LIMIT = D("750000")
US_STUDENT_INTEREST_CAP = D("2500")
# Months a fee is spread over when the loan has no fixed end (a card).
OPEN_ENDED_MONTHS = 12


@dataclass(frozen=True)
class MarginalCost:
    """Annual rates, as decimals (0.4248 = 42.48%)."""
    interest: Decimal      # nominal compounded monthly
    gst: Decimal           # GST on that interest (added)
    tax_benefit: Decimal   # tax saving the prepayment gives up (subtracted)
    fee: Decimal           # prepayment fee, annualised over months left (subtracted)
    lock_in_months: int    # months before an extra payment is allowed (0 = open)
    total: Decimal
    # India, old regime (C10): tax a unit of home-loan principal prepaid
    # saves this tax year under s.123 [80C] while its ₹1.5L room is unused
    # (added to `total`; a one-off saving, counted as a year's rate).
    principal_80c: Decimal = D("0")
    # Round 2 (item 4, W10 finding 6): a loan in another currency than the
    # user's pay, seen in the user's currency: the currency's expected yearly
    # move (User.fx_drift_annualized, the same drift the plan's FX path uses)
    # and the one-time cost of sending money (User.remittance_cost), spread
    # over the years left (engine/cross_border.prepay_return_in_user_currency).
    # Added to the cost (negative when the loan's currency slides).
    fx_adjust: Decimal = D("0")

    @property
    def locked(self) -> bool:
        return self.lock_in_months > 0

    @property
    def annual_cost(self) -> Decimal:
        """What the debt costs a year from here: compounded interest plus GST,
        less the tax break. The prepayment fee is left out: it is a cost of
        prepaying, checked on its own (prepayment_beats_fee), not of owing."""
        return self.interest + self.gst - self.tax_benefit + self.fx_adjust

    @property
    def order_key(self) -> Decimal:
        """Sort key, highest first: the total, with locked loans last."""
        return self.total - LOCKED_OFFSET if self.locked else self.total


def compounded(nominal: Decimal) -> Decimal:
    """Effective annual rate of a nominal rate charged monthly."""
    return (D("1") + nominal / D("12")) ** 12 - D("1")


def prepayment_fee_with_gst(fee_pct: Decimal, india: bool) -> Decimal:
    """The prepayment fee as charged: an Indian lender adds 18% GST on it
    (engine/tax/gst.py, "prepayment_fee"; grill #27). Fee % as typed, GST
    excluded, the way a KFS writes it ("4% + GST")."""
    from engine.tax.gst import gst_on
    return fee_pct + gst_on("prepayment_fee", fee_pct) if india else fee_pct


def marginal_cost(
    nominal_rate: Decimal,
    card_gst: bool,
    shield_fraction: Decimal,
    prepayment_fee_pct: Decimal,
    months_left: int,
    lock_in_months: int = 0,
) -> MarginalCost:
    """The shared formula. `card_gst`: an Indian credit card (GST on the
    interest). `shield_fraction`: the share of each unit of interest the
    user gets back in tax (0 for most loans; marginal rate × the capped
    share for a deductible one). `months_left`: months to the loan's end
    (≤ 0 = open-ended)."""
    interest = compounded(nominal_rate)
    # GST is 18% of each month's interest, and the year's GST is 18% of the
    # year's interest. It does not itself earn interest: RBI's Master
    # Direction on Credit Card and Debit Card - Issuance and Conduct, 2022
    # (RBI/2022-23/92, updated 7 March 2024), para 9(b)(ii): "The unpaid
    # charges/levies/taxes shall not be capitalized for charging/compounding
    # of interest", and its FAQ 7 (in force for taxes billed from
    # 1 October 2022). So a 42% card costs (1 + 0.42/12)^12 - 1 = 51.11% of
    # interest + 18% of that = 9.20% GST = 60.31% a year, not the 62.52%
    # that compounding the GST gave. Source:
    # https://www.rbi.org.in/Scripts/BS_ViewMasDirections.aspx?id=12300 (read 2026-10-12); C22: since
    # 28 Nov 2025 the same text is in the consolidated Commercial Banks card
    # Directions 2025, id=13155 (NBFC: id=12956, checked 14 Oct 2026).
    gst = interest * GST_ON_CARD_INTEREST_IN if card_gst else D("0")
    tax_benefit = interest * shield_fraction
    k = months_left if months_left > 0 else OPEN_ENDED_MONTHS
    fee = prepayment_fee_pct * D("12") / D(k) if prepayment_fee_pct > 0 else D("0")
    total = interest + gst - tax_benefit - fee
    return MarginalCost(interest, gst, tax_benefit, fee, max(0, int(lock_in_months)), total)


def marginal_shield(
    loan_type: str,
    country: str,
    marginal_rate: Decimal,
    regime: str = "new",
    itemises: bool = True,
    itemised_share: Decimal = D("1"),
    interest_total: Decimal = D("0"),
    debt_total: Decimal = D("0"),
    phaseout_factor: Decimal = D("1"),
    share: Decimal = D("1"),
    let_out: bool = False,
    cap: Decimal | None = None,
    deduction_open: bool = True,
    us_auto_qualified: bool = False,
) -> Decimal:
    """Tax saved on the NEXT unit of this loan's interest, as a share of it.

    Forward-looking, so a deduction cap that already binds gives nothing at
    the margin (the average shield in `effective_rate` still counts it):
    - India home loan, s.24(b): marginal rate while the year's home-loan
      interest (`interest_total`, across home loans) is under the ₹2L cap
      (old regime); 0 at or over it, and 0 in the new regime.
    - India education loan, s.80E (old regime, no cap): marginal rate.
    - US mortgage, §163: marginal rate for an itemiser whose itemised
      deductions exceed the standard deduction (`itemised_share` > 0) and
      whose mortgage debt (`debt_total`) is under $750k; else 0.
    - US student loan, §221: marginal rate × `phaseout_factor` while the
      year's student-loan interest is under $2,500; else 0.
    `country` is the user's tax residence ("IN" / "US"); `loan_type` the
    API name ("home_loan", "education_loan", ...).

    India, sprint G2 (Income-tax Act 2025 numbers): `share` is the user's
    share of the loan (a co-borrower saves tax on their part of the
    interest only, s.24); `let_out` with `cap` = the year's room for a
    let-out home's interest (its rent after 30% plus the old regime's ₹2L
    set-off, engine/tax/india.let_out_room), open in either regime;
    `cap` for a self-occupied home overrides ₹2L (₹30k under s.22(2)(b));
    `deduction_open` False once an education loan's 8-tax-year s.129 [80E]
    window has ended.
    """
    lt = loan_type.value if hasattr(loan_type, "value") else loan_type
    if country == "IN":
        sh = max(D("0"), min(D("1"), share))
        if lt == "home_loan":
            if let_out:
                return marginal_rate * sh if cap is not None and interest_total < cap else D("0")
            limit = IN_HOME_INTEREST_CAP if cap is None else cap
            return marginal_rate * sh if regime == "old" and interest_total < limit else D("0")
        if lt == "education_loan":
            return marginal_rate * sh if regime == "old" and deduction_open else D("0")
        return D("0")
    if lt == "home_loan":
        limit = US_MORTGAGE_DEBT_LIMIT if cap is None else cap     # C17: MFS / pre-2018 limit via `cap`
        ok = itemises and itemised_share > 0 and debt_total < limit
        return marginal_rate if ok else D("0")
    if lt == "education_loan":
        return marginal_rate * phaseout_factor if interest_total < US_STUDENT_INTEREST_CAP else D("0")
    if lt == "auto_loan":
        # IRC §163(h)(4), C16: only a loan the user marked qualified
        # (`us_auto_qualified`), while the year's qualified interest is under
        # $10,000; `phaseout_factor` is the MAGI phase-out share.
        from engine.tax.usa import AUTO_INTEREST_CAP
        return marginal_rate * phaseout_factor if us_auto_qualified and interest_total < AUTO_INTEREST_CAP else D("0")
    return D("0")


def loan_marginal_cost(
    loan: Loan,
    shield_fraction: Decimal,
    country: Country,
    months_left: int | None = None,
    lock_in_months: int | None = None,
) -> MarginalCost:
    """`marginal_cost` for a Loan. `months_left` / `lock_in_months` default to
    the loan's own fields (as of today); the simulation passes the values
    for the month it is in."""
    from engine.formulas import loan_market
    india = loan_market(loan, country) == Country.IN
    card_gst = loan.loan_type == LoanType.CREDIT_CARD and india
    return marginal_cost(
        loan.nominal_rate,
        card_gst,
        shield_fraction,
        prepayment_fee_with_gst(loan.prepayment_penalty_pct or D("0"), india),
        loan.tenure_months_remaining if months_left is None else months_left,
        loan.prepay_lock_in_months if lock_in_months is None else lock_in_months,
    )


def _shield_context(loans: list[Loan], user):
    """What the marginal tax shield of each loan depends on: this year's
    deductible interest and debt by kind, the US student-loan phase-out,
    and the Indian regime."""
    from engine.formulas import loan_market
    from engine.models import FilingStatusUS
    own = user.country
    market = lambda l: loan_market(l, own)  # noqa: E731
    homes = [l for l in loans if l.loan_type == LoanType.HOME and l.outstanding > 0 and market(l) == own]
    edu = [l for l in loans if l.loan_type == LoanType.EDUCATION and l.outstanding > 0 and market(l) == own]
    if own == Country.IN:
        # The user's share of interest + pre-construction instalments on
        # self-occupied homes: they share the one ₹2L cap (s.22(2), (5)).
        home_interest = sum(((l.outstanding * l.nominal_rate + l.pre_construction_interest_annual) * l.tax_share
                             for l in homes if (l.property_use or "self_occupied") != "let_out"), D("0"))
    else:
        home_interest = sum((l.outstanding * l.nominal_rate for l in homes), D("0"))
    home_debt = sum((l.outstanding for l in homes), D("0"))
    edu_interest = sum((l.outstanding * l.nominal_rate for l in edu), D("0"))
    phaseout = D("1")
    # C20: gross on file, else solved from take-home (engine/tax/income.py);
    # None used to skip the §221 phase-out for every high earner.
    from engine.tax.income import user_gross
    magi = user_gross(user)[0] if own == Country.US else None
    if own == Country.US and edu and (user.filing_status == FilingStatusUS.MFS):
        phaseout = D("0")      # §221(e)(2): none on a separate return (C17)
    elif own == Country.US and edu and magi is not None and edu_interest > 0:
        from engine.tax.usa import student_loan_interest_deduction
        allowed = student_loan_interest_deduction(min(edu_interest, US_STUDENT_INTEREST_CAP), magi,
                                                  user.filing_status or FilingStatusUS.SINGLE)
        phaseout = allowed / min(edu_interest, US_STUDENT_INTEREST_CAP)
    regime = (user.tax_regime.value if user.tax_regime is not None else "new")
    return home_interest, home_debt, edu_interest, phaseout, regime


def _us_auto_context(loans: list[Loan], user) -> tuple[Decimal, Decimal]:
    """(qualified car-loan interest this year, MAGI phase-out share) for
    IRC §163(h)(4) (C16)."""
    from engine.tax.income import user_gross
    from engine.tax.usa import auto_loan_interest_deduction, AUTO_INTEREST_CAP
    if user.country != Country.US:
        return D("0"), D("0")
    total = sum((l.outstanding * l.nominal_rate for l in loans
                 if l.loan_type == LoanType.AUTO and l.outstanding > 0 and l.us_auto_interest_qualified
                 and (l.currency or "USD").upper() == "USD"), D("0"))
    if total <= 0:
        return D("0"), D("0")
    base = min(total, AUTO_INTEREST_CAP)
    return total, auto_loan_interest_deduction(base, user_gross(user)[0], user.filing_status) / base


def _sec80c_room_left(loans: list[Loan], user, regime: str, prepaid_this_year: Decimal) -> Decimal:
    """C10: unused s.123 [80C] room this tax year for home-loan principal
    prepaid, old regime only, and only when the user told us their other
    80C items (`user.sec80c_other`; None = unknown, nothing assumed). The
    scheduled principal of the year (12 × EMI − interest, the user's share)
    comes off first, then what the plan already prepaid this tax year."""
    if user.country != Country.IN or regime != "old" or user.sec80c_other is None:
        return D("0")
    from engine.tax import india
    sched = D("0")
    for l in loans:
        if l.loan_type == LoanType.HOME and l.outstanding > 0 and l.principal_80c_eligible \
                and (l.currency or "INR").upper() == "INR" and l.pre_emi_months_remaining <= 0:
            sched += max(D("0"), l.scheduled_emi * 12 - l.outstanding * l.nominal_rate) * l.tax_share
    return max(D("0"), india.sec80c_room(user.sec80c_other, sched) - max(D("0"), prepaid_this_year))


def _india_shield_args(l: Loan, own: Country, regime: str, interest_total: Decimal, month: int) -> tuple:
    """`interest_total` for marginal_shield: a let-out Indian home is checked
    against its own room, so it passes its own share of interest."""
    if own == Country.IN and l.loan_type == LoanType.HOME and (l.property_use or "") == "let_out":
        return ((l.outstanding * l.nominal_rate + l.pre_construction_interest_annual) * l.tax_share,)
    return (interest_total,)


def _india_shield_kwargs(l: Loan, own: Country, regime: str, home_interest: Decimal, month: int) -> dict:
    """The India-only marginal_shield inputs for loan `l` in sim-month
    `month` (sprint G2): share, let-out room, the ₹30k cap, the 80E window."""
    if own != Country.IN:
        return {}
    from engine.models import TaxRegimeIN
    from engine.tax import india
    r = TaxRegimeIN.OLD if regime == "old" else TaxRegimeIN.NEW
    kw: dict = {"share": l.tax_share}
    if l.loan_type == LoanType.HOME:
        if (l.property_use or "") == "let_out":
            used = min(home_interest, india.SEC24B_SELF_OCCUPIED_CAP) if r == TaxRegimeIN.OLD else D("0")
            kw["let_out"] = True
            kw["cap"] = india.let_out_room(r, l.annual_rent, max(D("0"), min(D("1"), l.tax_share)), set_off_used=used)
        elif not l.sec24_full_cap:
            kw["cap"] = india.SEC24B_OTHER_CAP
    elif l.loan_type == LoanType.EDUCATION and l.tax_deduction_months_left is not None:
        kw["deduction_open"] = month <= l.tax_deduction_months_left
    return kw


def _home_rate(l: Loan, user, marginal_rate: Decimal) -> Decimal:
    """US mortgage interest saves no state tax in a state with no income tax
    or one that disallows it (engine/us_loans.py, grill #79)."""
    if user.country == Country.US and l.loan_type == LoanType.HOME:
        from engine.us_loans import us_mortgage_marginal_rate
        return us_mortgage_marginal_rate(marginal_rate, user.state, user.state_marginal_rate)
    return marginal_rate


def user_marginal_costs(loans: list[Loan], user, marginal_rate: Decimal, month: int = 1,
                        start_month: dict[int, int] | None = None,
                        home_prepaid_this_tax_year: Decimal = D("0")) -> dict[int, MarginalCost]:
    """{id(loan): MarginalCost} for the open loans in `loans`, as of sim-month
    `month` (1 = today). Shared by the simulation, Spare cash and the API.
    `home_prepaid_this_tax_year`: home-loan principal the plan already
    prepaid since April (uses up the 80C room, C10)."""
    from engine.models import FilingStatusUS
    from engine.tax.usa import mortgage_debt_limit
    own = user.country
    home_interest, home_debt, edu_interest, phaseout, regime = _shield_context(loans, user)
    auto_interest, auto_phaseout = _us_auto_context(loans, user)
    room_80c = _sec80c_room_left(loans, user, regime, home_prepaid_this_tax_year)
    out: dict[int, MarginalCost] = {}
    for l in loans:
        if l.outstanding <= 0:
            continue
        is_home = l.loan_type == LoanType.HOME
        if own == Country.US and l.loan_type == LoanType.AUTO:
            shield = marginal_shield(l.loan_type, own.value, marginal_rate, regime, interest_total=auto_interest,
                                     phaseout_factor=auto_phaseout, us_auto_qualified=l.us_auto_interest_qualified)
        else:
            us_kw = ({"cap": mortgage_debt_limit(user.filing_status, l.mortgage_before_2017_12_16)}
                     if own == Country.US and is_home else {})
            shield = marginal_shield(
                l.loan_type, own.value, _home_rate(l, user, marginal_rate), regime, bool(user.itemises), user.itemised_share,
                *_india_shield_args(l, own, regime, home_interest if is_home else edu_interest, month),
                home_debt, phaseout, **_india_shield_kwargs(l, own, regime, home_interest, month), **us_kw,
            )
        start = (start_month or {}).get(id(l), 1)
        elapsed = max(0, month - start)
        months_left = l.tenure_months_remaining - max(0, month - l.first_payment_month) if l.tenure_months_remaining > 0 else 0
        mc = loan_marginal_cost(
            l, shield, own, months_left=months_left,
            lock_in_months=max(0, l.prepay_lock_in_months - elapsed),
        )
        if room_80c > 0 and is_home and l.principal_80c_eligible and (l.currency or "INR").upper() == "INR" \
                and l.pre_emi_months_remaining <= 0:
            credit = marginal_rate * max(D("0"), min(D("1"), l.tax_share))
            mc = MarginalCost(mc.interest, mc.gst, mc.tax_benefit, mc.fee, mc.lock_in_months,
                              mc.total + credit, credit)
        fx = _fx_adjust(l, user, mc, months_left)
        if fx != 0:
            mc = MarginalCost(mc.interest, mc.gst, mc.tax_benefit, mc.fee, mc.lock_in_months,
                              mc.total + fx, mc.principal_80c, fx)
        out[id(l)] = mc
    return out


def _fx_adjust(l: Loan, user, mc: MarginalCost, months_left: int) -> Decimal:
    """What the earner's currency adds to (or takes off) a foreign-currency
    loan's yearly cost (round 2, item 4). One unit of pay sent home arrives
    as (1 − c); prepaid it saves the loan's cost k in the loan's currency,
    worth (1 + drift) a year later in the earner's:

        ((1 − c)^(1/years) · (1 + k) · (1 + drift)) − 1   −   k

    years = the years the loan has left (at least 1; a card counts 1). 0 for
    a loan in the user's own currency, so every single-currency plan is
    unchanged."""
    from engine.surplus import _user_residence_currency
    home = _user_residence_currency(user).upper()
    ccy = (l.currency or home).upper()
    if ccy == home:
        return D("0")
    drift = D(str((getattr(user, "fx_drift_annualized", None) or {}).get(ccy, D("0"))))
    c = getattr(user, "remittance_cost", None)
    if c is None:
        from engine.cross_border import default_remittance_cost
        c = (default_remittance_cost(home) or D("0")) if ccy == "INR" else D("0")
    if drift == 0 and c == 0:
        return D("0")
    years = max(1, -(-max(0, months_left) // 12))
    kept = D(str(float(D("1") - D(c)) ** (1 / years)))
    k = mc.annual_cost
    return (kept * (D("1") + k) * (D("1") + drift) - D("1")) - k


def user_forward_rates(loans: list[Loan], user, marginal_rate: Decimal) -> dict[int, Decimal]:
    """{id(loan): what the NEXT year of this debt costs, as a nominal rate}
    (C8): nominal × (1 − marginal tax shield) + GST on card interest. No
    sunk processing fee or insurance, and the shield at the margin (a
    deduction cap that already binds gives nothing). Same scale as a
    lender's quoted rate, so refinance / balance-transfer offers and the
    windfall rationale compare like with like. `formulas.effective_rate`
    stays for "what this loan costs in total" (True APR)."""
    mcs = user_marginal_costs(loans, user, marginal_rate)
    out: dict[int, Decimal] = {}
    from engine.formulas import loan_market
    for l in loans:
        nominal = l.nominal_rate
        mc = mcs.get(id(l))
        shield = (mc.tax_benefit / mc.interest) if mc is not None and mc.interest > 0 else D("0")
        gst = nominal * GST_ON_CARD_INTEREST_IN if (
            l.loan_type == LoanType.CREDIT_CARD and loan_market(l, user.country) == Country.IN) else D("0")
        out[id(l)] = nominal * (D("1") - shield) + gst
    return out


def uncapped_shields(loans: list[Loan], user, marginal_rate: Decimal) -> dict[int, Decimal]:
    """{id(loan): share of each unit of its interest given back in tax}, as if
    no yearly interest cap bound (the ₹2L 24(b) and $2,500 §221 caps are
    applied year by year by the caller; the $750k mortgage-debt limit, the
    regime and itemising still apply). Used by `plan_net_cost`."""
    own = user.country
    _, home_debt, _, phaseout, regime = _shield_context(loans, user)
    out = {}
    for l in loans:
        kw = _india_shield_kwargs(l, own, regime, D("0"), 1)
        if kw.get("let_out"):
            kw["cap"] = D("Infinity")
        out[id(l)] = marginal_shield(l.loan_type, own.value, _home_rate(l, user, marginal_rate), regime, bool(user.itemises),
                                     user.itemised_share, D("0"), home_debt, phaseout, **kw)
    return out


def why_first(mc: MarginalCost) -> str:
    """One line: the breakdown of the next rupee's cost, for "why this loan first"."""
    pct = lambda v: f"{v * 100:.2f}%"  # noqa: E731
    parts = [f"{pct(mc.interest)} interest (compounded monthly)"]
    if mc.gst > 0:
        parts.append(f"+ {pct(mc.gst)} GST on it")
    if mc.tax_benefit > 0:
        parts.append(f"− {pct(mc.tax_benefit)} tax break you'd give up")
    if mc.fee > 0:
        parts.append(f"− {pct(mc.fee)} prepayment fee")
    if mc.principal_80c > 0:
        parts.append(f"+ {pct(mc.principal_80c)} 80C tax saving on the principal (old regime, while 80C has room this year)")
    s = f"The next payment here saves {pct(mc.total)} a year: " + " ".join(parts)
    if mc.locked:
        s += f"; locked against prepayment for {mc.lock_in_months} more month{'' if mc.lock_in_months == 1 else 's'}"
    return s
