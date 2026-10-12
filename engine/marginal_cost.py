"""Marginal cost of the next rupee prepaid (roadmap PR J, founder decision 2026-10-07).

The payoff order ranks loans by what the NEXT rupee (or dollar) of extra
payment saves on each loan, looking forward only:

    marginal cost = interest, compounded monthly        (1 + r/12)^12 − 1
                  + GST on that interest, compounding   (Indian credit cards: 18%)
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

    @property
    def locked(self) -> bool:
        return self.lock_in_months > 0

    @property
    def annual_cost(self) -> Decimal:
        """What the debt costs a year from here: compounded interest plus GST,
        less the tax break. The prepayment fee is left out: it is a cost of
        prepaying, checked on its own (prepayment_beats_fee), not of owing."""
        return self.interest + self.gst - self.tax_benefit

    @property
    def order_key(self) -> Decimal:
        """Sort key, highest first: the total, with locked loans last."""
        return self.total - LOCKED_OFFSET if self.locked else self.total


def compounded(nominal: Decimal) -> Decimal:
    """Effective annual rate of a nominal rate charged monthly."""
    return (D("1") + nominal / D("12")) ** 12 - D("1")


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
    # GST is billed on each month's interest and, on a balance carried, earns
    # interest itself, so it compounds with it: (1 + r(1 + g)/12)^12 - 1 in all,
    # as the simulation and true_apr have it. Taken as interest × g, a 42%
    # card read 60.31% a year against the 62.6% it actually costs.
    gst = compounded(nominal_rate * (1 + GST_ON_CARD_INTEREST_IN)) - interest if card_gst else D("0")
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
        ok = itemises and itemised_share > 0 and debt_total < US_MORTGAGE_DEBT_LIMIT
        return marginal_rate if ok else D("0")
    if lt == "education_loan":
        return marginal_rate * phaseout_factor if interest_total < US_STUDENT_INTEREST_CAP else D("0")
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
    card_gst = loan.loan_type == LoanType.CREDIT_CARD and loan_market(loan, country) == Country.IN
    return marginal_cost(
        loan.nominal_rate,
        card_gst,
        shield_fraction,
        loan.prepayment_penalty_pct or D("0"),
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
    magi = user.annual_gross_salary or user.annual_business_income or None
    if own == Country.US and edu and magi is not None and edu_interest > 0:
        from engine.tax.usa import student_loan_interest_deduction
        allowed = student_loan_interest_deduction(min(edu_interest, US_STUDENT_INTEREST_CAP), magi,
                                                  user.filing_status or FilingStatusUS.SINGLE)
        phaseout = allowed / min(edu_interest, US_STUDENT_INTEREST_CAP)
    regime = (user.tax_regime.value if user.tax_regime is not None else "new")
    return home_interest, home_debt, edu_interest, phaseout, regime


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


def user_marginal_costs(loans: list[Loan], user, marginal_rate: Decimal, month: int = 1,
                        start_month: dict[int, int] | None = None) -> dict[int, MarginalCost]:
    """{id(loan): MarginalCost} for the open loans in `loans`, as of sim-month
    `month` (1 = today). Shared by the simulation, Spare cash and the API."""
    own = user.country
    home_interest, home_debt, edu_interest, phaseout, regime = _shield_context(loans, user)
    out: dict[int, MarginalCost] = {}
    for l in loans:
        if l.outstanding <= 0:
            continue
        is_home = l.loan_type == LoanType.HOME
        shield = marginal_shield(
            l.loan_type, own.value, marginal_rate, regime, bool(user.itemises), user.itemised_share,
            *_india_shield_args(l, own, regime, home_interest if is_home else edu_interest, month),
            home_debt, phaseout, **_india_shield_kwargs(l, own, regime, home_interest, month),
        )
        start = (start_month or {}).get(id(l), 1)
        elapsed = max(0, month - start)
        months_left = l.tenure_months_remaining - max(0, month - l.first_payment_month) if l.tenure_months_remaining > 0 else 0
        out[id(l)] = loan_marginal_cost(
            l, shield, own, months_left=months_left,
            lock_in_months=max(0, l.prepay_lock_in_months - elapsed),
        )
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
        out[id(l)] = marginal_shield(l.loan_type, own.value, marginal_rate, regime, bool(user.itemises),
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
    s = f"The next payment here saves {pct(mc.total)} a year: " + " ".join(parts)
    if mc.locked:
        s += f"; locked against prepayment for {mc.lock_in_months} more month{'' if mc.lock_in_months == 1 else 's'}"
    return s
