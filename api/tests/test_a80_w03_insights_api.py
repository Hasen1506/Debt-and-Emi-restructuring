"""Audit 80+ W3: /api/insights/* (A1, A2, A4, A5, A6, offer check) and the
goal diversion fields on /api/simulate."""
from __future__ import annotations

import re
from decimal import Decimal as D

import pytest


def body(take=140000, spend=45000, regime="new", **extra):
    return {
        "user": {
            "country": "IN", "income_type": "salaried", "annual_income": str(take * 12), "monthly_income": str(take),
            "fixed_expenses": str(spend), "savings_balance": "0", "primary_bank": "SBI", "tax_regime": regime,
            "loans": [
                {"loan_type": "credit_card", "bank": "HDFC Bank", "outstanding": "120000", "nominal_rate": "0.42",
                 "rate_type": "fixed", "tenure_months_remaining": 0, "scheduled_emi": "0"},
                {"loan_type": "personal_loan", "bank": "ICICI Bank", "outstanding": "300000", "nominal_rate": "0.14",
                 "rate_type": "fixed", "tenure_months_remaining": 36, "scheduled_emi": "10500"},
                {"loan_type": "home_loan", "bank": "SBI", "outstanding": "3500000", "nominal_rate": "0.086",
                 "rate_type": "floating", "tenure_months_remaining": 240, "scheduled_emi": "32000"},
            ],
        },
        "horizon_months": 360, "simulation_start_month": 10, "simulation_start_year": 2026, **extra,
    }


def test_plan_insights_p_ok(client):
    r = client.post("/api/insights/plan", json=body())
    assert r.status_code == 200, r.text
    j = r.json()
    assert j["order"]["material"] is False and j["order"]["line"] == "All orders give the same result for your loans."
    assert j["gap"] is None
    assert j["low_rate_phase_month"] == 9 and D(j["low_rate_threshold"]) == D("0.10")
    kinds = [i["kind"] for i in j["disagreements"]["items"]]
    assert kinds == ["consolidation"]
    c = j["consolidation"]
    assert [s["rate_basis"] for s in c["scenarios"]] == ["typical", "high"]
    assert c["neutrality"] == "We don't arrange loans and no lender pays us."
    assert all(src[1].startswith("https://") for src in c["published"]["sources"])


def test_plan_insights_p_short_gap_is_the_headline(client):
    j = client.post("/api/insights/plan", json=body(85000, 42000)).json()
    # ₹10,307: HDFC's sourced card minimum (W2 C14 x W1 C13; engine golden
    # test_consolidation_golden_p_short has the hand check).
    assert D(j["gap"]["gap"]) == D("10307") and len(j["gap"]["ways"]) == 3
    assert j["low_rate_phase_month"] is None
    assert all(D(w["closes"]) <= D("10307") for w in j["gap"]["ways"])


def test_consolidation_with_own_quote(client):
    r = client.post("/api/insights/consolidation", json=body(consolidation_rate="0.155", consolidation_fee_pct="0.02"))
    s = r.json()["scenarios"]
    assert len(s) == 1 and s[0]["rate_basis"] == "yours" and D(s[0]["rate"]) == D("0.155")
    assert D(s[0]["fee_gst"]) == (D(s[0]["fee"]) * D("0.18")).quantize(D("0.01"))


def test_prepay_invest_dates_in_words_and_sebi_safe(client):
    j = client.post("/api/insights/prepay-invest", json=body(assumed_return="0.07")).json()
    assert j["available"] and [D(o["share_kept"]) for o in j["options"]] == [D("0"), D("0.25"), D("0.5"), D("0.75"), D("1")]
    assert re.search(r"by [A-Z][a-z]{2} 20\d\d", j["statement"])
    assert not re.search(r"(^|\. )Invest\b|fund|equity|stock|bond|Nifty|S&P", j["statement"])
    none = client.post("/api/insights/prepay-invest", json=body(85000, 42000)).json()
    assert none["available"] is False


def test_offer_check_routes(client):
    j = client.post("/api/insights/offer-check", json=body(offer={
        "kind": "top_up", "purpose": "repay", "amount": "120000", "tenure_months": 60, "rate": "0.095",
        "floating": True, "repay_indices": [0]})).json()
    assert j["verdict"] == "checks_out" and j["neutrality"].startswith("We don't arrange loans")
    emi = client.post("/api/insights/offer-check", json=body(offer={
        "kind": "no_cost_emi", "purpose": "spend", "amount": "60000", "tenure_months": 6, "monthly_emi": "10000",
        "cash_price": "57000", "fee_flat": "199"})).json()
    assert D(emi["apr"]) > 0 and emi["verdict"] in ("costs_more", "doesnt_fit")


@pytest.mark.parametrize("bad", [
    {"consolidation_rate": "0.9"},
    {"consolidation_tenure_months": 2},
    {"assumed_return": "0.9"},
])
def test_bad_inputs_are_422(client, bad):
    path = "/api/insights/prepay-invest" if "assumed_return" in bad else "/api/insights/plan"
    assert client.post(path, json=body(**bad)).status_code == 422


def test_offer_check_needs_the_loans_it_repays(client):
    r = client.post("/api/insights/offer-check", json=body(offer={
        "kind": "personal_loan", "purpose": "repay", "amount": "100000", "tenure_months": 36, "rate": "0.15"}))
    assert r.status_code == 422 and r.json()["detail"]["field"] == "repay_indices"


def test_goal_diversion_fields_on_simulate(client):
    b = body()
    b["goals"] = [{"id": "trip", "target_month_index": 24, "required_amount": "200000", "funding_rule": "surplus_pct",
                   "funding_pct": "0.5", "funding_cap": "5000", "pause_below": "1000", "funding_end_month_index": 12}]
    r = client.post("/api/simulate", json=b)
    assert r.status_code == 200, r.text
    contrib = r.json()["surplus_allocation"]["goal_contributions"]
    assert all(D(c["amount"]) <= D("5000") for c in contrib)
    b["goals"][0]["funding_start_month_index"] = 12
    assert client.post("/api/simulate", json=b).status_code == 422     # must stop after it starts


# ---- A4: the user's own prepay/keep share on /api/simulate -----------------
# Guards the class "a saved choice changes the plan only where and how the
# user chose": omitted == 0 (RightDue never sets it), nothing moves before
# every loan left costs under 10%, and keeping more never clears sooner or
# costs less interest.

def _sim(client, share=None, **kw):
    b = body(**kw)
    if share is not None:
        b["low_rate_invest_share"] = share
    r = client.post("/api/simulate", json=b)
    assert r.status_code == 200, r.text
    return r.json()


def test_low_rate_share_omitted_is_prepay_all(client):
    a, z = _sim(client), _sim(client, "0")
    assert a["debt_free_month"] == z["debt_free_month"]
    assert D(a["total_interest_paid"]) == D(z["total_interest_paid"])


def test_low_rate_share_is_monotone_and_starts_at_the_phase(client):
    phase = client.post("/api/insights/plan", json=body()).json()["low_rate_phase_month"]
    assert phase is not None and phase > 0
    runs = [_sim(client, s) for s in ("0", "0.25", "0.5", "0.75", "1")]
    months = [r["debt_free_month"] for r in runs]
    interest = [D(r["total_interest_paid"]) for r in runs]
    assert months == sorted(months) and months[0] < months[-1]
    assert interest == sorted(interest)
    # Before the phase (a card and a 14% loan still open) every share pays the same.
    base = runs[0]["trajectory"]
    for r in runs[1:]:
        for p0, p1 in zip(base[:phase - 1], r["trajectory"][:phase - 1]):
            assert D(p0["balance"]) == D(p1["balance"]), p0["month"]


def test_low_rate_share_no_effect_while_expensive_debt_remains(client):
    # Short this month (P-short): the card, then card-rate gap debt, stay open
    # for years. Nothing is kept while any of it is open: both plans are
    # identical month by month until the gap debt is repaid. (Integration:
    # with HDFC's sourced minimum (W2 C14) the card clears and only the home
    # loan is left in year ~11, so the share may act after that; before C14
    # neither plan cleared and this test compared two None dates.)
    a, k = _sim(client, None, take=85000, spend=42000), _sim(client, "1", take=85000, spend=42000)
    gap_open = [r["month"] for r in a["trajectory"] if D(r["gap_debt"]) > 0]
    assert gap_open, "P-short borrows to cover the gap"
    last = max(gap_open)
    for p0, p1 in zip(a["trajectory"][:last], k["trajectory"][:last]):
        assert D(p0["balance"]) == D(p1["balance"]), p0["month"]
    assert k["debt_free_month"] is None or (a["debt_free_month"] is not None
                                            and k["debt_free_month"] >= a["debt_free_month"])


@pytest.mark.parametrize("bad", ["-0.1", "1.5", "abc"])
def test_low_rate_share_out_of_range_is_422(client, bad):
    b = body()
    b["low_rate_invest_share"] = bad
    assert client.post("/api/simulate", json=b).status_code == 422


def test_low_rate_share_on_sensitivity_compare(client):
    # What-if runs carry the saved share too, so they match the plan.
    b = body()
    b["low_rate_invest_share"] = "1"
    keep = client.post("/api/sensitivity/compare", json=b)
    assert keep.status_code == 200, keep.text
    pay = client.post("/api/sensitivity/compare", json=body())
    assert keep.json() != pay.json()
