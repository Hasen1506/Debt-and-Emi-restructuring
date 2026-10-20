"""RBI prepayment and foreclosure charges come from the circulars, not a typed fee.

Sources, read 19 Oct 2026:
* DBOD.No.Dir.BC.107/13.03.00/2011-12, 5 June 2012: no foreclosure or
  prepayment penalty on floating-rate home loans (banks).
* DBOD.Dir.BC.No.110/13.03.00/2013-14, 7 May 2014:
  https://www.rbi.org.in/Scripts/NotificationUser.aspx?Id=8868&Mode=0
  no foreclosure charge or prepayment penalty on any floating-rate term
  loan to an individual borrower (scheduled commercial banks, excluding RRBs).
* UBD.CO.BPD.PCB.Cir.No.64/12.05.001/2013-14, 26 May 2014, urban
  co-operative banks, and RPCD.CO.RCBD.RRB.BC.No.102/07.51.013/2013-14,
  27 May 2014, state and central co-operative banks and RRBs: the same
  bar, and it was not narrowed to non-business loans in 2019.
  https://www.rbi.org.in/Scripts/NotificationUser.aspx?Id=8896&Mode=0
  https://www.rbi.org.in/Scripts/NotificationUser.aspx?Id=8905&Mode=0
* DBR.Dir.BC.No.08/13.03.00/2019-20, 2 August 2019:
  https://www.rbi.org.in/scripts/NotificationUser.aspx?Id=11646&Mode=0
  the bar is for purposes other than business, with or without co-obligants.
* RBI (Pre-payment Charges on Loans) Directions, 2025, 2 July 2025,
  RBI/2025-26/64, in force for loans sanctioned or renewed from 1 Jan 2026:
  https://www.rbi.org.in/Scripts/NotificationUser.aspx?Id=12878&Mode=0
  para 5 is floating rate only. 5(i) non-business loans to individuals: no
  charge, any regulated lender, any amount. 5(ii)(a) business loans to
  individuals and MSEs from a commercial bank (not a small finance, regional
  rural or local area bank), a Tier 4 UCB, an NBFC-UL or an AIFI: no charge.
  5(ii)(b) a small finance bank, RRB, Tier 3 UCB, state or central
  co-operative bank, or NBFC-ML: no charge up to ₹50 lakh sanctioned.
  5(iii) part or full, any source of funds, no lock-in. 5(iv) a dual-rate
  loan follows the rate it is on when prepaid. Para 6: anything else,
  including a fixed rate, is the lender's own policy.
"""
from __future__ import annotations

from decimal import Decimal as D

from engine.formulas import emi
from engine.models import Country, IncomeType, Loan, LoanType, TaxRegimeIN, User
from engine.ordering import Strategy
from engine.prepayment_fee import (
    ZERO_NOTE,
    chargeable_lock_in_months,
    chargeable_prepayment_pct,
    prepayment_fee_default,
)
from engine.simulation import simulate_plan

CAP = D("5000000")


def _user(loans, strategy_income=D("200000")) -> User:
    return User(
        country=Country.IN, income_type=IncomeType.SALARIED,
        annual_income=strategy_income * 12, monthly_income=strategy_income,
        fixed_expenses=D("30000"), savings_balance=D("0"), primary_bank="HDFC Bank",
        tax_regime=TaxRegimeIN.NEW, efund_balance=D("0"), efund_target=D("0"),
        loans=loans, investment_options=[], inflation_rate=D("0"),
    )


def _term(rate, n, balance, **kw) -> Loan:
    return Loan(
        loan_type=kw.pop("loan_type", LoanType.PERSONAL),
        bank=kw.pop("bank", "HDFC Bank"),
        outstanding=balance, nominal_rate=rate, rate_type=kw.pop("rate_type", "floating"),
        tenure_months_remaining=n,
        scheduled_emi=emi(balance, rate, n).quantize(D("0.01")),
        **kw,
    )


def test_the_note_the_form_shows():
    assert ZERO_NOTE == "No prepayment charge on floating-rate loans (RBI rule)"


def test_each_rule_case():
    f = prepayment_fee_default
    # Non-business floating: 2012 / 2014 / 2019 / 2025 para 5(i). Any year, any amount.
    for lender in (None, "bank", "commercial_bank", "small_finance_bank",
                   "nbfc", "hfc"):
        d = f("home_loan", "floating", "IN", lender, False, 2014, D("8000000"))
        assert d.status == "assumed" and d.pct == 0, lender
    # RRBs and co-operative banks: 0 before 2026 as well. UBD.CO.BPD.PCB.Cir.No.64
    # (26 May 2014) and RPCD.CO.RCBD.RRB.BC.No.102 (27 May 2014) bar the charge
    # on every floating-rate term loan to an individual borrower. The 2 August
    # 2019 non-business clarification was not addressed to them.
    for lender in ("cooperative_bank", "regional_rural_bank"):
        assert f("home_loan", "floating", "IN", lender, False, 2014).status == "assumed", lender
        assert f("home_loan", "floating", "IN", lender, False, None).status == "assumed", lender
        assert f("home_loan", "floating", "IN", lender, False, 2026).status == "assumed", lender
        assert f("personal_loan", "floating", "IN", lender, True, 2014, D("8000000")).status == "assumed", lender
        assert f("personal_loan", "floating", "IN", lender, True, None).status == "assumed", lender
    # A blank business answer: personal for most loans. LAP and gold are asked
    # only when the purpose can change the fee.
    assert f("home_loan", "floating", "IN", "bank", None).status == "assumed"
    for lt in ("loan_against_property", "gold_loan"):
        # Before 2026 a commercial bank may charge on a business loan (2019 clarification).
        assert f(lt, "floating", "IN", "bank", None, 2025).status == "unknown", lt
        # From 2026 para 5(i) and 5(ii)(a) are both 0, so the blank answer cannot keep a fee.
        assert f(lt, "floating", "IN", "bank", None, 2026, D("20000000")).status == "assumed", lt
        assert f(lt, "floating", "IN", "bank", False, 2026).status == "assumed", lt
        # An RRB's May 2014 circular covers a business purpose too, so a blank answer is 0.
        assert f(lt, "floating", "IN", "regional_rural_bank", None, 2019).status == "assumed", lt
        # From 2026 an RRB may charge above ₹50 lakh, so a blank answer is asked.
        assert f(lt, "floating", "IN", "regional_rural_bank", None, 2026, CAP + 1).status == "unknown", lt
        assert f(lt, "floating", "IN", "regional_rural_bank", None, 2026, CAP).status == "assumed", lt
    # A lender RBI does not regulate is not covered.
    assert f("home_loan", "floating", "IN", "other", False).status == "unknown"
    # Fixed rate: para 5 does not apply. Para 6 leaves the charge to the lender.
    for lender in ("bank", "hfc", "nbfc", "small_finance_bank"):
        assert f("home_loan", "fixed", "IN", lender, False, 2026, D("1000000")).status == "unknown", lender
    assert f("personal_loan", "fixed", "IN", "bank", True, 2026).status == "unknown"
    # Cards and US loans are outside the Indian term-loan rule.
    assert f("credit_card", "floating", "IN", "bank", False).status == "unknown"
    assert f("home_loan", "floating", "US", "bank", False).status == "unknown"
    # Business, from 1 Jan 2026. Commercial bank: no charge at any amount (5(ii)(a)).
    assert f("personal_loan", "floating", "IN", "bank", True, 2026, D("20000000")).status == "assumed"
    assert f("personal_loan", "floating", "IN", "commercial_bank", True, 2026).status == "assumed"
    # The same loan sanctioned in 2025 is still the lender's own policy (2019 was non-business only).
    assert f("personal_loan", "floating", "IN", "bank", True, 2025, D("1000000")).status == "unknown"
    assert f("personal_loan", "floating", "IN", "bank", True, None).status == "unknown"
    # ₹50 lakh is the sanctioned amount, inclusive, and only for the lenders in 5(ii)(b).
    for lender in ("small_finance_bank", "regional_rural_bank", "hfc"):
        assert f("personal_loan", "floating", "IN", lender, True, 2026, CAP).status == "assumed", lender
        assert f("personal_loan", "floating", "IN", lender, True, 2026, CAP + 1).status == "unknown", lender
        assert f("personal_loan", "floating", "IN", lender, True, 2026, None).status == "unknown", lender
    # Before 2026 the 2019 clarification left a business loan to the lender, except
    # RRBs and co-operative banks, whose May 2014 circulars were not narrowed.
    for lender in ("small_finance_bank", "hfc", "nbfc", "bank"):
        assert f("personal_loan", "floating", "IN", lender, True, 2025, CAP).status == "unknown", lender
    for lender in ("regional_rural_bank", "cooperative_bank"):
        assert f("personal_loan", "floating", "IN", lender, True, 2025, CAP).status == "assumed", lender
    # An NBFC's layer and a co-operative bank's tier are not known, so from 2026 a charge can apply.
    for lender in ("nbfc", "cooperative_bank"):
        assert f("personal_loan", "floating", "IN", lender, True, 2026, CAP).status == "unknown", lender
        assert f("personal_loan", "floating", "IN", lender, True, 2026, D("10000000")).status == "unknown", lender


def test_a_stored_fee_is_ignored_where_the_law_says_zero():
    home = _term(D("0.085"), 180, D("3000000"), loan_type=LoanType.HOME, prepayment_penalty_pct=D("0.02"),
                 prepay_lock_in_months=12, lender_type="bank", business_purpose=False, sanction_year=2026)
    assert chargeable_prepayment_pct(home, Country.IN) == 0
    assert chargeable_lock_in_months(home, Country.IN) == 0
    # Before 2026 the charge is still forbidden; a lock-in the 2014 circular did not ban is kept.
    older = _term(D("0.085"), 180, D("3000000"), loan_type=LoanType.HOME, prepayment_penalty_pct=D("0.02"),
                  prepay_lock_in_months=12, sanction_year=2024)
    assert chargeable_prepayment_pct(older, Country.IN) == 0
    assert chargeable_lock_in_months(older, Country.IN) == 12
    fixed = _term(D("0.14"), 24, D("200000"), rate_type="fixed", prepayment_penalty_pct=D("0.03"))
    assert chargeable_prepayment_pct(fixed, Country.IN) == D("0.03")


def test_zeroing_the_fee_sends_the_extra_to_the_dearer_loan():
    """A 5% fee on a 6-month 14% loan used to make a 12% loan the better
    place for the extra. The 14% loan is floating and not for a business,
    so the fee is 0 and avalanche prepays it first."""
    dear = _term(D("0.14"), 6, D("400000"), loan_type=LoanType.HOME, bank="HDFC Bank",
                 prepayment_penalty_pct=D("0.05"), lender_type="bank", business_purpose=False)
    cheap = _term(D("0.12"), 24, D("400000"), bank="Bajaj Finance", rate_type="fixed")
    ruled = simulate_plan(_user([dear, cheap]), Strategy.AVALANCHE, horizon_months=2)
    assert ruled.months[0].extra_to_loan_index == 0
    # The same numbers, on a fixed-rate loan where a charge can apply: the fee
    # moves the extra onto the cheaper loan.
    honored = _term(D("0.14"), 6, D("400000"), loan_type=LoanType.HOME, bank="HDFC Bank",
                    rate_type="fixed", prepayment_penalty_pct=D("0.05"))
    with_fee = simulate_plan(_user([honored, cheap]), Strategy.AVALANCHE, horizon_months=2)
    assert with_fee.months[0].extra_to_loan_index == 1


def test_snowball_still_clears_the_smaller_zero_fee_loan_first():
    small = _term(D("0.10"), 6, D("80000"), prepayment_penalty_pct=D("0.05"), business_purpose=False)
    big = _term(D("0.09"), 36, D("500000"), bank="SBI", rate_type="fixed")
    ruled = simulate_plan(_user([small, big]), Strategy.SNOWBALL, horizon_months=2)
    assert ruled.months[0].extra_to_loan_index == 0
    honored = _term(D("0.10"), 6, D("80000"), rate_type="fixed", prepayment_penalty_pct=D("0.05"), bank="Bajaj Finance")
    with_fee = simulate_plan(_user([honored, big]), Strategy.SNOWBALL, horizon_months=2)
    assert with_fee.months[0].extra_to_loan_index == 1


def test_simulate_plan_leaves_the_callers_loans_alone():
    """The statutory zero is applied to copies; a typed fee stays on the input."""
    loan = _term(D("0.14"), 24, D("500000"), prepayment_penalty_pct=D("0.05"),
                 prepay_lock_in_months=12, lender_type="bank", business_purpose=False, sanction_year=2026)
    user = _user([loan])
    simulate_plan(user, Strategy.AVALANCHE, horizon_months=2)
    assert user.loans[0] is loan
    assert loan.prepayment_penalty_pct == D("0.05")
    assert loan.prepay_lock_in_months == 12
