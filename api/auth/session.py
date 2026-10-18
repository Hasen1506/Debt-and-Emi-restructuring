"""Session + OTP token utilities — pure stdlib, no external crypto deps.

OTP codes are 6-digit numeric. Since audit80 D25 we store
HMAC-SHA256(server key, email + code): a plain SHA-256 of a 6-digit code
can be reversed from a database dump in milliseconds, but without the
server key (OTP_HASH_KEY, else INTERNAL_API_TOKEN, both secrets that live
only in the app's environment) a dump alone recovers nothing during the
code's 10 minutes. Short expiry and capped requests/attempts remain the
protection against online guessing.

Session tokens are 32 random bytes, urlsafe-encoded. Only their SHA-256
digest is stored, so database reads do not expose usable session cookies.
"""
from __future__ import annotations

import hashlib
import hmac
import logging
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
# Grill #59 / audit80 D13: a daily cap under the email provider's quota.
# Resend's free plan sends 100 emails a day and 3,000 a month
# (https://resend.com/pricing, read 12 Oct 2026). Since D13 the cap counts and
# blocks only codes to addresses WITHOUT an account (new sign-ups), so it can
# never lock existing users out; 60 leaves ~40 a day for existing accounts
# and other mail. Raise it with OTP_GLOBAL_DAILY_CAP on a paid plan.
def _int_env(name: str, default: int) -> int:
    try:
        value = int(os.environ.get(name, default))
    except ValueError:
        return default
    return value if value > 0 else default


OTP_GLOBAL_DAILY_CAP = _int_env("OTP_GLOBAL_DAILY_CAP", 60)
# D13: new-sign-up codes one network (api/netkey.py) may trigger a day, so a
# single connection can't spend the global budget. Existing accounts get
# their own, smaller, per-address daily cap instead.
OTP_NEW_PER_NETWORK_DAILY = _int_env("OTP_NEW_PER_NETWORK_DAILY", 5)
OTP_ACCOUNT_DAILY_CAP = _int_env("OTP_ACCOUNT_DAILY_CAP", 5)
# How long sign-in records (codes sent, sessions) are kept after they end.
# DPDP Rules 2025 r.6(1)(e) and r.8(3) ask for one year of processing logs
# once they are in force (14 May 2027); docs/privacy-and-retention.md.
AUTH_LOG_RETENTION = timedelta(days=_int_env("AUTH_LOG_RETENTION_DAYS", 365))
SESSION_TTL = timedelta(days=30)
SESSION_COOKIE_NAME = "rightdue_session"
# Critique #58: the old brand's cookie name, still accepted for one release
# so sessions made before the rename keep working. Remove after Nov 2026.
LEGACY_SESSION_COOKIE_NAME = "finoptima_session"


def generate_otp() -> str:
    # secrets.randbelow gives 0..999_999 inclusive; pad to 6 digits.
    return f"{secrets.randbelow(1_000_000):06d}"


_OTP_HMAC_PREFIX = "h1:"
_DEV_OTP_KEY = "rightdue-dev-otp-key"
_log = logging.getLogger(__name__)


def otp_hash_key() -> bytes:
    """OTP_HASH_KEY, else INTERNAL_API_TOKEN (render.yaml generates it, so
    production has a secret key with no new setting). Neither set: a fixed
    development key, with a warning when running on Render."""
    key = os.environ.get("OTP_HASH_KEY", "").strip() or os.environ.get("INTERNAL_API_TOKEN", "").strip()
    if not key:
        if os.environ.get("RENDER"):
            _log.warning("OTP_HASH_KEY and INTERNAL_API_TOKEN are unset: sign-in codes use a public development key.")
        key = _DEV_OTP_KEY
    return key.encode("utf-8")


def hash_otp(code: str, email: str = "", key: bytes | None = None) -> str:
    """Keyed digest of one code for one address (audit80 D25)."""
    msg = (email.strip().lower() + "\n" + code).encode("utf-8")
    return _OTP_HMAC_PREFIX + hmac.new(key if key is not None else otp_hash_key(), msg, hashlib.sha256).hexdigest()


def otp_matches(stored: str, code: str, email: str) -> bool:
    """Constant-time check. A row written before D25 holds the old unsalted
    SHA-256; it is accepted for its last few minutes (codes expire in 10)."""
    if not stored:
        return False
    if stored.startswith(_OTP_HMAC_PREFIX):
        return hmac.compare_digest(stored, hash_otp(code, email))
    return hmac.compare_digest(stored, hashlib.sha256(code.encode("utf-8")).hexdigest())


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
