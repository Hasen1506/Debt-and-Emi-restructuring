"""Write the differential cases for the true annual cost (engine/true_apr.py
vs web/src/lib/true-apr.ts) to engine/tests/fixtures/true_apr_cases.json.

Fixed seed, so the file only changes when the formula does. The engine test
fails if the file is stale; the web test fails if the TypeScript twin gives
a different answer for any case.

Usage: python scripts/export_true_apr_cases.py
"""
from __future__ import annotations

import json
import random
import sys
from dataclasses import asdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from engine.true_apr import TrueAprInputs, true_apr  # noqa: E402

OUT_PATH = ROOT / "engine" / "tests" / "fixtures" / "true_apr_cases.json"


def cases() -> list[dict]:
    rng = random.Random(20261007)
    out = []
    named = [
        TrueAprInputs(0.42, None, gst_on_interest=0.18),                         # Indian card
        TrueAprInputs(0.085, 180),                                               # home loan, no extras
        TrueAprInputs(0.105, 60, fee_rate=0.004, gst_on_fee=0.18),               # personal loan with fee
        TrueAprInputs(0.085, 240, shield=0.3),                                   # deductible home loan
        TrueAprInputs(0.0, 24, fee_rate=0.01),                                   # 0% EMI with a fee
        TrueAprInputs(0.14, 12, fee_rate=0.02, insurance_rate=0.005, gst_on_fee=0.18, shield=0.0),
    ]
    for _ in range(40):
        named.append(TrueAprInputs(
            nominal=round(rng.uniform(0, 0.5), 4),
            months=rng.choice([None, 6, 12, 36, 60, 120, 240, 360]),
            fee_rate=round(rng.choice([0, rng.uniform(0, 0.02)]), 5),
            insurance_rate=round(rng.choice([0, 0, rng.uniform(0, 0.01)]), 5),
            gst_on_interest=rng.choice([0.0, 0.18]),
            gst_on_fee=rng.choice([0.0, 0.18]),
            shield=round(rng.choice([0, 0, rng.uniform(0, 0.42)]), 4),
        ))
    for x in named:
        out.append({"in": asdict(x), "out": {k: round(v, 10) for k, v in asdict(true_apr(x)).items()}})
    return out


def render() -> str:
    return json.dumps(cases(), indent=1) + "\n"


if __name__ == "__main__":
    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUT_PATH.write_text(render(), encoding="utf-8")
    print(f"wrote {OUT_PATH.relative_to(ROOT)}")
