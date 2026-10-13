"""The US-rules differential fixture is current (scripts/export_us_loan_cases.py);
web/tests/us-market.cjs checks the TypeScript twin against it."""
import json

from scripts.export_us_loan_cases import OUT_PATH, build


def test_us_loan_cases_fixture_is_current():
    want = json.loads(json.dumps(build(), ensure_ascii=False))
    got = json.loads(OUT_PATH.read_text())
    assert got == want, "run: python scripts/export_us_loan_cases.py"
