"""UX walkthrough fixes (16 Oct 2026, work/reports/ux-walkthrough.md).

Personas are the walkthrough's own: S1 India healthy (home loan, two cards,
personal loan), S2 India short this month, S3 capped (not fundable from a
month). Each test names the fix it guards."""
from __future__ import annotations

from decimal import Decimal as D

import pytest

from engine.consolidation import PLAN_CLEARS_SOON_MONTHS, consolidation_card, published_range
from engine.decisions import money
from engine.formulas import emi
from engine.models import Country, IncomeType, Loan, LoanType, User
from engine.ordering import Strategy
from engine.plan_end import shown_debt_free_month
from engine.plan_insights import disagreements, gap_ways
from engine.simulation import simulate_plan

from engine.tests.test_a80_w03_insights import DISCLOSURES

PUB = published_range(DISCLOSURES)
MR = D("0.26")


def card(bal: str, rate: str, bank: str = "") -> Loan:
    return Loan(LoanType.CREDIT_CARD, bank, D(bal), D(rate), "fixed", 0, D("0"))


def emi_loan(t, bal: str, rate: str, n: int, e: str, rt: str = "fixed") -> Loan:
    return Loan(t, "", D(bal), D(rate), rt, n, D(e))


def user(take: str, spend: str, loans: list[Loan]) -> User:
    return User(Country.IN, IncomeType.SALARIED, D(take) * 12, D(take), D(spend), D("0"), "", loans=loans)


def s1() -> User:
    return user("180000", "60000", [
        emi_loan(LoanType.HOME, "4500000", "0.086", 240, "42000", "floating"),
        card("60000", "0.42"), card("25000", "0.36"),
        emi_loan(LoanType.PERSONAL, "300000", "0.135", 36, "10200"),
    ])


def s2() -> User:
    return user("55000", "38000", [
        emi_loan(LoanType.PERSONAL, "350000", "0.14", 36, "12000"),
        card("120000", "0.42"), card("40000", "0.40"),
    ])


def s3() -> User:
    return user("40000", "35000", [
        emi_loan(LoanType.HOME, "2200000", "0.09", 240, "20000", "floating"),
        card("50000", "0.42"),
    ])


def run(u, strategy=Strategy.AVALANCHE):
    return simulate_plan(u, strategy, horizon_months=600, marginal_rate=MR)


def _dis(u, cons):
    base = run(u)
    return disagreements(u, base, lambda x: run(x, Strategy.RULES), MR, money, consolidation=cons)


# ── fix 1: the card-to-loan pitch never contradicts the plan ───────────────

def test_fix1_s1_cards_cleared_soon_means_no_pitch_and_no_worth():
    """S1: the plan clears both cards in its first two months, so a 36-month
    loan for them is not advice ("WORTH ₹1,293" beside "not worth it")."""
    u = s1()
    c = consolidation_card(u, run, MR, PUB)
    assert c is not None and c.plan_clears_month is not None
    assert c.plan_clears_month <= PLAN_CLEARS_SOON_MONTHS
    assert c.not_worth_it == "plan_clears"
    d = _dis(u, c)
    assert all(i.kind != "consolidation" for i in d.items)
    assert "personal loan" not in " ".join(i.headline for i in d.items)


def test_fix1_short_plan_keeps_the_card_when_it_frees_cash():
    """S2: a short month; the move frees cash, so it stays advice (A5/A6)."""
    u = s2()
    base = run(u)
    c = consolidation_card(u, run, MR, PUB, base=base)
    assert c is not None and c.not_worth_it is None
    g = gap_ways(u, base, run, money, consolidation=c)
    assert g is not None and g.ways[0].kind == "consolidate"


def test_fix1_restructuring_and_consolidation_share_one_line():
    """The "Cheaper rates" scan holds a move back when the plan clears the
    debt within two months; the consolidation card uses the same constant."""
    import inspect

    from engine import restructuring_scan
    assert PLAN_CLEARS_SOON_MONTHS == 2
    assert "clears <= 2" in inspect.getsource(restructuring_scan)


# ── fix 2: capped plans never leak a paper date ─────────────────────────────

def test_fix2_capped_plan_consolidation_scenarios_carry_no_date():
    u = s3()
    base = run(u)
    assert base.infeasible_from_month is not None and base.debt_free_month is not None
    c = consolidation_card(u, run, MR, PUB, base=base)
    assert c is not None and c.scenarios
    for s in c.scenarios:
        assert s.debt_free_before is None and s.debt_free_after is None


def test_fix2_offer_check_and_prepay_options_read_the_shown_date():
    from engine.offer_check import Offer, check_offer
    u = s3()
    base = run(u)
    assert shown_debt_free_month(base) is None
    r = check_offer(u, Offer("personal_loan", "spend", D("50000"), 24, D("0.16")), run, MR, money,
                    month_label=lambda m: f"m{m}")
    assert r.debt_free_before is None
    assert "debt-free date" not in r.headline


# ── fix 3: spare cash on a short or capped plan covers the gap first ───────

def test_fix3_short_plan_hold_covers_the_gap_and_names_no_saving():
    from engine.decisions import short_plan_hold
    h = short_plan_hold(D("100000"), D("17500"))
    assert h is not None and h.months_covered == 5
    assert "₹17,500 a month short" in h.rationale and "interest" not in h.rationale.lower()
    # Founder 17 Oct 2026: worded as the reason it is kept (no missed payment).
    assert h.rationale.startswith("Kept for the shortfall so no payment is missed")
    later = short_plan_hold(D("10000"), D("17500"), short_from_label="Apr 2027")
    assert later.months_covered == 0 and "from Apr 2027" in later.rationale and "part of one" in later.rationale
    assert short_plan_hold(D("100000"), D("0")) is None
    assert short_plan_hold(D("0"), D("5000")) is None


@pytest.mark.parametrize("gap", ["1", "999", "17500", "250000"])
def test_fix3_hold_months_never_overstate(gap):
    from engine.decisions import short_plan_hold
    h = short_plan_hold(D("100000"), D(gap))
    assert h.months_covered * D(gap) <= D("100000") < (h.months_covered + 1) * D(gap)


def test_fix2_what_if_compare_and_payoff_range_drop_capped_dates():
    from engine.sensitivity import compare, debt_free_range
    u = s3()
    base = run(u)
    d = compare(base, base)
    assert d["debt_free_month_baseline"] is None and d["debt_free_month_scenario"] is None
    assert d["months_pulled_forward"] == 0
    r = debt_free_range(u, Strategy.AVALANCHE, 600, MR, baseline=base)
    assert r["exact"] is None


# ── Fix 4: one "what you owe today" ─────────────────────────────────────────

def test_fix4_owed_today_is_the_start_of_month_balance_less_the_paid_emis_principal():
    """S1: the home loan's balance was entered after October's EMI (₹45,00,000).
    The plan opens with the EMI added back; owed today is the balance as typed."""
    from engine.owed_today import owed_today
    r = D("0.086") / 12
    typed, e = D("4500000"), D("42000")
    opening = (typed + e) / (1 + r)                          # web roll-forward add-back
    home = emi_loan(LoanType.HOME, str(opening), "0.086", 200, "42000")
    cc = card("60000", "0.42")
    u = user("180000", "60000", [home, cc])
    o = owed_today(u, [0])
    assert abs(o.total - (typed + D("60000"))) <= 1          # Home's ₹45,60,000
    assert o.start_of_month == (opening + D("60000")).quantize(D("1"))
    assert o.emi_paid == e and abs(o.interest_in_paid - opening * r) <= 1
    assert abs((o.start_of_month - o.total) - (e - o.interest_in_paid)) <= 1   # principal repaid
    # Nothing marked paid: the two agree. A card is never paid down by an EMI.
    assert owed_today(u).total == owed_today(u).start_of_month
    assert owed_today(u, [1]).total == owed_today(u).total


def test_fix4_owed_today_ignores_flat_and_pre_emi_loans_and_out_of_range_positions():
    from engine.owed_today import owed_today
    flat = emi_loan(LoanType.PERSONAL, "300000", "0.12", 36, "11000")
    flat.rate_basis = "flat"
    u = user("100000", "40000", [flat])
    assert owed_today(u, [0, 7]).total == D("300000")
