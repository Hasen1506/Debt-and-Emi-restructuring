"""Behind / collections loans in the plan (founder decision 17 Oct 2026,
docs/FOUNDER-RECORDS.md B17; engine/debt_status.py).

Hand check for the catch-up: take-home ₹1,40,000, spending ₹45,000, a
personal loan's EMI ₹10,871 and a car loan's ₹8,000 leave ₹76,129 spare. A
behind loan ₹30,000 overdue takes ₹30,000 of it first, before the emergency
fund and the avalanche; the rest follows the normal order.
"""
from decimal import Decimal

from engine.debt_status import DebtStatusPlan, is_held, overdue_of
from engine.models import Country, IncomeType, Loan, LoanType, PayoffRules, TaxRegimeIN, User
from engine.simulation import Strategy, simulate_plan

D = Decimal
MR = D("0.2")


def pl(**kw):
    return Loan(LoanType.PERSONAL, "SBI", D("500000"), D("0.11"), "fixed", 60, D("10871"), **kw)


def car(**kw):
    return Loan(LoanType.AUTO, "HDFC", D("400000"), D("0.09"), "fixed", 60, D("8000"), **kw)


def card(**kw):
    return Loan(LoanType.CREDIT_CARD, "ICICI", D("80000"), D("0.42"), "fixed", 0, D("0"), **kw)


def user(loans, **kw):
    kw.setdefault("tax_regime", TaxRegimeIN.NEW)
    return User(Country.IN, IncomeType.SALARIED, D("1680000"), D("140000"), D("45000"), D("0"), "SBI",
                loans=loans, **kw)


def run(u, **kw):
    return simulate_plan(u, Strategy.AVALANCHE, horizon_months=360, marginal_rate=MR, **kw)


def test_overdue_blank_is_one_emi_estimated():
    assert overdue_of(pl(debt_status="behind"), D("10871")) == (D("10871"), True)
    assert overdue_of(pl(debt_status="behind", overdue_amount=D("30000")), D("10871")) == (D("30000"), False)


def test_behind_overdue_is_paid_first_then_the_normal_order():
    # Avalanche alone sends the extra to the 11% personal loan, not the 9% car.
    u = user([pl(), car(debt_status="behind", overdue_amount=D("30000"))], efund_target=D("200000"))
    r = run(u)
    m1 = r.months[0]
    assert m1.catch_up_by_loan_index == {1: D("30000")}
    # The car loan got its EMI plus the ₹30,000 overdue, ahead of the fund and the avalanche.
    assert m1.payments_by_loan_index[1] == D("8000") + D("30000")
    # Month 2: caught up, so no more catch-up; the car is back to its EMI.
    assert r.months[1].catch_up_by_loan_index == {}
    assert r.months[1].payments_by_loan_index[1] == D("8000")


def test_catch_up_comes_before_the_emergency_fund():
    base = run(user([pl(), car()], efund_target=D("500000")))
    behind = run(user([pl(), car(debt_status="behind", overdue_amount=D("70000"))], efund_target=D("500000")))
    # ₹76,129 spare: ₹70,000 catch-up first, so the fund's ₹41,667 top-up gets only ₹6,129.
    assert base.months[0].efund_balance > D("41000")
    assert behind.months[0].catch_up_by_loan_index[1] == D("70000")
    assert abs(behind.months[0].efund_balance - D("6129")) < D("1")


def test_catch_up_never_exceeds_spare_cash():
    tight = user([pl(), car(debt_status="behind", overdue_amount=D("500000"))])
    m1 = run(tight).months[0]
    # All ₹76,129 of the spare cash, and nothing is left for anything else.
    assert m1.catch_up_by_loan_index[1] == D("76129") and m1.available_surplus == 0


def test_secured_behind_loan_is_caught_up_first():
    u = user([pl(debt_status="behind", overdue_amount=D("70000")), car(debt_status="behind", overdue_amount=D("70000"))])
    m1 = run(u).months[0]
    assert m1.catch_up_by_loan_index[1] == D("70000")             # the car (secured) first
    assert m1.catch_up_by_loan_index.get(0, D("0")) < D("70000")    # the rest of the spare cash


def test_collections_loan_gets_no_extra_and_builds_a_pot():
    normal = run(user([card(), pl()]))
    assert normal.months[0].extra_to_loan_index == 0              # the 42% card would get the extra
    r = run(user([card(debt_status="collections"), pl()]))
    m1 = r.months[0]
    pot = m1.settlement_pot_by_loan_index[0]
    # The card's balance is not paid down by the pot (the plan doesn't count it as paid).
    assert m1.extra_to_loan_index != 0
    assert pot > 0 and pot <= D("80000")
    assert m1.balances_by_loan_index[0] > normal.months[0].balances_by_loan_index[0]
    # The pot is capped at the balance owed when it is filled (the month's
    # opening balance); the rest goes on to the next loan in the order.
    for prev, cur in zip(r.months[:12], r.months[1:13]):
        assert cur.settlement_pot_by_loan_index[0] <= prev.balances_by_loan_index[0] + D("0.01")
    assert any(m.extra_to_loan_index == 1 for m in r.months[:6])


def test_user_pin_wins_over_the_pot():
    c = card(debt_status="collections", extra_ok=True)
    assert not is_held(c)
    r = run(user([c, pl()], payoff_rules=PayoffRules(pinned=[0])))
    assert r.months[0].settlement_pot_by_loan_index == {}
    assert r.months[0].extra_to_loan_index == 0


def test_normal_loans_unchanged():
    a = run(user([card(), pl(), car()]))
    b = run(user([card(debt_status="normal"), pl(), car()]))
    assert a.debt_free_month == b.debt_free_month and a.total_interest_paid == b.total_interest_paid
    assert all(m.catch_up_by_loan_index == {} and m.settlement_pot_by_loan_index == {} for m in a.months)


def test_pot_is_released_when_the_loan_clears():
    plan = DebtStatusPlan([card(debt_status="collections")], {}, user([]))
    l = next(iter(plan.loans.values()))
    plan.position = {id(l): 0}
    assert plan.fill_pots([l], D("5000"), lambda _: True) == 0
    assert plan.total_pot() == D("5000")
    l.outstanding = D("0")
    assert plan.release_cleared() == D("5000") and plan.total_pot() == 0


def test_minimums_only_has_no_catch_up_or_pot():
    r = run(user([card(debt_status="collections"), car(debt_status="behind")]), minimums_only=True)
    assert all(m.catch_up_by_loan_index == {} and m.settlement_pot_by_loan_index == {} for m in r.months)


# ── Payday email (item 5): no "normal due" lines for behind / collections loans ──

def _digest(rows):
    from datetime import date
    from engine.payday import build_digest, parse_snapshot
    snap = parse_snapshot({"month": "2026-10", "made_on": "2026-10-17", "country": "IN", "currency": "INR",
                           "rows": rows})
    links = {k: f"https://x/{k}" for k in ("all_paid", "some_paid", "cant_pay", "open_app", "unsubscribe")}
    return snap, build_digest(snap, today=date(2026, 10, 17), links=links)


def test_payday_email_lists_catch_up_and_collections_lines():
    snap, d = _digest([
        {"name": "HDFC car loan", "amount": "38000", "currency": "INR", "kind": "catch_up"},
        {"name": "ICICI card", "amount": "4000", "currency": "INR", "kind": "collections"},
        {"name": "Settlement pot (ICICI card)", "amount": "20000", "currency": "INR", "kind": "pot"},
        {"name": "SBI personal loan", "amount": "10871", "currency": "INR", "kind": "emi"},
    ])
    # The collector's line is shown but is not in the total.
    assert snap.total == D("38000") + D("20000") + D("10871")
    assert "HDFC car loan: ₹38,000, behind: EMI + what's overdue, to catch up" in d.text
    assert "ICICI card: ₹4,000, with a collection agency: don't pay until the debt is confirmed in writing" in d.text
    assert "settlement pot" in d.text and "HDFC car loan is behind" in d.text
    assert "ICICI card is with a collection agency" in d.text
    assert "ICICI card: ₹4,000, minimum due" not in d.text and "HDFC car loan: ₹38,000, EMI\n" not in d.text


def test_payday_tax_row_is_accepted():
    snap, _ = _digest([{"name": "Advance tax due 15 Dec", "amount": "9000", "currency": "INR", "kind": "tax"}])
    assert snap.rows[0].kind == "tax"
