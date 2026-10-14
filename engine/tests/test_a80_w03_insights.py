"""Audit 80+ W3: plan insights (A1, A2, A4, A5, A6, "Don't sign that", goals).

Golden cases carry a hand check in the comment; property tests guard the
class of defect (a floor rate used as the user's, a negative "worth", a
goal funded in a short month, a verdict phrased as an instruction to
invest, an option compared on different dates...)."""
from __future__ import annotations

import json
import re
from decimal import ROUND_CEILING, Decimal as D
from pathlib import Path

import pytest
from hypothesis import HealthCheck, given, settings, strategies as st

from engine.consolidation import (
    CARD_COST_TRIGGER, consolidate, consolidation_card, loan_amount, published_range, revolving_cards,
)
from engine.decisions import money
from engine.formulas import emi
from engine.goals import GoalState, serial_fill_allocation
from engine.models import Country, IncomeType, Loan, LoanType, TaxRegimeIN, User
from engine.offer_check import Offer, check_offer
from engine.ordering import Strategy
from engine.plan_insights import (
    LoanCheckFindingIn, disagreements, gap_ways, order_spread, plain_order,
)
from engine.prepay_invest import SHARES, compare, low_rate_phase
from engine.simulation import simulate_plan

ROOT = Path(__file__).resolve().parents[2]
FAST = settings(max_examples=15, deadline=None, suppress_health_check=[HealthCheck.too_slow])

# Banks' own disclosure rows (a trimmed copy of api/data/rate_disclosures/2026-10-12.json).
DISCLOSURES = {"as_of": "2026-10-12", "lenders": [
    {"name": "SBI", "source_url": "https://sbi.example/pl", "rows": [
        {"category": "personal_loan", "min": None, "max": None, "mean": "0.1154", "period_end": "2026-06-30", "period_label": "Apr-Jun 2026"}]},
    {"name": "HDFC Bank", "source_url": "https://hdfc.example/pl", "rows": [
        {"category": "personal_loan", "min": "0.0997", "max": "0.2406", "mean": "0.1089", "period_end": "2026-06-30", "period_label": "Apr-Jun 2026"}]},
    {"name": "ICICI Bank", "source_url": "https://icici.example/pl", "rows": [
        {"category": "personal_loan", "min": "0.0999", "max": "0.165", "mean": "0.116", "period_end": "2026-09-30", "period_label": "Jul-Sep 2026"}]},
    {"name": "Axis Bank", "source_url": "https://axis.example/pl", "rows": [
        {"category": "personal_loan", "min": "0.0875", "max": "0.2155", "mean": "0.1307", "period_end": "2026-06-30", "period_label": "Apr-Jun 2026"}]},
    {"name": "Kotak Mahindra Bank", "source_url": "https://kotak.example/pl", "rows": [
        {"category": "personal_loan", "min": "0.0975", "max": "0.3", "mean": "0.2189", "period_end": "2026-06-30", "period_label": "Apr-Jun 2026"}]},
    {"name": "IDFC FIRST Bank", "source_url": "https://idfc.example/pl", "rows": [
        {"category": "personal_loan", "min": "0.0999", "max": "0.24", "mean": "0.1258", "period_end": "2026-06-30", "period_label": "Apr-Jun 2026"},
        {"category": "home_loan", "min": "0.08", "max": "0.12", "mean": "0.09", "period_end": "2026-06-30", "period_label": "Apr-Jun 2026"}]},
]}
PUB = published_range(DISCLOSURES)


def card(bal="120000", rate="0.42", bank="HDFC Bank") -> Loan:
    return Loan(LoanType.CREDIT_CARD, bank, D(bal), D(rate), "fixed", 0, D("0"))


def loan(t, bank, bal, rate, n, emi_=None, **kw) -> Loan:
    rt = kw.pop("rt", "fixed")
    e = D(emi_) if emi_ else emi(D(bal), D(rate), n).quantize(D("1"))
    return Loan(t, bank, D(bal), D(rate), rt, n, e, **kw)


def persona(take: str, spend: str, regime=TaxRegimeIN.NEW, loans=None, gross=None) -> User:
    """The audit's P-short (85,000 / 42,000) and P-ok (1,40,000 / 45,000)."""
    loans = loans if loans is not None else [
        card(),
        loan(LoanType.PERSONAL, "ICICI Bank", "300000", "0.14", 36, "10500"),
        loan(LoanType.HOME, "SBI", "3500000", "0.086", 240, "32000", rt="floating"),
    ]
    return User(Country.IN, IncomeType.SALARIED, D(take) * 12, D(take), D(spend), D("0"), "SBI",
                tax_regime=regime, annual_gross_salary=D(gross) if gross else None, loans=loans)


def runner(mr=D("0.2")):
    def run(u, strategy=Strategy.AVALANCHE, lri=None):
        return simulate_plan(u, strategy, horizon_months=360, marginal_rate=mr, low_rate_invest=lri)
    return run


# ── published rates: never a bank's floor ───────────────────────────────────

def test_published_range_golden():
    # Means 10.89 11.54 11.60 12.58 13.07 21.89 -> middle two (11.60+12.58)/2 = 12.09%.
    # Maximums 16.5 21.55 24.0 24.06 30.0 (SBI publishes none) -> middle 24.0%.
    assert PUB.typical == D("0.1209") and PUB.high == D("0.2400") and PUB.banks == 6
    assert "Apr-Jun 2026" in PUB.period and "Jul-Sep 2026" in PUB.period


def test_committed_disclosure_file_parses():
    files = sorted((ROOT / "api" / "data" / "rate_disclosures").glob("*.json"))
    p = published_range(json.loads(files[-1].read_text()))
    assert p is not None and D("0.03") < p.typical < D("0.6")


@given(st.lists(st.tuples(st.decimals("0.08", "0.30", places=4), st.decimals("0.0", "0.10", places=4),
                          st.decimals("0.0", "0.15", places=4)), min_size=1, max_size=8))
def test_published_rate_is_never_the_floor(rows):
    """Class guard for E1: the rates offered as 'yours' are a middle of means
    or of maximums, never below every bank's mean (a floor)."""
    lenders = []
    for k, (mean, below, above) in enumerate(rows):
        lo, hi = max(D("0.03"), mean - below), min(D("0.6"), mean + above)
        lenders.append({"name": f"B{k}", "source_url": "u", "rows": [
            {"category": "personal_loan", "min": str(lo), "max": str(hi), "mean": str(mean), "period_end": "2026-06-30",
             "period_label": "Q"}]})
    p = published_range({"lenders": lenders})
    means = [r[0] for r in rows]
    assert min(means) - D("0.0001") <= p.typical <= max(means) + D("0.0001")
    assert p.high is None or p.high >= min(max(D("0.03"), m - b) for m, b, _ in rows)


# ── A6: consolidation ───────────────────────────────────────────────────────

def test_loan_amount_golden_and_fee():
    # No fee: the loan is the card balance.
    assert loan_amount(D("120000"), D("0"), D("0"), True) == (D("120000"), D("0.00"), D("0.00"))
    # 2% fee + 18% GST: P = ceil(120000 / (1 - 0.02 x 1.18)) = ceil(122,900.45) = 122,901;
    # fee 2,458.02, GST 442.44; P - fee - GST = 120,000.54 >= the card.
    assert loan_amount(D("120000"), D("0.02"), D("0"), True) == (D("122901"), D("2458.02"), D("442.44"))


@given(st.decimals("1000", "5000000", places=0), st.decimals("0", "0.05", places=4), st.decimals("0", "5000", places=0),
       st.booleans())
def test_loan_amount_always_clears_the_card(total, fee_pct, fee_flat, india):
    p, fee, gst = loan_amount(total, fee_pct, fee_flat, india)
    assert p - fee - gst >= total - D("0.01")
    assert p - fee - gst <= total + D("2")          # and never borrows much more than needed


def test_consolidation_golden_p_short():
    """P-short: card ₹1.2L at 42% (60.3% a year with GST, compounded).
    At 12% over 36 months: EMI = 120000 x 0.01 x 1.01^36 / (1.01^36 - 1) = 3,985.72 -> 3,986.
    Integration (W2 C14 x W1 C13): the HDFC card's minimum is its MITC rule,
    finance charge + 18% GST + 5% of the balance (was a flat 5% = ₹6,000).
    A full month's charge would be 4,200 + 756 + 6,000 = ₹10,956; C13 charges
    the average daily balance at the minimum, so the plan pays ₹10,807.
    Gap = 85,000 - 42,000 - 10,500 - 32,000 - 10,807 = -₹10,307; after the
    move -(85,000 - 42,000 - 10,500 - 32,000 - 3,986) = -₹3,486; freed
    10,807 - 3,986 = ₹6,821 = the fall in the gap."""
    u = persona("85000", "42000")
    run = runner()
    s = consolidate(u, lambda x: run(x), D("0.2"), [0], D("0.12"), 36)
    assert s.emi == D("3986") and s.card_minimum_now == D("10807") and s.cash_freed == D("6821")
    assert D("6000") < s.card_minimum_now < D("10956")
    assert s.gap_before == D("10307") and s.gap_after == D("3486")
    assert s.cash_freed == s.gap_before - s.gap_after   # "frees ₹X" is the plan's own gap change
    assert s.cost_window_months == 36            # a plan that never clears is compared over 36 months
    assert s.saving > 0 and s.verdict == "saves"


def test_consolidation_card_uses_typical_and_high_never_floor():
    u = persona("140000", "45000")
    c = consolidation_card(u, lambda x: runner()(x), D("0.2"), PUB)
    assert c.cards == [0] and c.card_cost[0] > CARD_COST_TRIGGER
    rates = {(s.rate, s.rate_basis) for s in c.scenarios}
    assert rates == {(D("0.1209"), "typical"), (D("0.2400"), "high")}
    floor = min(D(r["min"]) for l in DISCLOSURES["lenders"] for r in l["rows"] if r.get("min"))
    assert all(s.rate > floor for s in c.scenarios)
    # A higher rate never saves more (monotone in the rate).
    t, h = sorted(c.scenarios, key=lambda s: s.rate)
    assert t.saving >= h.saving and t.cash_freed >= h.cash_freed
    # The user's quote replaces the published ones.
    mine = consolidation_card(u, lambda x: runner()(x), D("0.2"), PUB, user_rate=D("0.155"))
    assert [(s.rate, s.rate_basis) for s in mine.scenarios] == [(D("0.155"), "yours")]


def test_no_card_over_trigger_means_no_card():
    u = persona("140000", "45000", loans=[loan(LoanType.HOME, "SBI", "3500000", "0.086", 240, "32000")])
    assert consolidation_card(u, lambda x: runner()(x), D("0.2"), PUB) is None
    # A US card at 24% is 26.8% a year compounded: under the 30% trigger.
    us = User(Country.US, IncomeType.SALARIED, D("90000"), D("6000"), D("3000"), D("0"), "Chase",
              loans=[Loan(LoanType.CREDIT_CARD, "Chase", D("6000"), D("0.24"), "fixed", 0, D("0"))])
    assert revolving_cards(us, D("0.22")) == []


@FAST
@given(st.decimals("0.08", "0.36", places=3), st.sampled_from([24, 36, 60]), st.decimals("0", "0.04", places=3))
def test_consolidation_invariants(rate, tenure, fee):
    u = persona("140000", "45000")
    s = consolidate(u, lambda x: runner()(x), D("0.2"), [0], rate, tenure, fee)
    assert s.cash_freed == s.card_minimum_now - s.emi
    assert s.principal - s.fee - s.fee_gst >= s.card_total - D("0.01")
    assert s.verdict == ("saves" if s.saving > 0 else "frees_cash_costs_more" if s.cash_freed > 0 else "costs_more")
    if s.break_even_fee_pct is not None:
        assert fee <= s.break_even_fee_pct <= D("0.05")


# ── A2: ask only when the order matters ─────────────────────────────────────

def test_p_ok_orders_identical_preselect_cheapest():
    sp = order_spread(persona("140000", "45000"), lambda u, s: runner()(u, s), D("0.2"))
    assert not sp.material and sp.cheapest == "avalanche" and sp.spread == 0
    # max(₹500, 0.5% of ₹7,61,195 interest) = ₹3,806.
    assert sp.threshold == D("3806")


def test_orders_that_differ_are_asked():
    u = persona("90000", "40000", loans=[
        loan(LoanType.PERSONAL, "Small NBFC", "30000", "0.11", 12),
        loan(LoanType.PERSONAL, "Bajaj Finance", "600000", "0.24", 60),
    ])
    sp = order_spread(u, lambda x, s: runner()(x, s), D("0.2"))
    assert sp.material and sp.cheapest == "avalanche" and sp.spread > sp.threshold


@FAST
@given(st.decimals("10000", "300000", places=0), st.decimals("0.10", "0.40", places=2),
       st.decimals("10000", "300000", places=0), st.decimals("0.10", "0.40", places=2))
def test_order_threshold_class(b1, r1, b2, r2):
    u = persona("150000", "50000", loans=[loan(LoanType.PERSONAL, "A", str(b1), str(r1), 36),
                                         loan(LoanType.PERSONAL, "B", str(b2), str(r2), 48)])
    sp = order_spread(u, lambda x, s: runner()(x, s), D("0.2"))
    cheapest = min(sp.runs, key=lambda r: r.net_cost)
    assert sp.threshold >= D("500") and sp.threshold >= (cheapest.interest * D("0.005")).quantize(D("1")) - 1
    assert sp.material == (sp.spread > sp.threshold or sp.months_apart != 0)
    assert next(r for r in sp.runs if r.strategy == sp.cheapest).net_cost == cheapest.net_cost


# ── A1: where we disagree with a plain calculator ───────────────────────────

def _dis(u, mr=D("0.2"), **kw):
    rd = simulate_plan(u, horizon_months=360, marginal_rate=mr)
    return disagreements(u, rd, lambda x: simulate_plan(x, Strategy.RULES, horizon_months=360, marginal_rate=mr),
                         mr, money, **kw), rd


def test_fee_reorder_worth_matches_fee_order_note():
    """A 4% prepayment fee on a 12% loan moves a 11.5% car loan first
    (engine/fee_order.py); the disagreement's worth is the same saving the
    fee-aware order reports in its own note."""
    u = persona("120000", "50000", loans=[
        loan(LoanType.PERSONAL, "Bajaj Finance", "400000", "0.12", 12, prepayment_penalty_pct=D("0.04")),
        loan(LoanType.AUTO, "HDFC Bank", "500000", "0.115", 60),
    ])
    d, rd = _dis(u)
    assert d.plain_order == [0, 1] and d.rightdue_order[0] == 1
    item = next(i for i in d.items if i.kind == "order")
    note_saving = D(re.search(r"saves about ₹([\d,]+)", rd.payoff_order_note).group(1).replace(",", ""))
    assert item.worth == note_saving and item.worth > 0
    assert "4.0% on each part-payment" in item.detail


def test_80e_after_tax_flip():
    """Old regime, 31.2% bracket: an 11% education loan (80E, interest fully
    deductible) costs about 11.6% x (1 - 0.312) = 8.0% a year after tax, less
    than a 9.5% car loan; a plain calculator pays the education loan first."""
    u = persona("120000", "50000", regime=TaxRegimeIN.OLD, gross="2400000", loans=[
        loan(LoanType.EDUCATION, "SBI", "800000", "0.11", 84),
        loan(LoanType.AUTO, "HDFC Bank", "600000", "0.095", 60),
    ])
    d, _ = _dis(u, D("0.312"))
    item = next(i for i in d.items if i.kind == "order")
    assert d.plain_order == [0, 1] and d.rightdue_order[0] == 1 and item.worth > 0
    assert "tax break" in item.detail and d.total_over_plan >= item.worth


def test_obvious_order_says_so_in_one_line():
    u = persona("140000", "45000", loans=[loan(LoanType.PERSONAL, "ICICI Bank", "300000", "0.14", 36),
                                         loan(LoanType.AUTO, "HDFC Bank", "500000", "0.09", 60)])
    d, _ = _dis(u)
    assert d.items == [] and d.total_over_plan == 0
    assert d.zero_line.startswith("Your order is the obvious one") and "watch" in d.zero_line


def test_loan_check_findings_are_this_year_not_in_total():
    u = persona("140000", "45000", loans=[loan(LoanType.HOME, "SBI", "3500000", "0.086", 240, "32000")])
    d, _ = _dis(u, loan_check=[LoanCheckFindingIn("old_benchmark", D("18500"), lender="Canara Bank"),
                               LoanCheckFindingIn("missed_rate_cut", D("0"))])
    assert [i.kind for i in d.items] == ["old_benchmark"] and d.items[0].basis == "this_year"
    assert d.total_over_plan == 0 and "₹18,500" in d.items[0].headline


@FAST
@given(st.lists(st.tuples(st.sampled_from([LoanType.PERSONAL, LoanType.AUTO, LoanType.EDUCATION, LoanType.CREDIT_CARD]),
                          st.decimals("20000", "800000", places=0), st.decimals("0.08", "0.42", places=3),
                          st.sampled_from([D("0"), D("0.03")])), min_size=1, max_size=4),
       st.sampled_from([TaxRegimeIN.NEW, TaxRegimeIN.OLD]))
def test_disagreements_never_negative_and_total_adds_up(spec, regime):
    loans = []
    for t, bal, r, fee in spec:
        if t == LoanType.CREDIT_CARD:
            loans.append(card(str(bal), str(r)))
        else:
            loans.append(loan(t, "Bank", str(bal), str(r), 48, prepayment_penalty_pct=fee))
    u = persona("200000", "60000", regime=regime, gross="3000000", loans=loans)
    cons = consolidation_card(u, lambda x: runner(D("0.3"))(x), D("0.3"), PUB)
    d, _ = _dis(u, D("0.3"), consolidation=cons)
    assert all(i.worth > 0 for i in d.items)
    assert d.total_over_plan == sum((i.worth for i in d.items if i.basis == "over_plan"), D("0"))
    assert (d.zero_line is None) == bool(d.items)
    assert sorted(d.plain_order) == sorted(i for i, l in enumerate(u.loans) if l.outstanding > 0)
    assert d.plain_order == plain_order(u)


# ── A5: the gap is the headline, with three ways to close it ────────────────

def test_p_short_gap_ways_golden():
    u = persona("85000", "42000")
    run = runner()
    base = run(u)
    cons = consolidation_card(u, lambda x: run(x), D("0.2"), PUB, base=base)
    g = gap_ways(u, base, lambda x: run(x), money, consolidation=cons)
    assert g.gap == D("10307")   # HDFC MITC minimum ₹10,807 (see test_consolidation_golden_p_short)
    assert [w.kind for w in g.ways] == ["consolidate", "stretch", "spend"]
    # Conservative: the card counted at the high rate (24%: EMI ₹4,708 -> frees
    # 10,807 - 4,708 = ₹6,099; typical 12.09%: EMI ₹3,991 -> ₹6,816).
    assert g.ways[0].monthly == D("6099") and "₹6,099 to ₹6,816" in g.ways[0].headline
    # 60 more months on ₹35L at 8.6%: EMI(35L, 8.6%, 300) = ₹28,419 -> frees ₹3,581.
    assert g.ways[1].monthly == D("3581")
    assert g.ways[2].closes_all and "25%" in g.ways[2].headline   # 10,307 / 42,000 = 24.5%


def test_no_gap_no_headline():
    u = persona("140000", "45000")
    assert gap_ways(u, runner()(u), lambda x: runner()(x), money) is None


@FAST
@given(st.decimals("40000", "120000", places=0), st.decimals("1000", "40000", places=0))
def test_gap_ways_class(take, short_by):
    u = persona(str(take), "0")
    base0 = runner()(u)
    mins = base0.months[0].available_surplus  # spare cash with no spending
    u.fixed_expenses = mins + short_by
    base = runner()(u)
    g = gap_ways(u, base, lambda x: runner()(x), money)
    assert g is not None and 1 <= len(g.ways) <= 3
    assert all(D("0") < w.closes <= g.gap for w in g.ways)
    assert g.ways[-1].kind == "spend" and g.ways[-1].closes == g.gap


# ── A4: prepay, keep or split (SEBI-safe) ───────────────────────────────────

BANNED = re.compile(r"(^|\. )Invest\b|\b(mutual fund|equity|index fund|stocks?|bonds?|fixed deposit|\bFD\b|SIP|Nifty|S&P|"
                    r"gold|crypto|ETF|PPF|NPS)\b", re.I)


def test_break_even_is_the_loans_after_tax_cost():
    """New regime, no tax break: the home loan's 8.6% compounds to
    (1 + 0.086/12)^12 - 1 = 8.95% a year; keeping the extra and prepaying it
    end level at about that return (to 0.2 points)."""
    u = persona("140000", "45000")
    r = compare(u, lambda x, lri: runner()(x, Strategy.AVALANCHE, lri), D("0.2"), money=money)
    assert r.phase.loans == [2] and abs(r.break_even_return - D("0.0895")) <= D("0.002")
    assert r.assumed_return is None and all(o.money_on_common_date is None for o in r.options)


def test_old_regime_24b_lowers_the_break_even():
    new = compare(persona("140000", "45000"), lambda x, lri: runner()(x, Strategy.AVALANCHE, lri), D("0.2"))
    old = compare(persona("140000", "45000", TaxRegimeIN.OLD, gross="2200000"),
                  lambda x, lri: runner(D("0.312"))(x, Strategy.AVALANCHE, lri), D("0.312"))
    assert old.break_even_return < new.break_even_return


@pytest.mark.parametrize("ret", [D("0"), D("0.05"), D("0.07"), D("0.12"), D("0.15")])
def test_options_are_compared_on_one_date(ret):
    u = persona("140000", "45000")
    r = compare(u, lambda x, lri: runner()(x, Strategy.AVALANCHE, lri), D("0.2"), assumed_return=ret, money=money)
    dates = [o.debt_free_month for o in r.options]
    assert [o.share_kept for o in r.options] == list(SHARES)
    assert dates == sorted(dates) and r.common_month == dates[-1]
    keep_all = r.options[-1].money_on_common_date
    prepay_all = r.options[0].money_on_common_date
    if ret <= D("0.08"):
        assert prepay_all > keep_all          # below the loan's cost prepaying ends ahead
    if ret >= D("0.10"):
        assert keep_all > prepay_all          # above it, keeping does (if the return holds)
    assert not BANNED.search(r.statement)
    assert r.statement.startswith("At the ")    # a statement about the user's own assumption


def test_no_phase_while_dear_debt_lasts_or_short():
    short = persona("85000", "42000")
    assert compare(short, lambda x, lri: runner()(x, Strategy.AVALANCHE, lri), D("0.2")) is None
    dear = persona("140000", "45000", loans=[loan(LoanType.PERSONAL, "X", "300000", "0.14", 36)])
    assert low_rate_phase(dear, runner()(dear), D("0.2")) is None


def test_low_rate_invest_off_changes_nothing():
    u = persona("140000", "45000")
    a = simulate_plan(u, horizon_months=360, marginal_rate=D("0.2"))
    b = simulate_plan(u, horizon_months=360, marginal_rate=D("0.2"), low_rate_invest=None)
    z = simulate_plan(u, horizon_months=360, marginal_rate=D("0.2"), low_rate_invest=(D("0.10"), D("0")))
    assert a.debt_free_month == b.debt_free_month == z.debt_free_month
    assert a.total_interest_paid == b.total_interest_paid == z.total_interest_paid


def test_low_rate_invest_never_touches_a_dear_loan():
    """Keeping a share applies only once every open loan is under the
    threshold: while the card or the 14% loan is open, all extra still goes
    to the debts."""
    u = persona("140000", "45000")
    a = simulate_plan(u, horizon_months=360, marginal_rate=D("0.2"))
    b = simulate_plan(u, horizon_months=360, marginal_rate=D("0.2"), low_rate_invest=(D("0.10"), D("1")))
    phase = low_rate_phase(u, a, D("0.2")).month
    for ra, rb in zip(a.months[: phase - 1], b.months[: phase - 1]):
        assert ra.balances_by_loan_index == rb.balances_by_loan_index
    assert b.months[phase].invested_this_month > 0 and b.months[phase].extra_paid == 0


# ── "Don't sign that": offers against the plan ──────────────────────────────

def test_offer_apr_golden():
    # No fee: the APR is the offered rate (EMI rounded up to the rupee moves it by < 0.01 point).
    u = persona("140000", "45000")
    r = check_offer(u, Offer("personal_loan", "spend", D("200000"), 36, D("0.16")), lambda x: runner()(x), D("0.2"),
                    money, PUB)
    assert abs(r.apr - D("0.16")) < D("0.0005")
    # EMI(2,00,000, 16%, 36) = 7,031.4 -> 7,032; paid 36 x 7,032 = 2,53,152: cost ₹53,152.
    assert r.monthly_emi == D("7032") and r.total_cost == D("53152")
    with_fee = check_offer(u, Offer("personal_loan", "spend", D("200000"), 36, D("0.16"), fee_pct=D("0.02")),
                           lambda x: runner()(x), D("0.2"), money, PUB)
    assert with_fee.apr > r.apr and with_fee.fee_total == D("4720")   # 4,000 + 18% GST


def test_top_up_clearing_a_42pct_card_checks_out_and_one_clearing_cheap_debt_costs_more():
    u = persona("140000", "45000")
    run = lambda x: runner()(x)
    good = check_offer(u, Offer("top_up", "repay", D("120000"), 60, D("0.095"), floating=True, repay_indices=(0,)),
                       run, D("0.2"), money, PUB)
    assert good.verdict == "checks_out" and good.comparisons[0].against == "keep_debts"
    cheap = persona("140000", "45000", loans=[loan(LoanType.AUTO, "HDFC Bank", "500000", "0.085", 48),
                                              loan(LoanType.HOME, "SBI", "3500000", "0.086", 240, "32000")])
    bad = check_offer(cheap, Offer("personal_loan", "repay", D("500000"), 60, D("0.16"), fee_pct=D("0.02"),
                                   repay_indices=(0,)), run, D("0.2"), money, PUB)
    assert bad.verdict == "costs_more" and bad.headline.startswith("Don't sign that")


def test_offer_that_does_not_fit_is_flagged():
    u = persona("85000", "42000")
    r = check_offer(u, Offer("top_up", "spend", D("500000"), 120, D("0.095"), floating=True),
                    lambda x: runner()(x), D("0.2"), money, PUB)
    assert r.verdict == "doesnt_fit" and "widens your monthly gap" in r.headline


@FAST
@given(st.decimals("20000", "800000", places=0), st.sampled_from([12, 36, 60, 120]), st.decimals("0.08", "0.30", places=3),
       st.decimals("0", "0.03", places=3), st.sampled_from(["spend", "repay"]))
def test_offer_check_class(amount, n, rate, fee, purpose):
    u = persona("140000", "45000")
    o = Offer("personal_loan", purpose, amount, n, rate, fee_pct=fee, repay_indices=(0,) if purpose == "repay" else ())
    r = check_offer(u, o, lambda x: runner()(x), D("0.2"), money, PUB)
    assert r.apr >= rate - D("0.0005")                 # fees and rounding only ever raise it
    assert r.total_cost >= 0 and r.fee_total >= 0
    assert r.verdict in ("checks_out", "costs_more", "doesnt_fit")
    if r.payments_share is not None and r.payments_share > D("0.5"):
        assert r.verdict == "doesnt_fit"


# ── Goals: programmable diversion ───────────────────────────────────────────

def _g(**kw):
    base = dict(id="g", target_month_index=24, required_amount=D("240000"))
    base.update(kw)
    return GoalState(**base)


def test_until_cap_and_floor():
    ended = serial_fill_allocation([_g(funding_end_month_index=3)], D("50000"), 3)
    assert ended.contributions[0].amount == 0 and ended.contributions[0].queued_reason == "ended"
    assert not ended.any_goal_short
    capped = serial_fill_allocation([_g(funding_rule="surplus_pct", funding_pct=D("0.5"), funding_cap=D("8000"))],
                                    D("40000"), 0)
    assert capped.contributions[0].amount == D("8000") and capped.contributions[0].queued_reason is None
    paused = serial_fill_allocation([_g(pause_below=D("15000"))], D("12000"), 0)
    assert paused.contributions[0].amount == 0 and paused.contributions[0].queued_reason == "paused"
    then_fixed = _g(funding_rule="after_debt", funding_amount=D("5000"))
    assert serial_fill_allocation([then_fixed], D("50000"), 0, debt_cleared=lambda i: True).contributions[0].amount == D("5000")
    then_pct = _g(funding_rule="after_debt", funding_pct=D("0.2"))
    assert serial_fill_allocation([then_pct], D("50000"), 0, debt_cleared=lambda i: True).contributions[0].amount == D("10000")


@settings(max_examples=60, deadline=None)
@given(st.lists(st.fixed_dictionaries({
    "rule": st.sampled_from(["schedule", "fixed", "surplus_pct", "after_debt"]),
    "amt": st.decimals("500", "30000", places=0), "pct": st.decimals("0.05", "1", places=2),
    "cap": st.one_of(st.none(), st.decimals("0", "20000", places=0)),
    "floor": st.one_of(st.none(), st.decimals("0", "40000", places=0)),
    "end": st.one_of(st.none(), st.integers(0, 30)), "bump": st.booleans(),
}), min_size=1, max_size=5), st.decimals("-20000", "80000", places=0), st.integers(0, 30))
def test_goal_rules_class(specs, surplus, month):
    goals = [_g(id=f"g{k}", funding_rule=s["rule"], funding_amount=s["amt"] if s["rule"] in ("fixed", "after_debt") else None,
                funding_pct=s["pct"] if s["rule"] in ("surplus_pct",) else None, funding_cap=s["cap"],
                pause_below=s["floor"], funding_end_month_index=s["end"], priority_bump=s["bump"],
                target_month_index=36) for k, s in enumerate(specs)]
    a = serial_fill_allocation(goals, surplus, month, debt_cleared=lambda i: True)
    pool = max(surplus, D("0"))
    assert a.total_outflow <= pool + D("0.01")                     # never more than the spare cash
    if surplus <= 0:
        assert a.total_outflow == 0                                # a short month funds no goal
    by_id = {c.goal_id: c for c in a.contributions}
    for g, s in zip(goals, specs):
        c = by_id[g.id]
        assert c.amount >= 0
        if s["cap"] is not None:
            assert c.amount <= s["cap"]
        if s["end"] is not None and month >= s["end"]:
            assert c.amount == 0
        if s["floor"] is not None and s["floor"] > 0 and pool < s["floor"]:
            assert c.amount == 0


def test_goals_never_funded_in_a_short_month_on_the_plan():
    u = persona("85000", "42000")
    goals = [_g(id="trip", funding_rule="fixed", funding_amount=D("3000"), target_month_index=24),
             _g(id="fund", funding_rule="surplus_pct", funding_pct=D("0.5"), target_month_index=60)]
    res = simulate_plan(u, horizon_months=60, marginal_rate=D("0.2"), goals=goals)
    for row in res.months:
        if row.shortfall > 0:
            assert sum(row.goal_contributions.values(), D("0")) == 0
