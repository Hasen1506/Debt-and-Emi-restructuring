"""D30 / D60 return: is the payday loop working? (grill #2: "Measure D30 and
D60 return before building anything else.")

Counted only over people who turned the payday email on, from events the
server already sees: the email going out, a tap on "All paid" / "Paid some"
/ "Can't pay", a "done" reply, and the app refreshing its payment list (it
does that whenever the user opens Home signed in). Nothing else is tracked.

A user "returned at D30" when they did something (not just received an
email) on day 30 to 59 after they opted in; "at D60" on day 60 to 89. Users
who opted in fewer than 30 (60) days ago are not in that denominator yet.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from typing import Iterable, Optional

ACTIVE_KINDS = {"ack_all", "ack_some", "ack_cant", "reply_done", "reply_not", "snapshot"}


@dataclass(frozen=True)
class Event:
    user: str
    kind: str
    day: date


@dataclass(frozen=True)
class ReturnRate:
    window: str             # "D30" | "D60"
    eligible: int
    returned: int

    @property
    def share(self) -> Optional[float]:
        return None if self.eligible == 0 else self.returned / self.eligible


def return_rates(opted_in: dict[str, date], events: Iterable[Event], today: date) -> list[ReturnRate]:
    by_user: dict[str, list[date]] = {}
    for e in events:
        if e.kind in ACTIVE_KINDS and e.user in opted_in:
            by_user.setdefault(e.user, []).append(e.day)
    out = []
    for name, lo, hi in (("D30", 30, 59), ("D60", 60, 89)):
        eligible = [u for u, start in opted_in.items() if (today - start).days >= lo]
        returned = sum(
            1 for u in eligible
            if any(lo <= (d - opted_in[u]).days <= hi for d in by_user.get(u, []))
        )
        out.append(ReturnRate(name, len(eligible), returned))
    return out
