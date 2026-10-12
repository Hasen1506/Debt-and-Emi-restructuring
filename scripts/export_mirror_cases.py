"""Golden cases for the TypeScript mirrors that had none (grill #41, sprint G4).

Writes engine/tests/fixtures/mirror_cases.json:
  • min_payment  — engine/minimum_payments.compute_minimum_payment vs
                   web/src/lib/min-payment.ts explainMinPayment, every bank
                   in both registries plus the country defaults;
  • prepayment_fee_default — engine/prepayment_fee.prepayment_fee_default vs
                   web/src/lib/prepayment-fee.ts prepaymentFeeDefault, every
                   loan type × rate type × market.
Fixed seed, so the file changes only when a formula does. The engine test
(test_mirror_golden.py) fails if the file is stale; the web test
(web/tests/g4-mirror-golden.cjs) fails if a TS twin disagrees.

Usage: python scripts/export_mirror_cases.py
"""
from __future__ import annotations

import json
import random
import sys
from decimal import ROUND_HALF_UP, Decimal
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from engine.minimum_payments import (  # noqa: E402
    INDIA_MIN_PAYMENT_FORMULAS, USA_MIN_PAYMENT_FORMULAS, compute_minimum_payment,
)
from engine.models import Country, Loan, LoanType  # noqa: E402
from engine.prepayment_fee import prepayment_fee_default  # noqa: E402

OUT_PATH = ROOT / "engine" / "tests" / "fixtures" / "mirror_cases.json"
D = Decimal


def _card(bank: str, outstanding: Decimal, rate: Decimal, ccy: str) -> Loan:
    return Loan(loan_type=LoanType.CREDIT_CARD, bank=bank, outstanding=outstanding,
                nominal_rate=rate, rate_type="fixed", tenure_months_remaining=12,
                scheduled_emi=D("0"), currency=ccy)


def min_payment_cases() -> list[dict]:
    rng = random.Random(20261012)
    out = []
    for country, registry, ccy in ((Country.IN, INDIA_MIN_PAYMENT_FORMULAS, "INR"),
                                   (Country.US, USA_MIN_PAYMENT_FORMULAS, "USD")):
        banks = list(registry) + ["(unlisted bank)"]
        for bank in banks:
            balances = [D("150"), D("3000"), D("85000")] + [
                D(str(rng.randint(100, 500000))) for _ in range(3)]
            for bal in balances:
                rate = D(str(round(rng.uniform(0.12, 0.48), 4)))
                interest = bal * rate / D("12")   # the TS twin's interest line
                got = compute_minimum_payment(_card(bank, bal, rate, ccy), country,
                                              interest_accrued=interest)
                out.append({
                    "in": {"loan_type": "credit_card", "bank": bank if bank != "(unlisted bank)" else "",
                           "outstanding": str(bal), "nominal_rate": str(rate), "country": country.value},
                    "out": {"estimated": str(got.quantize(D("1"), rounding=ROUND_HALF_UP)),
                            "source": "bank" if bank in registry else "default"},
                })
    return out


def prepayment_fee_cases() -> list[dict]:
    out = []
    for lt in LoanType:
        for rt in ("floating", "fixed"):
            for mk in ("IN", "US"):
                d = prepayment_fee_default(lt.value, rt, mk)
                out.append({"in": {"loan_type": lt.value, "rate_type": rt, "market": mk},
                            "out": {"pct": str(d.pct), "status": d.status, "reason": d.reason}})
    return out


def goal_rule_cases() -> list[dict]:
    """One goal, first month: what engine/goals.serial_fill_allocation puts
    in under each funding rule (goal-line.ts firstMonthContribution)."""
    from engine.goals import GoalState, serial_fill_allocation
    rng = random.Random(41)
    out = []
    for _ in range(60):
        rule = rng.choice(["schedule", "fixed", "surplus_pct"])
        required = D(rng.randint(10_000, 2_000_000))
        saved = D(rng.choice([0, 0, rng.randint(0, int(required))]))
        months = rng.randint(1, 120)
        spare = D(rng.choice([0, rng.randint(0, 200_000)]))
        amount = D(rng.randint(500, 80_000)) if rule == "fixed" else None
        pct = D(str(round(rng.uniform(0.05, 1), 2))) if rule == "surplus_pct" else None
        g = GoalState(id="g", target_month_index=months, required_amount=required, saved_so_far=saved,
                      funding_rule=rule, funding_amount=amount, funding_pct=pct)
        c = serial_fill_allocation([g], spare, 0).contributions[0]
        out.append({"in": {"rule": {"kind": rule, **({"amount": str(amount)} if amount is not None else {}),
                                    **({"pct": str(pct)} if pct is not None else {})},
                           "remaining": str(max(D(0), required - saved)), "months": months, "spare": str(spare)},
                    "out": {"amount": str(c.amount)}})
    return out


def render() -> str:
    return json.dumps({"min_payment": min_payment_cases(),
                       "prepayment_fee_default": prepayment_fee_cases(),
                       "goal_rule": goal_rule_cases()}, indent=1) + "\n"


if __name__ == "__main__":
    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUT_PATH.write_text(render(), encoding="utf-8")
    print(f"wrote {OUT_PATH.relative_to(ROOT)}")
