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
         "fixed_expenses": extra.pop("fixed_expenses", "50000"), "savings_balance": "0", "primary_bank": "SBI",
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
    # Spending leaves ~₹600 a month after the EMI, so nothing is prepaid
    # before the rise (the API has no minimums-only switch).
    """Aged 40 at plan start, salaried (limit 60): at the month-13 rise the
    loan has 228 months left, exactly the age limit, so the EMI rises to the
    re-amortised ₹46,497.78 instead of holding at ₹43,391.16."""
    monkeypatch.setattr(schemas, "current_month", lambda: "2026-10")
    ev = [{"kind": "floating_rate_reset", "effective_month": 13, "loan_index": 0, "new_rate": "0.095"}]
    # ~₹600 a month of prepayment moves the re-amortised EMI a little below
    # the zero-prepayment golden ₹46,497.78 (engine test pins it exactly).
    for dob, want in ((None, D("43391.16")), ("1986-10", D("46425.69"))):
        user = _home_user(fixed_expenses="156000", **({"date_of_birth": dob} if dob else {}))
        r = client.post("/api/simulate", json={"user": user, "horizon_months": 30, "lifecycle_events": ev})
        assert r.status_code == 200, r.text
        ev0 = r.json()["rate_rise_events"][0]
        applied = next(o for o in ev0["options"] if o["mode"] == ev0["applied"])
        assert abs(D(applied["emi"]) - want) < D("1")
        assert applied["months_left"] == 228 if dob else applied["months_left"] > 228


# ── item 5: advance tax for salaried users with non-TDS income ─────────────

def _adv(**kw):
    body = {"annual_gross_salary": "1800000", "tax_regime": "new", "today": "2026-10-15",
            "streams": [{"kind": "interest", "gross_annual": "200000", "tds_pct": "0.10"},
                        {"kind": "rent", "gross_annual": "360000"}]}
    body.update(kw)
    return body


def test_advance_tax_route_golden(client):
    """Same golden as engine/tests/test_r2_advance_tax_salaried.py."""
    r = client.post("/api/tax/advance-tax/salaried", json=_adv())
    assert r.status_code == 200, r.text
    j = r.json()
    assert j["applies"] and D(j["liability"]) == D("83220") and j["fiscal_year_label"] == "FY 2026-27"
    assert [(i["due"], D(i["amount"])) for i in j["instalments"]] == [
        ("2026-06-15", D("12483")), ("2026-09-15", D("24966")), ("2026-12-15", D("24966")), ("2027-03-15", D("20805"))]
    assert D(j["interest_234c_if_unpaid"]) == D("4198") and D(j["interest_234b_if_unpaid"]) == D("3328")
    assert all(u.startswith("https://www.incometaxindia.gov.in") for u in j["sources"].values())


def test_advance_tax_route_not_due_and_422(client):
    j = client.post("/api/tax/advance-tax/salaried",
                    json=_adv(streams=[{"kind": "interest", "gross_annual": "20000"}])).json()
    assert j["applies"] is False and j["instalments"] == []
    for bad in ({"streams": [{"kind": "lottery", "gross_annual": "1"}]},
                {"streams": [{"kind": "interest", "gross_annual": "1", "tds_pct": "2"}]},
                {"age": 5}, {"today": "15-10-2026"}):
        assert client.post("/api/tax/advance-tax/salaried", json=_adv(**bad)).status_code == 422


# ── item 4: seasonal income on /simulate, reserve opt-in ───────────────────

FESTIVE_PATTERN = ["60000", "60000", "90000", "60000", "50000", "40000",
                   "40000", "50000", "80000", "200000", "240000", "130000"]


def _seasonal_body(**seasonal):
    user = {"country": "IN", "income_type": "business_owner", "annual_income": "1100000",
            "monthly_income": "91666.67", "fixed_expenses": "55000", "savings_balance": "0",
            "primary_bank": "x",
            "loans": [{"loan_type": "personal_loan", "bank": "Bajaj Finance", "outstanding": "500000",
                       "nominal_rate": "0.16", "rate_type": "fixed", "tenure_months_remaining": 36,
                       "scheduled_emi": "17580"},
                      {"loan_type": "credit_card", "bank": "Axis Bank", "outstanding": "80000",
                       "nominal_rate": "0.42", "rate_type": "fixed", "tenure_months_remaining": 0,
                       "scheduled_emi": "0"}]}
    if seasonal:
        user["seasonal_income"] = seasonal
    return {"user": user, "strategy": "avalanche", "horizon_months": 120, "simulation_start_month": 4,
            "marginal_rate": "0.2"}


def test_no_pattern_no_seasonal_block(client):
    j = client.post("/api/simulate", json=_seasonal_body()).json()
    assert j["seasonal"] is None


def test_pattern_runs_month_by_month_and_reports_both_versions(client):
    off = client.post("/api/simulate", json=_seasonal_body(pattern=FESTIVE_PATTERN)).json()
    on = client.post("/api/simulate", json=_seasonal_body(pattern=FESTIVE_PATTERN, reserve=True)).json()
    flat = client.post("/api/simulate", json=_seasonal_body()).json()
    so, sn = off["seasonal"], on["seasonal"]
    assert so["applied"] and sn["applied"] and so["reserve_on"] is False and sn["reserve_on"] is True
    # Reserve is opt-in: off by default, and the headline follows the choice.
    assert D(off["total_interest_paid"]).quantize(D("0.01")) == D(so["without_reserve"]["total_interest_paid"])
    assert D(on["total_interest_paid"]).quantize(D("0.01")) == D(sn["with_reserve"]["total_interest_paid"])
    # Both requests describe the same two runs.
    assert so["with_reserve"] == sn["with_reserve"] and so["without_reserve"] == sn["without_reserve"]
    assert D(sn["reserve_interest_difference"]) == (
        D(sn["with_reserve"]["total_interest_paid"]) - D(sn["without_reserve"]["total_interest_paid"]))
    # Lean months = below the year's average (₹91,667): all but Oct, Nov, Dec.
    assert sn["lean_months"] == [1, 2, 3, 4, 5, 6, 7, 8, 9]
    assert D(sn["peak_reserve"]) >= 0
    # The month-by-month run differs from the flat average.
    assert off["trajectory"] != flat["trajectory"]
    # The reserve never makes card borrowing interest higher (engine class guard).
    assert D(sn["with_reserve"]["total_gap_interest"]) <= D(sn["without_reserve"]["total_gap_interest"])


def test_planned_salary_change_skips_the_pattern_and_says_so(client):
    body = _seasonal_body(pattern=FESTIVE_PATTERN, reserve=True)
    body["lifecycle_events"] = [{"kind": "salary_reset", "effective_month": 6, "new_monthly_take_home": "100000"}]
    j = client.post("/api/simulate", json=body).json()
    assert j["seasonal"] == {**j["seasonal"], "applied": False, "skipped_reason": "salary_change_planned"}


@pytest.mark.parametrize("pattern", [["1000"] * 11, ["1000"] * 13, ["0"] * 12, ["-5"] + ["1000"] * 11])
def test_bad_patterns_are_422(client, pattern):
    r = client.post("/api/simulate", json=_seasonal_body(pattern=pattern))
    assert r.status_code == 422
