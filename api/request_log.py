"""Request log without personal values (audit80 D24).

uvicorn's default access log prints the full request line, query string
included, so GET /api/score-band?score=742 put a user's credit score into
Render's logs, and the notify links' signed ?t= tokens would follow.
deploy/start.sh now runs uvicorn with --no-access-log, and this middleware
writes one line per request instead:

    GET /api/score-band 200 12ms

- the ROUTE TEMPLATE when FastAPI matched one (/api/notify/ack/{token}
  rather than the token itself), else the bare path with any long digit runs
  and token-like segments masked;
- never the query string, body, headers, cookies or client address.

Logger name "rightdue.access", level INFO. REQUEST_LOG=off silences it.
"""
from __future__ import annotations

import logging
import os
import re
import time

log = logging.getLogger("rightdue.access")


def _ensure_handler(logger: logging.Logger) -> None:
    """uvicorn configures only its own loggers; give ours a stdout handler
    (Render collects stdout) unless something already did."""
    if not logger.handlers:
        handler = logging.StreamHandler()
        handler.setFormatter(logging.Formatter("%(asctime)s access %(message)s"))
        logger.addHandler(handler)
        logger.setLevel(logging.INFO)
        logger.propagate = False

_DIGITS = re.compile(r"\d{4,}")
_TOKENISH = re.compile(r"/[A-Za-z0-9_\-]{24,}(?=/|$)")


def safe_path(scope) -> str:
    route = scope.get("route")
    template = getattr(route, "path", None)
    if template:
        return template
    path = scope.get("path", "") or ""
    path = _TOKENISH.sub("/{token}", path)
    return _DIGITS.sub("{n}", path)[:200]


def line(method: str, path: str, status: int, ms: float) -> str:
    return f"{method} {path} {status} {int(ms)}ms"


class RequestLogMiddleware:
    def __init__(self, app, *, logger: logging.Logger = log, enabled: bool | None = None):
        self.app = app
        self.logger = logger
        self.enabled = (os.environ.get("REQUEST_LOG", "on").lower() not in ("off", "0", "false", "no")
                        if enabled is None else enabled)
        if self.enabled and logger is log:
            _ensure_handler(logger)

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http" or not self.enabled:
            return await self.app(scope, receive, send)
        start = time.perf_counter()
        status_code = 500

        async def capture(message):
            nonlocal status_code
            if message["type"] == "http.response.start":
                status_code = int(message.get("status", 500))
            await send(message)

        try:
            await self.app(scope, receive, capture)
        finally:
            # Healthchecks every few seconds would drown everything else.
            # (Render's check, /api/healthz, is answered by Next.js and never
            # reaches FastAPI; web/tests/single-service.cjs keeps it that way.)
            if scope.get("path") != "/api/health":
                self.logger.info(line(scope.get("method", "?"), safe_path(scope), status_code,
                                      (time.perf_counter() - start) * 1000))
