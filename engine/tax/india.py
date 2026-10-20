"""India income tax: tax year 2026-27 (what was FY 2026-27).

The Income-tax Act, 2025 (30 of 2025) replaced the 1961 Act from 1 April
2026. Re-checked 12 Oct 2026 against primary sources (sprint G2):
- New-regime slabs: s.202(1) Table of the Act as amended by the Finance
  Act, 2026 (TAX_LAW_SOURCE). Rebate: s.156 (₹60,000 to ₹12L new, with the
  s.156(2)(b) marginal relief; ₹12,500 to ₹5L old). Standard deduction:
  s.19(1) Table Sl. 2 (₹75,000 new, ₹50,000 old).
- Old-regime slabs and the surcharge bands for tax year 2026-27: Finance
  Act, 2026, First Schedule Part I-B (TAX_RATES_SOURCE); the new regime's
  surcharge stops at 25% (Finance Act 2026 s.2(4)(b) Table Sl. 10).
Budget 2026 kept the FY 2025-26 rates.
"""
from decimal import Decimal
from engine.models import TaxRegimeIN

D = Decimal

# ── FY2026-27 slabs (decimals) ───────────────────────────────────────────────
NEW_REGIME_SLABS = [
    (D("400000"),     D("0.00")),
    (D("800000"),     D("0.05")),
    (D("1200000"),    D("0.10")),
    (D("1600000"),    D("0.15")),
    (D("2000000"),    D("0.20")),
    (D("2400000"),    D("0.25")),
    (D("Infinity"),   D("0.30")),
]
OLD_REGIME_SLABS = [
    (D("250000"),     D("0.00")),
    (D("500000"),     D("0.05")),
    (D("1000000"),    D("0.20")),
    (D("Infinity"),   D("0.30")),
]

# 87A rebate
REBATE_87A_NEW = D("60000")          # Tax becomes ₹0 if taxable_income ≤ ₹12L (new regime)
REBATE_87A_NEW_THRESHOLD = D("1200000")
REBATE_87A_OLD = D("12500")          # Old regime: tax becomes ₹0 if taxable_income ≤ ₹5L
REBATE_87A_OLD_THRESHOLD = D("500000")

# Standard deductions
STANDARD_DEDUCTION_NEW_SALARIED = D("75000")
STANDARD_DEDUCTION_OLD_SALARIED = D("50000")

# Surcharge (applies to tax; capped at 25% for LTCG/special-rate income)
SURCHARGE_BANDS = [
    (D("5000000"),    D("0.00")),
    (D("10000000"),   D("0.10")),
    (D("20000000"),   D("0.15")),
    (D("50000000"),   D("0.25")),
    (D("Infinity"),   D("0.37")),
]
SURCHARGE_CAP_LTCG = D("0.15")   # Finance Act 2022: surcharge on all LTCG capped at 15%
# Finance Act 2023: under the new regime (s.115BAC) the 37% band is capped
# at 25% (P2-01). Income Tax Dept: "25% in case assessee opted for new tax
# regime under section 115BAC".
SURCHARGE_CAP_NEW_REGIME = D("0.25")

CESS_RATE = D("0.04")                # Health & education cess


def _slab_tax(taxable_income: Decimal, slabs) -> Decimal:
    """Compute slab-based tax (no surcharge, no cess, no rebate)."""
    tax = D("0")
    prev_limit = D("0")
    for limit, rate in slabs:
        if taxable_income <= prev_limit:
            break
        chunk = min(taxable_income, limit) - prev_limit
        tax += chunk * rate
        prev_limit = limit
    return tax


def surcharge_rate(
    taxable_income: Decimal,
    is_ltcg: bool = False,
    regime: TaxRegimeIN | None = None,
) -> Decimal:
    """Surcharge rate based on income band. LTCG capped at 25%; the new
    regime caps every band at 25% (no 37%)."""
    for limit, rate in SURCHARGE_BANDS:
        if taxable_income <= limit:
            if is_ltcg:
                rate = min(rate, SURCHARGE_CAP_LTCG)
            if regime == TaxRegimeIN.NEW:
                rate = min(rate, SURCHARGE_CAP_NEW_REGIME)
            return rate
    return D("0")


def _tax_before_surcharge(taxable_income: Decimal, regime: TaxRegimeIN) -> Decimal:
    """Slab tax after the 87A rebate (and its new-regime marginal relief)."""
    slabs = NEW_REGIME_SLABS if regime == TaxRegimeIN.NEW else OLD_REGIME_SLABS
    tax = _slab_tax(taxable_income, slabs)
    if regime == TaxRegimeIN.NEW and taxable_income <= REBATE_87A_NEW_THRESHOLD:
        tax = max(D("0"), tax - REBATE_87A_NEW)
    elif regime == TaxRegimeIN.NEW:
        # Marginal relief (s.87A proviso, new regime): just above the ₹12L
        # line the tax can't exceed the income above it. Without it ₹12.1L
        # was taxed ₹63,960 instead of ₹10,400. Runs out near ₹12.71L.
        tax = min(tax, taxable_income - REBATE_87A_NEW_THRESHOLD)
    elif regime == TaxRegimeIN.OLD and taxable_income <= REBATE_87A_OLD_THRESHOLD:
        tax = max(D("0"), tax - REBATE_87A_OLD)
    return max(D("0"), tax)


SURCHARGE_THRESHOLDS = [D("5000000"), D("10000000"), D("20000000"), D("50000000")]


def income_tax(
    taxable_income: Decimal,
    regime: TaxRegimeIN,
    is_salaried: bool = True,
) -> Decimal:
    """Total income tax for FY2026-27: slab tax (less 87A rebate) × (1 + surcharge) × 1.04.

    Surcharge marginal relief (P2-02): just above ₹50L / ₹1Cr / ₹2Cr / ₹5Cr
    the tax plus surcharge can't exceed the tax at the threshold plus the
    income above it. Without it ₹1,000 more income cost ₹1.12 lakh at ₹50L.
    """
    tax = _tax_before_surcharge(taxable_income, regime)
    if tax <= 0:
        return D("0")
    surcharge = surcharge_rate(taxable_income, regime=regime)
    with_surcharge = tax * (D("1") + surcharge)
    below = [t for t in SURCHARGE_THRESHOLDS if t < taxable_income]
    if below and surcharge > 0:
        t = below[-1]
        at_t = _tax_before_surcharge(t, regime) * (D("1") + surcharge_rate(t, regime=regime))
        with_surcharge = min(with_surcharge, at_t + (taxable_income - t))
    return with_surcharge * (D("1") + CESS_RATE)


def marginal_rate(taxable_income: Decimal, regime: TaxRegimeIN) -> Decimal:
    """Effective marginal rate at given income: slab_rate × (1+surcharge) × 1.04.

    At or below the 87A line (₹12L new regime, ₹5L old) the rebate cancels
    the tax, so the next rupee, and a deduction's saving, is taxed at 0; it
    used to read 10.4% (new) or 5.2% (old).

    Just above the new-regime line, marginal relief taxes each extra rupee
    at ~104% until about ₹12.71L. That is not returned here (a rate above
    100% would make a loan's tax shield worth more than its interest); the
    slab rate stands in. (Nothing warns the user about the cliff yet.)
    """
    if regime == TaxRegimeIN.NEW and taxable_income <= REBATE_87A_NEW_THRESHOLD:
        return D("0")
    if regime == TaxRegimeIN.OLD and taxable_income <= REBATE_87A_OLD_THRESHOLD:
        return D("0")
    slabs = NEW_REGIME_SLABS if regime == TaxRegimeIN.NEW else OLD_REGIME_SLABS
    base = D("0")
    prev = D("0")
    for limit, rate in slabs:
        if taxable_income > prev and taxable_income <= limit:
            base = rate
            break
        prev = limit
    surcharge = surcharge_rate(taxable_income, regime=regime)
    return base * (D("1") + surcharge) * (D("1") + CESS_RATE)


# ═════════════════════════════════════════════════════════════════════════════
# Loan-related deductions and the old-vs-new regime comparison (sprint G2).
#
# Law: the Income-tax Act, 2025 (30 of 2025) replaced the Income-tax Act,
# 1961 from 1 April 2026; "tax year" 2026-27 is what used to be FY 2026-27 /
# AY 2027-28. Every figure below was read in the Act as amended by the
# Finance Act, 2026 (incometaxindia.gov.in, "income_tax_act_2025_as_amended
# _by_fa_act_2026", fetched 12 Oct 2026) and, for the slab rates, in the
# First Schedule to the Finance Act, 2026, Part I-B
# (https://www.incometaxindia.gov.in/w/first-schedule-104, fetched 12 Oct
# 2026). docs/TAX_INDIA.md quotes the clauses. The 1961 numbers people still
# use are kept beside the new ones (SECTION_MAP) because the FY 2025-26
# return filed in 2026 still uses them.
# ═════════════════════════════════════════════════════════════════════════════

TAX_LAW_AS_OF = "Income-tax Act, 2025 as amended by the Finance Act, 2026 · tax year 2026-27 · read 12 Oct 2026"
TAX_LAW_SOURCE = "https://www.incometaxindia.gov.in/documents/d/guest/income_tax_act_2025_as_amended_by_fa_act_2026-pdf"
TAX_RATES_SOURCE = "https://www.incometaxindia.gov.in/w/first-schedule-104"

# 1961 section → 2025 section, for every rule the app uses (CBDT's own
# navigator and the Act's text; docs/TAX_INDIA.md).
SECTION_MAP: dict[str, str] = {
    "24(b)": "22(1)(b) and 22(2)",              # home-loan interest; ₹2L self-occupied cap
    "24(b) pre-construction": "22(1)(c)",       # five equal instalments
    "24(a)": "22(1)(a)",                        # 30% of annual value
    "23(2)": "21(6)",                           # self-occupied: annual value nil
    "26": "24",                                 # co-owners each get the relief
    "71(3A)": "109(1)(b)",                      # house-property loss set-off ₹2L
    "80C": "123 + Schedule XV",                 # ₹1.5L; home-loan principal = Sch XV para 1(r), 3
    "80CCD(1B)": "124",
    "80D": "126",
    "80E": "129",                               # education-loan interest, 8 tax years
    "87A": "156",
    "115BAC": "202",                            # new regime (default); opt-out 202(4)
    "16(ia)": "19(1) Table Sl. 2",              # standard deduction ₹75k new / ₹50k old
    "139(1)": "263(1)",                         # return due date
}


# s.22(2)(a) [1961: s.24(b) 2nd proviso]: interest on a self-occupied home,
# ₹2,00,000 a year in all (s.22(5)), if the house was bought or built with
# the loan within 5 years from the end of the tax year it was borrowed in.
SEC24B_SELF_OCCUPIED_CAP = D("200000")
# s.22(2)(b): ₹30,000 in any other case (construction late, repair loans).
SEC24B_OTHER_CAP = D("30000")
# s.22(1)(a) [1961: s.24(a)]: 30% of the annual value of a let-out house.
LET_OUT_STANDARD_DEDUCTION = D("0.30")
# s.109(1)(b) [1961: s.71(3A)]: a house-property loss is set off against
# other income only up to ₹2,00,000 (old regime). s.202(2)(b)(ii): none in
# the new regime.
HP_LOSS_SET_OFF_CAP = D("200000")
# s.123 [1961: s.80C]: ₹1,50,000 across Schedule XV items, home-loan
# principal included (Schedule XV para 1(r) and 3(a)(iii)).
SEC80C_CAP = D("150000")
SEC80CCD1B_CAP = D("50000")
# s.129(2) [1961: s.80E(3)]: the initial tax year (when interest is first
# paid) and the seven after it, or until the interest is paid, if sooner.
SEC80E_TAX_YEARS = 8
# s.22(1)(c) [1961: Explanation to s.24(b)]: interest for the years before
# the house was bought or finished, in five equal instalments from the
# year it was finished. Since 1 Apr 2026 (Finance Act 2026) s.22(2) counts
# these instalments inside the ₹2L self-occupied cap.
PRE_CONSTRUCTION_INSTALMENTS = 5

# Old regime for residents aged 60–79 / 80+ (First Schedule Part I-B,
# Paragraph A (II), (III)). The new regime has one table for every age.
OLD_REGIME_SLABS_60_79 = [
    (D("300000"),     D("0.00")),
    (D("500000"),     D("0.05")),
    (D("1000000"),    D("0.20")),
    (D("Infinity"),   D("0.30")),
]
OLD_REGIME_SLABS_80_PLUS = [
    (D("500000"),     D("0.00")),
    (D("1000000"),    D("0.20")),
    (D("Infinity"),   D("0.30")),
]


def old_regime_slabs(age: str | None = None):
    """'60_79' / '80_plus' get the senior tables; anything else the main one."""
    if age == "80_plus":
        return OLD_REGIME_SLABS_80_PLUS
    if age == "60_79":
        return OLD_REGIME_SLABS_60_79
    return OLD_REGIME_SLABS


def income_tax_for_age(taxable_income: Decimal, regime: TaxRegimeIN, age: str | None = None) -> Decimal:
    """`income_tax` with the senior-citizen old-regime tables. Same rebate
    (s.156(1): ≤ ₹5L, ₹12,500), surcharge relief and cess."""
    if regime != TaxRegimeIN.OLD or old_regime_slabs(age) is OLD_REGIME_SLABS:
        return income_tax(taxable_income, regime)
    slabs = old_regime_slabs(age)

    def before(ti: Decimal) -> Decimal:
        t = _slab_tax(ti, slabs)
        if ti <= REBATE_87A_OLD_THRESHOLD:
            t = max(D("0"), t - REBATE_87A_OLD)
        return max(D("0"), t)

    tax = before(taxable_income)
    if tax <= 0:
        return D("0")
    s = surcharge_rate(taxable_income, regime=regime)
    with_s = tax * (D("1") + s)
    below = [t for t in SURCHARGE_THRESHOLDS if t < taxable_income]
    if below and s > 0:
        t = below[-1]
        with_s = min(with_s, before(t) * (D("1") + surcharge_rate(t, regime=regime)) + (taxable_income - t))
    return with_s * (D("1") + CESS_RATE)


def self_occupied_cap(regime: TaxRegimeIN, full_cap: bool = True) -> Decimal:
    """Interest on self-occupied homes that lowers tax in a year: ₹2L
    (₹30k if the house wasn't finished within 5 years of borrowing) in the
    old regime; nothing in the new one (s.202(2)(a)(v))."""
    if regime != TaxRegimeIN.OLD:
        return D("0")
    return SEC24B_SELF_OCCUPIED_CAP if full_cap else SEC24B_OTHER_CAP


def let_out_room(
    regime: TaxRegimeIN,
    annual_rent: Decimal | None,
    share: Decimal = D("1"),
    municipal_tax: Decimal = D("0"),
    set_off_used: Decimal = D("0"),
) -> Decimal:
    """Interest on a let-out home that lowers tax in a year. There's no cap
    on the interest itself: it is deducted from the rent (after municipal
    tax and the 30% standard deduction, s.22(1)(a)), and what's left over
    as a loss can lower other income only up to ₹2L in the old regime
    (s.109(1)(b)) and not at all in the new one (s.202(2)(b)(ii)).
    `set_off_used` is the part of the ₹2L already taken by self-occupied
    homes. Without the rent (None) only the set-off counts: the app labels
    that "simplified"."""
    rent_part = D("0")
    if annual_rent is not None and annual_rent > 0:
        nav = max(D("0"), annual_rent - municipal_tax) * share
        rent_part = nav * (D("1") - LET_OUT_STANDARD_DEDUCTION)
    set_off = max(D("0"), HP_LOSS_SET_OFF_CAP - set_off_used) if regime == TaxRegimeIN.OLD else D("0")
    return rent_part + set_off


def pre_construction_instalment(total_pre_construction_interest: Decimal) -> Decimal:
    """One of the five equal yearly instalments (s.22(1)(c))."""
    if total_pre_construction_interest <= 0:
        return D("0")
    return total_pre_construction_interest / PRE_CONSTRUCTION_INSTALMENTS


def sec80c_room(other_80c: Decimal, home_principal_this_year: Decimal) -> Decimal:
    """Unused s.123 / 80C room after the year's other items (PF, PPF, ELSS,
    insurance, tuition) and the scheduled home-loan principal. A home-loan
    prepayment that fits in this room also lowers old-regime tax."""
    return max(D("0"), SEC80C_CAP - max(D("0"), other_80c) - max(D("0"), home_principal_this_year))


# ─── Old vs new, with the loans ──────────────────────────────────────────────

from dataclasses import dataclass, field  # noqa: E402


@dataclass
class HomeLoanYear:
    """One home loan's year, in the user's share where it says so."""
    interest: Decimal                       # the loan's interest for the year
    principal: Decimal = D("0")             # scheduled principal repaid in the year
    share: Decimal = D("1")                 # the user's share (co-borrower / co-owner)
    let_out: bool = False
    annual_rent: Decimal | None = None      # let-out: rent for the year (whole house)
    municipal_tax: Decimal = D("0")
    pre_construction_instalment: Decimal = D("0")   # this year's 1/5 (whole loan)
    full_cap: bool = True                   # finished within 5 years of borrowing
    principal_80c_eligible: bool = True     # lender listed in Schedule XV para 3(a)(iii)


@dataclass
class RegimeInputs:
    salary: Decimal = D("0")                # gross salary
    business_income: Decimal = D("0")       # profit from business / profession (slab-taxed)
    other_income: Decimal = D("0")          # interest and other slab-taxed income
    age: str | None = None                  # '60_79' / '80_plus' for the old-regime senior tables
    hra_exemption: Decimal = D("0")         # old regime only, as claimed
    sec80c_other: Decimal = D("0")          # 80C items other than home-loan principal
    sec80d: Decimal = D("0")                # already within the 80D cap for the user's age
    sec80ccd1b: Decimal = D("0")
    other_old_deductions: Decimal = D("0")  # anything else old-regime only
    edu_interest: Decimal = D("0")          # 80E interest inside its 8-year window (user's share)
    home_loans: list[HomeLoanYear] = field(default_factory=list)


@dataclass
class RegimeSide:
    taxable: Decimal
    tax: Decimal
    house_property: Decimal                 # signed: + income, − loss used
    chapter_viii: Decimal                   # deductions from total income
    loan_deductions: Decimal                # the part of the above that comes from the loans


@dataclass
class RegimeComparison:
    old: RegimeSide
    new: RegimeSide
    better: str                             # 'old' | 'new' | 'same'
    old_saves: Decimal                      # new tax − old tax (negative: new is cheaper)
    loans_worth_in_old: Decimal             # old-regime tax the loans save
    extra_deductions_for_old_to_win: Decimal | None   # when new wins; None if no amount does
    switch_rule: str                        # 'yearly' | 'business_once'


def _house_property(inp: RegimeInputs, regime: TaxRegimeIN) -> tuple[Decimal, Decimal]:
    """(net house-property income after set-off limits, interest deduction
    from the loans that counted). Self-occupied interest is capped in all
    (s.22(2)/(5)); a let-out home nets its rent; a net loss lowers other
    income only up to ₹2L in the old regime and not at all in the new."""
    so = [h for h in inp.home_loans if not h.let_out]
    lo = [h for h in inp.home_loans if h.let_out]
    so_deduction = D("0")
    if regime == TaxRegimeIN.OLD and so:
        # Each home is held to its own cap (Rs 30k for a late one), then the
        # total to Rs 2L (s.22(2), s.22(5)).
        per_home = sum((min((h.interest + h.pre_construction_instalment) * h.share,
                            SEC24B_SELF_OCCUPIED_CAP if h.full_cap else SEC24B_OTHER_CAP) for h in so), D("0"))
        so_deduction = min(per_home, SEC24B_SELF_OCCUPIED_CAP)
    lo_net = D("0")
    lo_interest = D("0")
    for h in lo:
        nav = max(D("0"), (h.annual_rent or D("0")) - h.municipal_tax) * h.share
        interest = (h.interest + h.pre_construction_instalment) * h.share
        lo_net += nav * (D("1") - LET_OUT_STANDARD_DEDUCTION) - interest
        lo_interest += interest
    total = lo_net - so_deduction
    if total < 0:
        floor = -HP_LOSS_SET_OFF_CAP if regime == TaxRegimeIN.OLD else D("0")
        used = max(total, floor)
    else:
        used = total
    # Interest that counted: what the head would be without any loan
    # interest, less what it is.
    no_interest = sum((max(D("0"), (h.annual_rent or D("0")) - h.municipal_tax) * h.share
                       * (D("1") - LET_OUT_STANDARD_DEDUCTION) for h in lo), D("0"))
    return used, no_interest - used


def _side(inp: RegimeInputs, regime: TaxRegimeIN, extra_old: Decimal = D("0")) -> RegimeSide:
    old = regime == TaxRegimeIN.OLD
    std = min(STANDARD_DEDUCTION_OLD_SALARIED if old else STANDARD_DEDUCTION_NEW_SALARIED, max(D("0"), inp.salary))
    salary = max(D("0"), inp.salary - std - (inp.hra_exemption if old else D("0")))
    hp, hp_loans = _house_property(inp, regime)
    gross_total = max(D("0"), salary + inp.business_income + inp.other_income + hp)
    chapter = D("0")
    loan_chapter = D("0")
    if old:
        principal = sum((h.principal * h.share for h in inp.home_loans if h.principal_80c_eligible), D("0"))
        c80 = min(SEC80C_CAP, max(D("0"), inp.sec80c_other) + principal)
        c80_without = min(SEC80C_CAP, max(D("0"), inp.sec80c_other))
        loan_chapter = (c80 - c80_without) + inp.edu_interest
        chapter = (c80 + inp.sec80d + min(SEC80CCD1B_CAP, inp.sec80ccd1b) + inp.edu_interest
                   + inp.other_old_deductions + extra_old)
    chapter = min(chapter, gross_total)
    taxable = max(D("0"), gross_total - chapter)
    return RegimeSide(taxable, income_tax_for_age(taxable, regime, inp.age), hp, chapter, hp_loans + loan_chapter)


def compare_regimes(inp: RegimeInputs, has_business_income: bool | None = None) -> RegimeComparison:
    """This tax year's tax under each regime with the loans counted.

    Leaves out what the app doesn't ask: employer NPS (s.124(2), allowed in
    both), special-rate income (capital gains), agricultural income,
    carry-forward of house-property loss, and the 80+ / 60–79 split for
    anyone who only gave an age bracket.
    """
    old = _side(inp, TaxRegimeIN.OLD)
    new = _side(inp, TaxRegimeIN.NEW)
    diff = new.tax - old.tax
    better = "same" if abs(diff) < D("1") else ("old" if diff > 0 else "new")
    bare = RegimeInputs(**{**inp.__dict__, "home_loans": [], "edu_interest": D("0")})
    loans_worth = _side(bare, TaxRegimeIN.OLD).tax - old.tax
    extra: Decimal | None = None
    if better == "new":
        lo, hi = D("0"), D("10000000")
        if _side(inp, TaxRegimeIN.OLD, hi).tax >= new.tax:
            extra = None
        else:
            for _ in range(60):
                mid = (lo + hi) / 2
                if _side(inp, TaxRegimeIN.OLD, mid).tax < new.tax:
                    hi = mid
                else:
                    lo = mid
            extra = hi.quantize(D("1"))
    biz = has_business_income if has_business_income is not None else inp.business_income > 0
    return RegimeComparison(old, new, better, diff, loans_worth, extra, "business_once" if biz else "yearly")
