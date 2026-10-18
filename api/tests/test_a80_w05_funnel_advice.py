"""A15/A18 counts-only funnel and A8 /api/advice-check (W5)."""
import json
from datetime import date

import pytest
from fastapi.testclient import TestClient

from api import funnel
from api.main import app
from api.notify.store import sqlite_engine

SECRET = "s" * 24


@pytest.fixture()
def fz(tmp_path, monkeypatch):
    monkeypatch.setenv("FUNNEL_ENABLED", "true")
    monkeypatch.setenv("FUNNEL_ADMIN_SECRET", SECRET)
    s = funnel.FunnelStore(sqlite_engine(tmp_path / "f.sqlite3"))
    funnel.set_store(s)
    clock = {"d": date(2026, 10, 14)}
    monkeypatch.setattr(funnel, "today_fn", lambda: clock["d"])
    yield {"c": TestClient(app), "store": s, "clock": clock}
    funnel.set_store(None)


def post(c, body):
    # The browser sends text/plain (no CORS preflight, no cookies needed).
    return c.post("/api/funnel", content=json.dumps(body), headers={"Content-Type": "text/plain"})


def admin(c, days=30):
    return c.get(f"/api/funnel/admin?days={days}", headers={"Authorization": f"Bearer {SECRET}"})


def test_off_by_default(monkeypatch):
    monkeypatch.delenv("FUNNEL_ENABLED", raising=False)
    c = TestClient(app)
    assert post(c, {"event": "plan_saved"}).status_code == 404
    assert c.get("/api/funnel/admin").status_code == 404


def test_counts_add_up_and_no_rows_per_visitor(fz):
    c = fz["c"]
    for _ in range(3):
        assert post(c, {"event": "plan_saved", "country": "IN"}).status_code == 204
    post(c, {"event": "return_month2", "country": "IN"})
    post(c, {"event": "loan_check_result"})
    post(c, {"event": "loan_check_result"})
    post(c, {"event": "loan_check_finding_5k"})
    j = admin(c).json()
    assert j["product"] == {"loan_check_finding_5k": 1, "loan_check_result": 2, "plan_saved": 3, "return_month2": 1}
    assert j["loan_check_5k_share"] == 0.5
    import asyncio
    rows = asyncio.run(fz["store"].rows(date(2026, 1, 1)))
    # One counter row per (day, event, dims); nothing else is stored.
    assert sorted(rows[0].keys()) == ["country", "day", "event", "field", "loan_kind", "n", "step"]
    assert len(rows) == 4 and sum(r["n"] for r in rows) == 7


def test_setup_field_dropoff(fz):
    c = fz["c"]
    for _ in range(10):
        post(c, {"event": "field_focus", "step": 2, "field": "loan.months_left", "loan_kind": "home_loan"})
    for _ in range(4):
        post(c, {"event": "field_filled", "step": 2, "field": "loan.months_left", "loan_kind": "home_loan"})
    for _ in range(3):
        post(c, {"event": "field_dont_know", "step": 2, "field": "loan.months_left", "loan_kind": "home_loan"})
    post(c, {"event": "field_left_empty", "step": 2, "field": "loan.months_left", "loan_kind": "home_loan"})
    post(c, {"event": "field_abandon", "step": 2, "field": "loan.months_left", "loan_kind": "home_loan"})
    row = admin(c).json()["setup_fields"][0]
    assert row["field"] == "loan.months_left" and row["focus"] == 10
    assert row["dropoff"] == 0.2 and row["dont_know_share"] == 0.3


def test_fake_door_verdict_after_50_views(fz):
    c = fz["c"]
    for _ in range(60):
        post(c, {"event": "door_plus_shown"})
    post(c, {"event": "door_plus_notify"})
    for _ in range(10):
        post(c, {"event": "door_letter_shown"})
    d = admin(c).json()["doors"]
    assert d["plus"]["verdict"] == "kill" and d["plus"]["share"] == round(1 / 60, 4)
    assert d["letter"]["verdict"] is None          # too few views to decide


def test_days_window(fz):
    c = fz["c"]
    post(c, {"event": "plan_saved"})
    fz["clock"]["d"] = date(2026, 11, 20)
    post(c, {"event": "plan_saved"})
    assert admin(c, days=7).json()["product"]["plan_saved"] == 1
    assert admin(c, days=60).json()["product"]["plan_saved"] == 2


@pytest.mark.parametrize("body", [
    {"event": "plan_saved", "email": "a@b.c"},                 # nothing may ride along
    {"event": "plan_saved", "amount": 50000},
    {"event": "page_view"},                                    # unknown event
    {"event": "field_focus", "step": 2},                       # field events need a field
    {"event": "field_focus", "step": 2, "field": "HDFC Bank ₹50000"},   # free text can't be a field
    {"event": "field_focus", "step": 2, "field": "x" * 41},
    {"event": "plan_saved", "country": "FR"},
    {"event": "plan_saved", "loan_kind": "yacht"},
    {"event": "field_focus", "step": 99, "field": "a"},
    {"event": "plan_saved", "step": True},
    [1, 2],
])
def test_anything_but_a_known_counter_is_refused(fz, body):
    assert post(fz["c"], body).status_code == 422


def test_body_too_big_refused(fz):
    r = fz["c"].post("/api/funnel", content="{" + " " * 600 + "}", headers={"Content-Type": "text/plain"})
    assert r.status_code == 422


def test_admin_needs_the_secret(fz):
    assert fz["c"].get("/api/funnel/admin").status_code == 401
    assert fz["c"].get("/api/funnel/admin", headers={"Authorization": "Bearer wrong-wrong-wrong-wrong"}).status_code == 401


def test_no_cookie_is_set(fz):
    r = post(fz["c"], {"event": "plan_saved"})
    assert "set-cookie" not in {k.lower() for k in r.headers}


# ── /api/advice-check ───────────────────────────────────────────────────────

LOANS = [
    {"loan_type": "home_loan", "outstanding": 5000000, "rate": 0.085, "emi": 43391, "months_left": 240, "bank": "SBI"},
    {"loan_type": "credit_card", "outstanding": 85000, "rate": 0.42, "rate_type": "fixed", "bank": "HDFC"},
]


def test_advice_check_route():
    c = TestClient(app)
    r = c.post("/api/advice-check", json={
        "text": "Pay off the home loan first. Prepaying it attracts a foreclosure penalty. Your card is at 42%.",
        "loans": LOANS, "extra_target": 1, "country": "IN"})
    assert r.status_code == 200
    j = r.json()
    kinds = {(x["kind"], x["verdict"]) for x in j["claims"]}
    assert ("order", "disagree") in kinds and ("prepay_fee", "disagree") in kinds and ("rate", "agree") in kinds
    assert "no AI model" in j["method"]


@pytest.mark.parametrize("bad", [{"text": "", "loans": LOANS}, {"text": "x", "loans": []},
                                 {"text": "x" * 8001, "loans": LOANS},
                                 {"text": "x", "loans": [{**LOANS[0], "loan_type": "yacht"}]}])
def test_advice_check_validates(bad):
    assert TestClient(app).post("/api/advice-check", json=bad).status_code == 422
