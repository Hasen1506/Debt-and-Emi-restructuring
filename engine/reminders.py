"""Reminders for the dates that matter after a letter goes out (grill #70a).

"Who does the follow-ups?" Nobody, unless something reminds the borrower.
Loan Check's complaint tracker (engine/complaint_deadlines.py) and the
loan-closure letter (engine/closure_letter.py) both produce dated
milestones. This module turns those into reminders: a week before, the
day before and on the day of each date the borrower has to act by, and the
day after a date the *lender* had to act by (that is when the borrower's
next step opens).

The reminders go out by email when the notification flag is on (api/notify)
and can always be added to the user's own calendar as an .ics file
(web/src/lib/ics.ts) with no server at all.

Pure functions; dates only (no times, no time zones: a reminder is "on 3
November", sent the morning of that day in the user's time zone).
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import date, timedelta
from typing import Iterable, Optional

# Keys are the milestone keys engine/complaint_deadlines.py and
# engine/closure_letter.py already emit.
# Dates the *borrower* must act by: remind a week before, the day before
# and on the day.
BORROWER_DEADLINES = {
    "ombudsman_deadline",     # India: last day to file with the RBI Ombudsman
    "notice_by",              # US FCBA: the issuer must receive the notice by
}
# Dates the *lender* must act by: remind the day after, when the
# borrower's next step opens if nothing came.
LENDER_DEADLINES = {
    "reply", "io_decision",                 # India: bank reply / IO decision
    "ack", "response", "response_ext", "resolve",   # US RESPA / FCBA
    "documents_by", "card_closed_by", "gold_back_by",  # closure letter
}
# A door that opens on a day: remind on the day only.
OPENS_ON = {"ombudsman_opens", "compensation_from", "card_penalty_from"}
BEFORE_DAYS = (7, 1, 0)
MAX_ITEMS = 40


@dataclass(frozen=True)
class Item:
    key: str
    label: str
    day: date
    source: str = "complaint"     # complaint | closure
    done: bool = False


@dataclass(frozen=True)
class Reminder:
    send_on: date
    key: str
    label: str
    day: date
    source: str
    lead: int                     # days before the date; -1 = the day after
    text: str


def _long(d: date) -> str:
    return f"{d.day} {d:%B %Y}"


def _text(it: Item, lead: int) -> str:
    when = _long(it.day)
    if lead == -1:
        return (f"{it.label} was {when}. If nothing has come from the lender, the next step is open now: "
                "open RightDue to see it.")
    if lead == 0 and it.key in OPENS_ON:
        return f"{it.label} {when}, today. Open RightDue for the next step."
    if lead == 0:
        return f"Today, {when}: {it.label}."
    if lead == 1:
        return f"Tomorrow, {when}: {it.label}."
    return f"In {lead} days, on {when}: {it.label}."


def schedule(items: Iterable[Item], *, today: date) -> list[Reminder]:
    """Every reminder still to come (send_on >= today), in date order.

    Done items and dates already past get none. Unknown keys are treated
    as borrower deadlines (remind before), which errs towards reminding.
    """
    out: list[Reminder] = []
    for it in list(items)[:MAX_ITEMS]:
        if it.done:
            continue
        if it.key in LENDER_DEADLINES:
            leads: tuple[int, ...] = (-1,)
        elif it.key in OPENS_ON:
            leads = (0,)
        else:
            leads = BEFORE_DAYS
        for lead in leads:
            send_on = it.day + timedelta(days=1) if lead == -1 else it.day - timedelta(days=lead)
            if send_on < today:
                continue
            out.append(Reminder(send_on, it.key, it.label, it.day, it.source, lead, _text(it, lead)))
    out.sort(key=lambda r: (r.send_on, r.day, r.key))
    return out


def due_on(reminders: Iterable[Reminder], day: date) -> list[Reminder]:
    return [r for r in reminders if r.send_on == day]


def from_milestones(milestones: Iterable[dict], source: str = "complaint") -> list[Item]:
    """Read the timeline milestones the API already returns
    ({key, label, day: 'YYYY-MM-DD', state}). 'done' and 'missed' states
    need no reminder."""
    items = []
    for m in milestones:
        try:
            d = date.fromisoformat(str(m["day"]))
        except (KeyError, ValueError):
            continue
        key = str(m.get("key", ""))[:40]
        label = " ".join(str(m.get("label", "")).split())[:120]
        if not key or not label:
            continue
        items.append(Item(key, label, d, source, done=m.get("state") in ("done", "missed")))
    return items


def next_reminder(reminders: Iterable[Reminder]) -> Optional[Reminder]:
    rs = list(reminders)
    return rs[0] if rs else None
