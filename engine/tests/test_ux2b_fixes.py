"""UX walkthrough round 2, part B fixes (16 Oct 2026, work/reports/ux-fix-2b.md)."""
from __future__ import annotations

from decimal import Decimal as D

from engine.consolidation import consolidation_card
from engine.models import LoanType
from engine.tests.test_ux1_walkthrough import MR, PUB, card, emi_loan, run, s2, user


def test_b12_student_stipend_gets_no_personal_loan_pitch():
    """n14: a ₹9,000 stipend and a ₹4,500 card; no bank lends that."""
    u = user("9000", "6000", [card("4500", "0.42")])
    c = consolidation_card(u, run, MR, PUB)
    assert c is not None and c.not_worth_it in ("not_approvable", "plan_clears")
    u = user("9000", "8500", [card("60000", "0.42")])            # income alone
    assert consolidation_card(u, run, MR, PUB).not_worth_it == "not_approvable"


def test_b12_tiny_balance_and_high_foir_are_held_back():
    u = user("80000", "40000", [card("12000", "0.42"), emi_loan(LoanType.PERSONAL, "200000", "0.14", 36, "6000")])
    c = consolidation_card(u, run, MR, PUB)
    assert c.not_worth_it in ("not_approvable", "plan_clears")
    # Payments already ~58% of pay; with the new EMI over 60%.
    u = user("60000", "15000", [emi_loan(LoanType.HOME, "3000000", "0.09", 240, "33000", "floating"), card("150000", "0.42")])
    c = consolidation_card(u, run, MR, PUB)
    assert all(s.payments_share_after > D("0.60") for s in c.scenarios)
    assert c.not_worth_it == "not_approvable"
    # The user's own quote is a lender's offer: shown, not gated.
    mine = consolidation_card(u, run, MR, PUB, user_rate=D("0.14"))
    assert mine.not_worth_it != "not_approvable"


def test_b12_ux1_short_month_still_pitched():
    c = consolidation_card(s2(), run, MR, PUB)
    assert c.not_worth_it is None


def test_b5_zero_percent_promo_then_the_rate_jumps():
    """u06: a 0% balance-transfer card; the plan charged nothing for ever.
    With an end month the card's own rate applies after it."""
    from engine.ordering import Strategy
    from engine.simulation import simulate_plan
    c = card("300000", "0")
    c.promo_months, c.rate_after_promo = 6, D("0.42")
    u = user("80000", "40000", [c])
    res = simulate_plan(u, Strategy.AVALANCHE, horizon_months=120, marginal_rate=MR)
    assert all(r.interest_paid_month == 0 for r in res.months[:6])
    assert res.months[6].interest_paid_month > 0
    flat = simulate_plan(user("80000", "40000", [card("300000", "0")]), Strategy.AVALANCHE, horizon_months=120, marginal_rate=MR)
    assert flat.total_interest_paid == 0 and res.total_interest_paid > 0


def test_b5_api_takes_the_promo(client=None):
    from api.schemas import LoanIn
    l = LoanIn(loan_type="credit_card", bank="", outstanding="300000", nominal_rate="0", rate_type="fixed",
               tenure_months_remaining=0, scheduled_emi="0", promo_months=6, rate_after_promo="0.42").to_engine()
    assert l.promo_months == 6 and l.rate_after_promo == D("0.42")
