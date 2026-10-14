"""Retention for sign-in records (grill #51). See docs/privacy-and-retention.md.

What is kept, and for how long:
- otp_challenges (codes sent): the code's hash is blanked as soon as it is
  used or expires; the row (email, when sent, when used, wrong guesses) is
  deleted AUTH_LOG_RETENTION (default 365 days) after it was sent.
- otp_codes (legacy rows from before grill #59): same rule.
- sessions: deleted AUTH_LOG_RETENTION after they expired or were signed out.
- rate_buckets: deleted a day after their window ends.
- auth_log_tombstones (audit80 D6): sign-in records of a deleted account,
  deleted AUTH_LOG_RETENTION after the account was deleted.
- access_log (audit80 D8): deleted AUTH_LOG_RETENTION after the access.
- consent_events (audit80 D2): kept while the account exists; for a
  deleted account, deleted AUTH_LOG_RETENTION after its withdrawal.

Why a year: once in force (14 May 2027), DPDP Rules 2025 r.6(1)(e) and
r.8(3) ask a Data Fiduciary to keep logs of processing for one year to
detect and investigate unauthorised access. The period is a setting
(AUTH_LOG_RETENTION_DAYS), and a founder decision (answers G8).

`purge` runs when the API starts and then at most every PURGE_EVERY from
the sign-in route; the free plan has no scheduler, and both are cheap.
"""
from __future__ import annotations

import logging
import time
from datetime import datetime, timedelta
from typing import Optional

from sqlalchemy import and_, delete, or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from api.auth.session import AUTH_LOG_RETENTION, utc_now
from api.db.models import AccessLog, AuthLogTombstone, ConsentEvent, OtpChallenge, OtpCode, RateBucket, Session, User

log = logging.getLogger(__name__)

PURGE_EVERY = 6 * 3600  # seconds
RATE_BUCKET_GRACE = timedelta(days=1)
_last_purge: Optional[float] = None


async def purge(db: AsyncSession, now: Optional[datetime] = None) -> dict[str, int]:
    """Apply the retention rules once. Returns rows touched per table."""
    now = now or utc_now()
    cutoff = now - AUTH_LOG_RETENTION
    counts: dict[str, int] = {}
    res = await db.execute(
        update(OtpChallenge)
        .where(OtpChallenge.code_hash != "")
        .where(or_(OtpChallenge.used_at.is_not(None), OtpChallenge.expires_at <= now))
        .values(code_hash="")
    )
    counts["codes_blanked"] = res.rowcount or 0
    res = await db.execute(delete(OtpChallenge).where(OtpChallenge.created_at < cutoff))
    counts["otp_challenges"] = res.rowcount or 0
    res = await db.execute(delete(OtpCode).where(OtpCode.created_at < cutoff))
    counts["otp_codes_legacy"] = res.rowcount or 0
    res = await db.execute(delete(Session).where(or_(
        Session.expires_at < cutoff,
        and_(Session.revoked_at.is_not(None), Session.revoked_at < cutoff),
    )))
    counts["sessions"] = res.rowcount or 0
    res = await db.execute(delete(RateBucket).where(RateBucket.expires_at < now - RATE_BUCKET_GRACE))
    counts["rate_buckets"] = res.rowcount or 0
    res = await db.execute(delete(AuthLogTombstone).where(AuthLogTombstone.deleted_at < cutoff))
    counts["auth_log_tombstones"] = res.rowcount or 0
    res = await db.execute(delete(AccessLog).where(AccessLog.at < cutoff))
    counts["access_log"] = res.rowcount or 0
    withdrawn_long_ago = (
        select(ConsentEvent.user_id).where(ConsentEvent.action == "withdrawn").where(ConsentEvent.at < cutoff)
    )
    res = await db.execute(delete(ConsentEvent).where(
        ConsentEvent.user_id.in_(withdrawn_long_ago),
        ConsentEvent.user_id.not_in(select(User.id)),
    ))
    counts["consent_events"] = res.rowcount or 0
    await db.commit()
    return counts


async def maybe_purge(db: AsyncSession, clock=time.monotonic) -> None:
    """Purge if this process has not in the last PURGE_EVERY. Never raises."""
    global _last_purge
    t = clock()
    if _last_purge is not None and t - _last_purge < PURGE_EVERY:
        return
    _last_purge = t
    try:
        await purge(db)
    except Exception:
        await db.rollback()
        log.warning("Sign-in record purge failed; will retry later.", exc_info=True)


async def purge_on_startup() -> None:
    from api.db.database import SessionLocal
    if SessionLocal is None:
        return
    async with SessionLocal() as db:
        await maybe_purge(db)
