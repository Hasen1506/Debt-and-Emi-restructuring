"""The order notification emails go out in when the shared budget is short
(api/notify/budget.py), and which reminders roll over to the next run.

Fair order, founder decision 15 Oct 2026:
  1. deadline reminders (a missed Ombudsman or FCBA date loses a right),
  2. then payday and rate-move emails,
  oldest due first within each class; ties by user id so two runs agree.

A reminder that couldn't go out on its day stays due for ROLLOVER_DAYS, as
long as its date is still ahead (for a "before the date" reminder) or the
step it opens is still recent (the day after a lender's date). When several
of one date's reminders are waiting (say the 7-day and the 1-day one), only
the latest is sent, worded for the day it actually goes out ("Tomorrow"),
and all of them are marked sent. Payday emails roll over for the late-send
grace in engine/payday.py; rate-move emails for RATE_MOVE_SEND_WINDOW_DAYS.
"""
from __future__ import annotations

from dataclasses import dataclass, field, replace
from datetime import date, timedelta
from typing import Any, Iterable

from engine import reminders

ROLLOVER_DAYS = 7

CLASS_DEADLINE = 0
CLASS_OTHER = 1


@dataclass(order=True)
class Candidate:
    klass: int
    due_since: date
    user_id: str
    kind: str = field(compare=True)               # "reminders" | "payday" | "rate_move"
    payload: Any = field(default=None, compare=False)


def order(cands: Iterable[Candidate]) -> list[Candidate]:
    return sorted(cands)


def _key(r: reminders.Reminder) -> str:
    return f"{r.key}|{r.send_on.isoformat()}"


@dataclass(frozen=True)
class DueReminder:
    reminder: reminders.Reminder        # worded for today
    sent_keys: tuple[str, ...]          # every waiting key this one covers
    due_since: date                     # the oldest waiting send day


def due_reminders(items: Iterable[reminders.Item], today: date, sent: Iterable[str]) -> list[DueReminder]:
    """Reminders to send today: today's, plus any from the last
    ROLLOVER_DAYS that were not sent and still make sense."""
    sent_set = set(sent)
    since = today - timedelta(days=ROLLOVER_DAYS)
    waiting = [r for r in reminders.schedule(items, today=since)
               if r.send_on <= today and _key(r) not in sent_set]
    groups: dict[tuple[str, date, str], list[reminders.Reminder]] = {}
    for r in waiting:
        if r.lead >= 0 and r.day < today:
            continue                     # the date itself has passed: a "before" reminder is pointless now
        groups.setdefault((r.key, r.day, r.label), []).append(r)
    out: list[DueReminder] = []
    for rs in groups.values():
        rs.sort(key=lambda r: r.send_on)
        latest = rs[-1]
        if latest.send_on < today and latest.lead >= 0:
            lead = (latest.day - today).days
            item = reminders.Item(latest.key, latest.label, latest.day, latest.source)
            latest = replace(latest, lead=lead, text=reminders._text(item, lead))
        out.append(DueReminder(latest, tuple(_key(r) for r in rs), rs[0].send_on))
    out.sort(key=lambda d: (d.due_since, d.reminder.day, d.reminder.key))
    return out
