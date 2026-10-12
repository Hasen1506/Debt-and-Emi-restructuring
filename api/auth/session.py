"""Session + OTP token utilities — pure stdlib, no external crypto deps.

OTP codes are 6-digit numeric. We store SHA-256(code), but this small
code space can be enumerated from a database dump. Short expiry and
capped requests/attempts are the protection against online guessing.

Session tokens are 32 random bytes, urlsafe-encoded. Only their SHA-256
digest is stored, so database reads do not expose usable session cookies.
"""
from __future__ import annotations

import hashlib
import secrets
from datetime import datetime, timedelta, timezone

OTP_TTL = timedelta(minutes=10)
OTP_MAX_ATTEMPTS = 5
OTP_MAX_REQUESTS = 5
# M7: per-email limits across codes. A fresh code used to reset the 5-guess
# counter (25 guesses per 10 minutes, ~3,600 a day per account), and an
# address could be mailed ~720 times a day from rotating IPs.
OTP_DAILY_WINDOW = timedelta(hours=24)
OTP_MAX_FAILED_DAILY = 15
OTP_MAX_REQUESTS_DAILY = 20
SESSION_TTL = timedelta(days=30)
SESSION_COOKIE_NAME = "rightdue_session"
# Critique #58: the old brand's cookie name, still accepted for one release
# so sessions made before the rename keep working. Remove after Nov 2026.
LEGACY_SESSION_COOKIE_NAME = "finoptima_session"


def generate_otp() -> str:
    # secrets.randbelow gives 0..999_999 inclusive; pad to 6 digits.
    return f"{secrets.randbelow(1_000_000):06d}"


def hash_otp(code: str) -> str:
    return hashlib.sha256(code.encode("utf-8")).hexdigest()


def generate_session_token() -> str:
    return secrets.token_urlsafe(32)


def hash_session_token(token: str) -> str:
    # The prefix distinguishes new digests from legacy plaintext sessions.
    return "sha256:" + hashlib.sha256(token.encode("utf-8")).hexdigest()


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def otp_expiry() -> datetime:
    return utc_now() + OTP_TTL


def session_expiry() -> datetime:
    return utc_now() + SESSION_TTL
