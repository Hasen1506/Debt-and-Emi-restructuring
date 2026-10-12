"""Integration: a short month that never closes, borrowed at card rate over
the longest horizon, compounds past 28 significant digits. Rounding to
paise used to raise decimal.InvalidOperation and /api/simulate and
/api/baseline answered 500 (seen in the E2E run after L2 + G3)."""
from decimal import Decimal

from fastapi.testclient import TestClient

from api.main import app
from api.schemas import MAX_MONTHS

client = TestClient(app)

USER = {
    "country": "IN", "income_type": "salaried", "annual_income": "240000",
    "monthly_income": "20000", "fixed_expenses": "40000", "savings_balance": "0",
    "primary_bank": "HDFC Bank",
    "loans": [
        {"bank": "", "loan_type": "credit_card", "rate_type": "fixed", "outstanding": "150000",
         "nominal_rate": "0.42", "scheduled_emi": "0", "tenure_months_remaining": 0},
        {"bank": "", "loan_type": "personal_loan", "rate_type": "fixed", "outstanding": "400000",
         "nominal_rate": "0.14", "scheduled_emi": "10931", "tenure_months_remaining": 48},
    ],
}


def test_never_closing_gap_over_the_longest_horizon_still_answers():
    for path in ("/api/simulate", "/api/baseline"):
        r = client.post(path, json={"user": USER, "horizon_months": MAX_MONTHS})
        assert r.status_code == 200, (path, r.text[:300])
        body = r.json()
        assert Decimal(body["total_gap_interest"]) > 0
        assert Decimal(body["trajectory"][-1]["balance"]).as_tuple().exponent == -2
