"""Export old-vs-new regime comparisons (engine/tax/india.compare_regimes)
to engine/tests/fixtures/regime_compare_cases.json.

web/src/lib/regime-compare.ts mirrors the engine; web/tests/g2-india-tax.cjs
checks it against these cases and engine/tests/test_tax_india_2025.py fails
when the JSON falls behind the engine.

Usage: python scripts/export_regime_cases.py
"""
from __future__ import annotations

import json
import sys
from decimal import Decimal
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from engine.tax.india import HomeLoanYear, RegimeInputs, compare_regimes  # noqa: E402

OUT_PATH = ROOT / "engine" / "tests" / "fixtures" / "regime_compare_cases.json"
D = Decimal


def _cases() -> list[dict]:
    out: list[dict] = []
    salaries = ["0", "600000", "1000000", "1275000", "1500000", "1800000", "2500000", "6000000"]
    homes = [
        [],
        [{"interest": "350000", "principal": "120000"}],
        [{"interest": "180000", "principal": "60000", "share": "0.5"}],
        [{"interest": "240000", "principal": "90000", "let_out": True, "annual_rent": "300000", "municipal_tax": "6000"}],
        [{"interest": "240000", "principal": "90000", "let_out": True}],
        [{"interest": "150000", "principal": "40000", "pre_construction_instalment": "60000"},
         {"interest": "90000", "principal": "30000", "let_out": True, "annual_rent": "120000"}],
        [{"interest": "100000", "principal": "50000", "full_cap": False}],
        [{"interest": "200000", "principal": "100000", "principal_80c_eligible": False}],
    ]
    extras = [
        {},
        {"sec80c_other": "100000", "sec80d": "25000"},
        {"sec80c_other": "150000", "sec80ccd1b": "50000", "hra_exemption": "180000", "edu_interest": "60000"},
        {"business_income": "800000", "age": "60_79"},
        {"other_income": "50000", "age": "80_plus", "sec80d": "50000"},
    ]
    for s in salaries:
        for h in homes:
            for e in extras:
                out.append({"salary": s, "home_loans": h, **e})
    return out


def _inputs(c: dict) -> RegimeInputs:
    hl = [HomeLoanYear(
        interest=D(h["interest"]), principal=D(h.get("principal", "0")), share=D(h.get("share", "1")),
        let_out=bool(h.get("let_out", False)),
        annual_rent=D(h["annual_rent"]) if "annual_rent" in h else None,
        municipal_tax=D(h.get("municipal_tax", "0")),
        pre_construction_instalment=D(h.get("pre_construction_instalment", "0")),
        full_cap=bool(h.get("full_cap", True)),
        principal_80c_eligible=bool(h.get("principal_80c_eligible", True)),
    ) for h in c.get("home_loans", [])]
    return RegimeInputs(
        salary=D(c.get("salary", "0")), business_income=D(c.get("business_income", "0")),
        other_income=D(c.get("other_income", "0")), age=c.get("age"),
        hra_exemption=D(c.get("hra_exemption", "0")), sec80c_other=D(c.get("sec80c_other", "0")),
        sec80d=D(c.get("sec80d", "0")), sec80ccd1b=D(c.get("sec80ccd1b", "0")),
        edu_interest=D(c.get("edu_interest", "0")), home_loans=hl,
    )


def _s(d: Decimal | None) -> str | None:
    return None if d is None else str(d.quantize(D("0.01")))


def build() -> dict:
    rows = []
    for c in _cases():
        r = compare_regimes(_inputs(c))
        rows.append({"in": c, "out": {
            "old_taxable": _s(r.old.taxable), "old_tax": _s(r.old.tax), "old_hp": _s(r.old.house_property),
            "old_loan_deductions": _s(r.old.loan_deductions),
            "new_taxable": _s(r.new.taxable), "new_tax": _s(r.new.tax), "new_hp": _s(r.new.house_property),
            "better": r.better, "old_saves": _s(r.old_saves), "loans_worth_in_old": _s(r.loans_worth_in_old),
            "extra_for_old": _s(r.extra_deductions_for_old_to_win), "switch_rule": r.switch_rule,
        }})
    return {"source": "engine/tax/india.compare_regimes · python scripts/export_regime_cases.py", "cases": rows}


def render() -> str:
    return json.dumps(build(), indent=1) + "\n"


def main() -> int:
    OUT_PATH.write_text(render(), encoding="utf-8")
    print(f"wrote {OUT_PATH.relative_to(ROOT)} ({len(build()['cases'])} cases)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
