"""Session + OTP token utilities — pure stdlib, no external crypto deps.

OTP codes are 6-digit numeric. We store SHA-256(code), but this small
code space can be enumerated from a database dump. Short expiry and
capped requests/attempts are the protection against online guessing.

Session tokens are 32 random bytes, urlsafe-encoded. Only their SHA-256
digest is stored, so database reads do not expose usable session cookies.
"""
from __future__ import annotations

import hashlib
import os
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
# Grill #59: one cap on codes sent per day across ALL emails, under the
# email provider's own quota. Resend's free plan sends 100 emails a day and
# 3,000 a month (https://resend.com/pricing, read 12 Oct 2026); 90 leaves
# room for other mail. Raise it with OTP_GLOBAL_DAILY_CAP on a paid plan.
def _int_env(name: str, default: int) -> int:
    try:
        value = int(os.environ.get(name, default))
    except ValueError:
        return default
    return value if value > 0 else default


OTP_GLOBAL_DAILY_CAP = _int_env("OTP_GLOBAL_DAILY_CAP", 90)
# How long sign-in records (codes sent, sessions) are kept after they end.
# DPDP Rules 2025 r.6(1)(e) and r.8(3) ask for one year of processing logs
# once they are in force (14 May 2027); docs/privacy-and-retention.md.
AUTH_LOG_RETENTION = timedelta(days=_int_env("AUTH_LOG_RETENTION_DAYS", 365))
SESSION_TTL = timedelta(days=30)
SESSION_COOKIE_NAME = "finoptima_session"


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
