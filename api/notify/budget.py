"""How many notification emails may go out today (A12).

Resend's Free plan allows 100 emails a day and 3,000 a month, and every
email counts: sign-in codes, payday emails, reminders, rate-move emails and
received replies alike (resend.com/pricing, read 14 Oct 2026). Sign-in
codes already stop at OTP_GLOBAL_DAILY_CAP (default 90, api/auth/session.py)
to stay under that. Notifications must never eat the codes' share, or one
busy payday locks people out of signing in. So:

    allowance = RESEND_DAILY_LIMIT − OTP_GLOBAL_DAILY_CAP     (100 − 90 = 10)

unless NOTIFY_DAILY_CAP sets it outright. RESEND_DAILY_LIMIT=0 means the
plan has no daily limit (Pro, $20/month for 50,000): then only
NOTIFY_DAILY_CAP, if set, limits notifications.

Whoever isn't emailed today because the budget ran out is emailed on a later
run: payday emails stay due for LATE_SEND_GRACE_DAYS (engine/payday.py),
reminders and rate-move emails stay due until sent.
"""
from __future__ import annotations

import os
from typing import Optional

RESEND_FREE_DAILY = 100
OTP_CAP_DEFAULT = 90          # api/auth/session.py OTP_GLOBAL_DAILY_CAP default


def _int(name: str, default: Optional[int]) -> Optional[int]:
    raw = os.environ.get(name, "").strip()
    if not raw:
        return default
    try:
        return max(0, int(raw))
    except ValueError:
        return default


def daily_allowance() -> Optional[int]:
    """Emails notifications may send today; None = no limit."""
    cap = _int("NOTIFY_DAILY_CAP", None)
    limit = _int("RESEND_DAILY_LIMIT", RESEND_FREE_DAILY)
    if limit == 0:
        return cap
    room = max(0, (limit or 0) - (_int("OTP_GLOBAL_DAILY_CAP", OTP_CAP_DEFAULT) or 0))
    return min(room, cap) if cap is not None else room


class Budget:
    def __init__(self, allowance: Optional[int], used: int):
        self.allowance = allowance
        self.used = used
        self.deferred = 0

    def take(self) -> bool:
        if self.allowance is not None and self.used >= self.allowance:
            self.deferred += 1
            return False
        self.used += 1
        return True

    def give_back(self) -> None:
        self.used = max(0, self.used - 1)
