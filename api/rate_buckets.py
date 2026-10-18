"""Rate-limit counters kept in Postgres, so a restart can't reset them (grill #59).

The in-memory token buckets in api/security.py vanish whenever the free
container sleeps or restarts, which is several times a day. For the routes
that send email or accept reports, a second, slower limit is kept in the
`rate_buckets` table: a fixed window per client address (an hour by
default). A fixed window is simple, atomic in one SQL statement, and
good enough for "no more than N an hour"; the memory bucket still stops
short bursts.

Privacy: the address is stored only as a keyed hash (HMAC-SHA256 with
RATE_BUCKET_KEY, else OUTCOMES_IP_KEY, the same approach as
api/outcomes_store.py), and rows are purged a day after their window ends
(api/auth/retention.py).

If the database can't be reached the check is skipped (logged): the
per-email limits in the sign-in route still hold, and refusing every
sign-in because a counter failed would be worse.
"""
from __future__ import annotations

import hashlib
import hmac
import logging
import os
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Optional

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from api.db.models import RateBucket
from api.netkey import network_of

log = logging.getLogger(__name__)


@dataclass(frozen=True)
class WindowLimit:
    limit: int
    window_seconds: int = 3600


# First matching prefix wins. Generous for a person, low for a script.
PERSISTED_LIMITS: list[tuple[str, WindowLimit]] = [
    ("/api/auth/request-otp", WindowLimit(limit=20)),   # each one is an email
    ("/api/auth/verify-otp", WindowLimit(limit=60)),
    ("/api/auth/account/", WindowLimit(limit=30)),
    ("/api/admin/", WindowLimit(limit=20)),
    ("/api/outcomes", WindowLimit(limit=30)),
    # audit80 D15: each one spawns a PDF parse; the memory bucket resets on restart.
    ("/api/kfs/", WindowLimit(limit=60)),
    ("/api/credit-report/", WindowLimit(limit=60)),
]


def _key_bytes() -> bytes:
    key = os.environ.get("RATE_BUCKET_KEY") or os.environ.get("OUTCOMES_IP_KEY") or ""
    if not key:
        # Stable fallback so counts survive restarts; set a secret in production.
        key = "rightdue-rate-buckets-unkeyed"
    return key.encode()


def match(path: str, limits: list[tuple[str, WindowLimit]] = PERSISTED_LIMITS) -> Optional[tuple[str, WindowLimit]]:
    for prefix, limit in limits:
        if path.startswith(prefix):
            return prefix, limit
    return None


class DbRateCounter:
    def __init__(self, sessions: async_sessionmaker[AsyncSession], key: Optional[bytes] = None,
                 limits: Optional[list[tuple[str, WindowLimit]]] = None):
        self.sessions = sessions
        self.key = key if key is not None else _key_bytes()
        self.limits = limits if limits is not None else PERSISTED_LIMITS

    def bucket_key(self, prefix: str, ip: str, window_start: int) -> str:
        # audit80 D13: an IPv6 client owns a whole /64, so it is counted as
        # one (api/netkey.py); IPv4 stays per address (carrier NAT in India).
        digest = hmac.new(self.key, network_of(ip).encode(), hashlib.sha256).hexdigest()[:32]
        return f"{prefix}|{digest}|{window_start}"

    async def hit(self, ip: str, path: str, now: Optional[datetime] = None) -> Optional[int]:
        """Count one request. None if allowed, else seconds until the window ends."""
        found = match(path, self.limits)
        if found is None:
            return None
        prefix, limit = found
        now = now or datetime.now(timezone.utc)
        epoch = int(now.timestamp())
        start = epoch - epoch % limit.window_seconds
        ends = datetime.fromtimestamp(start + limit.window_seconds, timezone.utc)
        key = self.bucket_key(prefix, ip, start)
        try:
            async with self.sessions() as db:
                count = await _increment(db, key, ends)
                await db.commit()
        except Exception:
            log.warning("Persisted rate limit unavailable; allowing the request.", exc_info=True)
            return None
        if count > limit.limit:
            return max(1, start + limit.window_seconds - epoch)
        return None


async def _increment(db: AsyncSession, key: str, expires_at: datetime) -> int:
    dialect = db.bind.dialect.name
    if dialect == "postgresql":
        from sqlalchemy.dialects.postgresql import insert
    elif dialect == "sqlite":
        from sqlalchemy.dialects.sqlite import insert
    else:  # pragma: no cover
        raise RuntimeError(f"Unsupported database for rate buckets: {dialect}")
    stmt = insert(RateBucket).values(key=key, count=1, expires_at=expires_at)
    stmt = stmt.on_conflict_do_update(
        index_elements=[RateBucket.key], set_={"count": RateBucket.count + 1}
    ).returning(RateBucket.count)
    return int((await db.execute(stmt)).scalar_one())


def default_counter() -> Optional[DbRateCounter]:
    """The production counter, when a database is configured and
    RATE_LIMIT_STORE is not "memory"."""
    if os.environ.get("RATE_LIMIT_STORE", "db").lower() == "memory":
        return None
    from api.db.database import SessionLocal
    return DbRateCounter(SessionLocal) if SessionLocal is not None else None

