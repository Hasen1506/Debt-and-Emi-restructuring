"""Layer 2 ordering — avalanche/hybrid/snowball + cascade."""
from decimal import Decimal
from engine.ordering import Strategy, rank_loans, allocate_extra, cascade_on_payoff
from engine.models import Loan, LoanType

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
    # Threshold ₹50k → card is below; personal and home above.
    # Card first (small bucket), then personal/home by rate.
    # Actually card 80k > 50k → not in small bucket. Add a small loan.
    bnpl = Loan(loan_type=LoanType.BNPL, bank="Lazypay", outstanding=D("15000"),
                nominal_rate=D("0.24"), rate_type="fixed", tenure_months_remaining=6,
                scheduled_emi=D("2700"))
    rates[id(bnpl)] = D("0.24")
    ranked = rank_loans([home, card, personal, bnpl], rates, Strategy.HYBRID)
    # Small bucket: [bnpl]; rest by rate desc: [card, personal, home]
    assert ranked == [bnpl, card, personal, home]


def test_allocate_extra_routes_all_to_top_priority():
    home, card, personal = _loans()
    mins = {id(home): D("34713"), id(card): D("4000"), id(personal): D("10110")}
    ranked = [card, personal, home]
    payments = allocate_extra(ranked, mins, D("15000"))
    assert payments[id(card)] == D("4000") + D("15000")
    assert payments[id(personal)] == D("10110")
    assert payments[id(home)] == D("34713")


def test_allocate_extra_zero_surplus_keeps_minimums():
    home, card, personal = _loans()
    mins = {id(home): D("34713"), id(card): D("4000"), id(personal): D("10110")}
    payments = allocate_extra([card, personal, home], mins, D("0"))
    assert payments[id(card)] == D("4000")
    assert payments[id(home)] == D("34713")


def test_cascade_returns_freed_amount():
    home, card, personal = _loans()
    freed = cascade_on_payoff(cleared_loan=card, extra_allocated_to_cleared=D("15000"),
                              minimum_of_cleared=D("4000"))
    assert freed == D("19000")
