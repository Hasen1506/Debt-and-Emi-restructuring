"""Roadmap PR J: the payoff order ranks loans by the forward-looking marginal
cost of the next unit prepaid (founder decision 2026-10-07).

marginal cost = monthly-compounded interest + GST on that interest
              − the tax benefit the prepayment gives up (24(b) / 80E / US)
              − the prepayment fee spread over the months it saves;
locked loans last; sunk costs (processing fee, insurance) excluded.
"""
from __future__ import annotations

import importlib.util
import itertools
from decimal import Decimal as D
from pathlib import Path

from hypothesis import example, given, settings
from hypothesis import strategies as st

from engine.decisions import allocate_windfall
from engine.fee_order import plan_net_cost, rate_only_order
from engine.formulas import effective_rate, emi
from engine.marginal_cost import (
    LOCKED_OFFSET, compounded, loan_marginal_cost, marginal_cost, marginal_shield,
    user_marginal_costs, why_first,
)
from engine.models import Country, IncomeType, Loan, LoanType, PayoffRules, TaxRegimeIN, User
from engine.ordering import Strategy
from engine.simulation import simulate_plan
from engine.tests.strategies import examples

ROOT = Path(__file__).resolve().parents[2]


def _loan(lt, bal, rate, n=60, **kw) -> Loan:
    sched = D("0") if lt == LoanType.CREDIT_CARD else emi(D(bal), D(rate), n).quantize(D("0.01"))
    return Loan(lt, kw.pop("bank", "HDFC Bank"), D(bal), D(rate), "fixed", n, sched, **kw)


def _user(loans, country=Country.IN, income="200000", expenses="40000", regime=TaxRegimeIN.NEW) -> User:
    return User(country, IncomeType.SALARIED, D(income) * 12, D(income), D(expenses), D("0"), "HDFC Bank",
                tax_regime=regime if country == Country.IN else None,
                efund_balance=D("0"), efund_target=D("0"), loans=loans, investment_options=[])


def _first_extra_target(user: User, marg: str = "0.3") -> int:
    """Index of the loan that gets month 1's extra payment."""
    res = simulate_plan(user, Strategy.AVALANCHE, horizon_months=6, marginal_rate=D(marg))
    row = res.months[0]
    extra = {i: row.payments_by_loan_index[i] - user.loans[i].scheduled_emi for i in row.payments_by_loan_index}
    return max(extra, key=extra.get)


# ── the formula ─────────────────────────────────────────────────────────────

def test_formula_components_for_an_indian_card():
    mc = marginal_cost(D("0.36"), True, D("0"), D("0"), 0)
    assert mc.interest == (D("1.03") ** 12 - 1)               # 42.58%, compounded monthly
    # GST on each month's interest, carried and compounding with it:
    # (1 + 3% × 1.18)^12 − 1 = 51.81% in all (interest × 18% gave 50.24%).
    assert mc.gst == (D("1") + D("0.03") * D("1.18")) ** 12 - 1 - mc.interest
    assert mc.total == mc.interest + mc.gst
    assert round(mc.total, 4) == D("0.5181")


def test_tax_benefit_and_fee_are_subtracted_and_lock_in_ranks_last():
    mc = marginal_cost(D("0.09"), False, D("0.3"), D("0.02"), 24, 0)
    assert mc.tax_benefit == compounded(D("0.09")) * D("0.3")
    assert mc.fee == D("0.02") * 12 / 24
    assert mc.total == mc.interest - mc.tax_benefit - mc.fee
    locked = marginal_cost(D("0.40"), False, D("0"), D("0"), 24, 3)
    assert locked.locked and locked.order_key == locked.total - LOCKED_OFFSET
    assert locked.order_key < marginal_cost(D("0.01"), False, D("0"), D("0"), 24).order_key


def test_sunk_costs_do_not_change_the_marginal_cost():
    a = _loan(LoanType.PERSONAL, 300000, "0.14")
    b = _loan(LoanType.PERSONAL, 300000, "0.14", processing_fee_amortised=D("0.03"), insurance_premium_pct=D("0.01"))
    assert loan_marginal_cost(a, D("0"), Country.IN).total == loan_marginal_cost(b, D("0"), Country.IN).total
    assert effective_rate(b, D("0"), Country.IN) > effective_rate(a, D("0"), Country.IN)


def test_a_binding_deduction_cap_gives_no_tax_benefit_at_the_margin():
    # ₹2L 24(b) cap (old regime): under it the next rupee's interest is deductible, over it it isn't.
    assert marginal_shield("home_loan", "IN", D("0.3"), "old", interest_total=D("150000")) == D("0.3")
    assert marginal_shield("home_loan", "IN", D("0.3"), "old", interest_total=D("450000")) == D("0")
    assert marginal_shield("home_loan", "IN", D("0.3"), "new", interest_total=D("10000")) == D("0")
    assert marginal_shield("education_loan", "IN", D("0.3"), "old") == D("0.3")       # 80E: no cap
    assert marginal_shield("home_loan", "US", D("0.24"), itemises=True, itemised_share=D("0.4"), debt_total=D("500000")) == D("0.24")
    assert marginal_shield("home_loan", "US", D("0.24"), itemises=True, itemised_share=D("1"), debt_total=D("900000")) == D("0")
    assert marginal_shield("home_loan", "US", D("0.24"), itemises=False, itemised_share=D("0")) == D("0")
    assert marginal_shield("education_loan", "US", D("0.22"), interest_total=D("2600")) == D("0")
    assert marginal_shield("personal_loan", "IN", D("0.3"), "old") == D("0")


# ── the order (each of these ranked differently before PR J) ────────────────

def test_processing_fee_and_insurance_no_longer_put_a_cheaper_loan_first():
    fees = _loan(LoanType.PERSONAL, 300000, "0.14", processing_fee_amortised=D("0.03"), insurance_premium_pct=D("0.015"))
    plain = _loan(LoanType.PERSONAL, 300000, "0.16")
    assert effective_rate(fees, D("0"), Country.IN) > effective_rate(plain, D("0"), Country.IN)   # the old key
    assert _first_extra_target(_user([fees, plain])) == 1


def test_a_home_loan_over_the_24b_cap_is_ranked_on_its_full_rate():
    # ₹60L at 9% = ₹5.4L interest a year, well over the ₹2L cap: prepaying saves
    # non-deductible interest. The average shield (old key) made it look like 7.9%.
    home = _loan(LoanType.HOME, 6_000_000, "0.09", n=240)
    personal = _loan(LoanType.PERSONAL, 400000, "0.085")
    u = _user([home, personal], income="400000", regime=TaxRegimeIN.OLD)
    assert effective_rate(home, D("0.3"), Country.IN, TaxRegimeIN.OLD) < D("0.085")
    assert _first_extra_target(u) == 0


def test_a_prepayment_fee_counts_against_a_loan_with_few_months_left():
    # A 3% fee on a loan with 12 months left costs 3% a year of what prepaying
    # saves: 21.94% compounded − 3% = 18.94%, below an 18% loan's 19.56%.
    feeful = _loan(LoanType.PERSONAL, 200000, "0.20", n=12, prepayment_penalty_pct=D("0.03"))
    plain = _loan(LoanType.PERSONAL, 200000, "0.18", n=60)
    u = _user([feeful, plain], income=str(feeful.scheduled_emi + plain.scheduled_emi + 40000 + 3000), expenses="40000")
    assert _first_extra_target(u) == 1


def test_rules_fall_back_to_the_marginal_cost_order():
    fees = _loan(LoanType.PERSONAL, 300000, "0.14", processing_fee_amortised=D("0.03"), insurance_premium_pct=D("0.015"))
    plain = _loan(LoanType.PERSONAL, 300000, "0.16")
    pinned = _loan(LoanType.AUTO, 300000, "0.09")
    u = _user([fees, plain, pinned])
    u.payoff_rules = PayoffRules(pinned=[2])
    res = simulate_plan(u, Strategy.RULES, horizon_months=200, marginal_rate=D("0.3"))
    cleared = [i for row in res.months for i, b in row.balances_by_loan_index.items()
               if b == 0 and all(r.balances_by_loan_index.get(i, 1) != 0 for r in res.months[:res.months.index(row)])]
    assert cleared[0] == 2 and cleared.index(1) < cleared.index(0)


def test_windfall_ranks_by_marginal_cost_and_explains_why():
    fees = _loan(LoanType.PERSONAL, 300000, "0.14", processing_fee_amortised=D("0.03"), insurance_premium_pct=D("0.015"))
    card = _loan(LoanType.CREDIT_CARD, 80000, "0.15", n=0)
    u = _user([fees, card])
    rates = {id(l): effective_rate(l, D("0"), Country.IN) for l in u.loans}
    mcs = user_marginal_costs(u.loans, u, D("0"))
    out = allocate_windfall(D("50000"), u.loans, rates, [], D("0.05"), marginal_costs=mcs)
    assert out.to_loan_id == id(card)                     # 15% card + GST beats a 14% loan's sunk fees
    assert "compounded monthly" in out.rationale and "GST" in out.rationale


def test_why_first_breakdown():
    s = why_first(marginal_cost(D("0.09"), False, D("0.3"), D("0.02"), 24, 2))
    assert s.startswith("The next payment here saves ")
    assert "interest (compounded monthly)" in s and "tax break" in s and "prepayment fee" in s
    assert s.endswith("locked against prepayment for 2 more months")


def test_differential_fixture_is_current():
    spec = importlib.util.spec_from_file_location("exp", ROOT / "scripts" / "export_marginal_cost_cases.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    assert mod.OUT_PATH.read_text(encoding="utf-8") == mod.render(), (
        "engine/tests/fixtures/marginal_cost_cases.json is stale: run python scripts/export_marginal_cost_cases.py"
    )


# ── property: never worse than the best fixed order ─────────────────────────

GST_IN = D("0.18")


def _net_cost(user: User, res, marg: D) -> D:
    """Interest paid (GST and prepayment fees included, as the simulation
    books them) minus the tax the deductible interest saved. The generator
    keeps every deduction under its cap, so the saving is the loan's shield
    share of its interest, month by month."""
    mcs = user_marginal_costs(user.loans, user, marg)
    shield = {i: (mcs[id(l)].tax_benefit / mcs[id(l)].interest if mcs[id(l)].interest > 0 else D("0"))
              for i, l in enumerate(user.loans)}
    saved = D("0")
    prev = {i: l.outstanding for i, l in enumerate(user.loans)}
    for row in res.months:
        for i, l in enumerate(user.loans):
            if shield[i] > 0:
                saved += shield[i] * prev[i] * l.nominal_rate / 12
        prev = {i: row.balances_by_loan_index.get(i, D("0")) for i in prev}
    return res.total_interest_paid - saved


@st.composite
def _portfolios(draw):
    country = draw(st.sampled_from([Country.IN, Country.US]))
    regime = draw(st.sampled_from([TaxRegimeIN.OLD, TaxRegimeIN.NEW]))
    types = [LoanType.PERSONAL, LoanType.AUTO, LoanType.HOME, LoanType.EDUCATION, LoanType.CREDIT_CARD]
    loans = []
    for i in range(draw(st.integers(2, 4))):
        lt = draw(st.sampled_from(types))
        rate = D(draw(st.integers(100, 4200 if lt in (LoanType.PERSONAL, LoanType.CREDIT_CARD) else 1600))) / 10000
        # Balances keep every deduction under its cap, even with four such
        # loans (4 × ₹3L × 16% < ₹2L 24(b); 4 × $3,900 × 16% < $2,500
        # §221), so the tax benefit is linear in the interest.
        if country == Country.US and lt == LoanType.EDUCATION:
            bal = D(draw(st.integers(5, 39)) * 100)
        else:
            bal = D(draw(st.integers(5, 300 if lt == LoanType.HOME else 600)) * 1000)
        n = draw(st.integers(12, 84))
        kw = {}
        if lt == LoanType.CREDIT_CARD:
            kw["min_payment_override"] = (bal / D(draw(st.integers(10, 40)))).quantize(D("1"))
        if draw(st.integers(0, 4)) == 0:
            kw["prepay_lock_in_months"] = draw(st.sampled_from([1, 3, 6]))
        if draw(st.integers(0, 4)) == 0:
            kw["processing_fee_amortised"] = D(draw(st.integers(1, 30))) / 1000
            kw["insurance_premium_pct"] = D(draw(st.integers(0, 15))) / 1000
        loans.append(_loan(lt, bal, rate, n=0 if lt == LoanType.CREDIT_CARD else n, bank=f"B{i}", **kw))
    mins = sum((l.min_payment_override or l.scheduled_emi for l in loans), D("0"))
    extra = D(draw(st.integers(5, 60)) * 1000)
    u = _user(loans, country=country, income=str((mins + extra + 30000).quantize(D("1"))), expenses="30000", regime=regime)
    marg = draw(st.sampled_from([D("0"), D("0.2"), D("0.3")]))
    return u, marg


@st.composite
def _fee_portfolios(draw):
    """`_portfolios` with prepayment fees: each non-card loan charges 0.5%–5%
    of every amount prepaid, half the time (roadmap PR K)."""
    user, marg = draw(_portfolios())
    for l in user.loans:
        if l.loan_type != LoanType.CREDIT_CARD and draw(st.booleans()):
            l.prepayment_penalty_pct = D(draw(st.integers(5, 50))) / 1000
    return user, marg


def _best_fixed_order_cost(user: User, marg: D) -> D:
    """Brute force: the cheapest of every fixed payoff order, same simulator."""
    best = None
    rules = user.payoff_rules
    for perm in itertools.permutations(range(len(user.loans))):
        user.payoff_rules = PayoffRules(custom_order=list(perm))
        cost = _net_cost(user, simulate_plan(user, Strategy.RULES, horizon_months=360, marginal_rate=marg), marg)
        best = cost if best is None else min(best, cost)
    user.payoff_rules = rules
    return best


# ── PR K: fee portfolios where PR J's greedy order lost (fail on main @ 7f97fc0) ──

def _case(country, regime, income, loans):
    ls = []
    for i, (lt, bal, rate, n, fee, lock, pf, ins, minp) in enumerate(loans):
        kw = {"prepayment_penalty_pct": D(fee), "prepay_lock_in_months": lock,
              "processing_fee_amortised": D(pf), "insurance_premium_pct": D(ins)}
        if minp is not None:
            kw["min_payment_override"] = D(minp)
        ls.append(_loan(lt, bal, rate, n=n, bank=f"B{i}", **kw))
    return _user(ls, country=country, income=income, expenses="30000", regime=regime)


T = LoanType
FEE_REGRESSIONS = [
    # (user, marginal rate). Found by sampling fee portfolios on main; on each,
    # the greedy plan cost more than the best fixed order by more than the slack.
    (lambda: _case(Country.US, None, "52056", [
        (T.AUTO, 290000, "0.0751", 83, "0.03", 0, "0.01", "0.003", None),
        (T.PERSONAL, 45000, "0.0101", 19, "0.01", 0, "0.027", "0", None),
        (T.EDUCATION, 6000, "0.0228", 35, "0", 0, "0.006", "0.013", None)]), D("0.3")),
    (lambda: _case(Country.IN, TaxRegimeIN.OLD, "83525", [
        (T.CREDIT_CARD, 456000, "0.0295", 0, "0", 3, "0", "0", "41455"),
        (T.HOME, 44000, "0.1595", 79, "0", 0, "0", "0", None),
        (T.PERSONAL, 51000, "0.1927", 76, "0.021", 3, "0.007", "0.012", None)]), D("0.2")),
    (lambda: _case(Country.IN, TaxRegimeIN.NEW, "91821", [
        (T.CREDIT_CARD, 482000, "0.0267", 0, "0", 0, "0", "0", "48200"),
        (T.PERSONAL, 50000, "0.0482", 33, "0.007", 1, "0", "0", None)]), D("0")),
    (lambda: _case(Country.IN, TaxRegimeIN.OLD, "57654", [
        (T.AUTO, 246000, "0.0567", 69, "0.012", 0, "0", "0", None),
        (T.CREDIT_CARD, 29000, "0.0348", 0, "0", 0, "0", "0", "2231"),
        (T.EDUCATION, 190000, "0.0269", 63, "0.014", 1, "0", "0", None)]), D("0")),
]


@settings(max_examples=examples(60))
@given(_fee_portfolios())
@example((FEE_REGRESSIONS[0][0](), FEE_REGRESSIONS[0][1]))
@example((FEE_REGRESSIONS[3][0](), FEE_REGRESSIONS[3][1]))

def test_property_marginal_order_is_at_least_as_good_as_the_best_fixed_order(case):
    """On 2–4 loan portfolios (IN and US; cards with GST; deductible home and
    education loans; sunk processing fees and insurance; lock-ins; and
    prepayment fees on about half the loans), the Avalanche plan costs no
    more, net of tax and fees included, than the best of every fixed payoff
    order (brute force over all permutations).

    Prepayment fees are in (roadmap PR K). A fee charged on each prepaid
    rupee breaks the rate-by-rate order, so with a fee loan the plan
    searches orders on the same simulator (engine/fee_order.py: every order
    up to 5 loans) and keeps the cheapest; without one it is the greedy
    marginal-cost order of PR J."""
    user, marg = case
    ours = _net_cost(user, simulate_plan(user, Strategy.AVALANCHE, horizon_months=360, marginal_rate=marg), marg)
    best = _best_fixed_order_cost(user, marg)
    # One rupee/cent per loan of rounding slack; nothing more.
    assert ours <= best + D(len(user.loans)), (ours, best)


def test_fee_regressions_beat_or_match_the_best_fixed_order():
    for make, marg in FEE_REGRESSIONS:
        user = make()
        res = simulate_plan(user, Strategy.AVALANCHE, horizon_months=360, marginal_rate=marg)
        ours = _net_cost(user, res, marg)
        best = _best_fixed_order_cost(user, marg)
        assert ours <= best + D(len(user.loans)), (ours, best)
        assert res.payoff_order_method == "exact"


def test_the_net_cost_the_search_minimises_is_the_one_the_property_checks():
    # Caps not binding: the engine's net cost (yearly caps) equals the test's.
    for make, marg in FEE_REGRESSIONS:
        user = make()
        res = simulate_plan(user, Strategy.AVALANCHE, horizon_months=360, marginal_rate=marg)
        assert abs(plan_net_cost(user, res, marg) - _net_cost(user, res, marg)) < D("0.000001")


def test_a_fee_that_changes_the_order_is_explained():
    # A 5% fee on a 13% loan with 18 months left: prepaying it early costs 5%
    # of every rupee to save at most ~1.5 years of 13%; the 12% loan with no
    # fee and 7 years left should take the extra first, and the plan says why.
    feeful = _loan(LoanType.PERSONAL, 300000, "0.13", n=18, bank="Alpha", prepayment_penalty_pct=D("0.05"))
    plain = _loan(LoanType.PERSONAL, 600000, "0.12", n=84, bank="Beta")
    u = _user([feeful, plain], income=str(feeful.scheduled_emi + plain.scheduled_emi + 40000 + 25000), expenses="40000")
    assert rate_only_order(u, D("0")) == [0, 1]                       # by rate alone: the 13% loan first
    res = simulate_plan(u, Strategy.AVALANCHE, horizon_months=360, marginal_rate=D("0"))
    assert _net_cost(u, res, D("0")) <= _best_fixed_order_cost(u, D("0")) + 2
    assert res.payoff_order_note is not None
    note = res.payoff_order_note
    assert note.startswith("A prepayment fee changed this order.")
    assert "Alpha personal loan" in note and "5% fee" in note and "Beta personal loan" in note
    assert "saves about ₹" in note and "fees included" in note
    # Without the fee nothing is searched and nothing is said.
    feeful.prepayment_penalty_pct = D("0")
    res0 = simulate_plan(u, Strategy.AVALANCHE, horizon_months=360, marginal_rate=D("0"))
    assert res0.payoff_order_method is None and res0.payoff_order_note is None


def test_more_than_five_loans_use_greedy_plus_local_swaps_and_never_lose_to_either_start():
    loans = [
        _loan(LoanType.PERSONAL, 300000, "0.13", n=18, bank="A", prepayment_penalty_pct=D("0.05")),
        _loan(LoanType.PERSONAL, 400000, "0.12", n=84, bank="B"),
        _loan(LoanType.AUTO, 250000, "0.10", n=48, bank="C", prepayment_penalty_pct=D("0.03")),
        _loan(LoanType.PERSONAL, 150000, "0.16", n=36, bank="D"),
        _loan(LoanType.CREDIT_CARD, 60000, "0.36", n=0, bank="E", min_payment_override=D("3000")),
        _loan(LoanType.AUTO, 200000, "0.09", n=60, bank="F"),
    ]
    u = _user(loans, income=str(sum((l.min_payment_override or l.scheduled_emi for l in loans), D("0")) + 30000 + 30000),
              expenses="30000")
    res = simulate_plan(u, Strategy.AVALANCHE, horizon_months=360, marginal_rate=D("0"))
    assert res.payoff_order_method == "local"
    ours = _net_cost(u, res, D("0"))
    u.payoff_rules = PayoffRules(custom_order=rate_only_order(u, D("0")))
    by_rate = _net_cost(u, simulate_plan(u, Strategy.RULES, horizon_months=360, marginal_rate=D("0")), D("0"))
    u.payoff_rules = None
    from engine.simulation import _simulate_plan
    greedy = _net_cost(u, _simulate_plan(u, Strategy.AVALANCHE, horizon_months=360, marginal_rate=D("0")), D("0"))
    assert ours <= min(by_rate, greedy)


def test_plan_net_cost_applies_the_24b_cap_per_year():
    # Two home loans whose interest is far over ₹2L a year (old regime, 30%):
    # the tax saved in year one is 30% of ₹2L, not of all the interest.
    a = _loan(LoanType.HOME, 4_000_000, "0.09", n=240)
    b = _loan(LoanType.HOME, 3_000_000, "0.09", n=240)
    u = _user([a, b], income="400000", regime=TaxRegimeIN.OLD)
    res = simulate_plan(u, Strategy.AVALANCHE, horizon_months=12, marginal_rate=D("0.3"))
    saved = res.total_interest_paid - plan_net_cost(u, res, D("0.3"))
    assert saved == D("0.3") * D("200000")
