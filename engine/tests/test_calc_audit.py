"""Worked examples for the shared amortisation walk and the card cost Home shows.

The numbers are the standard reducing-balance identities, checked by hand,
not a snapshot of whatever the code happened to print.
"""
from decimal import Decimal

from engine.formulas import emi, remaining_balance, schedule_interest
from engine.marginal_cost import compounded, marginal_cost
from engine.models import Country, Loan, LoanType
from engine.restructuring_scan import displayed_card_cost

D = Decimal


def test_emi_worked_examples():
    # ₹1,00,000 at 12% for 12 months.
    # r = 0.01; EMI = 100000 × 0.01 × 1.01^12 / (1.01^12 − 1) = 8,884.878…
    got = emi(D("100000"), D("0.12"), 12)
    assert abs(got - D("8884.878868")) < D("0.001")
    # Zero interest is the principal split across the months.
    assert emi(D("120000"), D("0"), 10) == D("12000")
    # One month: principal plus one month of interest.
    assert emi(D("100000"), D("0.12"), 1) == D("101000")
    # Nothing to amortise: the principal is still owed.
    assert emi(D("5000"), D("0.10"), 0) == D("5000")


def test_schedule_interest_stops_when_the_balance_is_gone():
    # ₹5,000 at 12%, paying ₹10,000. One month of interest (₹50), then clear.
    # Walking the full EMI past a zero balance would invent later interest.
    assert schedule_interest(D("5000"), D("0.12"), D("10000"), 12) == D("50")


def test_prepaying_saves_part_of_the_interest_not_the_whole_loan():
    payment = emi(D("100000"), D("0.12"), 24)
    full = schedule_interest(D("100000"), D("0.12"), payment, 24)
    after = schedule_interest(D("80000"), D("0.12"), payment, 24)
    saved = full - after
    assert saved > D("1000")
    assert saved < full
    # A zero-rate loan has no interest to save.
    assert schedule_interest(D("100000"), D("0"), D("10000"), 10) == 0


def test_long_tenure_pays_the_principal_back():
    principal = D("5000000")
    payment = emi(principal, D("0.08"), 360)
    # Still owed just before the last year, and clear at the end of the term.
    assert remaining_balance(principal, D("0.08"), 360, 348) > D("100000")
    assert remaining_balance(principal, D("0.08"), 360, 360) == 0
    interest = schedule_interest(principal, D("0.08"), payment, 360)
    assert interest > principal  # 30 years at 8% costs more than the principal
    # Interest equals what 360 EMIs pay beyond the principal (the schedule
    # lands on zero, so the last instalment is a full EMI).
    assert abs(interest - (payment * 360 - principal)) < D("1")


def test_card_cost_on_the_offer_matches_home():
    """36% Indian card, no tax shield. Home shows compounded interest plus
    18% GST on that interest. Compounding the GST-loaded forward rate does not."""
    card = Loan(
        loan_type=LoanType.CREDIT_CARD, bank="HDFC Bank", outstanding=D("100000"),
        nominal_rate=D("0.36"), rate_type="fixed", tenure_months_remaining=0, scheduled_emi=D("0"),
    )
    forward = D("0.36") * D("1.18")
    shown = displayed_card_cost(card, forward, Country.IN)
    home = marginal_cost(D("0.36"), True, D("0"), D("0"), 0).annual_cost
    assert shown == home
    assert shown != compounded(forward)
    # A US card has no GST, so the shown cost is just the compounded rate.
    us = displayed_card_cost(card, D("0.36"), Country.US)
    assert us == compounded(D("0.36"))
