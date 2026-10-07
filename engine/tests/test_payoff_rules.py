"""Your rules (roadmap PR E): the user's own payoff order replaces Hybrid.

Rules flow through rank_loans in the simulation (both the monthly extra and
the reinvest cascade) and through allocate_windfall; Hybrid is exactly the
rule "clear loans under ₹50,000 / $1,000 first". The TypeScript twin
(web/src/lib/payoff-rules.ts) is checked against
engine/tests/fixtures/payoff_rules_cases.json.
"""
import importlib.util
from decimal import Decimal as D
from pathlib import Path

from engine.decisions import allocate_windfall
from engine.models import (
    Country, IncomeType, InvestmentOption, LiquidityClass, Loan, LoanType, PayoffRules, User,
)
from engine.ordering import Strategy, apply_rules, hybrid_rules, rank_loans
from engine.simulation import simulate_plan

ROOT = Path(__file__).resolve().parents[2]


def _loans():
    home = Loan(LoanType.HOME, "HDFC Bank", D("4000000"), D("0.085"), "floating", 240, D("34713"))
    card = Loan(LoanType.CREDIT_CARD, "ICICI Bank", D("80000"), D("0.36"), "fixed", 12, D("0"))
    personal = Loan(LoanType.PERSONAL, "SBI", D("300000"), D("0.13"), "fixed", 36, D("10110"))
    bnpl = Loan(LoanType.BNPL, "Lazypay", D("15000"), D("0.24"), "fixed", 6, D("2700"))
    return home, card, personal, bnpl


def _rates(*loans):
    return {id(l): l.nominal_rate for l in loans}


def _user(loans, rules=None):
    return User(
        country=Country.IN, income_type=IncomeType.SALARIED,
        annual_income=D("2400000"), monthly_income=D("200000"),
        fixed_expenses=D("60000"), savings_balance=D("0"), primary_bank="x",
        loans=loans, payoff_rules=rules,
    )


def test_rules_order_pin_then_small_then_rate():
    home, card, personal, bnpl = _loans()
    loans = [home, card, personal, bnpl]
    r = _rates(*loans)
    # No rules: avalanche.
    assert rank_loans(loans, r, Strategy.RULES, rules=PayoffRules()) == [card, bnpl, personal, home]
    # Pin the home loan (position 0) to the front.
    assert rank_loans(loans, r, Strategy.RULES, rules=PayoffRules(pinned=[0])) == [home, card, bnpl, personal]
    # Clear anything under ₹1,00,000 first, smallest first; then by rate.
    assert rank_loans(loans, r, Strategy.RULES, rules=PayoffRules(small_first_below=D("100000"))) == [bnpl, card, personal, home]
    # Pin + small: pinned first, then the small ones, then by rate.
    assert rank_loans(loans, r, Strategy.RULES, rules=PayoffRules(small_first_below=D("100000"), pinned=[2])) == [personal, bnpl, card, home]
    # A custom order wins over the other rules; loans it leaves out follow by rate.
    assert rank_loans(loans, r, Strategy.RULES, rules=PayoffRules(small_first_below=D("100000"), pinned=[2], custom_order=[3, 0])) == [bnpl, home, card, personal]


def test_hybrid_is_exactly_its_rule():
    home, card, personal, bnpl = _loans()
    loans = [home, card, personal, bnpl]
    r = _rates(*loans)
    for c in (Country.IN, Country.US):
        assert rank_loans(loans, r, Strategy.HYBRID, country=c) == apply_rules(loans, r, hybrid_rules(c), lambda l: l.outstanding)
    assert hybrid_rules(Country.IN).small_first_below == D("50000")
    assert hybrid_rules(Country.US).small_first_below == D("1000")


def test_rules_name_loans_by_their_place_in_the_profile_not_in_the_active_list():
    """The simulation ranks only the open loans; a cleared loan ahead of the
    pinned one must not shift which loan the pin names."""
    home, card, personal, _ = _loans()
    r = _rates(home, personal)
    index_of = {id(card): 0, id(home): 1, id(personal): 2}
    ranked = rank_loans([home, personal], r, Strategy.RULES, rules=PayoffRules(pinned=[1]), index_of=index_of)
    assert ranked == [home, personal]


def test_simulation_sends_the_extra_to_the_pinned_loan():
    """Before PR E the simulation never saw the rules: strategy RULES fell
    through to ValueError and Hybrid was the only alternative."""
    home, card, personal, _ = _loans()
    u = _user([home, card, personal], PayoffRules(pinned=[2]))
    pinned = simulate_plan(u, strategy=Strategy.RULES, horizon_months=12)
    aval = simulate_plan(_user([home, card, personal]), strategy=Strategy.AVALANCHE, horizon_months=12)
    first, first_av = pinned.months[0], aval.months[0]
    # The personal loan (13%) gets the extra under the pin; the card (36%) under avalanche.
    assert first.payments_by_loan_index[2] > first_av.payments_by_loan_index[2] + D("50000")
    assert first_av.payments_by_loan_index[1] > first.payments_by_loan_index[1] + D("50000")
    # Pinning a cheaper loan costs interest against avalanche.
    assert pinned.total_interest_paid > aval.total_interest_paid


def test_simulated_hybrid_and_its_rule_give_the_same_plan():
    home, card, personal, bnpl = _loans()
    h = simulate_plan(_user([home, card, personal, bnpl]), strategy=Strategy.HYBRID, horizon_months=360)
    r = simulate_plan(_user([home, card, personal, bnpl], hybrid_rules(Country.IN)), strategy=Strategy.RULES, horizon_months=360)
    assert (h.debt_free_month, h.total_interest_paid) == (r.debt_free_month, r.total_interest_paid)


def test_windfall_follows_the_rules():
    home, card, personal, _ = _loans()
    loans = [home, card, personal]
    fund = [InvestmentOption(name="Liquid", expected_return=D("0.05"), liquidity_class=LiquidityClass.LIQUID, is_in_pool=True)]
    a = allocate_windfall(D("50000"), loans, _rates(*loans), fund, D("0.046"),
                          strategy=Strategy.RULES, rules=PayoffRules(pinned=[2]))
    assert a.to_loan_id == id(personal)
    assert "your rules" in a.rationale
    # Without rules, RULES is plain avalanche: the card.
    b = allocate_windfall(D("50000"), loans, _rates(*loans), fund, D("0.046"), strategy=Strategy.RULES)
    assert b.to_loan_id == id(card)


def _exporter():
    spec = importlib.util.spec_from_file_location("export_payoff_rules_cases", ROOT / "scripts" / "export_payoff_rules_cases.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def test_differential_fixture_is_current():
    mod = _exporter()
    assert mod.OUT_PATH.read_text(encoding="utf-8") == mod.render(), (
        "engine/tests/fixtures/payoff_rules_cases.json is stale: run python scripts/export_payoff_rules_cases.py"
    )
