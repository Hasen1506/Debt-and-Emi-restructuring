"""Roadmap PR G: POST /api/kfs/read reads a KFS and saves nothing."""
import base64
from pathlib import Path

from fastapi.testclient import TestClient

from api.security import MAX_BODY_BYTES, SecurityMiddleware

F = Path(__file__).resolve().parents[2] / "engine" / "tests" / "fixtures" / "kfs"


def test_pasted_text_comes_back_field_by_field(client):
    text = (F / "personal_fixed.synthetic.txt").read_text(encoding="utf-8")
    r = client.post("/api/kfs/read", json={"text": text, "as_of": "2026-10-08"})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["is_kfs"] is True
    assert body["fields"]["interest_rate"]["value"] == "0.135"
    assert "13.50% Fixed" in body["fields"]["interest_rate"]["source"]
    assert body["loan"]["prepayment_penalty_pct"] == "0.04"
    assert {c["kind"] for c in body["checks"]} == {"emi", "apr"} and all(c["ok"] for c in body["checks"])
    assert "Id=12663" in body["circular_url"]
    # Read-only: the reply is a proposal, and no cookie or session is set.
    assert "set-cookie" not in {k.lower() for k in r.headers}
    assert r.headers.get("cache-control") == "no-store"


def test_an_uploaded_pdf(client):
    data = base64.b64encode((F / "personal_fixed.synthetic.pdf").read_bytes()).decode()
    r = client.post("/api/kfs/read", json={"pdf_base64": data, "as_of": "2026-10-08"})
    assert r.status_code == 200, r.text
    assert r.json()["fields"]["emi"]["value"] == "11505"


def test_problems_are_one_plain_message(client):
    scan = base64.b64encode((F / "scanned.synthetic.pdf").read_bytes()).decode()
    r = client.post("/api/kfs/read", json={"pdf_base64": scan})
    assert r.status_code == 422 and "scan" in r.json()["detail"]["message"]
    r = client.post("/api/kfs/read", json={"pdf_base64": "not base64!!"})
    assert r.status_code == 422 and r.json()["detail"]["field"] == "pdf_base64"
    r = client.post("/api/kfs/read", json={})
    assert r.status_code == 422 and "paste its text" in r.json()["detail"]["message"]
    r = client.post("/api/kfs/read", json={"text": "x\ny\nz\nnothing here"})
    assert r.status_code == 422


def _echo_app():
    async def app(scope, receive, send):
        await receive()
        await send({"type": "http.response.start", "status": 200, "headers": []})
        await send({"type": "http.response.body", "body": b"ok"})
    return app


def test_only_the_kfs_upload_may_be_larger_than_256_kb():
    c = TestClient(SecurityMiddleware(_echo_app(), rate_limits=False, proxy_hops=0, internal_token=""))
    big = b"x" * (MAX_BODY_BYTES + 1000)
    assert c.post("/api/kfs/read", content=big).status_code == 200
    assert c.post("/api/simulate", content=big).status_code == 413
    assert c.post("/api/kfs/read", content=b"x" * (7 * 1024 * 1024)).status_code == 413
