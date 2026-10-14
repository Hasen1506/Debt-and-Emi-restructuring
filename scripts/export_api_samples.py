"""Real API response samples for the web's boundary parsers (Audit 80 E19).

Writes api/tests/fixtures/api_response_samples.json: what /api/simulate,
/api/baseline and /api/sensitivity/compare actually return for two fixed
users (India with a card, so gap/surplus fields appear; US), trajectories cut
to their first 3 rows to keep the file small. web/tests/boundary.cjs checks
that web/src/lib/boundary.ts accepts every sample, so a response shape the
parsers do not know fails `npm test` instead of a user's screen.
api/tests/test_property_schema_roundtrip.py::test_api_samples_are_current
fails when this file is stale. Re-run after changing a response model:

    python scripts/export_api_samples.py
"""
from __future__ import annotations

import json
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
os.environ.setdefault("RATES_FEED", "off")
os.environ.setdefault("RATE_LIMITS", "off")

OUT_PATH = ROOT / "api" / "tests" / "fixtures" / "api_response_samples.json"

USERS = {
    "IN": {
        "country": "IN", "income_type": "salaried", "annual_income": "960000", "monthly_income": "80000",
        "fixed_expenses": "30000", "savings_balance": "0", "primary_bank": "HDFC Bank",
        "loans": [
            {"loan_type": "personal_loan", "bank": "HDFC Bank", "outstanding": "300000", "nominal_rate": "0.14",
             "rate_type": "fixed", "tenure_months_remaining": 36, "scheduled_emi": "10253"},
            {"loan_type": "credit_card", "bank": "HDFC Bank", "outstanding": "60000", "nominal_rate": "0.42",
             "rate_type": "fixed", "tenure_months_remaining": 12, "scheduled_emi": "0"},
        ],
    },
    "US": {
        "country": "US", "income_type": "salaried", "annual_income": "84000", "monthly_income": "7000",
        "fixed_expenses": "3500", "savings_balance": "0", "primary_bank": "HDFC Bank",
        "loans": [
            {"loan_type": "auto_loan", "bank": "HDFC Bank", "outstanding": "18000", "nominal_rate": "0.07",
             "rate_type": "fixed", "tenure_months_remaining": 48, "scheduled_emi": "431"},
        ],
    },
}
ENDPOINTS = ["/api/simulate", "/api/baseline", "/api/sensitivity/compare"]


def _body(path: str, user: dict) -> dict:
    body = {"user": user, "horizon_months": 120}
    if path.endswith("compare"):
        body.update(lump_sum_amount="1000", lump_sum_target_loan_index=0, include_trajectory=True)
    return body


def _trim(resp: dict) -> dict:
    for key in ("trajectory", "scenario_trajectory"):
        if isinstance(resp.get(key), list):
            resp[key] = resp[key][:3]
    return resp


def build() -> dict:
    from fastapi.testclient import TestClient

    from api.main import app
    from engine.tests.fixtures.pin_rates import pin_frozen_rate_cards

    restore = pin_frozen_rate_cards()
    try:
        client = TestClient(app)
        out: dict = {}
        for country, user in USERS.items():
            for path in ENDPOINTS:
                res = client.post(path, json=_body(path, user))
                res.raise_for_status()
                out[f"{country} {path}"] = _trim(res.json())
        return out
    finally:
        restore()


def render(data: dict) -> str:
    return json.dumps(data, indent=1, sort_keys=True) + "\n"


if __name__ == "__main__":
    OUT_PATH.write_text(render(build()), encoding="utf-8")
    print(f"wrote {OUT_PATH.relative_to(ROOT)}")
