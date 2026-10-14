"""A coarse device label for each sign-in session (audit80 D21).

"Chrome on Android", "Safari on iPhone": enough to tell your own devices
apart on the account page, too coarse to fingerprint anyone. No version
numbers, no IP address, no location. Unknown agents become "A browser".

A session's public id is derived from its stored digest, so the page can
name one session to sign out without ever seeing the token or its hash.
"""
from __future__ import annotations

import hashlib
import re
from typing import Optional

# Order matters: Edge and Opera say "Chrome" too, Chrome says "Safari".
_BROWSERS = (
    (re.compile(r"Edg(e|A|iOS)?/", re.I), "Edge"),
    (re.compile(r"OPR/|Opera", re.I), "Opera"),
    (re.compile(r"SamsungBrowser/", re.I), "Samsung Internet"),
    (re.compile(r"Firefox/|FxiOS/", re.I), "Firefox"),
    (re.compile(r"Chrome/|CriOS/", re.I), "Chrome"),
    (re.compile(r"Safari/", re.I), "Safari"),
)
_SYSTEMS = (
    (re.compile(r"iPhone", re.I), "iPhone"),
    (re.compile(r"iPad", re.I), "iPad"),
    (re.compile(r"Android", re.I), "Android"),
    (re.compile(r"Windows", re.I), "Windows"),
    (re.compile(r"Mac OS X|Macintosh", re.I), "Mac"),
    (re.compile(r"CrOS", re.I), "ChromeOS"),
    (re.compile(r"Linux", re.I), "Linux"),
)


def device_label(user_agent: Optional[str]) -> str:
    ua = (user_agent or "")[:512]
    browser = next((name for rx, name in _BROWSERS if rx.search(ua)), None)
    system = next((name for rx, name in _SYSTEMS if rx.search(ua)), None)
    if browser and system:
        return f"{browser} on {system}"
    if browser or system:
        return browser or f"A browser on {system}"
    return "A browser"


def public_session_id(stored_token: str) -> str:
    """16 hex characters, stable for a session, not reversible to its token."""
    return hashlib.sha256(("sid:" + stored_token).encode("utf-8")).hexdigest()[:16]
