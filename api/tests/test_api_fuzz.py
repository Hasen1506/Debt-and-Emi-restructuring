"""Fuzz through the API: random loans, and hostile input on every POST endpoint.

1. Random loans through Loan Check, the complaint letters and the offer
   comparison. Never a server error; a refusal is a 422 that names the
   field; never a negative amount; never a stray "you" in a letter.
   300 loans run in the normal suite. The full run is 20,000:

       FUZZ_N=20000 python -m pytest api/tests/test_api_fuzz.py -q

2. Hostile values (huge, negative, NaN, text, 500 loans...) in every
   field of every POST endpoint: a 200 or a 422 naming the field, never
   a 500, and quickly. FUZZ_FULL=1 tries every value in every field;
   the normal suite tries a fixed sample.
"""
import copy
import os
import random
import re
import time
from datetime import date, timedelta
from decimal import Decimal

import pytest

from engine import policy_rates
from engine.complaints_in import stray_you
from engine.models import Country

D = Decimal
TODAY = date(2026, 9, 26)
N_LOANS = int(os.environ.get("FUZZ_N", "300"))
FULL = os.environ.get("FUZZ_FULL") == "1"
LENDERS = ["SBI", "HDFC Bank", "ICICI Bank", "Axis Bank", "Kotak Mahindra", "PNB",
           "Bank of Baroda", "Canara Bank", "A Local Co-operative Bank", None, ""]
LEFTOVERS = re.compile(r"\bNone\b|\bnan\b|\bNaN\b|[{}]|₹-|-₹|\.\.")
NEGATIVE_RUPEES = re.compile(r"[-−]\s*₹|₹\s*[-−]")


def _month(d: date) -> str:
    return f"{d.year:04d}-{d.month:02d}"


def _rate(x: Decimal) -> str:
    return str(x.quantize(D("0.0001")))


def random_loan(rng: random.Random) -> dict:
    start = date(2016, 1, 1) + timedelta(days=rng.randint(0, 3900))
    start = date(start.year, start.month, 1)
    repo0 = policy_rates.rate_on(Country.IN, start) or D("0.0650")
    body = {
        "lender": rng.choice(LENDERS),
        "loan_start": _month(start),
        "current_rate": _rate(D("0.0525") + D(rng.randint(-50, 600)) / 10000),
        "outstanding": str(rng.randint(1, 4000) * 5000),
        "tenure_months_remaining": rng.randint(1, 360),
        "benchmark": rng.choice(["repo", "repo", "repo", "mclr", "base_rate", "unknown"]),
        "as_of": TODAY.isoformat(),
    }
    spread = D(rng.randint(150, 450)) / 10000
    if rng.random() < 0.2:
        body["start_benchmark_rate"] = _rate(repo0)
        body["start_spread"] = _rate(spread)
    else:
        body["start_rate"] = _rate(repo0 + spread)
    if rng.random() < 0.3:
        body["emi"] = str(rng.randint(1000, 200000))
    if rng.random() < 0.3:
        reset = start + timedelta(days=rng.randint(0, (TODAY - start).days))
        body["last_reset"] = _month(reset)
    return body


HOSTILE = ["-1", "-1e6", "1e30", "1E+999999", "NaN", "Infinity", "9.5", "0", "", None,
           "abc", 10**18, -10**9, "x" * 5000, [], {}, 1e308, True]


def hostile_loan(rng: random.Random) -> dict:
    body = random_loan(rng)
    key = rng.choice(sorted(body))
    body[key] = rng.choice(HOSTILE)
    return {k: v for k, v in body.items() if v is not None}


def random_stage(rng: random.Random, loan: dict) -> dict:
    """Draft, or sent on some day with some reply."""
    if rng.random() < 0.3:
        return {}
    sent = TODAY - timedelta(days=rng.randint(0, 400))
    out = {"sent_on": sent.isoformat()}
    reply = rng.choice(["none", "none", "fixed", "partly", "rejected"])
    out["reply"] = reply
    if reply != "none":
        out["reply_on"] = (sent + timedelta(days=rng.randint(0, (TODAY - sent).days))).isoformat()
        out["io_reviewed"] = rng.random() < 0.5
    if rng.random() < 0.2:
        out["bank_reference"] = f"GRV{rng.randint(1000, 99999)}"
    return out


def random_offers(rng: random.Random, loan: dict) -> dict:
    cur = D(loan["current_rate"])
    out = {}
    if rng.random() < 0.8:
        out["reset"] = {"rate": _rate(cur - D(rng.randint(-10, 150)) / 10000)}
        if rng.random() < 0.5:
            out["reset"]["fee"] = str(rng.choice([0, 5000, 25000, 90000]))
        else:
            out["reset"]["fee_percent"] = str(D(rng.randint(10, 100)) / 10000)
        out["reset"]["fee_plus_gst"] = rng.random() < 0.5
    if not out or rng.random() < 0.6:
        out["refinance"] = {
            "rate": _rate(cur - D(rng.randint(-20, 250)) / 10000),
            "lender": rng.choice([None, "SBI", "ICICI Bank"]),
            "processing_fee": str(rng.choice([0, 3000, 10000])),
            "stamp_duty": str(rng.choice([0, 5000, 20000])),
            "prepayment_charge": str(rng.choice([0, 0, 20000])),
        }
    if rng.random() < 0.3:
        out["mode"] = "same_emi"
    if rng.random() < 0.3:
        out["horizon_months"] = rng.randint(1, loan["tenure_months_remaining"])
    return out


def _named_422(r) -> str:
    assert r.status_code == 422, r.text[:300]
    detail = r.json()["detail"]
    assert isinstance(detail, dict) and detail["message"], r.text[:300]
    return detail["field"]


def _plain_text(*parts: str, where: str, lender=None) -> None:
    for text in parts:
        if isinstance(lender, str) and lender.strip():
            text = text.replace(lender.strip(), "LENDER")    # the borrower's own words
        m = LEFTOVERS.search(text)
        assert m is None, f"{where}: {m.group(0)!r} in …{text[max(0, m.start() - 40):m.end() + 40]}…"
        assert NEGATIVE_RUPEES.search(text) is None, f"{where}: negative amount in {text[:200]}"


def _letter(letter: dict, where: str, lender) -> None:
    text = letter["text"]
    assert stray_you(text) is None, f"{where}: stray {stray_you(text)!r}"
    _plain_text(text, where=where, lender=lender)
    assert D(letter["claim_amount"]) >= 0


def test_random_loans_through_the_api(client):
    rng = random.Random(20260926)
    seen = {"checked": 0, "refused": 0, "letters": 0, "offers": 0}
    for i in range(N_LOANS):
        where = f"loan {i}"
        loan = hostile_loan(rng) if rng.random() < 0.1 else random_loan(rng)
        loan = {k: v for k, v in loan.items() if v is not None}
        r = client.post("/api/loan-check", json=loan)
        if r.status_code != 200:
            _named_422(r)
            seen["refused"] += 1
            continue
        seen["checked"] += 1
        body = r.json()
        lender = loan.get("lender")
        assert D(body["claim_amount"]) >= 0, where
        assert D(body["amount_at_stake_this_year"]) >= 0, where
        for f in body["findings"]:
            assert D(f["amount_this_year"]) >= 0 and D(f["overcharged_so_far"]) >= 0, where
            assert f["months_overcharged"] >= 0, where
            _plain_text(f["headline"], f["detail"], where=where, lender=lender)
        _plain_text(body["summary"], *body["assumptions"], where=where, lender=lender)
        owed = any(f["kind"] == "missed_rate_cut" and f["claimable"] for f in body["findings"])

        # The complaint: only a claimable missed cut makes a letter.
        r = client.post("/api/complaints/in", json={**loan, **random_stage(rng, loan)})
        if r.status_code == 200:
            assert owed, where
            c = r.json()
            assert D(c["letter"]["claim_amount"]) == D(body["claim_amount"]), where
            _letter(c["letter"], where, lender)
            if c["io_followup"]:
                _letter(c["io_followup"], where + " IO follow-up", lender)
            if c["ombudsman"]:
                o = c["ombudsman"]
                for text in (o["facts"], o["relief"]):
                    assert stray_you(text) is None, f"{where}: ombudsman {stray_you(text)!r}"
                    _plain_text(text, where=where + " ombudsman", lender=lender)
            seen["letters"] += 1
        else:
            field = _named_422(r)
            assert field in ("claim", "sent_on", "received_on", "reply_on", "reply"), (where, r.text[:300])

        # The offer comparison.
        r = client.post("/api/offers/compare", json={**loan, **random_offers(rng, loan)})
        if r.status_code != 200:
            _named_422(r)
            continue
        seen["offers"] += 1
        o = r.json()
        assert o["verdict"] in ("keep", "reset", "refinance"), where
        for opt in o["options"]:
            assert D(opt["upfront_total"]) >= 0 and D(opt["cost_to_horizon"]) >= 0, where
            assert opt["months"] >= 1 and D(opt["emi"]) > 0, where
        _plain_text(o["headline"], o["reason"], o["next_step"], *o["warnings"], *o["notes"],
                    where=where + " offers", lender=lender)

    # The generator must exercise every path.
    assert seen["checked"] > N_LOANS * 0.7, seen
    assert seen["letters"] > N_LOANS * 0.1, seen
    assert seen["offers"] > N_LOANS * 0.5, seen
    assert seen["refused"] > 0, seen


# ── hostile values on every POST endpoint ───────────────────────────────────

def _bodies(user: dict) -> dict:
    loan = {"lender": "HDFC Bank", "loan_start": "2022-01", "start_rate": "0.0690",
            "current_rate": "0.0890", "outstanding": "4000000",
            "tenure_months_remaining": 200, "benchmark": "repo", "as_of": "2026-09-26"}
    return {
        "/api/simulate": {"user": user, "horizon_months": 60},
        "/api/baseline": {"user": user, "horizon_months": 60},
        "/api/sensitivity/compare": {"user": user, "horizon_months": 60, "surplus_delta": "5000",
                                     "lump_sum_amount": "100000", "lump_sum_target_loan_index": 0},
        "/api/windfall": {"amount": "100000", "user": user},
        "/api/quick-recompute": {"user": user, "extra_payment": "10000", "horizon_months": 60},
        "/api/restructuring": {"user": user, "plan_balances": {"0": ["100000", "90000"], "1": ["50000", "0"]}},
        # /api/portfolio/liquidation-rankings is off by default (audit 80 W10,
        # LIQUIDATION_RANKER): test_a80_w10_api.py fuzzes it with the flag on.
        "/api/new-debt": {"list_price": "50000", "cash_price_elsewhere": "45000",
                          "emi_offer_months": 12, "emi_offer_monthly_payment": "4500"},
        "/api/cash-yield": {"idle_balance": "500000", "current_yield": "0.025", "country": "IN"},
        "/api/asset-liquidation": {
            "asset": {"asset_type": "real_estate", "purchase_price": "6000000",
                      "purchase_date": "2018-06-15", "current_market_value": "9000000",
                      "state": "Maharashtra"},
            "sale_price": "9000000", "debt_balance": "1500000", "debt_effective_rate": "0.36",
            "taxable_income": "1800000", "asset_nominal_return": "0.04",
            "expected_hold_years_post_sale": "5", "purchase_fy": "2018-19", "current_fy": "2026-27"},
        "/api/score-impact": {"action": "utilisation_drop", "current_score": 680, "country": "IN",
                              "utilisation_from": "0.80", "utilisation_to": "0.30"},
        "/api/rate-offered": {"advertised_rate": "0.105", "score": 540,
                              "loan_type": "personal_loan", "country": "IN"},
        "/api/loan-check": loan,
        "/api/complaints/in": loan,
        "/api/offers/compare": {**loan, "reset": {"rate": "0.0790", "fee": "25000"},
                                "refinance": {"rate": "0.0760", "processing_fee": "10000"}},
        "/api/outcomes": {"lender": "HDFC Bank", "outcome": "fixed_full", "days_taken": 12,
                          "rate_before": "0.0925", "rate_after": "0.0870"},
    }


def _leaves(obj, path=()):
    if isinstance(obj, dict):
        for k, v in obj.items():
            yield from _leaves(v, path + (k,))
    elif isinstance(obj, list):
        for i, v in enumerate(obj):
            yield from _leaves(v, path + (i,))
    else:
        yield path


def _put(obj, path, value):
    for p in path[:-1]:
        obj = obj[p]
    obj[path[-1]] = value


def test_hostile_values_never_crash(client, india_user_payload):
    rng = random.Random(7)
    bodies = _bodies(india_user_payload)
    for ep, body in bodies.items():
        assert client.post(ep, json=body).status_code == 200, ep
    tried = 0
    for ep, body in bodies.items():
        paths = list(_leaves(body))
        if not FULL and "user" in body and ep != "/api/restructuring":
            # The user payload's fields are the same everywhere: sample them.
            paths = rng.sample(paths, 6)
        for path in paths:
            values = HOSTILE if FULL else rng.sample(HOSTILE, 3)
            for v in values:
                b = copy.deepcopy(body)
                _put(b, path, v)
                t = time.monotonic()
                r = client.post(ep, json=b)
                took = time.monotonic() - t
                tried += 1
                where = f"{ep} {'.'.join(map(str, path))}={str(v)[:20]!r}"
                # Outcome reports stop at 2 per bank a day, so later valid ones get a 429.
                allowed = (200, 400, 422, 429) if ep == "/api/outcomes" else (200, 400, 422)
                assert r.status_code in allowed, f"{where}: {r.status_code} {r.text[:200]}"
                assert took < 3, f"{where}: {took:.1f}s"
                if r.status_code == 422:
                    assert r.json()["detail"]["message"], where
    assert tried > 150


# ── the cases that crashed or slipped through before ────────────────────────

@pytest.mark.parametrize("mutate, field, words", [
    (lambda b: b["user"]["loans"][0].update(outstanding="-500000"), "user.loans.0.outstanding", "negative"),
    # Audit C12: loan rates are accepted up to 1,000% a year (10), so 9.5
    # (950%) is now a valid instant-loan rate; the typo guard bites above 10.
    (lambda b: b["user"]["loans"][0].update(nominal_rate="10.5"), "user.loans.0.nominal_rate", "send 0.105 for 10.5%"),
    (lambda b: b["user"].update(loans=b["user"]["loans"] * 250), "user.loans", "at most 50"),
    (lambda b: b["user"]["loans"][0].update(outstanding="1E+999999"), "user.loans.0.outstanding", "1,000,000,000,000"),
    (lambda b: b["user"]["loans"][0].update(tenure_months_remaining=10**18), "user.loans.0.tenure_months_remaining", ""),
    (lambda b: b.update(horizon_months=10**6), "horizon_months", "1200"),
    (lambda b: b["user"].update(inflation_rate="-1"), "user.inflation_rate", ""),
    (lambda b: b["user"].update(primary_bank="x" * 5000), "user.primary_bank", "200 characters"),
])
def test_bad_plan_input_is_a_named_422(client, india_user_payload, mutate, field, words):
    body = {"user": copy.deepcopy(india_user_payload), "horizon_months": 60}
    mutate(body)
    r = client.post("/api/simulate", json=body)
    assert r.status_code == 422, r.text[:300]
    detail = r.json()["detail"]
    assert detail["field"] == field
    assert words.lower() in detail["message"].lower(), detail
    assert "x" * 300 not in r.text          # input is not echoed back


def test_invalid_json_is_a_named_422(client):
    r = client.post("/api/simulate", content=b"{not json", headers={"Content-Type": "application/json"})
    assert r.status_code == 422
    assert r.json()["detail"] == {"field": "", "message": "The request is not valid JSON."}


@pytest.mark.parametrize("ep, body, field", [
    ("/api/windfall", {"amount": "1e30"}, "amount"),
    ("/api/new-debt", {"list_price": "50000", "cash_price_elsewhere": "45000", "emi_offer_months": 12,
                       "emi_offer_monthly_payment": "1e30"}, "emi_offer_monthly_payment"),
    ("/api/score-impact", {"action": "utilisation_drop", "current_score": 680, "country": "IN",
                           "utilisation_from": "1E+999999", "utilisation_to": "0.3"}, "utilisation_from"),
    ("/api/asset-liquidation", {"expected_hold_years_post_sale": "0"}, "expected_hold_years_post_sale"),
])
def test_numbers_that_used_to_crash(client, india_user_payload, ep, body, field):
    base = _bodies(india_user_payload)[ep]
    r = client.post(ep, json={**base, **body})
    assert _named_422(r) == field


def test_offer_fee_larger_than_the_loan(client):
    body = {**_bodies({})["/api/offers/compare"], "reset": {"rate": "0.079", "fee": "1e30"}}
    r = client.post("/api/offers/compare", json=body)
    assert _named_422(r) == "reset.fee"
    assert r.json()["detail"]["message"] == "The bank's fee is more than the loan itself. Check the number."
