"""Layer 2 ordering — avalanche/hybrid/snowball + cascade."""
from decimal import Decimal
from engine.ordering import (
    Strategy, rank_loans,
    hybrid_small_balance_threshold,
)
from engine.models import Country, Loan, LoanType

D = Decimal


def _loans():
    """Three loans: home (large, low rate), card (small, high rate), personal (medium)."""
    home = Loan(loan_type=LoanType.HOME, bank="HDFC Bank",
                outstanding=D("4000000"), nominal_rate=D("0.085"), rate_type="floating",
                tenure_months_remaining=240, scheduled_emi=D("34713"))
    card = Loan(loan_type=LoanType.CREDIT_CARD, bank="ICICI Bank",
                outstanding=D("80000"), nominal_rate=D("0.36"), rate_type="fixed",
                tenure_months_remaining=12, scheduled_emi=D("0"))
    personal = Loan(loan_type=LoanType.PERSONAL, bank="SBI",
                    outstanding=D("300000"), nominal_rate=D("0.13"), rate_type="fixed",
                    tenure_months_remaining=36, scheduled_emi=D("10110"))
    return home, card, personal


def test_avalanche_orders_by_effective_rate_desc():
    home, card, personal = _loans()
    rates = {id(home): D("0.085"), id(card): D("0.4248"), id(personal): D("0.13")}
    ranked = rank_loans([home, card, personal], rates, Strategy.AVALANCHE)
    assert ranked == [card, personal, home]


def test_snowball_orders_by_balance_asc():
    home, card, personal = _loans()
    rates = {id(home): D("0.085"), id(card): D("0.4248"), id(personal): D("0.13")}
    ranked = rank_loans([home, card, personal], rates, Strategy.SNOWBALL)
    assert ranked == [card, personal, home]


def test_hybrid_small_balances_first_then_avalanche():
    home, card, personal = _loans()
    rates = {id(home): D("0.085"), id(card): D("0.4248"), id(personal): D("0.13")}
    # India threshold ₹50k → card 80k is NOT in small bucket. Add a small loan.
    bnpl = Loan(loan_type=LoanType.BNPL, bank="Lazypay", outstanding=D("15000"),
                nominal_rate=D("0.24"), rate_type="fixed", tenure_months_remaining=6,
                scheduled_emi=D("2700"))
    rates[id(bnpl)] = D("0.24")
    ranked = rank_loans([home, card, personal, bnpl], rates, Strategy.HYBRID,
                        country=Country.IN)
    # Small bucket: [bnpl]; rest by rate desc: [card, personal, home]
    assert ranked == [bnpl, card, personal, home]


def test_hybrid_uses_us_threshold_when_country_is_us():
    # US threshold $1,000 — a $800 store card jumps the queue; a $5,000 card doesn't.
    store_card = Loan(loan_type=LoanType.CREDIT_CARD, bank="Macy's",
                      outstanding=D("800"), nominal_rate=D("0.299"), rate_type="fixed",
                      tenure_months_remaining=12, scheduled_emi=D("75"))
    chase_card = Loan(loan_type=LoanType.CREDIT_CARD, bank="Chase",
                      outstanding=D("5000"), nominal_rate=D("0.2424"), rate_type="fixed",
                      tenure_months_remaining=24, scheduled_emi=D("250"))
    auto = Loan(loan_type=LoanType.AUTO, bank="Capital One",
                outstanding=D("18000"), nominal_rate=D("0.07"), rate_type="fixed",
                tenure_months_remaining=48, scheduled_emi=D("431"))
    rates = {id(store_card): D("0.299"), id(chase_card): D("0.2424"), id(auto): D("0.07")}
    ranked = rank_loans([auto, chase_card, store_card], rates, Strategy.HYBRID,
                        country=Country.US)
    # Small bucket: [store_card]; rest by rate desc: [chase_card, auto]
    assert ranked == [store_card, chase_card, auto]


def test_hybrid_threshold_helper_per_country():
    assert hybrid_small_balance_threshold(Country.IN) == D("50000")
    assert hybrid_small_balance_threshold(Country.US) == D("1000")


