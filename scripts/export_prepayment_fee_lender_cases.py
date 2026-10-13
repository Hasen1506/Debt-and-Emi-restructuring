"""Write engine/tests/fixtures/prepayment_fee_lender_cases.json: the blank
prepayment-fee default by lender type, business purpose, sanction year and
amount (grill #28, sprint G1). The engine test and web/tests/g1-cards-fees.cjs
both read it, so engine/prepayment_fee.py and web/src/lib/prepayment-fee.ts
can't drift apart.

Usage: python scripts/export_prepayment_fee_lender_cases.py
"""
import itertools
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from decimal import Decimal  # noqa: E402

from engine.prepayment_fee import LENDER_TYPES, prepayment_fee_default  # noqa: E402

OUT = ROOT / "engine" / "tests" / "fixtures" / "prepayment_fee_lender_cases.json"


def main() -> None:
    cases = []
    for loan_type, rate_type, market in (("personal_loan", "floating", "IN"), ("home_loan", "floating", "IN"),
                                         ("personal_loan", "fixed", "IN"), ("home_loan", "floating", "US")):
        for lender, business, year, amount in itertools.product(
            (None, *LENDER_TYPES), (None, False, True), (None, 2025, 2026), (None, "4000000", "6000000"),
        ):
            d = prepayment_fee_default(loan_type, rate_type, market, lender, business, year,
                                       Decimal(amount) if amount else None)
            cases.append({
                "args": {"loan_type": loan_type, "rate_type": rate_type, "market": market, "lender_type": lender,
                         "business_purpose": business, "sanction_year": year, "sanctioned_amount": amount},
                "pct": str(d.pct), "status": d.status, "reason": d.reason,
            })
    OUT.write_text(json.dumps({"cases": cases}, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"wrote {OUT} ({len(cases)} cases)")


if __name__ == "__main__":
    main()
