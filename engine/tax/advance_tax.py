"""Advance tax for a salaried person with income that has no TDS (round 2,
item 5; founder decision 15 Oct 2026).

Salary tax is deducted by the employer. Interest, capital gains, rent and
freelance income usually aren't (or only in part), and once the tax still
owed for the year after TDS is ₹10,000 or more it is payable in advance, in
four instalments. Before this module RightDue only showed advance tax for
business / irregular income.

Law (Income-tax Act, 2025, in force from 1 Apr 2026; 1961 numbers in []):
* s.404 [208]: advance tax is payable when the tax for the year, after TDS,
  is ₹10,000 or more. Income Tax Dept: "every person whose estimated tax
  liability for the year is Rs. 10,000 or more, shall pay his tax in
  advance"; a resident senior citizen (60 or over) with no business or
  profession income is not liable [207].
  https://www.incometaxindia.gov.in/w/is-a-resident-senior-citizen-granted-exemption-from-payment-of-advance-tax-
* Due dates (FAQ Q20): at least 15% by 15 June, 45% by 15 September, 75%
  by 15 December, 100% by 15 March; tax paid by 31 March also counts as
  advance tax. Presumptive income under s.58(2) [44AD / 44ADA]: the whole
  amount by 15 March (Q22).
* s.425 [234C] (Q21, Q25): simple interest at 1% a month — 3 months on
  (15% of assessed tax − paid by 15 Jun) if that is under 12%; 3 months on
  (45% − paid by 15 Sep) if under 36%; 3 months on (75% − paid by 15 Dec);
  1 month on (100% − paid by 15 Mar). Shortfalls from capital gains (and
  lottery winnings, first-time business income, dividends) are ignored if
  the tax on them is paid in the next instalments (Q27).
* s.424 [234B] (Q10–Q16): if advance tax paid is under 90% of the assessed
  tax, 1% a month (or part of a month) on the shortfall from 1 April after
  the year until the tax is paid.
  FAQs: https://www.incometaxindia.gov.in/documents/d/guest/faqs-on-interest-under-section-423-424-425-426
  (read 15 Oct 2026).
* Rounding for interest: the amount is rounded down to a multiple of ₹100
  (Income-tax Rules 1962, r.119A). VERIFY: the 2026 Rules' equivalent.
* Capital gains: equity short-term 20% (1961 s.111A), long-term 12.5% above
  ₹1.25 lakh a year (s.112A), from the Finance (No. 2) Act 2024. VERIFY the
  2025-Act section numbers. Other gains are taxed here at the slab rate (an
  assumption the panel labels). No surcharge on special-rate income and no
  set-off of unused exemption against gains are modelled.
* Rent: 30% standard deduction on the rent (s.22(1)(a) [24(a)]); municipal
  tax and home-loan interest on a let-out home aren't asked here.
* Freelance: presumptive (s.58(2) [44ADA]) = 50% of receipts is income;
  otherwise the whole amount (expenses not asked).

The tax on salary alone is taken as fully covered by the employer's TDS, so
the advance tax is what the other income adds, less any TDS on it. Neutral
by design: it states what is due and what skipping it costs.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date
from decimal import ROUND_DOWN, ROUND_HALF_UP, Decimal
from typing import Optional

from engine.models import TaxRegimeIN
from engine.tax.india import (
    CESS_RATE, STANDARD_DEDUCTION_NEW_SALARIED, STANDARD_DEDUCTION_OLD_SALARIED, income_tax,
)

D = Decimal

THRESHOLD = D("10000")
SENIOR_AGE = 60
STCG_EQUITY_RATE = D("0.20")
LTCG_EQUITY_RATE = D("0.125")
LTCG_EQUITY_EXEMPT = D("125000")
RENT_STANDARD_DEDUCTION = D("0.30")
PRESUMPTIVE_PROFESSION_SHARE = D("0.50")
INTEREST_RATE_MONTHLY = D("0.01")
# (due month, day, cumulative share due, share below which 234C applies, months of 234C)
INSTALMENTS = ((6, 15, D("0.15"), D("0.12"), 3), (9, 15, D("0.45"), D("0.36"), 3),
               (12, 15, D("0.75"), D("0.75"), 3), (3, 15, D("1.00"), D("1.00"), 1))
# Return due date for a non-audit individual (s.263(1) [139(1)]): 31 July.
RETURN_DUE = (7, 31)

FAQ_URL = "https://www.incometaxindia.gov.in/documents/d/guest/faqs-on-interest-under-section-423-424-425-426"
SENIOR_URL = ("https://www.incometaxindia.gov.in/w/is-a-resident-senior-citizen-granted-exemption-from-payment-"
              "of-advance-tax-")

KINDS = ("interest", "rent", "freelance", "capital_gains", "other")
CG_KINDS = ("equity_stcg", "equity_ltcg", "other")


class AdvanceTaxInputError(ValueError):
    def __init__(self, field_name: str, message: str):
        super().__init__(message)
        self.field = field_name


@dataclass
class OtherIncome:
    """One yearly source with no (or partial) TDS."""
    kind: str                         # KINDS
    gross_annual: Decimal
    tds_pct: Decimal = D("0")         # share of gross already deducted at source
    presumptive: bool = True          # freelance only: s.58(2) [44ADA] 50% deemed income
    cg_kind: str = "other"            # capital_gains only: CG_KINDS


@dataclass
class Instalment:
    due: date
    cumulative_share: Decimal
    amount: Decimal                   # due at this date (not cumulative)
    cumulative: Decimal


@dataclass
class AdvanceTaxResult:
    applies: bool
    liability: Decimal                # tax the other income adds, after its TDS (the advance tax)
    reason: str
    tax_total: Decimal
    tax_on_salary: Decimal
    tds_on_other: Decimal
    presumptive: bool
    fy_start: int
    instalments: list[Instalment] = field(default_factory=list)
    # If nothing is paid in advance and everything is paid by 31 July.
    interest_234c_if_unpaid: Decimal = D("0")
    interest_234b_if_unpaid: Decimal = D("0")
    assumptions: list[str] = field(default_factory=list)
    sources: dict[str, str] = field(default_factory=dict)

    @property
    def interest_if_unpaid(self) -> Decimal:
        return self.interest_234c_if_unpaid + self.interest_234b_if_unpaid


def _r(x: Decimal) -> Decimal:
    return x.quantize(D("1"), rounding=ROUND_HALF_UP)


def _floor100(x: Decimal) -> Decimal:
    """r.119A: the amount interest is charged on, rounded down to ₹100."""
    return (max(D("0"), x) / 100).to_integral_value(rounding=ROUND_DOWN) * 100


def fy_start_for(today: date) -> int:
    return today.year if today.month >= 4 else today.year - 1


def schedule(liability: Decimal, fy_start: int, presumptive: bool = False) -> list[Instalment]:
    """The year's instalments (all four, past ones included), amounts rounded
    to the rupee so they add up to the liability."""
    out: list[Instalment] = []
    prev = D("0")
    for month, day, share, _, _ in INSTALMENTS:
        if presumptive and share < 1:
            continue
        year = fy_start + 1 if month < 4 else fy_start
        cum = _r(liability * share)
        out.append(Instalment(date(year, month, day), share, cum - prev, cum))
        prev = cum
    return out


def interest_234c(assessed: Decimal, paid_by: list[Decimal], presumptive: bool = False) -> Decimal:
    """s.425 [234C]. `paid_by`: cumulative advance tax paid by 15 Jun, 15 Sep,
    15 Dec and 15 Mar (one figure, by 15 Mar, when `presumptive`)."""
    if assessed <= 0:
        return D("0")
    if presumptive:
        paid = paid_by[-1] if paid_by else D("0")
        return _floor100(assessed - paid) * INTEREST_RATE_MONTHLY if paid < assessed else D("0")
    if len(paid_by) != 4:
        raise AdvanceTaxInputError("paid_by", "Give what was paid by each of the four due dates.")
    total = D("0")
    for (_, _, share, floor_share, months), paid in zip(INSTALMENTS, paid_by):
        if paid < assessed * floor_share:
            total += _floor100(assessed * share - paid) * INTEREST_RATE_MONTHLY * months
    return total


def months_from_april(paid_on: date, fy_start: int) -> int:
    """Months (a part month counts as one) from 1 April after the year to
    `paid_on`; 0 if paid before then."""
    start = date(fy_start + 1, 4, 1)
    if paid_on < start:
        return 0
    return (paid_on.year - start.year) * 12 + (paid_on.month - start.month) + 1


def interest_234b(assessed: Decimal, advance_paid: Decimal, months: int) -> Decimal:
    """s.424 [234B]: none if 90% or more was paid in advance."""
    if assessed <= 0 or advance_paid >= assessed * D("0.9") or months <= 0:
        return D("0")
    return _floor100(assessed - advance_paid) * INTEREST_RATE_MONTHLY * months


def _validate(streams: list[OtherIncome]) -> None:
    for i, s in enumerate(streams):
        if s.kind not in KINDS:
            raise AdvanceTaxInputError(f"streams.{i}.kind", f"Kind must be one of {', '.join(KINDS)}.")
        if s.gross_annual < 0:
            raise AdvanceTaxInputError(f"streams.{i}.gross_annual", "Enter a yearly amount of 0 or more.")
        if not (D("0") <= s.tds_pct <= D("1")):
            raise AdvanceTaxInputError(f"streams.{i}.tds_pct", "TDS is a share from 0 to 100%.")
        if s.kind == "capital_gains" and s.cg_kind not in CG_KINDS:
            raise AdvanceTaxInputError(f"streams.{i}.cg_kind", f"Capital gains kind must be one of {', '.join(CG_KINDS)}.")


def salaried_advance_tax(
    annual_gross_salary: Decimal,
    streams: list[OtherIncome],
    regime: TaxRegimeIN = TaxRegimeIN.NEW,
    today: Optional[date] = None,
    age: Optional[int] = None,
    resident: bool = True,
) -> AdvanceTaxResult:
    """Whether advance tax applies to a salaried person's other income this
    tax year, how much, when, and what skipping it would cost."""
    _validate(streams)
    today = today or date.today()
    fy = fy_start_for(today)
    std = STANDARD_DEDUCTION_NEW_SALARIED if regime == TaxRegimeIN.NEW else STANDARD_DEDUCTION_OLD_SALARIED
    base = max(D("0"), D(annual_gross_salary) - std) if annual_gross_salary else D("0")
    slab_other = D("0")
    special = D("0")
    tds = D("0")
    business = False
    presumptive_all = True
    assumptions: list[str] = []
    stcg = ltcg = D("0")
    for s in streams:
        g = D(s.gross_annual)
        tds += g * D(s.tds_pct)
        if s.kind == "rent":
            slab_other += g * (1 - RENT_STANDARD_DEDUCTION)
        elif s.kind == "freelance":
            business = True
            if s.presumptive:
                slab_other += g * PRESUMPTIVE_PROFESSION_SHARE
            else:
                presumptive_all = False
                slab_other += g
                assumptions.append("Freelance income is counted in full: expenses aren't asked here.")
        elif s.kind == "capital_gains":
            if s.cg_kind == "equity_stcg":
                stcg += g
            elif s.cg_kind == "equity_ltcg":
                ltcg += g
            else:
                slab_other += g
                assumptions.append("Gains marked 'other' are taxed at your slab rate here.")
        else:
            slab_other += g
    special = stcg * STCG_EQUITY_RATE + max(D("0"), ltcg - LTCG_EQUITY_EXEMPT) * LTCG_EQUITY_RATE
    tax_salary = income_tax(base, regime)
    tax_total = income_tax(base + slab_other, regime) + special * (1 + CESS_RATE)
    liability = _r(max(D("0"), tax_total - tax_salary - tds))
    presumptive = business and presumptive_all and any(s.kind == "freelance" for s in streams)
    senior_exempt = resident and age is not None and age >= SENIOR_AGE and not business
    if senior_exempt:
        applies, reason = False, ("Not due: a resident aged 60 or more with no business or profession income "
                                  "doesn't pay advance tax; pay it with the return.")
    elif liability >= THRESHOLD:
        applies, reason = True, ("Due: the tax on your income without TDS is ₹10,000 or more this year, so it "
                                 "is paid in advance in instalments.")
    else:
        applies, reason = False, "Not due: the tax still owed after TDS is under ₹10,000 this year."
    out = AdvanceTaxResult(
        applies=applies, liability=liability, reason=reason, tax_total=_r(tax_total), tax_on_salary=_r(tax_salary),
        tds_on_other=_r(tds), presumptive=presumptive, fy_start=fy,
        assumptions=["Your salary's tax is taken as fully covered by your employer's TDS."] + assumptions,
        sources={"due_dates_and_interest": FAQ_URL, "senior_citizens": SENIOR_URL},
    )
    if applies:
        out.instalments = schedule(liability, fy, presumptive)
        zeros = [D("0")] * (1 if presumptive else 4)
        out.interest_234c_if_unpaid = interest_234c(liability, zeros, presumptive)
        out.interest_234b_if_unpaid = interest_234b(liability, D("0"), months_from_april(date(fy + 1, *RETURN_DUE), fy))
    return out
