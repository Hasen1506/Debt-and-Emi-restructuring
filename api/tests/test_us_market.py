"""US-market fields through the API (sprint G3; grill #33, #34)."""
from decimal import Decimal

D = Decimal


def _user(loans, **kw):
    u = {
        "country": "US", "income_type": "salaried",
        "annual_income": "96000", "monthly_income": "8000",
        "fixed_expenses": "3000", "savings_balance": "0",
        "primary_bank": "JPMorgan Chase", "filing_status": "single",
        "loans": loans,
    }
    u.update(kw)
    return u


HOME = {
    "loan_type": "home_loan", "bank": "Wells Fargo", "outstanding": "285000",
    "nominal_rate": "0.065", "rate_type": "fixed", "tenure_months_remaining": 348,
    "scheduled_emi": "1896", "pmi_monthly": "150", "original_home_value": "300000",
}
EDU = {
    "loan_type": "education_loan", "bank": "MOHELA", "outstanding": "40000",
    "nominal_rate": "0.068", "rate_type": "fixed", "tenure_months_remaining": 120,
    "scheduled_emi": "460", "student_loan_kind": "federal", "forgiveness_track": "pslf",
}
AUTO = {
    "loan_type": "auto_loan", "bank": "Ally", "outstanding": "15000",
    "nominal_rate": "0.05", "rate_type": "fixed", "tenure_months_remaining": 48,
    "scheduled_emi": "345",
}


def test_simulate_reports_when_pmi_ends(client):
    r = client.post("/api/simulate", json={
        "user": _user([HOME]), "strategy": "avalanche", "horizon_months": 360, "marginal_rate": "0.22",
    })
    assert r.status_code == 200, r.text
    ev = r.json()["pmi_events"]
    assert len(ev) == 1 and ev[0]["loan_index"] == 0 and ev[0]["kind"] == "pmi"
    assert 0 < ev[0]["last_paid_month"] < 120
    assert "80%" in ev[0]["note"]


def test_pslf_loan_gets_only_its_required_payment(client):
    r = client.post("/api/simulate", json={
        "user": _user([EDU, AUTO]), "strategy": "avalanche", "horizon_months": 60, "marginal_rate": "0.22",
    })
    assert r.status_code == 200, r.text
    traj = r.json()["trajectory"]
    # Every month the PSLF loan (index 0) gets its $460 and no more, while
    # the 5% car loan (index 1) takes the extra.
    for p in traj[:24]:
        pay = p["payments_by_loan_index"]
        if "0" in pay:
            assert D(str(pay["0"])) <= D("460.01")
    assert any(D(str(p["payments_by_loan_index"].get("1", 0))) > D("345") for p in traj[:6])
    assert r.json()["pmi_events"] == []


def test_us_enums_are_validated(client):
    bad = dict(EDU, forgiveness_track="forgive-me")
    r = client.post("/api/simulate", json={"user": _user([bad]), "horizon_months": 12, "marginal_rate": "0.22"})
    assert r.status_code == 422
    # "none" and blank both mean no track.
    for v in ("none", "", None):
        ok = dict(EDU, forgiveness_track=v)
        r = client.post("/api/simulate", json={"user": _user([ok]), "horizon_months": 12, "marginal_rate": "0.22"})
        assert r.status_code == 200, r.text


def test_loan_in_carries_us_fields_to_the_engine():
    from api.schemas import LoanIn
    l = LoanIn(**dict(HOME, mortgage_insurance_kind="FHA-MIP", pmi_months_remaining=24)).to_engine()
    assert l.pmi_monthly == D("150") and l.original_home_value == D("300000")
    assert l.mortgage_insurance_kind == "fha_mip" and l.pmi_months_remaining == 24
    e = LoanIn(**EDU).to_engine()
    assert e.student_loan_kind == "federal" and e.forgiveness_track == "pslf"
