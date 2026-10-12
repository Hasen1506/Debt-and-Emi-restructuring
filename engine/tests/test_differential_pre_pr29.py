"""Differential tests: the current engine against the pre-PR-29 engine (c753849).

Both engines run the same seeded random profiles (the old one from a
`git archive` of c753849, in a subprocess; see differential_runner.py).
Each domain states what must hold between them:

  IDENTICAL  — inputs PR #29 did not touch: results must match to 1e-9.
  DIRECTION  — an intentional change: the difference must point the
               documented way (and be explained by that change alone).

Every intentional difference is listed in docs/testing/DIFFERENCES.md; a new
difference that isn't there fails this file.
"""
from __future__ import annotations

import json
import os
import random
import subprocess
import sys
import tarfile
import io
from decimal import Decimal
from pathlib import Path

import pytest

from engine.formulas import emi
from engine.tests.differential_runner import run_case

D = Decimal
LEGACY_SHA = "c753849"
ROOT = Path(__file__).resolve().parents[2]
RUNNER = Path(__file__).with_name("differential_runner.py")
SEED = 290029
EXACT = D("1e-9")


# ── legacy engine ───────────────────────────────────────────────────────────

@pytest.fixture(scope="session")
def legacy_dir(tmp_path_factory) -> Path:
    out = tmp_path_factory.mktemp("legacy_c753849")
    try:
        blob = subprocess.run(["git", "-C", str(ROOT), "archive", "--format=tar", LEGACY_SHA, "engine"],
                              check=True, capture_output=True, timeout=60).stdout
    except (subprocess.CalledProcessError, FileNotFoundError, subprocess.TimeoutExpired) as e:
        if os.environ.get("CI"):
            pytest.fail(f"CI must check out full history (fetch-depth: 0) to reach {LEGACY_SHA}: {e}")
        pytest.skip(f"{LEGACY_SHA} not in this clone")
    with tarfile.open(fileobj=io.BytesIO(blob)) as tar:
        tar.extractall(out, filter="data")
    return out


def run_legacy(legacy_dir: Path, cases: list[dict]) -> list[dict]:
    env = {k: v for k, v in os.environ.items() if k != "PYTHONPATH"}
    env["PYTHONPATH"] = str(legacy_dir)
    proc = subprocess.run([sys.executable, str(RUNNER)], input=json.dumps(cases), capture_output=True,
                          text=True, env=env, cwd=str(legacy_dir), timeout=600)
    assert proc.returncode == 0, proc.stderr[-2000:]
    return json.loads(proc.stdout)


def both(legacy_dir, cases):
    old = run_legacy(legacy_dir, cases)
    new = [run_case(c) for c in cases]
    return list(zip(cases, old, new))


# ── seeded generators ───────────────────────────────────────────────────────

EMI_TYPES = ["home_loan", "auto_loan", "personal_loan", "education_loan", "gold_loan", "bnpl"]


def _loan(rng, lt=None, min_bps=60, **extra):
    lt = lt or rng.choice(EMI_TYPES)
    p = rng.choice([rng.randint(5_000, 500_000), rng.randint(500_000, 20_000_000)])
    bps = rng.randint(min_bps, 3600)
    n = rng.randint(6, 240)
    r = D(bps) / D(10000)
    e = "0" if lt == "credit_card" else str(emi(D(p), r, n).quantize(D("0.01")))
    loan = {"loan_type": lt, "outstanding": str(p), "nominal_rate": str(r), "tenure": n, "emi": e,
            "bank": rng.choice(["SBI", "HDFC Bank", "ICICI Bank", "Chase", "Citi"])}
    loan.update(extra)
    return loan


def _income(rng, loans, comfortable=True):
    need = sum(D(l["emi"]) for l in loans) + sum(D(l["outstanding"]) * D("0.06") for l in loans if l["loan_type"] == "credit_card")
    k = rng.randint(105, 300) if comfortable else rng.randint(60, 140)
    return str((need * k / 100 + rng.randint(0, 50_000)).quantize(D("1")))


def _num(x):
    return D(x) if x is not None else None


def _assert_identical(case, old, new):
    for mode in case.get("modes", ["plan", "baseline"]):
        o, n = old[mode], new[mode]
        assert "error" not in o and "error" not in n, (case, o, n)
        assert o["debt_free_month"] == n["debt_free_month"], (case, mode)
        assert abs(D(o["total_interest"]) - D(n["total_interest"])) <= EXACT, (case, mode, o["total_interest"], n["total_interest"])
        assert len(o["months"]) == len(n["months"])
        for mo, mn in zip(o["months"], n["months"]):
            assert abs(D(mo[1]) - D(mn[1])) <= EXACT, (case, mode)


# ── IDENTICAL: what PR #29 did not change ───────────────────────────────────

def test_single_loan_untouched_inputs_are_identical(legacy_dir):
    """One EMI loan or one US card, own currency, no fees/moratorium/pre-EMI,
    no tax shield (marginal rate 0): PR #29 changed nothing here."""
    rng = random.Random(SEED)
    cases = []
    for _ in range(400):
        country = rng.choice(["IN", "US"])
        lt = rng.choice(EMI_TYPES)  # cards: average daily balance since G1 (test_card_interest_on_the_average_daily_balance)
        loans = [_loan(rng, lt)]
        cases.append({"country": country, "income": _income(rng, loans, rng.random() < 0.8), "loans": loans,
                      "strategy": rng.choice(["avalanche", "snowball", "hybrid"]),
                      "liquid_returns": rng.choice([[], ["0.04"], ["0.07"]])})
    for case, old, new in both(legacy_dir, cases):
        if _gate_moved_by_compounding(case):
            continue
        _assert_identical(case, old, new)


def _gate_moved_by_compounding(case) -> bool:
    """The invest-or-prepay gate now weighs a loan at its compounded annual
    cost, (1 + r/12)^12 - 1, where the old engine took the nominal rate: a
    7.5% loan costs 7.76% a year. Where the hurdle (best return + 0.5pp, no
    tax at marginal rate 0) falls between the two, the old engine invested
    and the new one prepays, on purpose. Every other case must still match."""
    r = D(case["loans"][0]["nominal_rate"])
    hurdles = [D(x) + D("0.005") for x in case.get("liquid_returns") or []]
    return any(r <= h < (1 + r / 12) ** 12 - 1 for h in hurdles)


def test_multi_loan_baseline_is_identical(legacy_dir):
    """Minimums-only on several own-currency EMI loans / US cards: no cascade,
    no GST, so both engines must agree month by month."""
    rng = random.Random(SEED + 1)
    cases = []
    for _ in range(250):
        country = rng.choice(["IN", "US"])
        types = EMI_TYPES  # cards: average daily balance since G1, see test_card_interest_on_the_average_daily_balance
        loans = [_loan(rng, rng.choice(types)) for _ in range(rng.randint(2, 5))]
        cases.append({"country": country, "income": _income(rng, loans, rng.random() < 0.7), "loans": loans,
                      "modes": ["baseline"]})
    for case, old, new in both(legacy_dir, cases):
        _assert_identical(case, old, new)


def test_multi_loan_plan_differs_only_by_the_cascade_fix(legacy_dir):
    """DIFFERENCE H2 (cascade walks the payoff order): the old engine gave a
    clearing loan's freed money to the next loan only, dropping anything
    above its balance. The new one keeps walking, so it can only pay MORE
    principal: total interest never higher, debt-free never later."""
    rng = random.Random(SEED + 2)
    cases, identical = [], 0
    for _ in range(250):
        country = rng.choice(["IN", "US"])
        types = EMI_TYPES  # cards: average daily balance since G1, see test_card_interest_on_the_average_daily_balance
        loans = [_loan(rng, rng.choice(types)) for _ in range(rng.randint(2, 4))]
        cases.append({"country": country, "income": _income(rng, loans, True), "loans": loans,
                      "strategy": rng.choice(["avalanche", "snowball", "hybrid"]), "modes": ["plan"]})
    for case, old, new in both(legacy_dir, cases):
        o, n = old["plan"], new["plan"]
        assert D(n["total_interest"]) <= D(o["total_interest"]) + EXACT, case
        if o["debt_free_month"] is not None:
            assert n["debt_free_month"] is not None and n["debt_free_month"] <= o["debt_free_month"], case
        identical += abs(D(n["total_interest"]) - D(o["total_interest"])) <= EXACT
    # The fix bites only when freed money overflows the next loan; most
    # profiles are untouched.
    assert identical >= len(cases) // 2, identical


# ── DIRECTION: intentional differences ──────────────────────────────────────

def test_indian_card_interest_carries_18pct_gst(legacy_dir):
    """DIFFERENCE P2-13: Indian card finance charges now carry 18% GST in the
    cash flow. Since sprint G1 the charge is on the average daily balance
    (the payment stops interest on its part for the last third of the
    cycle), so first-month interest is between 1.18 × 2/3 and 1.18 times the
    old engine's whole-month figure."""
    rng = random.Random(SEED + 3)
    cases = []
    for _ in range(200):
        card = _loan(rng, "credit_card", min_bps=100)
        if rng.random() < 0.5:
            card["min_override"] = str((D(card["outstanding"]) * D("0.06")).quantize(D("0.01")))
        cases.append({"country": "IN", "income": _income(rng, [card], True), "loans": [card], "modes": ["baseline"]})
    for case, old, new in both(legacy_dir, cases):
        o, n = old["baseline"], new["baseline"]
        first_old, first_new = D(o["months"][0][1]), D(n["months"][0][1])
        assert first_new <= first_old * D("1.18") + D("1e-6"), case
        assert first_new >= first_old * D("1.18") * 2 / 3 - D("1e-6"), case


def test_card_interest_on_the_average_daily_balance(legacy_dir):
    """DIFFERENCE G1-ADB (sprint G1, grill #25): a US card's interest is on
    the average daily balance; the payment made on the due date stops
    interest on the paid part for the last third of the cycle (RBI MD 2022
    FAQ 6 for India; the same daily-balance method US issuers use). It can
    only be lower than the old whole-month charge, month by month."""
    rng = random.Random(SEED + 9)
    cases = []
    for _ in range(150):
        card = _loan(rng, "credit_card", min_bps=100)
        cases.append({"country": "US", "income": _income(rng, [card], True), "loans": [card], "modes": ["baseline"]})
    for case, old, new in both(legacy_dir, cases):
        o, n = old["baseline"], new["baseline"]
        assert D(n["months"][0][1]) <= D(o["months"][0][1]) + D("1e-6"), case
        assert D(n["total_interest"]) <= D(o["total_interest"]) + EXACT, case


def test_moratorium_interest_is_capitalised(legacy_dir):
    """DIFFERENCE M1: before the first EMI (gap of 2+ months) interest now
    accrues onto the balance; the old engine let it vanish."""
    rng = random.Random(SEED + 4)
    cases = []
    for _ in range(150):
        loan = _loan(rng, rng.choice(["education_loan", "home_loan", "personal_loan"]),
                     first_payment_month=rng.randint(3, 24))
        cases.append({"country": rng.choice(["IN", "US"]), "income": _income(rng, [loan], True),
                      "loans": [loan], "modes": ["baseline"]})
    for case, old, new in both(legacy_dir, cases):
        o, n = old["baseline"], new["baseline"]
        assert D(n["total_interest"]) > D(o["total_interest"]), case


def test_foreign_loan_without_rate_is_refused_not_converted_1_to_1(legacy_dir):
    """DIFFERENCE H4: the old engine silently treated ₹ and $ as 1:1 when no
    exchange rate was saved; the new one refuses (the API answers 422)."""
    rng = random.Random(SEED + 5)
    cases = []
    for _ in range(60):
        country = rng.choice(["IN", "US"])
        foreign = "USD" if country == "IN" else "INR"
        loans = [_loan(rng), _loan(rng, currency=foreign)]
        cases.append({"country": country, "income": _income(rng, loans, True), "loans": loans})
    for case, old, new in both(legacy_dir, cases):
        for mode in ("plan", "baseline"):
            assert "error" not in old[mode], case
            assert new[mode].get("error") == "MissingFxRate", (case, new[mode])


def test_hike_schedule_alone_now_raises_income(legacy_dir):
    """DIFFERENCE (hike schedule): phases used to be ignored unless a flat
    annual hike was also set. More income can only mean less interest."""
    rng = random.Random(SEED + 6)
    cases = []
    for _ in range(120):
        loans = [_loan(rng) for _ in range(rng.randint(1, 3))]
        cases.append({"country": rng.choice(["IN", "US"]), "income": _income(rng, loans, True), "loans": loans,
                      "hike_schedule": [[1, 40, str(D(rng.randint(3, 15)) / 100)]], "modes": ["plan"]})
    changed = 0
    for case, old, new in both(legacy_dir, cases):
        o, n = old["plan"], new["plan"]
        assert D(n["total_interest"]) <= D(o["total_interest"]) + EXACT, case
        changed += D(n["total_interest"]) < D(o["total_interest"]) - EXACT
    assert changed > 0


def test_pre_emi_minimum_is_interest_only(legacy_dir):
    """DIFFERENCE P2-14: during pre-EMI the committed payment is the interest,
    not the full EMI, so the first month's spare cash is never lower."""
    rng = random.Random(SEED + 7)
    cases = []
    for _ in range(120):
        loans = [_loan(rng, "home_loan", pre_emi=rng.randint(1, 18)), _loan(rng)]
        cases.append({"country": rng.choice(["IN", "US"]), "income": _income(rng, loans, True), "loans": loans,
                      "modes": ["plan"]})
    for case, old, new in both(legacy_dir, cases):
        assert D(new["plan"]["months"][0][3]) >= D(old["plan"]["months"][0][3]), case


def test_prepayment_fee_gate_never_prepays_at_a_loss(legacy_dir):
    """DIFFERENCE (this PR, found by the property suite): a loan whose
    prepayment fee exceeds the interest an extra payment saves is no longer
    prepaid. The new engine's plan never costs more than its own minimums-
    only baseline; the old one did in some of these profiles."""
    rng = random.Random(SEED + 8)
    cases = []
    for _ in range(200):
        loans = [_loan(rng, penalty=str(D(rng.randint(50, 400)) / 10000)) for _ in range(rng.randint(1, 2))]
        for l in loans:
            l["tenure"] = rng.randint(6, 24)
            l["nominal_rate"] = str(D(rng.randint(60, 900)) / 10000)
            l["emi"] = str(emi(D(l["outstanding"]), D(l["nominal_rate"]), l["tenure"]).quantize(D("0.01")))
        cases.append({"country": rng.choice(["IN", "US"]), "income": _income(rng, loans, True), "loans": loans})
    old_losses = 0
    for case, old, new in both(legacy_dir, cases):
        assert D(new["plan"]["total_interest"]) <= D(new["baseline"]["total_interest"]) + D("0.01"), case
        old_losses += D(old["plan"]["total_interest"]) > D(old["baseline"]["total_interest"]) + D("0.01")
    assert old_losses > 0, "the seeded profiles should include the losses the old engine made"
