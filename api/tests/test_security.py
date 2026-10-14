"""Size cap, security headers and rate limits (api/security.py)."""
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.security import Limit, SecurityMiddleware


class Clock:
    def __init__(self):
        self.t = 1000.0

    def __call__(self) -> float:
        return self.t


def _app(**kw) -> tuple[TestClient, Clock]:
    app = FastAPI()

    @app.post("/api/echo")
    async def echo(body: dict) -> dict:
        return {"n": len(body)}

    @app.post("/api/auth/request-otp")
    async def otp() -> dict:
        return {}

    @app.get("/api/read")
    async def read() -> dict:
        return {}

    clock = Clock()
    kw.setdefault("rate_limits", True)
    kw.setdefault("limits", [("/api/auth/request-otp", Limit(per_minute=2, burst=2)),
                             ("/api/", Limit(per_minute=60, burst=3))])
    app.add_middleware(SecurityMiddleware, clock=clock, **kw)
    return TestClient(app), clock


# ── headers and size ────────────────────────────────────────────────────────

def test_account_reads_cannot_be_cached():
    app = FastAPI()
    app.add_middleware(SecurityMiddleware, rate_limits=False)
    with TestClient(app) as client:
        for path in ('/api/auth/me', '/api/user/state'):
            assert client.get(path).headers['cache-control'] == 'no-store'


def test_headers_on_the_real_app(client):
    r = client.get("/api/health")
    assert r.headers["x-content-type-options"] == "nosniff"
    assert r.headers["referrer-policy"] == "no-referrer"
    assert "cache-control" not in r.headers
    assert "strict-transport-security" not in r.headers
    r = client.post("/api/new-debt", json={"list_price": "50000", "cash_price_elsewhere": "45000",
                                           "emi_offer_months": 12, "emi_offer_monthly_payment": "4500"})
    assert r.status_code == 200 and r.headers["cache-control"] == "no-store"


def test_hsts_only_behind_https():
    c, _ = _app(proxy_hops=1)
    assert "strict-transport-security" not in c.get("/api/read").headers
    r = c.get("/api/read", headers={"x-forwarded-proto": "https"})
    assert r.headers["strict-transport-security"] == "max-age=63072000; includeSubDomains; preload"  # UX50 E-08 + audit80 D23: same as the pages
    c, _ = _app(proxy_hops=0)      # not behind a proxy we trust: the header is ignored
    assert "strict-transport-security" not in c.get("/api/read", headers={"x-forwarded-proto": "https"}).headers


def test_large_body_is_refused(client):
    big = {"user": {"loans": [{"bank": "x" * 1000}] * 300}}
    r = client.post("/api/simulate", json=big)
    assert r.status_code == 413
    assert r.json() == {"detail": {"field": "", "message": "The request is too large."}}
    assert r.headers["x-content-type-options"] == "nosniff"


def test_large_body_without_a_length_is_refused():
    c, _ = _app(max_body=1000)

    def chunks():
        for _ in range(20):
            yield b'{"a": "' + b"x" * 100 + b'"}'
    r = c.post("/api/echo", content=chunks(), headers={"content-type": "application/json"})
    assert r.status_code == 413
    r = c.post("/api/echo", json={"a": 1})
    assert r.status_code == 200 and r.json() == {"n": 1}


# ── rate limits ─────────────────────────────────────────────────────────────

def test_writes_are_limited_per_client_and_refill():
    c, clock = _app()
    for _ in range(3):
        assert c.post("/api/echo", json={}).status_code == 200
    r = c.post("/api/echo", json={})
    assert r.status_code == 429
    assert r.headers["retry-after"] == "1"
    assert "Wait a minute" in r.json()["detail"]["message"]
    assert c.get("/api/read").status_code == 200          # reads are not limited
    clock.t += 1
    assert c.post("/api/echo", json={}).status_code == 200


def test_sign_in_has_its_own_tighter_limit():
    c, clock = _app()
    assert [c.post("/api/auth/request-otp").status_code for _ in range(3)] == [200, 200, 429]
    assert c.post("/api/auth/request-otp").headers["retry-after"] == "30"
    assert c.post("/api/echo", json={}).status_code == 200


def test_forwarded_for_cannot_be_spoofed():
    c, _ = _app(proxy_hops=1)
    # Our proxy appends the real address; whatever the client put first is ignored.
    for fake in ("1.1.1.1", "2.2.2.2", "3.3.3.3", "4.4.4.4"):
        r = c.post("/api/echo", json={}, headers={"x-forwarded-for": f"{fake}, 9.9.9.9"})
    assert r.status_code == 429
    r = c.post("/api/echo", json={}, headers={"x-forwarded-for": "8.8.8.8"})
    assert r.status_code == 200


def test_forwarded_for_ignored_when_not_behind_a_proxy():
    c, _ = _app(proxy_hops=0)
    codes = [c.post("/api/echo", json={}, headers={"x-forwarded-for": f"10.0.0.{i}"}).status_code
             for i in range(4)]
    assert codes == [200, 200, 200, 429]


def test_internal_calls_are_not_limited():
    c, _ = _app(internal_token="s3cret")
    codes = [c.post("/api/echo", json={}, headers={"x-internal-token": "s3cret"}).status_code
             for _ in range(10)]
    assert set(codes) == {200}
    wrong = [c.post("/api/echo", json={}, headers={"x-internal-token": "guess"}).status_code
             for _ in range(4)]
    assert wrong[-1] == 429


def test_limits_off():
    c, _ = _app(rate_limits=False)
    assert {c.post("/api/echo", json={}).status_code for _ in range(10)} == {200}


# ── oversized bodies: read to the end before the 413 (live re-test 12 O-1) ──

import asyncio  # noqa: E402

import api.security as security  # noqa: E402


def _drive(mw_kw: dict, messages: list, content_length: int | None = None):
    """Run SecurityMiddleware on one POST with these receive() messages.
    Returns (messages read, what was sent, how many reads came before the reply)."""
    async def app(scope, receive, send):  # never reached for a 413
        raise AssertionError("the app must not see an oversized body")

    mw = SecurityMiddleware(app, rate_limits=False, **mw_kw)
    headers = [(b"content-type", b"application/json")]
    if content_length is not None:
        headers.append((b"content-length", str(content_length).encode()))
    scope = {"type": "http", "method": "POST", "path": "/api/echo", "headers": headers,
             "scheme": "http", "client": ("1.2.3.4", 1)}
    queue, read, sent, reads_at_reply = list(messages), [], [], []

    async def receive():
        if not queue:
            await asyncio.sleep(3600)  # a client that sends nothing more
        m = queue.pop(0)
        read.append(m)
        return m

    async def send(m):
        if m["type"] == "http.response.start":
            reads_at_reply.append(len(read))
        sent.append(m)

    asyncio.run(mw(scope, receive, send))
    return read, sent, reads_at_reply


def _body(n_chunks: int, size: int):
    return [{"type": "http.request", "body": b"x" * size, "more_body": i < n_chunks - 1} for i in range(n_chunks)]


def test_oversized_declared_body_is_read_to_the_end_before_the_413():
    msgs = _body(10, 500)                      # 5,000 bytes against a 1,000 cap
    read, sent, at = _drive({"max_body": 1000}, msgs, content_length=5000)
    assert len(read) == 10, "the whole upload was taken before answering"
    assert at == [10]
    start = sent[0]
    assert start["status"] == 413
    hdrs = dict(start["headers"])
    assert hdrs[b"connection"] == b"close"
    assert hdrs[b"x-content-type-options"] == b"nosniff"
    assert b"too large" in sent[1]["body"]


def test_oversized_body_without_a_length_is_drained_too():
    read, sent, at = _drive({"max_body": 1000}, _body(10, 500))
    assert len(read) == 10 and at == [10]
    assert sent[0]["status"] == 413 and dict(sent[0]["headers"])[b"connection"] == b"close"
    # Over the cap on the very last chunk: nothing more is read (it would hang).
    read, sent, _ = _drive({"max_body": 1000}, _body(1, 1500))
    assert len(read) == 1 and sent[0]["status"] == 413


def test_draining_stops_at_its_byte_cap_and_when_the_client_leaves(monkeypatch):
    monkeypatch.setattr(security, "DRAIN_MAX_BYTES", 3000)
    read, sent, _ = _drive({"max_body": 1000}, _body(100, 500), content_length=50000)
    assert len(read) <= 8, "a huge upload isn't read forever"
    assert sent[0]["status"] == 413
    # The client hung up mid-upload: nobody to answer, nothing sent.
    gone = _body(3, 500)[:2] + [{"type": "http.disconnect"}]
    read, sent, _ = _drive({"max_body": 1000}, gone, content_length=5000)
    assert sent == []


def test_draining_gives_up_after_its_time_cap(monkeypatch):
    monkeypatch.setattr(security, "DRAIN_MAX_SECONDS", 0.05)
    # Two chunks, then the client stalls: answered anyway once the time is up.
    read, sent, _ = _drive({"max_body": 1000}, _body(10, 500)[:2], content_length=5000)
    assert sent[0]["status"] == 413


def test_oversized_body_over_a_real_socket_gets_a_clean_413():
    """uvicorn on a real socket: a 2 MB upload against the 256 KB cap is
    answered 413 after the server took all of it, and the connection is
    closed cleanly (no reset while the client is still sending)."""
    import socket
    import threading

    import uvicorn

    app = FastAPI()

    @app.post("/api/echo")
    async def echo(body: dict) -> dict:
        return {"n": len(body)}

    app.add_middleware(SecurityMiddleware, rate_limits=False)
    sock = socket.socket()
    sock.bind(("127.0.0.1", 0))
    port = sock.getsockname()[1]
    server = uvicorn.Server(uvicorn.Config(app, log_level="warning", lifespan="off"))
    t = threading.Thread(target=server.run, kwargs={"sockets": [sock]}, daemon=True)
    t.start()
    try:
        import time as _t
        for _ in range(100):
            if server.started:
                break
            _t.sleep(0.05)
        body = b'{"a":"' + b"x" * (2 * 1024 * 1024) + b'"}'
        c = socket.create_connection(("127.0.0.1", port), timeout=10)
        c.sendall(b"POST /api/echo HTTP/1.1\r\nHost: x\r\nContent-Type: application/json\r\n"
                  + f"Content-Length: {len(body)}\r\n\r\n".encode())
        c.sendall(body)  # would raise ConnectionResetError if the server hung up early
        data = b""
        while True:
            part = c.recv(65536)
            if not part:
                break
            data += part
        c.close()
        head = data.split(b"\r\n\r\n", 1)[0].lower()
        assert head.startswith(b"http/1.1 413")
        assert b"connection: close" in head
        assert b"The request is too large." in data
    finally:
        server.should_exit = True
        t.join(timeout=5)
