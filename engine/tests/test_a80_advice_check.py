"""A8: the advice verifier. Golden cases in the different ways assistants and
bank RMs word the same claims; each must reach the same verdict.

The loans (hand-checked numbers):
  0 SBI home loan  ₹50,00,000 at 8.50%, EMI ₹43,391 (240 months), floating
  1 HDFC card      ₹85,000 at 42%
  2 Axis card      ₹35,000 at 39%
  3 Bajaj personal ₹4,00,000 at 13.5%, EMI ₹13,600, fixed
The plan puts this month's extra on loan 1 (HDFC card, highest rate).
"""
from datetime import date
from decimal import Decimal as D

import pytest
from hypothesis import given, settings, strategies as st

from engine.advice_check import (
    AGREE, CANT, DISAGREE, AdviceLoan, PlanFacts, check, money, percents, sentences, tenure_months,
)

LOANS = [
    AdviceLoan("home_loan", D(5_000_000), D("0.085"), D("43391"), 240, "floating", "SBI"),
    AdviceLoan("credit_card", D(85_000), D("0.42"), None, None, "fixed", "HDFC"),
    AdviceLoan("credit_card", D(35_000), D("0.39"), None, None, "fixed", "Axis"),
    AdviceLoan("personal_loan", D(400_000), D("0.135"), D("13600"), 36, "fixed", "Bajaj"),
]
PLAN = PlanFacts(extra_target=1, strategy="avalanche", country="IN", today=date(2026, 10, 14))


def verdicts(text, loans=LOANS, plan=PLAN):
    return [(c.kind, c.verdict) for c in check(text, loans, plan).claims]


# ── numbers in Indian text ──────────────────────────────────────────────────

@pytest.mark.parametrize("text,want", [
    ("₹1,23,456", D(123456)), ("Rs. 50 lakh", D(5_000_000)), ("Rs50L", D(5_000_000)), ("INR 2.5 lakhs", D(250_000)),
    ("1.2 crore", D(12_000_000)), ("12k", D(12_000)), ("45,000 rupees", None), ("$1,200", D(1200)), ("1.5 cr", D(15_000_000)),
])
def test_money_formats(text, want):
    got = money(text)
    if want is None:
        assert got == []        # a bare number without ₹/lakh isn't taken as money
    else:
        assert got and got[0][1] == want


@pytest.mark.parametrize("text,want", [("8.5%", "0.085"), ("8.5 per cent", "0.085"), ("8.50 percent p.a.", "0.085"),
                                       ("42 %", "0.42")])
def test_percent_formats(text, want):
    assert percents(text)[0][1] == D(want)


@pytest.mark.parametrize("text,want", [("over 20 years", 240), ("for 60 months", 60), ("15-year", 180), ("36 mos", 36)])
def test_tenure_formats(text, want):
    assert tenure_months(text) == want


def test_decimals_dont_split_sentences():
    assert sentences("Your home loan is at 8.5% p.a. Pay the card first.") == [
        "Your home loan is at 8.5% p.a.", "Pay the card first."]


# ── payoff order, many wordings ─────────────────────────────────────────────

@pytest.mark.parametrize("text", [
    "Pay off the HDFC card first.",
    "Prioritize your HDFC credit card - it's the most expensive.",
    "I'd focus on the HDFC card before anything else.",
    "Put any extra money towards the HDFC card.",
    "Use the highest-interest-first (avalanche) method.",
    "Tackle the debt with the highest interest rate first.",
    "Start with the costliest debt first.",
])
def test_order_agree(text):
    assert ("order", AGREE) in verdicts(text)


@pytest.mark.parametrize("text", [
    "Pay off the Axis card first since it's the smallest.",
    "Clear your personal loan first to free up the EMI.",
    "Use the snowball method: smallest balance first.",
    "Throw your extra cash at the home loan.",
    "Focus on the Bajaj personal loan first.",
])
def test_order_disagree(text):
    assert ("order", DISAGREE) in verdicts(text)


def test_order_disagree_says_why_with_rates():
    c = check("Pay off the Axis card first.", LOANS, PLAN).claims[0]
    assert "42%" in c.why and "39%" in c.why


def test_order_cant_check_without_extra():
    assert verdicts("Pay off the HDFC card first.", plan=PlanFacts(extra_target=None, today=PLAN.today)) == [
        ("order", CANT)]


def test_dont_close_card_is_not_an_order_claim():
    assert ("order", AGREE) not in verdicts("Don't close your HDFC card, it helps your credit score.")


# ── rates and EMIs ──────────────────────────────────────────────────────────

@pytest.mark.parametrize("text,want", [
    ("Your SBI home loan at 8.5% is reasonable.", AGREE),
    ("The home loan is charging 8.50 per cent.", AGREE),
    ("Your home loan @ 9.25% is expensive.", DISAGREE),
    ("Your personal loan is at 11.5%.", DISAGREE),
    ("Bajaj charges you 13.5% p.a.", AGREE),
])
def test_rate_claims(text, want):
    assert ("rate", want) in verdicts(text)


@pytest.mark.parametrize("text,want", [
    ("Your home loan EMI should be about ₹43,400.", AGREE),
    ("EMI on the home loan works out to Rs 45,000.", DISAGREE),
    ("For 50 lakh over 20 years at 8.5% the EMI is ₹43,391.", AGREE),
    ("On ₹50 lakh at 8.5% for 20 years, the monthly instalment would be roughly 52,000 rupees, Rs 52k.", DISAGREE),
    ("Your personal loan EMI is Rs 13,600.", AGREE),
])
def test_emi_claims(text, want):
    assert ("emi", want) in verdicts(text)


# ── RBI rules ───────────────────────────────────────────────────────────────

@pytest.mark.parametrize("text,want", [
    ("Don't prepay the home loan, you'll pay a foreclosure penalty of 2%.", DISAGREE),
    ("Prepaying your home loan attracts a prepayment charge.", DISAGREE),
    ("There's no prepayment penalty on a floating home loan.", AGREE),
    ("Banks can't charge foreclosure charges on floating-rate home loans.", AGREE),
])
def test_prepayment_fee_rule(text, want):
    assert ("prepay_fee", want) in verdicts(text)


def test_fee_on_fixed_personal_loan_is_cant_check():
    assert ("prepay_fee", CANT) in verdicts("Your personal loan has a foreclosure charge of 4%.")


@pytest.mark.parametrize("text,want", [
    ("When you prepay, reduce the tenure instead of the EMI.", AGREE),
    ("Opt to lower your tenure rather than EMI.", AGREE),
    ("Ask the bank to reduce the EMI instead of the tenure.", DISAGREE),
])
def test_tenure_vs_emi(text, want):
    assert ("tenure_vs_emi", want) in verdicts(text)


@pytest.mark.parametrize("text,want", [
    ("Just pay the minimum due on your cards for now.", DISAGREE),
    ("Pay more than the minimum amount on the cards.", AGREE),
])
def test_minimum_due(text, want):
    assert ("minimum_due", want) in verdicts(text)


@pytest.mark.parametrize("text,want", [
    ("Take a personal loan at 14% to consolidate the cards.", AGREE),
    ("A balance transfer at 45% would help.", DISAGREE),
])
def test_consolidation(text, want):
    assert ("consolidate", want) in verdicts(text)


def test_invest_instead_of_prepay_with_42pct_card():
    assert ("invest_vs_prepay", DISAGREE) in verdicts("Invest in SIP instead of prepaying, mutual funds give 12%.")


@pytest.mark.parametrize("text,want", [("The repo rate is 5.5% now.", AGREE), ("Current repo rate is 5.25%.", DISAGREE)])
def test_repo_level(text, want):
    assert ("repo", want) in verdicts(text)


def test_tax_reason_not_to_prepay_new_regime():
    plan = PlanFacts(extra_target=1, today=PLAN.today, regime="new")
    assert ("tax_prepay", DISAGREE) in verdicts("Don't prepay your home loan, you lose the tax deduction.", plan=plan)


# ── whole answers from different "assistants" reach the same verdicts ──────

CHATGPT = """Here's a plan:
1. Pay off your Axis card first since it has the smallest balance.
2. Your home loan at 8.5% is fine. Don't prepay it - you'll pay a foreclosure penalty.
3. Always pay more than the minimum due."""
CLAUDE = """I'd start with the smallest balance - the Axis card - for a quick win. Your home loan's 8.50 per cent \
rate is fine, but keep in mind prepaying it will attract a prepayment charge. Pay above the minimum on cards."""
RM = """Sir, close Axis card first as per snowball. Home loan @ 8.5% is good. Prepayment penalty will be applicable \
on home loan. Pay over the minimum amount always."""


@pytest.mark.parametrize("text", [CHATGPT, CLAUDE, RM])
def test_same_advice_different_words_same_verdicts(text):
    got = sorted(set(verdicts(text)))
    assert got == sorted({("order", DISAGREE), ("rate", AGREE), ("prepay_fee", DISAGREE), ("minimum_due", AGREE)})


def test_nothing_checkable():
    r = check("Hope this helps! Let me know if you have questions.", LOANS, PLAN)
    assert r.claims == [] and "couldn't find" in r.headline


@settings(max_examples=150, deadline=None)
@given(st.text(max_size=400))
def test_never_raises_and_is_deterministic(text):
    a = check(text, LOANS, PLAN)
    b = check(text, LOANS, PLAN)
    assert [(c.kind, c.verdict, c.why) for c in a.claims] == [(c.kind, c.verdict, c.why) for c in b.claims]
    assert all(c.verdict in (AGREE, DISAGREE, CANT) for c in a.claims)
