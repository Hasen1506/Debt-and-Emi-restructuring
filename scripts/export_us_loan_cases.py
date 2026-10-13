"""Write the differential cases for the US loan rules (engine/us_loans.py and
engine/tax/usa.py's SALT schedule vs web/src/lib/us-loans.ts) to
engine/tests/fixtures/us_loan_cases.json.

Fixed inputs, so the file only changes when a rule does. The engine test
(engine/tests/test_us_loan_cases_export.py) fails if the file is stale; the
web test (web/tests/us-market.cjs) fails if the TypeScript twin differs.

Usage: python scripts/export_us_loan_cases.py
"""
from __future__ import annotations

import json
import sys
from decimal import Decimal as D
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from engine import us_loans  # noqa: E402
from engine.models import Loan, LoanType  # noqa: E402
from engine.tax.usa import salt_cap_for_year  # noqa: E402

OUT_PATH = ROOT / "engine" / "tests" / "fixtures" / "us_loan_cases.json"

US_STATES = [
    "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "DC", "FL", "GA", "HI", "ID", "IL", "IN", "IA", "KS",
    "KY", "LA", "ME", "MD", "MA", "MI", "MN", "MS", "MO", "MT", "NE", "NV", "NH", "NJ", "NM", "NY", "NC",
    "ND", "OH", "OK", "OR", "PA", "RI", "SC", "SD", "TN", "TX", "UT", "VT", "VA", "WA", "WV", "WI", "WY",
]


def _s(v) -> str | None:
    if v is None:
        return None
    return format(v.normalize() if v != 0 else D("0"), "f")


def _loan(d: dict) -> Loan:
    return Loan(
        loan_type=LoanType(d["loan_type"]), bank="X",
        outstanding=D(d.get("outstanding", "0")), nominal_rate=D(d.get("nominal_rate", "0")),
        rate_type="fixed", tenure_months_remaining=360, scheduled_emi=D(d.get("scheduled_emi", "0")),
        currency=d.get("currency"),
        student_loan_kind=d.get("student_loan_kind"), forgiveness_track=d.get("forgiveness_track"),
        pmi_monthly=D(d.get("pmi_monthly", "0")),
        original_home_value=D(d["original_home_value"]) if d.get("original_home_value") else None,
        mortgage_insurance_kind=d.get("mortgage_insurance_kind"),
        pmi_months_remaining=d.get("pmi_months_remaining"),
    )


def build() -> dict:
    student = []
    for kind in (None, "federal", "private"):
        for track in (None, "pslf", "idr"):
            for ccy in (None, "USD", "INR"):
                d = {"loan_type": "education_loan", "outstanding": "40000",
                     **({"student_loan_kind": kind} if kind else {}),
                     **({"forgiveness_track": track} if track else {}),
                     **({"currency": ccy} if ccy else {})}
                l = _loan(d)
                student.append({"loan": d, "block": us_loans.forgiveness_prepay_block(l),
                                "explainer": us_loans.student_loan_explainer(l)})
    homes = []
    base = {"loan_type": "home_loan", "outstanding": "285000", "nominal_rate": "0.065",
            "scheduled_emi": "1896", "pmi_monthly": "150", "original_home_value": "300000"}
    variants = [
        {}, {"outstanding": "240000"}, {"outstanding": "240001"}, {"outstanding": "200000"},
        {"original_home_value": None}, {"pmi_monthly": "0"},
        {"mortgage_insurance_kind": "fha_mip"}, {"mortgage_insurance_kind": "fha_mip", "pmi_months_remaining": 0},
        {"mortgage_insurance_kind": "fha_mip", "pmi_months_remaining": 18},
        {"outstanding": "475000", "original_home_value": "500000", "nominal_rate": "0.07", "scheduled_emi": "3200",
         "pmi_monthly": "210"},
        {"outstanding": "100000", "nominal_rate": "0.08", "scheduled_emi": "600"},   # payment below interest
        {"loan_type": "auto_loan"},
    ]
    for v in variants:
        d = {**base, **v}
        if d.get("original_home_value") is None:
            d.pop("original_home_value", None)
        l = _loan(d)
        a = us_loans.pmi_analysis(l)
        homes.append({
            "loan": d,
            "due": _s(us_loans.pmi_due(l)),
            "analysis": None if a is None else {
                "kind": a.kind, "monthly": _s(a.monthly), "annual": _s(a.annual),
                "request_balance": _s(a.request_balance), "auto_balance": _s(a.auto_balance),
                "extra_to_request_now": _s(a.extra_to_request_now),
                "months_to_request": a.months_to_request, "months_to_auto": a.months_to_auto,
                "pmi_saved_by_paying_now": _s(a.pmi_saved_by_paying_now),
                "pmi_return_pct": _s(a.pmi_return_pct), "notes": a.notes,
            },
        })
    states = []
    for s in [None, "", "tx", *US_STATES]:
        t = us_loans.state_mortgage_treatment(s)
        states.append({"state": s, "kind": t.kind, "modelled": t.modelled, "label": t.label,
                       "source_url": t.source_url,
                       "rate": _s(us_loans.us_mortgage_marginal_rate(D("0.2707"), s, D("0.0507")))})
    salt = []
    for year in range(2025, 2032):
        for magi in (None, "400000", "505000", "510050", "600000", "700000", "2000000"):
            for mfs in (False, True):
                v = salt_cap_for_year(year, D(magi) if magi else None, mfs)
                salt.append({"year": year, "magi": magi, "mfs": mfs, "cap": _s(v)})
    return {"as_of": us_loans.AS_OF, "student": student, "homes": homes, "states": states, "salt": salt,
            "escrow_note": us_loans.ESCROW_NOTE}


def main() -> None:
    OUT_PATH.write_text(json.dumps(build(), indent=1, ensure_ascii=False) + "\n")
    print(f"wrote {OUT_PATH.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
