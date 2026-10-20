"""Sprint G1 (cards-fees) regression tests, 2026-10-12.

Each test names the grill item it pins. Sources:
- RBI Master Direction, Credit Card and Debit Card - Issuance and Conduct,
  2022 (updated 7 Mar 2024): https://www.rbi.org.in/Scripts/BS_ViewMasDirections.aspx?id=12300
- RBI (Pre-payment Charges on Loans) Directions, 2025 (2 Jul 2025):
  https://www.rbi.org.in/Scripts/NotificationUser.aspx?Id=12878&Mode=0
"""
from __future__ import annotations

import json
from copy import deepcopy
from decimal import Decimal
from pathlib import Path

import pytest

from engine.decisions import allocate_windfall
from engine.fee_order import ILLUSTRATIVE_HIGH_FEE, unknown_fee_check
from engine.formulas import effective_rate, gst_component
from engine.marginal_cost import compounded, loan_marginal_cost, marginal_cost, prepayment_fee_with_gst
from engine.minimum_payments import (
    FORMULA_SOURCE, INDIA_MIN_PAYMENT_FORMULAS, STATEMENT_MIN_ADVICE, compute_minimum_payment,
)
from engine.models import Country, IncomeType, InvestmentOption, LiquidityClass, Loan, LoanType, TaxRegimeIN, User
from engine.ordering import Strategy
from engine.prepayment_fee import prepayment_fee_default
from engine.simulation import simulate_plan
from engine.tax.gst import GST_APPLIES, GST_RATE_IN, gst_applies, gst_on

D = Decimal
ROOT = Path(__file__).resolve().parents[2]


def _loan(**kw) -> Loan:
    base = dict(loan_type=LoanType.PERSONAL, bank="HDFC Bank", outstanding=D("300000"), nominal_rate=D("0.14"),
                rate_type="fixed", tenure_months_remaining=36, scheduled_emi=D("10254"))
    base.update(kw)
    return Loan(**base)


def _user(loans, surplus_income=D("120000")) -> User:
    return User(
        country=Country.IN, income_type=IncomeType.SALARIED,
        annual_income=surplus_income * 12, monthly_income=surplus_income,
        fixed_expenses=D("40000"), savings_balance=D("0"), primary_bank="HDFC Bank",
        tax_regime=TaxRegimeIN.NEW, efund_balance=D("0"), efund_target=D("0"),
        loans=loans, investment_options=[], inflation_rate=D("0"),
    )


# ── L3 finding / #25: GST on card interest never compounds ──────────────────

def test_a_42_percent_card_costs_60_31_not_62_52():
    mc = marginal_cost(D("0.42"), True, D("0"), D("0"), 0)
    assert round(mc.interest, 4) == D("0.5111")
    assert mc.gst == mc.interest * GST_RATE_IN
    assert round(mc.annual_cost, 4) == D("0.6031")


def test_new_spend_while_revolving_has_no_interest_free_period():
    """FAQ 6: once the bill isn't paid in full, interest runs from the
    transaction date. The month's spend is charged interest (+GST)."""
    def first_interest(spend):
        card = Loan(loan_type=LoanType.CREDIT_CARD, bank="SBI Card", outstanding=D("100000"),
                    nominal_rate=D("0.42"), rate_type="fixed", tenure_months_remaining=0,
                    scheduled_emi=D("5000"), expected_monthly_spend=spend)
        return simulate_plan(_user([card]), Strategy.AVALANCHE, horizon_months=2, minimums_only=True).months[0].interest_paid_month
    extra = first_interest(D("10000")) - first_interest(D("0"))
    assert extra > 0


# ── #26: min-due formulas are estimates; statement figure wins; RBI floor ───

def test_every_bank_formula_is_marked_unverified_and_the_statement_wins():
    assert set(FORMULA_SOURCE) >= set(INDIA_MIN_PAYMENT_FORMULAS)
    # C14 (audit 80): the big four issuers are sourced from their MITC with a
    # date; every other formula stays an unverified estimate.
    sourced = {"SBI Card", "Axis Bank", "HDFC Bank", "ICICI Bank"}
    for bank, v in FORMULA_SOURCE.items():
        if bank in sourced:
            assert v["verified"] is True and v["source_url"].startswith("https://") and v["as_of"]
        else:
            assert v["verified"] is False and v["source_url"] is None
    assert "statement" in STATEMENT_MIN_ADVICE
    card = Loan(loan_type=LoanType.CREDIT_CARD, bank="HDFC Bank", outstanding=D("50000"), nominal_rate=D("0.42"),
                rate_type="fixed", tenure_months_remaining=0, scheduled_emi=D("0"))
    card.min_payment_override = D("2600")
    assert compute_minimum_payment(card, Country.IN, interest_accrued=D("2065")) == D("2600")


def test_indian_minimum_never_below_interest_plus_gst():
    """RBI MD para 9(b)(ii) + Annex: no negative amortisation. AmEx India's
    '2% of the balance' estimate on a 42% card is below interest + GST."""
    card = Loan(loan_type=LoanType.CREDIT_CARD, bank="AmEx India", outstanding=D("100000"), nominal_rate=D("0.42"),
                rate_type="fixed", tenure_months_remaining=0, scheduled_emi=D("0"))
    charges = D("100000") * D("0.42") / 12 * (1 + GST_RATE_IN)      # ₹4,130
    assert compute_minimum_payment(card, Country.IN, interest_accrued=charges) >= charges


# ── #27: one GST table ───────────────────────────────────────────────────────

def test_gst_table_covers_every_charge_and_exempts_loan_interest():
    assert gst_applies("card_interest") and not gst_applies("loan_interest")
    for kind in ("processing_fee", "prepayment_fee", "late_fee", "penal_charge", "bounce_charge"):
        assert gst_applies(kind), kind
    assert gst_on("loan_interest", D("1000")) == 0 and gst_on("late_fee", D("1000")) == D("180")
    with pytest.raises(ValueError):
        gst_applies("something_new")


def test_web_reads_the_same_gst_table():
    tables = json.loads((ROOT / "web" / "src" / "lib" / "tax-tables.json").read_text(encoding="utf-8"))
    assert tables["in"]["gst_applies"] == GST_APPLIES


@pytest.mark.parametrize("lt", [LoanType.GOLD, LoanType.EDUCATION, LoanType.BNPL, LoanType.PERSONAL, LoanType.HOME])
def test_processing_fee_gst_on_every_loan_type(lt):
    assert gst_component(lt, D("0.10"), D("0.01")) == D("0.01") * GST_RATE_IN


def test_prepayment_fee_carries_gst_in_india_only():
    assert prepayment_fee_with_gst(D("0.04"), True) == D("0.04") * (1 + GST_RATE_IN)
    assert prepayment_fee_with_gst(D("0.04"), False) == D("0.04")
    l = _loan(prepayment_penalty_pct=D("0.04"), tenure_months_remaining=24)
    mc = loan_marginal_cost(l, D("0"), Country.IN)
    assert mc.fee == D("0.04") * (1 + GST_RATE_IN) * 12 / 24


def test_simulation_charges_gst_on_the_prepayment_fee():
    l = _loan(prepayment_penalty_pct=D("0.04"), outstanding=D("200000"), tenure_months_remaining=24,
              scheduled_emi=D("9603"))
    res = simulate_plan(_user([l]), Strategy.AVALANCHE, horizon_months=1)
    row = res.months[0]
    # The fee is folded into interest_paid; interest alone is 200000 × 14% / 12.
    interest_only = D("200000") * D("0.14") / 12
    fee = row.interest_paid_month - interest_only
    extra = row.payments_by_loan_index[0] - D("9603")
    assert fee == pytest.approx(extra * D("0.04") * (1 + GST_RATE_IN), abs=D("1"))


# ── #28: lender type and business purpose ───────────────────────────────────

def test_personal_purpose_is_zero_for_every_rbi_lender_and_unknown_for_others():
    for lender in (None, "bank", "small_finance_bank", "nbfc", "hfc"):
        assert prepayment_fee_default("home_loan", "floating", "IN", lender, False).status == "assumed"
    # Co-operative banks and RRBs: asked before 2026 or with no year, 0 from 2026 (decision 2026-10-20).
    for lender in ("cooperative_bank", "regional_rural_bank"):
        assert prepayment_fee_default("home_loan", "floating", "IN", lender, False).status == "unknown"
        assert prepayment_fee_default("home_loan", "floating", "IN", lender, False, 2026).status == "assumed"
    assert prepayment_fee_default("home_loan", "floating", "IN", "other", False).status == "unknown"


def test_business_loans_follow_para_5_ii():
    f = prepayment_fee_default
    assert f("personal_loan", "floating", "IN", "bank", True, 2026).status == "assumed"           # 5(ii)(a)
    assert f("personal_loan", "floating", "IN", "bank", True, 2025).status == "unknown"           # before the rule
    assert f("personal_loan", "floating", "IN", "bank", True, None).status == "unknown"           # year not given
    assert f("personal_loan", "floating", "IN", "small_finance_bank", True, 2026, D("5000000")).status == "assumed"
    assert f("personal_loan", "floating", "IN", "small_finance_bank", True, 2026, D("5000001")).status == "unknown"
    for lender in ("nbfc", "hfc", "cooperative_bank"):   # depends on tier / layer
        assert f("personal_loan", "floating", "IN", lender, True, 2026).status == "unknown"
    assert f("personal_loan", "fixed", "IN", "bank", False).status == "unknown"


def test_lender_table_matches_its_fixture():
    table = json.loads((ROOT / "engine" / "tests" / "fixtures" / "prepayment_fee_lender_cases.json").read_text(encoding="utf-8"))
    for c in table["cases"]:
        a = c["args"]
        d = prepayment_fee_default(a["loan_type"], a["rate_type"], a["market"], a["lender_type"],
                                   a["business_purpose"], a["sanction_year"],
                                   D(a["sanctioned_amount"]) if a["sanctioned_amount"] else None)
        assert (str(d.pct), d.status, d.reason) == (c["pct"], c["status"], c["reason"]), a


# ── #29: unknown fee: run 0% and a high illustrative fee; ask only if it flips

def _run(u):
    return simulate_plan(u, Strategy.AVALANCHE, horizon_months=6)


def test_unknown_fee_asks_only_when_the_order_flips():
    # A 15% fixed personal loan with a blank fee vs a 14% one with a known 0 fee:
    # at 4% + GST the first one stops being the better place for the extra.
    a = _loan(bank="Bajaj Finance", nominal_rate=D("0.15"), outstanding=D("200000"), tenure_months_remaining=12,
              scheduled_emi=D("18052"))
    b = _loan(bank="SBI", nominal_rate=D("0.14"), outstanding=D("200000"), tenure_months_remaining=36,
              scheduled_emi=D("6835"))
    chk = unknown_fee_check(_user([a, b]), [0], _run)
    assert chk.first_at_zero == 0
    assert chk.ask_fee and chk.first_at_high == 1 and "illustrative" in chk.note
    # A 42% card next to it: a fee on the personal loan can't change that the card goes first.
    card = Loan(loan_type=LoanType.CREDIT_CARD, bank="SBI Card", outstanding=D("80000"), nominal_rate=D("0.42"),
                rate_type="fixed", tenure_months_remaining=0, scheduled_emi=D("4000"))
    chk2 = unknown_fee_check(_user([card, a]), [1], _run)
    assert not chk2.ask_fee and chk2.note is None
    assert ILLUSTRATIVE_HIGH_FEE == D("0.04")


def test_a_known_fee_is_never_stressed():
    a = _loan(prepayment_penalty_pct=D("0.02"))
    assert unknown_fee_check(_user([a]), [0], _run).loans == []


# ── #30: lender's minimum part-payment → set aside, then paid in one go ─────

def test_extra_below_the_minimum_is_set_aside_then_paid():
    l = _loan(rate_type="floating", outstanding=D("500000"), tenure_months_remaining=60, scheduled_emi=D("11634"),
              min_prepay_amount=D("150000"))
    res = simulate_plan(_user([l], surplus_income=D("100000")), Strategy.AVALANCHE, horizon_months=8)
    extras = [r.payments_by_loan_index.get(0, D("0")) - D("11634") for r in res.months]
    pots = [r.set_aside_for_prepay for r in res.months]
    # No part-payment under ₹1.5L ever reaches the lender.
    assert all(e <= D("0.01") or e >= D("150000") for e in extras), extras
    assert any(p > 0 for p in pots) and any(e >= D("150000") for e in extras)
    # Without the minimum, the extra goes in every month.
    l2 = deepcopy(l)
    l2.min_prepay_amount = D("0")
    res2 = simulate_plan(_user([l2], surplus_income=D("100000")), Strategy.AVALANCHE, horizon_months=8)
    assert all(r.set_aside_for_prepay == 0 for r in res2.months)


# ── #36: the invest-vs-prepay gate uses the forward cost, not a sunk fee ────

def test_windfall_gate_ignores_a_sunk_processing_fee():
    # 8% loan with a big upfront fee spread in its effective rate (2%/yr): the
    # all-in rate (10%+) beat an 8.5% liquid fund; the cost from here (8.3%) doesn't.
    l = _loan(rate_type="fixed", nominal_rate=D("0.08"), processing_fee_amortised=D("0.02"))
    u = _user([l])
    fund = [InvestmentOption(name="Liquid fund", expected_return=D("0.085"), liquidity_class=LiquidityClass.LIQUID,
                             is_in_pool=True)]
    eff = {id(l): effective_rate(l, D("0"), Country.IN, TaxRegimeIN.NEW)}
    assert eff[id(l)] > D("0.10")
    mcs = {id(l): loan_marginal_cost(l, D("0"), Country.IN)}
    out = allocate_windfall(D("100000"), [l], eff, fund, D("0"), marginal_costs=mcs, prepay_hurdle=D("0"))
    assert out.invest_instead
    assert compounded(D("0.08")) < D("0.085")
