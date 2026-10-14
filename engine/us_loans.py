"""US-specific loan rules: federal student loans, mortgage insurance (PMI /
FHA MIP), and how each state treats mortgage interest (grill #33, #34, #79).

Every rule below names its primary source and the date it was read. Nothing
here is a lender-specific number: the user enters their own PMI amount,
home value and loan details from their statements.

Sources (read 2026-10-12):
- PSLF: 120 qualifying payments while working full time for a government or
  qualifying not-for-profit employer; Direct Loans only; Tiered Standard
  plan payments don't count. https://studentaid.gov/manage-loans/forgiveness-cancellation/public-service
- IDR plans after the One Big Beautiful Bill Act (P.L. 119-21): RAP (1-10% of
  AGI / 12, minus $50 per dependent, 30 years) opened 1 July 2026; IBR 20/25
  years; ICR and PAYE end no later than 1 July 2028; loans first disbursed on
  or after 1 July 2026 can use only RAP or the Tiered Standard plan; the
  SAVE plan was ended by court order on 10 March 2026.
  https://studentaid.gov/manage-loans/repayment/plans/income-driven
  https://studentaid.gov/announcements-events/big-updates
- Private refinancing of federal loans gives up IDR, PSLF and other federal
  protections: CFPB, https://www.consumerfinance.gov/paying-for-college/repay-student-debt/federal-and-private-student-loans
- Tax on forgiveness: IDR forgiveness after 31 Dec 2025 is generally taxable
  income (the ARPA exclusion expired); PSLF, Teacher Loan Forgiveness and
  death/disability discharges are not. Taxpayer Advocate Service, Mar 2026,
  https://www.taxpayeradvocate.irs.gov/news/tax-tips/what-to-know-about-student-loan-forgiveness-and-your-taxes/2026/03
  and IRS Pub 4681 (2025), https://www.irs.gov/publications/p4681
- PMI (Homeowners Protection Act, loans closed on or after 29 July 1999):
  ask to cancel when the balance reaches 80% of the home's original value
  (sooner by paying extra); automatic end when the balance is SCHEDULED to
  reach 78%; final end at the loan's midpoint. "Original value" = the lower
  of the sales price and the appraisal at purchase. Conditions for a request:
  in writing, good payment history, no junior liens, and evidence the value
  hasn't fallen. FHA and VA loans follow different rules.
  CFPB, https://www.consumerfinance.gov/ask-cfpb/when-can-i-remove-private-mortgage-insurance-pmi-from-my-loan-en-202/
- FHA annual MIP (case numbers from 3 June 2013): LTV at origination above
  90% -> paid for the loan term (max 30 years); 90% or less -> 11 years.
  HUD, https://answers.hud.gov/FHA/s/article/How-long-is-MIP-collected-for-case-numbers-assigned-on-or-after-June-3-2013
- Mortgage insurance premiums deductible again as mortgage interest for tax
  year 2026 (itemisers; phased out above $100,000 AGI, gone above $109,000;
  half those for married filing separately). IRS Pub 936 (2026 draft),
  https://www.irs.gov/pub/irs-dft/p936--dft.pdf
- States: no individual income tax in 2026 in AK, FL, NV, NH, SD, TN, TX, WA
  (WA taxes only capital gains), WY. Tax Foundation, 2026 State Income Tax
  Rates, https://taxfoundation.org/data/all/state/state-income-tax-rates-2026/
  and NH DRA (interest & dividends tax repealed from 1 Jan 2025),
  https://www.revenue.nh.gov/news-and-media/repeal-nh-interest-and-dividends-tax-now-effect
  Pennsylvania allows no itemised deductions (mortgage interest included)
  and has no student-loan-interest deduction: PA DOR,
  https://www.pa.gov/agencies/revenue/forms-and-publications/pa-personal-income-tax-guide/deductions-and-credits
  Massachusetts does not adopt the IRC s.163 interest deduction except for
  rental or business debt (G.L. c.62 s.2(d)): MA DOR Directive 86-8,
  https://www.mass.gov/directive/directive-86-8-interest-expenses
  Every other state: not verified here, so it is labelled "check your state"
  rather than modelled.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from decimal import Decimal
from typing import Optional

from engine.models import Loan, LoanType

D = Decimal
AS_OF = "2026-10-12"

# ── Student loans ────────────────────────────────────────────────────────────
STUDENT_LOAN_KINDS = ("federal", "private")
FORGIVENESS_TRACKS = ("pslf", "idr")
# E7 (audit 80): the user's answer to "on PSLF or an income-driven plan?".
# "none" = no, paying it off; "unsure" (or no answer at all) = not known
# yet, so extra is held off until they say: prepaying a loan that will be
# forgiven is money lost, while waiting a month on a loan that won't be
# costs a month of interest at a (usually low) federal rate.
FORGIVENESS_ANSWERS = FORGIVENESS_TRACKS + ("none", "unsure")

PSLF_QUALIFYING_PAYMENTS = 120
RAP_REPAYMENT_YEARS = 30
NEW_LOAN_PLAN_CUTOFF = "2026-07-01"   # loans first disbursed on/after: RAP or Tiered Standard only

SOURCES = {
    "pslf": "https://studentaid.gov/manage-loans/forgiveness-cancellation/public-service",
    "idr": "https://studentaid.gov/manage-loans/repayment/plans/income-driven",
    "obbba": "https://studentaid.gov/announcements-events/big-updates",
    "refi": "https://www.consumerfinance.gov/paying-for-college/repay-student-debt/federal-and-private-student-loans",
    "forgiveness_tax": "https://www.taxpayeradvocate.irs.gov/news/tax-tips/what-to-know-about-student-loan-forgiveness-and-your-taxes/2026/03",
    "pmi": "https://www.consumerfinance.gov/ask-cfpb/when-can-i-remove-private-mortgage-insurance-pmi-from-my-loan-en-202/",
    "fha_mip": "https://answers.hud.gov/FHA/s/article/How-long-is-MIP-collected-for-case-numbers-assigned-on-or-after-June-3-2013",
    "pmi_deduction": "https://www.irs.gov/pub/irs-dft/p936--dft.pdf",
    "no_income_tax": "https://taxfoundation.org/data/all/state/state-income-tax-rates-2026/",
    "nh": "https://www.revenue.nh.gov/news-and-media/repeal-nh-interest-and-dividends-tax-now-effect",
    "pa": "https://www.pa.gov/agencies/revenue/forms-and-publications/pa-personal-income-tax-guide/deductions-and-credits",
    "ma": "https://www.mass.gov/directive/directive-86-8-interest-expenses",
}


def is_us_market(loan: Loan, country) -> bool:
    """A dollar loan, or a loan with no currency held by a US resident."""
    c = (loan.currency or "").upper()
    if c:
        return c == "USD"
    return getattr(country, "value", country) == "US"


def is_federal_or_unknown_student_loan(loan: Loan, country) -> bool:
    """A US student loan we must treat as federal: marked federal, or not
    marked at all (most US student debt is federal, so "unknown" gets the
    protective reading)."""
    return (
        loan.loan_type == LoanType.EDUCATION
        and is_us_market(loan, country)
        and (loan.student_loan_kind or "") != "private"
    )


def on_forgiveness_track(loan: Loan) -> bool:
    """A federal student loan the user says is heading for PSLF or IDR
    forgiveness. Paying extra on it only shrinks what would be forgiven."""
    return (
        loan.loan_type == LoanType.EDUCATION
        and (loan.student_loan_kind or "federal") != "private"
        and (loan.currency or "").upper() != "INR"
        and (loan.forgiveness_track or "") in FORGIVENESS_TRACKS
    )


def forgiveness_answer_pending(loan: Loan, country=None) -> bool:
    """A US federal (or unmarked) student loan whose forgiveness answer
    isn't in yet (E7): never asked, or "not sure". Private loans and loans
    the user said are not on PSLF/IDR ("none") are not pending. Without
    `country`, only an explicitly dollar loan counts as US."""
    if loan.loan_type != LoanType.EDUCATION or (loan.student_loan_kind or "") == "private":
        return False
    if (loan.forgiveness_track or "") not in ("", "unsure"):
        return False
    if country is None:
        return (loan.currency or "").upper() == "USD"
    return is_us_market(loan, country)


PENDING_HOLD_REASON = (
    "isn't marked yet as federal or private, or as on PSLF or an income-driven plan, so extra "
    "payments are held off it until you say: on a loan heading for forgiveness they're money "
    "lost. Its required payment still goes"
)


def forgiveness_prepay_block(loan: Loan, country=None) -> Optional[str]:
    """Why extra payments are held off this loan, or None. Same gate in the
    plan simulator and the one-off windfall split. With `country` (the
    user's), a loan outside the US market is never held.

    E7 (audit 80): a US federal or unmarked student loan with no answer yet
    on PSLF / income-driven repayment is held too, until the user answers."""
    if forgiveness_answer_pending(loan, country):
        return PENDING_HOLD_REASON
    if not on_forgiveness_track(loan):
        return None
    if country is not None and not is_us_market(loan, country):
        return None
    if loan.forgiveness_track == "pslf":
        return ("is on track for Public Service Loan Forgiveness, so extra payments only shrink "
                "what would be forgiven tax-free; it gets its required payment and no more")
    return ("is on an income-driven plan you expect to end in forgiveness, so extra payments only "
            "shrink what would be forgiven; it gets its required payment and no more")


def refinance_note(loan: Loan) -> str:
    """Plain-words reason a federal (or unmarked) US student loan is never
    offered a private refinance or consolidation."""
    return (
        "Not suggested: moving a federal student loan to a private lender ends its federal "
        "protections for good: income-driven plans such as RAP and IBR, Public Service Loan "
        "Forgiveness, and federal deferment and forbearance (CFPB). If this loan is private, "
        "mark it private on your profile."
    )


def student_loan_explainer(loan: Loan) -> list[str]:
    """Short lines for the loan card: what the federal/private choice and the
    forgiveness track change, with the 2026 rules."""
    out: list[str] = []
    kind = loan.student_loan_kind or ""
    track = loan.forgiveness_track or ""
    if kind == "private":
        out.append("Private student loan: no federal repayment plans or forgiveness, so it is "
                   "paid off like any other loan, and refinancing it can make sense.")
        return out
    if not kind:
        out.append("Not marked federal or private yet. We treat it as federal (most US student "
                   "debt is), so we never suggest refinancing it with a private lender. Your loans "
                   "are listed on studentaid.gov if you're not sure.")
    if track == "pslf":
        out.append("PSLF: the rest is forgiven after 120 qualifying payments while you work full "
                   "time for a government or not-for-profit employer, and PSLF forgiveness isn't "
                   "taxed. Extra payments are held off this loan; your required payment still goes.")
    elif track == "idr":
        out.append("Income-driven forgiveness: what's left is forgiven after 20, 25 or 30 years "
                   "(RAP is 30). Since 1 January 2026 that forgiven amount is generally taxable "
                   "income, so set some money aside for it. Extra payments are held off this loan.")
    elif track in ("", "unsure") and (loan.currency or "").upper() != "INR":
        out.append("Not yet answered: is it on PSLF or an income-driven plan? Until you say, extra "
                   "payments are held off this loan (on a loan that will be forgiven they're money "
                   "lost). PSLF needs a government or not-for-profit employer; payments on the "
                   "Tiered Standard plan don't count toward it.")
    else:
        out.append("Federal loan, not on a forgiveness track: it's treated like any other loan in "
                   "the payoff order. Since 1 July 2026 the income-driven plans are RAP and IBR "
                   "(ICR and PAYE close by July 2028); loans taken from 1 July 2026 can use only "
                   "RAP or the Tiered Standard plan.")
    return out


# ── Mortgage insurance ───────────────────────────────────────────────────────
PMI_REQUEST_LTV = D("0.80")   # borrower may ask to cancel (HPA)
PMI_AUTO_LTV = D("0.78")      # servicer must end it on the scheduled date (HPA)
FHA_LOW_LTV = D("0.90")       # at or below: MIP for 11 years; above: loan term
FHA_SHORT_YEARS = 11
PMI_DEDUCTION_AGI_START = D("100000")
PMI_DEDUCTION_AGI_END = D("109000")
MI_KINDS = ("pmi", "fha_mip")


def mortgage_insurance_kind(loan: Loan) -> Optional[str]:
    if loan.loan_type != LoanType.HOME or (loan.pmi_monthly or D("0")) <= 0:
        return None
    return loan.mortgage_insurance_kind or "pmi"


def pmi_due(loan: Loan) -> Decimal:
    """This month's mortgage insurance on the loan, in the loan's currency.

    Conventional PMI stops once the balance is at or below 80% of the
    original value (we assume the user asks the servicer, the earliest legal
    date; we can't check payment history, liens or the appraisal). With no
    original value entered it runs while the loan does. FHA MIP doesn't
    follow loan-to-value: it runs for `pmi_months_remaining` months when
    entered, else for the life of the loan."""
    kind = mortgage_insurance_kind(loan)
    if kind is None or loan.outstanding <= 0:
        return D("0")
    if loan.pmi_months_remaining is not None and loan.pmi_months_remaining <= 0:
        return D("0")
    if kind == "pmi" and loan.original_home_value and loan.original_home_value > 0:
        if loan.outstanding <= PMI_REQUEST_LTV * loan.original_home_value:
            return D("0")
    return loan.pmi_monthly


def _months_until(balance: Decimal, rate: Decimal, payment: Decimal, target: Decimal,
                  cap: int = 1200) -> Optional[int]:
    """Months of scheduled payments until `balance` is at or below `target`."""
    if balance <= target:
        return 0
    r = rate / D("12")
    b = balance
    for m in range(1, cap + 1):
        b = b + b * r - payment
        if b <= target:
            return m
        if b >= balance and m > 1 and payment <= balance * r:
            return None
    return None


@dataclass
class PmiAnalysis:
    kind: str                                # "pmi" | "fha_mip"
    monthly: Decimal
    annual: Decimal
    request_balance: Optional[Decimal] = None   # 80% of original value
    auto_balance: Optional[Decimal] = None      # 78% of original value
    extra_to_request_now: Optional[Decimal] = None
    months_to_request: Optional[int] = None     # on the current payment
    months_to_auto: Optional[int] = None
    # PMI saved by reaching 80% now instead of on schedule, over the extra needed:
    # a return on that extra, on top of the mortgage interest it also saves.
    pmi_saved_by_paying_now: Optional[Decimal] = None
    pmi_return_pct: Optional[Decimal] = None
    notes: list[str] = field(default_factory=list)


def pmi_analysis(loan: Loan) -> Optional[PmiAnalysis]:
    kind = mortgage_insurance_kind(loan)
    if kind is None:
        return None
    monthly = loan.pmi_monthly
    a = PmiAnalysis(kind=kind, monthly=monthly, annual=monthly * 12)
    if kind == "fha_mip":
        a.notes.append(
            "FHA mortgage insurance doesn't end at 80% or 78%. For FHA loans from 3 June 2013 it runs "
            "11 years if you borrowed 90% or less of the home's value, otherwise for the loan's term "
            "(HUD). Refinancing to a conventional loan is the usual way out; that's a big decision "
            "with its own costs."
        )
        if loan.pmi_months_remaining:
            a.notes.append(f"You entered {loan.pmi_months_remaining} months of MIP left.")
        return a
    v = loan.original_home_value
    if not v or v <= 0:
        a.notes.append("Add the home's original value (the lower of the price and the appraisal when you "
                       "bought it) to see when PMI can end.")
        return a
    a.request_balance = (PMI_REQUEST_LTV * v).quantize(D("0.01"))
    a.auto_balance = (PMI_AUTO_LTV * v).quantize(D("0.01"))
    a.extra_to_request_now = max(D("0"), loan.outstanding - a.request_balance).quantize(D("0.01"))
    a.months_to_request = _months_until(loan.outstanding, loan.nominal_rate, loan.scheduled_emi, a.request_balance)
    a.months_to_auto = _months_until(loan.outstanding, loan.nominal_rate, loan.scheduled_emi, a.auto_balance)
    if a.extra_to_request_now > 0 and a.months_to_request:
        a.pmi_saved_by_paying_now = (monthly * a.months_to_request).quantize(D("0.01"))
        # While it makes the difference, each year the extra ends PMI early
        # saves a year of premiums: a yearly return of annual PMI / extra.
        a.pmi_return_pct = (a.annual / a.extra_to_request_now).quantize(D("0.0001"))
    a.notes.append(
        "You can ask your servicer in writing to cancel PMI once the balance is 80% of the original "
        "value, earlier if you pay extra. You need a good payment history, no second mortgage, and "
        "possibly an appraisal showing the value hasn't fallen. It ends on its own when the balance "
        "is scheduled to reach 78%, and at the loan's halfway point at the latest (CFPB)."
    )
    a.notes.append(
        "For 2026, PMI counts as deductible mortgage interest if you itemise and your AGI is $100,000 "
        "or less (phased out up to $109,000). The plan doesn't take that into account."
    )
    return a


ESCROW_NOTE = (
    "Enter the payment as principal and interest only. Escrow (property tax and home insurance the "
    "servicer collects with it) goes in your monthly fixed expenses, and PMI in its own field, so "
    "the plan can drop PMI when it ends."
)


# ── State treatment of mortgage interest ────────────────────────────────────
NO_INCOME_TAX_STATES = ("AK", "FL", "NV", "NH", "SD", "TN", "TX", "WA", "WY")
NO_MORTGAGE_DEDUCTION_STATES = {"PA": "pa", "MA": "ma"}


@dataclass(frozen=True)
class StateMortgageTreatment:
    state: Optional[str]
    kind: str          # "no_income_tax" | "no_deduction" | "unverified" | "unknown"
    modelled: bool     # True: the plan uses it; False: labelled only
    label: str
    source_url: Optional[str]


def state_mortgage_treatment(state: Optional[str]) -> StateMortgageTreatment:
    s = (state or "").strip().upper()
    if not s:
        return StateMortgageTreatment(None, "unknown", False,
                                      "Add your state to see whether it taxes income and lets you deduct "
                                      "mortgage interest.", None)
    if s in NO_INCOME_TAX_STATES:
        src = SOURCES["nh"] if s == "NH" else SOURCES["no_income_tax"]
        return StateMortgageTreatment(s, "no_income_tax", True,
                                      f"{s} has no state income tax on wages, so mortgage interest saves "
                                      "only federal tax.", src)
    if s in NO_MORTGAGE_DEDUCTION_STATES:
        return StateMortgageTreatment(s, "no_deduction", True,
                                      f"{s} doesn't let you deduct home mortgage interest, so it saves "
                                      "only federal tax.", SOURCES[NO_MORTGAGE_DEDUCTION_STATES[s]])
    return StateMortgageTreatment(s, "unverified", False,
                                  f"State rules vary and we haven't verified {s}'s: the plan assumes your "
                                  "state lets you deduct mortgage interest at your state rate. Check your "
                                  "state's income-tax instructions.", None)


def us_mortgage_marginal_rate(marginal_rate: Decimal, state: Optional[str],
                              state_rate: Decimal) -> Decimal:
    """The rate a US mortgage's interest saves tax at. The caller's
    `marginal_rate` is federal + state; in a state with no income tax, or
    one that disallows mortgage interest, the state part saves nothing."""
    t = state_mortgage_treatment(state)
    if t.kind in ("no_income_tax", "no_deduction"):
        return max(D("0"), marginal_rate - (state_rate or D("0")))
    return marginal_rate
