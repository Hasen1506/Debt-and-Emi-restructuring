"""Signed links in emails: "All paid", "Paid some", "Can't pay", "Turn off".

A link carries who, which month and what, signed with NOTIFY_SIGNING_KEY
(HMAC-SHA256), and expires. Nothing secret is in it: it can only record
that one answer for that one month, or turn that user's emails off. The
link opens a confirm page first (GET changes nothing), because mail
scanners open links on their own.
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import os
import re
import time
from dataclasses import dataclass
from typing import Optional

ACTIONS = {"all", "some", "cant", "unsub"}
TTL_SECONDS = 45 * 24 * 3600      # a month's links stay good into the next month
UNSUB_TTL_SECONDS = 400 * 24 * 3600


class TokenError(ValueError):
    pass


@dataclass(frozen=True)
class Claim:
    user_id: str
    month: str
    action: str
    expires: int


def _key() -> bytes:
    raw = os.environ.get("NOTIFY_SIGNING_KEY", "")
    if len(raw) < 32:
        raise TokenError("NOTIFY_SIGNING_KEY is not set (32+ characters).")
    return raw.encode()


def _b64(b: bytes) -> str:
    return base64.urlsafe_b64encode(b).rstrip(b"=").decode()


def _unb64(s: str) -> bytes:
    return base64.urlsafe_b64decode(s + "=" * (-len(s) % 4))


def sign(user_id: str, month: str, action: str, *, now: Optional[float] = None) -> str:
    if action not in ACTIONS:
        raise TokenError("unknown action")
    if not re.fullmatch(r"[A-Za-z0-9-]{1,64}", user_id) or not re.fullmatch(r"\d{4}-\d{2}|-", month):
        raise TokenError("bad claim")
    ttl = UNSUB_TTL_SECONDS if action == "unsub" else TTL_SECONDS
    exp = int((now if now is not None else time.time()) + ttl)
    body = f"v1.{user_id}.{month}.{action}.{exp}"
    mac = hmac.new(_key(), body.encode(), hashlib.sha256).digest()[:20]
    return _b64(body.encode()) + "." + _b64(mac)


def verify(token: str, *, now: Optional[float] = None) -> Claim:
    try:
        b, m = (token or "").split(".", 1)
        body = _unb64(b).decode()
        mac = _unb64(m)
    except (ValueError, UnicodeDecodeError):
        raise TokenError("This link isn't readable.") from None
    want = hmac.new(_key(), body.encode(), hashlib.sha256).digest()[:20]
    if not hmac.compare_digest(mac, want):
        raise TokenError("This link isn't valid.")
    parts = body.split(".")
    if len(parts) != 5 or parts[0] != "v1" or parts[3] not in ACTIONS:
        raise TokenError("This link isn't valid.")
    exp = int(parts[4])
    if (now if now is not None else time.time()) > exp:
        raise TokenError("This link has expired. Open RightDue to record it there.")
    return Claim(parts[1], parts[2], parts[3], exp)
