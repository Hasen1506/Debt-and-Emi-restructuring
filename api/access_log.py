"""Access log for personal data (audit80 D8).

DPDP Rules 2025 r.6(1)(c) asks for "visibility on the accessing of such
personal data, through appropriate logs, monitoring and review", and
r.6(1)(e) for those logs to be kept one year (in force from mid-May 2027;
https://www.meity.gov.in/static/uploads/2025/11/53450e6e5dc0bfa85ebd78686cadad39.pdf).

One row per read or write of a saved plan, per export, per account delete,
per session revoke and per consent change: account id, action, route
template, outcome, time. Never a figure, a query string or an IP address.
Rows are purged AUTH_LOG_RETENTION (365 days) after they were written
(api/auth/retention.py). The account id is not a foreign key, so the log
of a deleted account survives its deletion for that year, as r.8(3) asks.

Writing the log must never break the request it describes: a failure is
logged and swallowed.
"""
from __future__ import annotations

import logging
import uuid
from typing import Optional

from sqlalchemy.ext.asyncio import AsyncSession

from api.auth.session import utc_now
from api.db.models import AccessLog

log = logging.getLogger(__name__)

ACTIONS = {"read", "write", "export", "delete", "revoke", "consent"}


def entry(user_id: Optional[uuid.UUID], action: str, route: str, outcome: str = "ok") -> AccessLog:
    if action not in ACTIONS:
        raise ValueError(f"unknown access-log action {action!r}")
    # A route template, never a URL with a query: cut at '?' to be sure.
    return AccessLog(user_id=user_id, action=action, route=route.split("?", 1)[0][:120],
                     outcome=outcome[:16], at=utc_now())


async def record(db: AsyncSession, user_id: Optional[uuid.UUID], action: str, route: str,
                 outcome: str = "ok", *, commit: bool = True) -> None:
    """Add one line. With commit=False the caller's own commit saves it, so
    the line and the change it describes land together."""
    try:
        db.add(entry(user_id, action, route, outcome))
        if commit:
            await db.commit()
    except Exception:
        log.warning("Access log line not written (%s %s).", action, route, exc_info=True)
        try:
            await db.rollback()
        except Exception:  # pragma: no cover
            pass
