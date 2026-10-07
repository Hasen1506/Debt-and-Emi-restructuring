"""Write the differential cases for the payoff rules (engine/ordering.py
apply_rules vs web/src/lib/payoff-rules.ts applyRules) to
engine/tests/fixtures/payoff_rules_cases.json.

Fixed seed, so the file only changes when the rules do. The engine test
fails if the file is stale; the web test fails if the TypeScript twin
orders any case differently.

Usage: python scripts/export_payoff_rules_cases.py
"""
from __future__ import annotations

import json
import random
import sys
from decimal import Decimal as D
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from engine.models import Loan, LoanType, PayoffRules  # noqa: E402
from engine.ordering import apply_rules  # noqa: E402

OUT_PATH = ROOT / "engine" / "tests" / "fixtures" / "payoff_rules_cases.json"


def cases() -> list[dict]:
    rng = random.Random(20261007)
    out = []
    for n in range(60):
        k = rng.randint(1, 6)
        # Distinct rates and balances, so both sides have one right answer.
        rates = rng.sample(range(10, 480), k)
        bals = rng.sample(range(500, 400000, 250), k)
        loans = [Loan(LoanType.PERSONAL, f"B{i}", D(bals[i]), D(rates[i]) / 1000, "fixed", 36, D("0")) for i in range(k)]
        rules = PayoffRules(
            small_first_below=rng.choice([None, D(rng.choice([1000, 50000, 100000, 250000]))]),
            pinned=rng.sample(range(k + 1), rng.randint(0, min(2, k))) if rng.random() < 0.5 else [],
            custom_order=rng.sample(range(k + 1), rng.randint(1, k)) if rng.random() < 0.25 else [],
        )
        eff = {id(l): l.nominal_rate for l in loans}
        order = apply_rules(loans, eff, rules, lambda l: l.outstanding)
        out.append({
            "rates": [float(l.nominal_rate) for l in loans],
            "balances": [float(l.outstanding) for l in loans],
            "rules": {
                "small_first_below": None if rules.small_first_below is None else str(rules.small_first_below),
                "pinned": list(rules.pinned),
                "custom_order": list(rules.custom_order),
            },
            "order": [loans.index(l) for l in order],
        })
    return out


def render() -> str:
    return json.dumps(cases(), indent=1) + "\n"


if __name__ == "__main__":
    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUT_PATH.write_text(render(), encoding="utf-8")
    print(f"wrote {OUT_PATH.relative_to(ROOT)}")
