"""Grill #17/#56/#60: POST /api/credit-report/read reads a report and saves nothing;
POST /api/kfs/read takes a password; both run off the event loop."""
import asyncio
import base64
import json
from pathlib import Path

from api.routes import credit_report as cr_route
from api.routes import kfs as kfs_route

ROOT = Path(__file__).resolve().parents[2] / "engine" / "tests" / "fixtures"
C, K = ROOT / "credit_report", ROOT / "kfs"
PASSWORDS = json.loads((C / "passwords.json").read_text(encoding="utf-8"))


def _b64(p: Path) -> str:
    return base64.b64encode(p.read_bytes()).decode()


def test_pasted_report_comes_back_account_by_account(client):
    r = client.post("/api/credit-report/read", json={"text": (C / "experian.synthetic.txt").read_text(), "as_of": "2026-10-12"})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["bureau"] == "experian" and body["open_loans"] == 2
    pl = body["accounts"][0]
    assert pl["loan"]["nominal_rate"] == "0.1325" and pl["loan"]["emi"] == "13350"
    assert "set-cookie" not in {k.lower() for k in r.headers}


def test_locked_pdf_asks_for_the_password_then_opens(client):
    r = client.post("/api/credit-report/read", json={"pdf_base64": _b64(C / "cibil_locked.synthetic.pdf")})
    assert r.status_code == 422 and r.json()["detail"]["field"] == "password"
    r = client.post("/api/credit-report/read", json={"pdf_base64": _b64(C / "cibil_locked.synthetic.pdf"), "password": "x"})
    assert r.status_code == 422 and "didn't open" in r.json()["detail"]["message"]
    r = client.post("/api/credit-report/read", json={"pdf_base64": _b64(C / "cibil_locked.synthetic.pdf"),
                                                     "password": PASSWORDS["cibil_locked"], "as_of": "2026-10-12"})
    assert r.status_code == 200, r.text
    assert PASSWORDS["cibil_locked"] not in r.text  # never echoed
    assert r.json()["bureau"] == "cibil"


def test_kfs_password_field(client):
    data = _b64(K / "personal_fixed_locked.synthetic.pdf")
    r = client.post("/api/kfs/read", json={"pdf_base64": data})
    assert r.status_code == 422 and r.json()["detail"]["field"] == "password"
    r = client.post("/api/kfs/read", json={"pdf_base64": data, "password": PASSWORDS["kfs_personal_fixed_locked"]})
    assert r.status_code == 200, r.text
    assert r.json()["fields"]["emi"]["value"] == "11505"


def test_problems_are_one_plain_message(client):
    r = client.post("/api/credit-report/read", json={"pdf_base64": "not base64!!"})
    assert r.status_code == 422 and r.json()["detail"]["field"] == "pdf_base64"
    r = client.post("/api/credit-report/read", json={})
    assert r.status_code == 422 and r.json()["detail"]["field"] == "text"
    r = client.post("/api/credit-report/read", json={"text": "nothing to see here at all, just a long enough line of words"})
    assert r.status_code == 422 and "No accounts" in r.json()["detail"]["message"]


def test_pdf_routes_run_in_the_threadpool_not_the_event_loop():
    # A plain def is run by FastAPI in its threadpool; an async def would block the one worker (#60).
    assert not asyncio.iscoroutinefunction(kfs_route.read)
    assert not asyncio.iscoroutinefunction(cr_route.read)
