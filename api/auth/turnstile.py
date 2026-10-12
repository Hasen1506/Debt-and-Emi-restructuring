"""Cloudflare Turnstile check on sign-in code requests (grill #59). OFF by default.

Turnstile is Cloudflare's free "are you a person" check. It shows a small
box on the sign-in page; the box hands the browser a one-time token, and
the server asks Cloudflare whether the token is real before it emails a
code. It stops scripts from using our sign-in form to mail strangers.

Turn it on with two settings (DEPLOY.md, "Turnstile"):
  TURNSTILE_SECRET_KEY            here, on the API (a secret)
  NEXT_PUBLIC_TURNSTILE_SITE_KEY  on the web build (public)
With no secret key the check is skipped, exactly as before.

Server-side validation follows Cloudflare's docs (read 12 Oct 2026):
https://developers.cloudflare.com/turnstile/get-started/server-side-validation/
POST https://challenges.cloudflare.com/turnstile/v0/siteverify with
`secret`, `response` (the token, at most 2048 characters, valid for 300 s,
single use) and optionally `remoteip`; the reply is JSON with `success`.
"""
from __future__ import annotations

import json
import logging
import os
import urllib.parse
import urllib.request
from typing import Callable, Optional

log = logging.getLogger(__name__)

SITEVERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify"
MAX_TOKEN_LENGTH = 2048
TIMEOUT_SECONDS = 5


def secret_key() -> str:
    return os.environ.get("TURNSTILE_SECRET_KEY", "").strip()


def enabled() -> bool:
    return bool(secret_key())


def _post(url: str, data: bytes, timeout: float) -> bytes:
    req = urllib.request.Request(url, data=data, headers={"Content-Type": "application/x-www-form-urlencoded"})
    # No proxy: a host-level HTTP(S)_PROXY must not see the secret.
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    with opener.open(req, timeout=timeout) as resp:  # noqa: S310 (fixed https URL)
        return resp.read()


def verify(token: Optional[str], remote_ip: Optional[str] = None,
           post: Callable[[str, bytes, float], bytes] = _post) -> bool:
    """True when Cloudflare confirms the token. Fails closed: a missing,
    oversized or unverifiable token is refused (the user can retry the box)."""
    if not token or len(token) > MAX_TOKEN_LENGTH:
        return False
    fields = {"secret": secret_key(), "response": token}
    if remote_ip and remote_ip != "unknown":
        fields["remoteip"] = remote_ip
    try:
        raw = post(SITEVERIFY_URL, urllib.parse.urlencode(fields).encode(), TIMEOUT_SECONDS)
        reply = json.loads(raw)
    except Exception:  # network, timeout, bad JSON: never let it through
        log.warning("Turnstile verification could not be completed.")
        return False
    return reply.get("success") is True
