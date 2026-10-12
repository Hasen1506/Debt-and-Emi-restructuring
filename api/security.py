"""Request-size cap, security headers and rate limits for the public API.

One ASGI middleware, so it also covers requests FastAPI never routes.

- **Size cap:** bodies over MAX_BODY_BYTES (256 KB; a profile with 50
  loans is about 50 KB) get a 413, whether or not they declare a length.
  The one exception is reading a Key Facts Statement PDF (/api/kfs/read,
  up to 4 MB of PDF sent as base64), capped at KFS_BODY_BYTES.
- **Headers:** nosniff and no-referrer on everything; `no-store` on
  writes, whose replies carry the user's figures; HSTS behind HTTPS.
  Content-Security-Policy and frame-ancestors stay off until launch
  (ROADMAP 6.4): they stop the app opening in VS Code's preview.
- **Rate limits:** a token bucket per client IP on every POST, PUT,
  PATCH and DELETE, tighter on sign-in (it sends email) and admin.
  The client IP is spoof-proof (api/client_ip.py): X-Forwarded-For is
  read only as far back as TRUSTED_PROXY_HOPS proxies we run behind.
  The Next.js server renders /plan by calling the API itself, for every
  user; it sends INTERNAL_API_TOKEN and is not limited. RATE_LIMITS=off
  turns limits off (tests).
"""
from __future__ import annotations

import hmac
import json
import os
import time
from dataclasses import dataclass
from typing import Callable, Optional

from api import client_ip

MAX_BODY_BYTES = int(os.environ.get("MAX_BODY_BYTES", 256 * 1024))
# A KFS PDF (engine/kfs.MAX_PDF_BYTES, 4 MB) as base64 in JSON.
KFS_BODY_BYTES = 6 * 1024 * 1024
LARGE_BODY_PATHS = {"/api/kfs/read": KFS_BODY_BYTES, "/api/credit-report/read": KFS_BODY_BYTES}
WRITE_METHODS = {"POST", "PUT", "PATCH", "DELETE"}


@dataclass(frozen=True)
class Limit:
    per_minute: float
    burst: int


# First matching prefix wins.
DEFAULT_LIMITS: list[tuple[str, Limit]] = [
    ("/api/auth/request-otp", Limit(per_minute=2, burst=5)),     # sends an email
    ("/api/auth/verify-otp", Limit(per_minute=6, burst=10)),
    ("/api/admin/", Limit(per_minute=2, burst=5)),
    ("/api/outcomes", Limit(per_minute=6, burst=10)),           # plus 10 a day (outcomes_store)
    ("/api/kfs/", Limit(per_minute=10, burst=10)),              # reads up to 4 MB of PDF
    ("/api/credit-report/", Limit(per_minute=10, burst=10)),    # same size of PDF (G6)
    ("/api/", Limit(per_minute=120, burst=60)),
]


def _json(status: int, message: str, extra_headers: Optional[list] = None):
    body = json.dumps({"detail": {"field": "", "message": message}}).encode()
    headers = [(b"content-type", b"application/json"), (b"content-length", str(len(body)).encode())]
    return status, headers + (extra_headers or []), body


class SecurityMiddleware:
    def __init__(
        self,
        app,
        *,
        limits: Optional[list[tuple[str, Limit]]] = None,
        rate_limits: Optional[bool] = None,
        proxy_hops: Optional[int] = None,
        internal_token: Optional[str] = None,
        max_body: Optional[int] = None,
        large_body_paths: Optional[dict[str, int]] = None,
        clock: Callable[[], float] = time.monotonic,
    ):
        self.app = app
        self.limits = limits if limits is not None else DEFAULT_LIMITS
        self.rate_limits = (rate_limits if rate_limits is not None else
                            os.environ.get("RATE_LIMITS", "on").lower() not in ("off", "0", "false", "no"))
        self.proxy_hops = proxy_hops if proxy_hops is not None else client_ip.proxy_hops()
        token = internal_token if internal_token is not None else os.environ.get("INTERNAL_API_TOKEN", "")
        self.internal_token = token.encode()
        self.max_body = max_body if max_body is not None else MAX_BODY_BYTES
        self.large_body_paths = large_body_paths if large_body_paths is not None else LARGE_BODY_PATHS
        self.clock = clock
        self._buckets: dict[tuple[str, str], tuple[float, float]] = {}
        self._seen = 0

    # ── who is asking ──────────────────────────────────────────────────────
    def client_ip(self, scope) -> str:
        return client_ip.from_scope(scope, self.proxy_hops)

    def _internal(self, headers: dict[bytes, bytes]) -> bool:
        sent = headers.get(b"x-internal-token")
        return bool(self.internal_token and sent and hmac.compare_digest(sent, self.internal_token))

    # ── token bucket ───────────────────────────────────────────────────────
    def _take(self, ip: str, path: str) -> Optional[int]:
        """None if allowed, else seconds to wait."""
        for prefix, limit in self.limits:
            if path.startswith(prefix):
                break
        else:
            return None
        now = self.clock()
        key = (ip, prefix)
        tokens, last = self._buckets.get(key, (float(limit.burst), now))
        tokens = min(float(limit.burst), tokens + (now - last) * limit.per_minute / 60)
        if tokens < 1:
            self._buckets[key] = (tokens, now)
            return max(1, int((1 - tokens) * 60 / limit.per_minute + 0.999))
        self._buckets[key] = (tokens - 1, now)
        self._seen += 1
        if self._seen % 1000 == 0:
            self._prune(now)
        return None

    def _prune(self, now: float) -> None:
        """Forget clients idle for 10 minutes (their buckets are full again)."""
        self._buckets = {k: v for k, v in self._buckets.items() if now - v[1] < 600}

    # ── ASGI ───────────────────────────────────────────────────────────────
    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            return await self.app(scope, receive, send)
        headers = dict(scope.get("headers") or [])
        method = scope.get("method", "GET")
        write = method in WRITE_METHODS
        private = scope.get("path", "").startswith(("/api/auth/", "/api/user/"))
        https = scope.get("scheme") == "https" or (
            self.proxy_hops > 0 and headers.get(b"x-forwarded-proto", b"").split(b",")[-1].strip() == b"https"
        )

        async def send_with_headers(message):
            if message["type"] == "http.response.start":
                h = list(message.get("headers", []))
                names = {k.lower() for k, _ in h}
                extra = [(b"x-content-type-options", b"nosniff"), (b"referrer-policy", b"no-referrer")]
                if (write or private) and b"cache-control" not in names:
                    extra.append((b"cache-control", b"no-store"))
                if https:
                    extra.append((b"strict-transport-security", b"max-age=15552000"))
                message = {**message, "headers": h + [x for x in extra if x[0] not in names]}
            await send(message)

        async def reply(status, hdrs, body):
            await send_with_headers({"type": "http.response.start", "status": status, "headers": hdrs})
            await send_with_headers({"type": "http.response.body", "body": body})

        cap = max(self.max_body, self.large_body_paths.get(scope.get("path", ""), 0))
        if write:
            length = headers.get(b"content-length")
            if length is not None:
                try:
                    too_big = int(length) > cap
                except ValueError:
                    return await reply(*_json(400, "The request's length could not be read."))
                if too_big:
                    return await reply(*_json(413, "The request is too large."))
            if self.rate_limits and not self._internal(headers):
                wait = self._take(self.client_ip(scope), scope.get("path", ""))
                if wait is not None:
                    return await reply(*_json(
                        429, "Too many requests from this connection. Wait a minute and try again.",
                        [(b"retry-after", str(wait).encode())]))

        if not write:
            return await self.app(scope, receive, send_with_headers)

        # Read the body here, up to the cap, and hand it on. (Raising from
        # inside FastAPI's own body read would come out as a 400.)
        chunks, size = [], 0
        while True:
            message = await receive()
            if message["type"] == "http.disconnect":
                return
            chunk = message.get("body", b"")
            size += len(chunk)
            if size > cap:
                return await reply(*_json(413, "The request is too large."))
            chunks.append(chunk)
            if not message.get("more_body", False):
                break
        body, handed = b"".join(chunks), False

        async def replay():
            nonlocal handed
            if not handed:
                handed = True
                return {"type": "http.request", "body": body, "more_body": False}
            return await receive()

        await self.app(scope, replay, send_with_headers)
