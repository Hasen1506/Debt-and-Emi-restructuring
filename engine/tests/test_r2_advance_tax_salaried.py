"""Round 2, item 5: advance tax for a salaried person with income that has
no TDS (engine/tax/advance_tax.py).

Golden (new regime, FY 2026-27, hand check):
  salary ₹18,00,000 − ₹75,000 standard deduction = ₹17,25,000
    slab tax 20,000 + 40,000 + 60,000 + 25,000 = 1,45,000 × 1.04 = ₹1,50,800
  + FD interest ₹2,00,000 (TDS 10% = ₹20,000) + rent ₹3,60,000 × 70% = ₹2,52,000
    → ₹21,77,000: 2,00,000 + 1,77,000 × 25% = 2,44,250 × 1.04 = ₹2,54,020
  advance tax = 2,54,020 − 1,50,800 − 20,000 = ₹83,220
  instalments 15/45/75/100%: 12,483 · 24,966 · 24,966 · 20,805
  nothing paid in advance, all paid by 31 July:
    234C (s.425) 1% × (3 × 12,400 + 3 × 37,400 + 3 × 62,400 + 1 × 83,200) = 372 + 1,122 + 1,872 + 832 = ₹4,198
    234B (s.424) 1% × 4 months (Apr–Jul) × 83,200 = ₹3,328
"""
from datetime import date
from decimal import Decimal

import pytest
from hypothesis import given, settings, strategies as st

from engine.models import TaxRegimeIN
from engine.tax.advance_tax import (
    AdvanceTaxInputError, OtherIncome, interest_234b, interest_234c, months_from_april, salaried_advance_tax,
    schedule,
)

D = Decimal
TODAY = date(2026, 10, 15)


def golden():
    return salaried_advance_tax(D("1800000"), [OtherIncome("interest", D("200000"), D("0.10")),
                                               OtherIncome("rent", D("360000"))], TaxRegimeIN.NEW, TODAY)


def test_golden_liability_and_schedule():
    r = golden()
    assert r.tax_on_salary == D("150800") and r.tax_total == D("254020") and r.tds_on_other == D("20000")
    assert r.applies and r.liability == D("83220")
    assert [(i.due, i.amount) for i in r.instalments] == [
        (date(2026, 6, 15), D("12483")), (date(2026, 9, 15), D("24966")),
        (date(2026, 12, 15), D("24966")), (date(2027, 3, 15), D("20805"))]


def test_golden_interest_if_nothing_paid():
    r = golden()
    assert r.interest_234c_if_unpaid == D("4198")
    assert r.interest_234b_if_unpaid == D("3328")
    assert r.interest_if_unpaid == D("7526")


def test_threshold_is_10000_or_more():
    """₹10,000 exactly is due ("Rs. 10,000 or more"); ₹9,999 isn't. Salary
    ₹16,00,000 (taxable 15,25,000, 15% band to 16 L) + ₹X interest at 15.6%:
    X = 64,103 → ₹10,000; X = 64,096 → ₹9,999."""
    due = salaried_advance_tax(D("1600000"), [OtherIncome("interest", D("64103"))], TaxRegimeIN.NEW, TODAY)
    below = salaried_advance_tax(D("1600000"), [OtherIncome("interest", D("64096"))], TaxRegimeIN.NEW, TODAY)
    assert due.liability == D("10000") and due.applies
    assert below.liability == D("9999") and not below.applies and below.instalments == []


def test_rebate_keeps_small_other_income_tax_free():
    """₹12 L salary + ₹50,000 interest: taxable ₹11,75,000 is under the
    new-regime 87A line (₹12 L), so nothing is owed."""
    r = salaried_advance_tax(D("1200000"), [OtherIncome("interest", D("50000"))], TaxRegimeIN.NEW, TODAY)
    assert r.liability == 0 and not r.applies


def test_resident_senior_without_business_income_is_exempt():
    r = salaried_advance_tax(D("1800000"), [OtherIncome("interest", D("400000"))], TaxRegimeIN.NEW, TODAY, age=61)
    assert r.liability > D("10000") and not r.applies and "60" in r.reason
    f = salaried_advance_tax(D("1800000"), [OtherIncome("freelance", D("800000"))], TaxRegimeIN.NEW, TODAY, age=61)
    assert f.applies                                    # business / profession income: no exemption


def test_presumptive_freelance_pays_once_by_15_march():
    r = salaried_advance_tax(D("1800000"), [OtherIncome("freelance", D("600000"))], TaxRegimeIN.NEW, TODAY)
    assert r.presumptive and [i.due for i in r.instalments] == [date(2027, 3, 15)]
    assert r.instalments[0].amount == r.liability
    # Only the March shortfall draws 234C, for one month.
    assert r.interest_234c_if_unpaid == (r.liability // 100 * 100) * D("0.01")


def test_capital_gains_rates():
    """Equity STCG 20%, LTCG 12.5% above ₹1.25 L, plus 4% cess, on top of a
    salary already in the 30% band (₹30 L)."""
    s = salaried_advance_tax(D("3000000"), [OtherIncome("capital_gains", D("100000"), cg_kind="equity_stcg")],
                             TaxRegimeIN.NEW, TODAY)
    assert s.liability == D("20800")                    # 1,00,000 × 20% × 1.04
    lt = salaried_advance_tax(D("3000000"), [OtherIncome("capital_gains", D("325000"), cg_kind="equity_ltcg")],
                              TaxRegimeIN.NEW, TODAY)
    assert lt.liability == D("26000")                   # (3,25,000 − 1,25,000) × 12.5% × 1.04


def test_234c_safe_harbour_and_fixed_periods():
    """FAQ Q21/Q25: June needs only 12%, September 36%; each shortfall
    carries 3 months (1 for March) whatever the delay."""
    a = D("100000")
    assert interest_234c(a, [D("12000"), D("45000"), D("75000"), D("100000")]) == 0
    assert interest_234c(a, [D("11900"), D("45000"), D("75000"), D("100000")]) == D("3100") * D("0.03")
    assert interest_234c(a, [D("15000"), D("36000"), D("75000"), D("100000")]) == 0
    assert interest_234c(a, [D("15000"), D("45000"), D("74000"), D("100000")]) == D("1000") * D("0.03")
    assert interest_234c(a, [D("15000"), D("45000"), D("75000"), D("90000")]) == D("10000") * D("0.01")
    with pytest.raises(AdvanceTaxInputError):
        interest_234c(a, [D("0")])


def test_234b_ninety_percent_rule_and_part_months():
    assert interest_234b(D("100000"), D("90000"), 4) == 0
    assert interest_234b(D("100000"), D("89999"), 4) == D("10000") * D("0.04")      # 10,001 → 10,000
    assert months_from_april(date(2027, 3, 31), 2026) == 0
    assert months_from_april(date(2027, 4, 1), 2026) == 1
    assert months_from_april(date(2027, 7, 31), 2026) == 4
    assert months_from_april(date(2027, 8, 1), 2026) == 5


def test_fy_runs_april_to_march():
    r = salaried_advance_tax(D("1800000"), [OtherIncome("interest", D("400000"))], TaxRegimeIN.NEW, date(2027, 2, 1))
    assert r.fy_start == 2026 and r.instalments[-1].due == date(2027, 3, 15)


def test_bad_inputs():
    for s, f in ((OtherIncome("lottery", D("1")), "kind"), (OtherIncome("interest", D("-1")), "gross_annual"),
                 (OtherIncome("interest", D("1"), D("2")), "tds_pct"),
                 (OtherIncome("capital_gains", D("1"), cg_kind="crypto"), "cg_kind")):
        with pytest.raises(AdvanceTaxInputError) as e:
            salaried_advance_tax(D("1000000"), [s], TaxRegimeIN.NEW, TODAY)
        assert e.value.field.endswith(f)


@settings(max_examples=80, deadline=None)
@given(salary=st.integers(0, 6_000_000), extra=st.integers(0, 3_000_000), more=st.integers(1, 500_000),
       kind=st.sampled_from(["interest", "rent", "freelance", "other"]),
       regime=st.sampled_from([TaxRegimeIN.NEW, TaxRegimeIN.OLD]))
def test_class_invariants(salary, extra, more, kind, regime):
    """Never negative; more other income never lowers it; the schedule adds
    up to the liability with cumulative shares 15/45/75/100; interest if
    unpaid is never negative and is zero when nothing is due."""
    a = salaried_advance_tax(D(salary), [OtherIncome(kind, D(extra))], regime, TODAY)
    b = salaried_advance_tax(D(salary), [OtherIncome(kind, D(extra + more))], regime, TODAY)
    assert a.liability >= 0 and b.liability >= a.liability
    assert a.applies == (a.liability >= 10000)
    if a.applies:
        assert sum(i.amount for i in a.instalments) == a.liability
        assert a.interest_if_unpaid > 0
    else:
        assert a.instalments == [] and a.interest_if_unpaid == 0
    sched = schedule(D(extra), 2026)
    assert [i.cumulative_share for i in sched] == [D("0.15"), D("0.45"), D("0.75"), D("1.00")]


def test_marginal_relief_counts_share_gains_but_never_reduces_their_tax():
    """s.87A marginal relief, new regime (docs/decisions section 7): tax on total income,
    gains included, is capped at the income above Rs 12L; the relief never exceeds the slab
    tax (Finance Act 2025 second proviso), so the special-rate tax itself is never cut."""
    # Salary Rs 12.25L gross - 75k = Rs 11.5L slab income (tax 55,000) + equity STCG Rs 1L (20% = 20,000).
    # Total Rs 12.5L: 75,000 before relief, capped at Rs 50,000 above 12L -> 50,000 x 1.04 = 52,000.
    r = salaried_advance_tax(D("1225000"), [OtherIncome("capital_gains", D("100000"), cg_kind="equity_stcg")],
                             TaxRegimeIN.NEW, TODAY)
    assert r.tax_total == D("52000")
    # Gains tax above the excess: salary 11.95L gross (slab 11.2L) + STCG 4L (tax 80,000).
    # Excess over 12L is 3.2L, which is above all tax, so relief is zero: (52,000 + 80,000) x 1.04.
    r = salaried_advance_tax(D("1195000"), [OtherIncome("capital_gains", D("400000"), cg_kind="equity_stcg")],
                             TaxRegimeIN.NEW, TODAY)
    assert r.tax_total == D("137280")
    # Special-rate tax larger than the excess: slab 11.95L (tax 59,500) + STCG 1L... excess just 15k,
    # but the 20,000 gains tax is never relieved: tax = 20,000 x 1.04 = 20,800.
    r = salaried_advance_tax(D("1270000"), [OtherIncome("capital_gains", D("20000"), cg_kind="equity_stcg")],
                             TaxRegimeIN.NEW, TODAY)
    # slab 11.95L tax 59,500; STCG 4,000; total 12.15L; excess 15,000 > 4,000 -> tax 15,000 x 1.04
    assert r.tax_total == D("15600")
