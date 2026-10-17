"""Write the differential cases for audit-80 W10 (NRI drift/remittance and the
US student-loan hold with the user's country) to
engine/tests/fixtures/a80_w10_cases.json.

The engine test (engine/tests/test_a80_w10_nri.py) fails if the file is
stale; web/tests/a80-w10.cjs checks the TypeScript side against it.

Usage: python scripts/export_a80_w10_cases.py
"""
from __future__ import annotations

import json
import sys
from decimal import Decimal as D
from itertools import product
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from engine import cross_border, us_loans  # noqa: E402
from engine.models import Country, Loan, LoanType  # noqa: E402

OUT_PATH = ROOT / "engine" / "tests" / "fixtures" / "a80_w10_cases.json"


def build() -> dict:
    student = []
    for kind, track, ccy, country in product(
        (None, "federal", "private"), (None, "unsure", "none", "pslf", "idr"),
        (None, "USD", "INR"), ("US", "IN"),
    ):
        d = {"loan_type": "education_loan", "outstanding": "38000",
             **({"student_loan_kind": kind} if kind else {}),
             **({"forgiveness_track": track} if track else {}),
             **({"currency": ccy} if ccy else {})}
        loan = Loan(loan_type=LoanType.EDUCATION, bank="X", outstanding=D("38000"), nominal_rate=D("0.055"),
                    rate_type="fixed", tenure_months_remaining=120, scheduled_emi=D("420"),
                    currency=ccy, student_loan_kind=kind, forgiveness_track=track)
        student.append({"loan": d, "country": country,
                        "block": us_loans.forgiveness_prepay_block(loan, Country(country))})
    return {
        "inr_slide_vs_usd": format(-cross_border.INR_SLIDE_A_YEAR["USD"], "f"),
        "remittance_default_usd": format(cross_border.REMITTANCE_COST_DEFAULT["USD"], "f"),
        "student_with_country": student,
    }


if __name__ == "__main__":
    OUT_PATH.write_text(json.dumps(build(), indent=1, ensure_ascii=False) + "\n")
    print(f"wrote {OUT_PATH.relative_to(ROOT)}")
