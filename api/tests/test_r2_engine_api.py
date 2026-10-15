"""Round 2 engine items through the API (work/reports/r2-engine.md)."""
from decimal import Decimal

import pytest

from api import schemas
from api.schemas import UserIn, age_in_months

D = Decimal


# ── item 3: prepay / keep / split trigger ──────────────────────────────────

@pytest.mark.parametrize("path", ["/api/insights/plan", "/api/insights/prepay-invest"])
def test_api_labels_the_default_assumption(client, path):
    body = {"user": {"country": "IN", "income_type": "salaried", "annual_income": "1680000",
                     "monthly_income": "140000", "fixed_expenses": "45000", "savings_balance": "0",
                     "primary_bank": "SBI", "tax_regime": "new",
                     "loans": [{"loan_type": "home_loan", "bank": "SBI", "outstanding": "3500000",
                                "nominal_rate": "0.086", "rate_type": "floating",
                                "tenure_months_remaining": 240, "scheduled_emi": "30596"}]},
            "horizon_months": 360, "simulation_start_month": 10, "simulation_start_year": 2026}
    j = client.post(path, json=body).json()
    if path.endswith("plan"):
        assert j["low_rate_phase_month"] is None and D(j["low_rate_threshold"]) == D("0.075")
        assert j["low_rate_assumption_is_default"] is True and j["low_rate_eligible"] == {"0": False}
    else:
        assert j["available"] is False and j["assumption_is_default"] is True
        assert "assumed 6.5%" in j["statement"] and "emergency fund" in j["statement"]
    body["user"]["assumed_post_tax_return"] = "0.085"
    j = client.post(path, json=body).json()
    if path.endswith("plan"):
        assert j["low_rate_phase_month"] == 1 and j["low_rate_assumption_is_default"] is False
    else:
        assert j["available"] is True and j["assumption_is_default"] is False


# ── item 1: date of birth → age ceiling on a tenure-first rate rise ─────────

def test_age_in_months_by_calendar_month():
    assert age_in_months("1999-06-15", "2026-10") == 328          # 27 y 4 m
    assert age_in_months("1999-06", "2026-10") == 328
    assert age_in_months(None) is None and age_in_months("2030-01", "2026-10") is None


def _home_user(**extra):
    u = {"country": "IN", "income_type": "salaried", "annual_income": "2400000", "monthly_income": "200000",
         "fixed_expenses": "50000", "savings_balance": "0", "primary_bank": "SBI",
         "loans": [{"loan_type": "home_loan", "bank": "SBI", "outstanding": "5000000", "nominal_rate": "0.085",
                    "rate_type": "floating", "tenure_months_remaining": 240, "scheduled_emi": "43391.16"}]}
    u.update(extra)
    return u


def test_dob_and_retirement_age_reach_the_engine(monkeypatch):
    monkeypatch.setattr(schemas, "current_month", lambda: "2026-10")
    e = UserIn(**_home_user(date_of_birth="1986-10-01", retirement_age=62)).to_engine()
    assert e.age_months == 480 and e.retirement_age == 62
    assert UserIn(**_home_user()).to_engine().age_months is None


@pytest.mark.parametrize("bad", [{"date_of_birth": "15-06-1999"}, {"retirement_age": 30}, {"retirement_age": 99},
                                 {"assumed_post_tax_return": "0.5"}, {"remittance_cost": "0.3"}])
def test_bad_new_fields_are_422(client, bad):
    body = {"user": _home_user(**bad), "horizon_months": 60}
    assert client.post("/api/simulate", json=body).status_code == 422


def test_simulate_with_dob_raises_emi_when_the_age_limit_binds(client, monkeypatch):
    """Aged 40 at plan start, salaried (limit 60): at the month-13 rise the
    loan has 228 months left, exactly the age limit, so the EMI rises to the
    re-amortised ₹46,497.78 instead of holding at ₹43,391.16."""
    monkeypatch.setattr(schemas, "current_month", lambda: "2026-10")
    ev = [{"kind": "floating_rate_reset", "effective_month": 13, "loan_index": 0, "new_rate": "0.095"}]
    for dob, want in ((None, D("43391.16")), ("1986-10", D("46497.78"))):
        user = _home_user(**({"date_of_birth": dob} if dob else {}))
        r = client.post("/api/simulate", json={"user": user, "horizon_months": 30, "lifecycle_events": ev,
                                                "minimums_only": True})
        assert r.status_code == 200, r.text
        ev0 = r.json()["rate_rise_events"][0]
        applied = next(o for o in ev0["options"] if o["mode"] == ev0["applied"])
        assert abs(D(applied["emi"]) - want) < D("1")
