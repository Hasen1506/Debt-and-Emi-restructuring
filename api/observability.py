"""Error reports to Sentry, OFF unless SENTRY_DSN is set (grill #64).

Sentry is an error-tracking service: when the API hits a bug, it gets a
short report (what failed, where in the code) so we hear about it before
users do. Its free plan is enough for an app this size.

This is a small dependency-free client, not the Sentry SDK, so that
nothing about a user's money can leave the server by accident:
- Only unhandled exceptions are sent (the replies that become a 500).
- A report holds the exception type, a message cut to 300 characters
  with digits masked, the code's stack frames (file, function, line, no
  local variables), the HTTP method and the route path. Never the request
  body, query string, headers, cookies, client address or account.
- Sending happens on a background thread with a 3-second timeout, and a
  failure to send is ignored, so reporting can never break a request.

Wire format: Sentry's envelope endpoint, POST /api/<project_id>/envelope/
with a JSON header line, an item header and the event
(https://develop.sentry.dev/sdk/data-model/envelopes/, read 12 Oct 2026).
Set SENTRY_ENVIRONMENT (default "production") and optionally SENTRY_RELEASE.
"""
from __future__ import annotations

import json
import logging
import os
import re
import threading
import traceback
import urllib.parse
import urllib.request
import uuid
from datetime import datetime, timezone
from typing import Callable, Optional

log = logging.getLogger(__name__)

MAX_MESSAGE = 300
_DIGITS = re.compile(r"\d")


class Dsn:
    def __init__(self, raw: str):
        u = urllib.parse.urlsplit(raw)
        if u.scheme not in ("https", "http") or not u.username or not u.hostname:
            raise ValueError("Not a Sentry DSN")
        project = u.path.rstrip("/").rsplit("/", 1)[-1]
        if not project:
            raise ValueError("Not a Sentry DSN")
        self.raw = raw
        self.public_key = u.username
        host = u.hostname + (f":{u.port}" if u.port else "")
        prefix = u.path.rstrip("/").rsplit("/", 1)[0]
        self.envelope_url = f"{u.scheme}://{host}{prefix}/api/{project}/envelope/"


def dsn() -> Optional[Dsn]:
    raw = os.environ.get("SENTRY_DSN", "").strip()
    if not raw:
        return None
    try:
        return Dsn(raw)
    except ValueError:
        log.warning("SENTRY_DSN is set but is not a valid DSN; error reports are off.")
        return None


def scrub(text: str) -> str:
    """Digits can be amounts, account numbers or emails' numbers: mask them."""
    return _DIGITS.sub("#", text)[:MAX_MESSAGE]


def build_event(exc: BaseException, method: str = "", route: str = "") -> dict:
    frames = [
        {"filename": os.path.relpath(f.filename) if os.path.isabs(f.filename) else f.filename,
         "function": f.name, "lineno": f.lineno, "in_app": "site-packages" not in f.filename}
        for f in traceback.extract_tb(exc.__traceback__)
    ]
    event = {
        "event_id": uuid.uuid4().hex,
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "platform": "python",
        "level": "error",
        "logger": "rightdue.api",
        "environment": os.environ.get("SENTRY_ENVIRONMENT", "production"),
        "exception": {"values": [{
            "type": type(exc).__name__,
            "value": scrub(str(exc)),
            "stacktrace": {"frames": frames[-30:]},
        }]},
        # Route path only: no query string, body, headers or cookies.
        "request": {"method": method, "url": scrub(route)},
        "tags": {"component": "api"},
    }
    release = os.environ.get("SENTRY_RELEASE")
    if release:
        event["release"] = release
    return event


def envelope(event: dict, target: Dsn) -> bytes:
    payload = json.dumps(event, separators=(",", ":")).encode()
    header = json.dumps({"event_id": event["event_id"], "dsn": target.raw,
                         "sent_at": datetime.now(timezone.utc).isoformat()}, separators=(",", ":"))
    item = json.dumps({"type": "event", "length": len(payload), "content_type": "application/json"},
                      separators=(",", ":"))
    return header.encode() + b"\n" + item.encode() + b"\n" + payload + b"\n"


def _send(url: str, body: bytes, public_key: str) -> None:
    req = urllib.request.Request(url, data=body, method="POST", headers={
        "Content-Type": "application/x-sentry-envelope",
        "X-Sentry-Auth": f"Sentry sentry_version=7, sentry_key={public_key}, sentry_client=rightdue-api/1",
    })
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    with opener.open(req, timeout=3) as resp:  # noqa: S310 (URL from our own DSN)
        resp.read()


def capture_exception(exc: BaseException, method: str = "", route: str = "",
                      sender: Callable[[str, bytes, str], None] = _send, background: bool = True) -> Optional[str]:
    """Report one exception if SENTRY_DSN is set. Returns the event id or None."""
    target = dsn()
    if target is None:
        return None
    try:
        event = build_event(exc, method, route)
        body = envelope(event, target)
    except Exception:  # pragma: no cover - never let reporting raise
        return None

    def run():
        try:
            sender(target.envelope_url, body, target.public_key)
        except Exception:
            log.info("Sentry report not delivered.")

    if background:
        threading.Thread(target=run, daemon=True).start()
    else:
        run()
    return event["event_id"]
