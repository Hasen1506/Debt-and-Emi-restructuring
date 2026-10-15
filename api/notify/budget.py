"""One shared email budget for every email RightDue sends (round 2, 15 Oct 2026).

The founder stays on Resend Free (no $20/month Pro). Free allows **100
emails a day and 3,000 a month**, and every email counts against both:
sign-in codes, payday emails, deadline reminders, rate-move emails, and
each *received* email (a "done" reply) too. Read on resend.com/pricing,
15 Oct 2026 ("Daily limit 100", "3,000 emails / mo", "Each received email
counts towards your transactional emails quota").

So there is one budget, and sign-in codes always come first:

* ``RESEND_DAILY_LIMIT`` (default **95**: five under Resend's 100, so a
  replied-to email or a retry never tips us over). ``0`` = no daily limit
  (a paid plan).
* ``RESEND_MONTHLY_LIMIT`` (default **3000** while a daily limit applies,
  none when ``RESEND_DAILY_LIMIT=0``). ``0`` = no monthly limit.
* Sign-in codes are **never** refused by this budget (only by their own
  per-address / per-network / new-sign-up caps in api/auth). They are
  counted, and room is held back for codes still to come:
  ``reserve = max(RESEND_CODE_RESERVE (default 20), codes sent yesterday)``
  for today, of which ``reserve − codes already sent today`` is still held.
* Notification emails (payday, reminders, rate-move) take what is left:

      daily room   = limit − codes today − notifications today − reserve still held
      monthly room = monthly limit − everything sent this month
                     − reserve still held today
                     − (days left in the month after today) × max(reserve floor, this month's codes per day)
      room         = min(daily room, monthly room, NOTIFY_DAILY_CAP − notifications today)

  ``NOTIFY_DAILY_CAP`` is optional (an extra ceiling on notifications only).
* What doesn't fit today rolls to the next run in a fair order
  (api/notify/routes.py ``_run_once``): deadline reminders first, then
  payday and rate-move emails, oldest due first within each.

The day is the India calendar day (the scheduler runs 09:00 IST, and the
Resend dashboard's day is close enough: we stay 5 under its limit).
"""
from __future__ import annotations

import calendar
import math
import os
from dataclasses import dataclass, field
from datetime import date, datetime, time, timedelta, timezone
from typing import Any, Awaitable, Callable, Mapping, Optional
from zoneinfo import ZoneInfo

RESEND_FREE_DAILY = 100           # the provider's hard limit (for the docs and tests)
RESEND_FREE_MONTHLY = 3000
DEFAULT_DAILY_LIMIT = 95          # what we plan to: five under the provider's 100
DEFAULT_MONTHLY_LIMIT = RESEND_FREE_MONTHLY
DEFAULT_CODE_RESERVE = 20
IST = ZoneInfo("Asia/Kolkata")


def _int(env: Mapping[str, str], name: str, default: Optional[int]) -> Optional[int]:
    raw = (env.get(name) or "").strip()
    if not raw:
        return default
    try:
        return max(0, int(raw))
    except ValueError:
        return default


@dataclass(frozen=True)
class Counts:
    """Emails already sent, by kind, for the India day `today`."""
    today: date
    codes_today: int = 0
    codes_yesterday: int = 0
    codes_month: int = 0              # this calendar month, today included
    notify_today: int = 0
    notify_month: int = 0             # this calendar month, today included


@dataclass
class Plan:
    """How many notification emails may still go out today, and why."""
    room: Optional[int]               # None = no limit
    daily_limit: Optional[int]
    monthly_limit: Optional[int]
    code_reserve_today: int
    code_reserve_left: int
    future_code_reserve: int
    daily_room: Optional[int]
    monthly_room: Optional[int]
    cap_room: Optional[int]
    counts: Counts

    def explain(self) -> dict[str, Any]:
        c = self.counts
        return {
            "daily_limit": self.daily_limit, "monthly_limit": self.monthly_limit,
            "codes_today": c.codes_today, "notify_today": c.notify_today,
            "codes_month": c.codes_month, "notify_month": c.notify_month,
            "code_reserve_today": self.code_reserve_today, "code_reserve_left": self.code_reserve_left,
            "future_code_reserve": self.future_code_reserve,
            "daily_room": self.daily_room, "monthly_room": self.monthly_room, "cap_room": self.cap_room,
            "notify_room": self.room,
        }


def limits(env: Mapping[str, str] | None = None) -> tuple[Optional[int], Optional[int]]:
    """(daily, monthly) limits in force; None = no limit."""
    env = os.environ if env is None else env
    daily = _int(env, "RESEND_DAILY_LIMIT", DEFAULT_DAILY_LIMIT)
    monthly = _int(env, "RESEND_MONTHLY_LIMIT", None)
    if monthly is None:
        monthly = DEFAULT_MONTHLY_LIMIT if daily != 0 else 0
    return (daily or None), (monthly or None)


def plan(counts: Counts, env: Mapping[str, str] | None = None) -> Plan:
    env = os.environ if env is None else env
    daily, monthly = limits(env)
    floor = _int(env, "RESEND_CODE_RESERVE", DEFAULT_CODE_RESERVE) or 0
    reserve = max(floor, counts.codes_yesterday)
    reserve_left = max(0, reserve - counts.codes_today)

    daily_room = None
    if daily is not None:
        daily_room = max(0, daily - counts.codes_today - counts.notify_today - reserve_left)

    monthly_room = None
    future = 0
    if monthly is not None:
        days_in_month = calendar.monthrange(counts.today.year, counts.today.month)[1]
        days_after = days_in_month - counts.today.day
        per_day = max(floor, math.ceil(counts.codes_month / max(1, counts.today.day)))
        future = days_after * per_day
        monthly_room = max(0, monthly - counts.codes_month - counts.notify_month - reserve_left - future)

    cap = _int(env, "NOTIFY_DAILY_CAP", None)
    cap_room = None if cap is None else max(0, cap - counts.notify_today)

    rooms = [r for r in (daily_room, monthly_room, cap_room) if r is not None]
    return Plan(
        room=min(rooms) if rooms else None, daily_limit=daily, monthly_limit=monthly,
        code_reserve_today=reserve, code_reserve_left=reserve_left, future_code_reserve=future,
        daily_room=daily_room, monthly_room=monthly_room, cap_room=cap_room, counts=counts,
    )


# ── counting sign-in codes ──────────────────────────────────────────────────

def ist_day_bounds(day: date) -> tuple[datetime, datetime]:
    """[start, end) of an India calendar day, as aware UTC datetimes (UTC so
    SQLite, which compares stored text, agrees with Postgres)."""
    start = datetime.combine(day, time(0), tzinfo=IST).astimezone(timezone.utc)
    return start, start + timedelta(days=1)


async def _db_code_counts(today: date) -> tuple[int, int, int]:
    """(today, yesterday, this month) sign-in codes, from otp_challenges.

    Every row is one email Resend was asked to send (a failed send still
    leaves its row, used up: counting it errs on the safe side). No
    database (local runs, tests): (0, 0, 0)."""
    try:
        from api.db.database import SessionLocal, db_enabled
    except Exception:                                    # pragma: no cover - import guard
        return 0, 0, 0
    if not db_enabled() or SessionLocal is None:
        return 0, 0, 0
    from sqlalchemy import func, select
    from api.db.models import OtpChallenge

    t0, t1 = ist_day_bounds(today)
    y0, _ = ist_day_bounds(today - timedelta(days=1))
    m0, _ = ist_day_bounds(today.replace(day=1))

    def q(a: datetime, b: datetime):
        return select(func.count()).select_from(OtpChallenge).where(
            OtpChallenge.created_at >= a).where(OtpChallenge.created_at < b)

    async with SessionLocal() as db:
        today_n = int((await db.execute(q(t0, t1))).scalar_one())
        yest_n = int((await db.execute(q(y0, t0))).scalar_one())
        month_n = int((await db.execute(q(m0, t1))).scalar_one())
    return today_n, yest_n, month_n


# Tests swap this for a fixed answer.
code_counts_fn: Callable[[date], Awaitable[tuple[int, int, int]]] = _db_code_counts


async def gather(today: date, notify_store: Any) -> Counts:
    codes_today, codes_yesterday, codes_month = await code_counts_fn(today)
    notify_today = await notify_store.sent_on(today)
    notify_month = await notify_store.sent_between(today.replace(day=1), today)
    return Counts(today=today, codes_today=codes_today, codes_yesterday=codes_yesterday,
                  codes_month=codes_month, notify_today=notify_today, notify_month=notify_month)


# ── one run's budget ────────────────────────────────────────────────────────

@dataclass
class Budget:
    """Spends `room` during one scheduler run. `used` counts today's
    notification emails (before and during this run)."""
    allowance: Optional[int]          # room at the start of this run; None = no limit
    used: int = 0
    deferred: int = 0
    deferred_by: dict[str, int] = field(default_factory=dict)
    _spent: int = 0

    def take(self, kind: str = "") -> bool:
        if self.allowance is not None and self._spent >= self.allowance:
            self.deferred += 1
            if kind:
                self.deferred_by[kind] = self.deferred_by.get(kind, 0) + 1
            return False
        self._spent += 1
        self.used += 1
        return True

    def give_back(self) -> None:
        self._spent = max(0, self._spent - 1)
        self.used = max(0, self.used - 1)

    @property
    def left(self) -> Optional[int]:
        return None if self.allowance is None else max(0, self.allowance - self._spent)
