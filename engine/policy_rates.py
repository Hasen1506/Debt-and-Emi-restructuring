"""Central-bank policy-rate history — RBI repo rate and Fed funds target.

Loan Check needs the rate *history*, not just today's value: whether a
floating-rate loan passed on a cut depends on what the benchmark did
between the loan's start and now. Each entry is (effective date, rate)
where the date is the policy announcement day; the rate holds until the
next entry.

Sources, re-checked 9 Oct 2026:
- RBI: monetary policy statements on rbi.org.in. Latest: raised 25 bps to
  5.50% on 7 Oct 2026 (MPC resolution, 5-7 Oct; SDF 5.25%, MSF 5.75%),
  after 5.25% from the 5 Dec 2025 cut through the Feb-Aug 2026 meetings.
- Fed: FOMC statements on federalreserve.gov. Latest: target range raised
  to 3.75–4.00% on 16 Sep 2026. We store the upper bound.

The tables below are the verified base. Decisions after them come from
the live feeds (api/rates_feed.py: FRED and the RBI website, every 6
hours) through `apply_live`, which only ever adds changes dated after the
table ends. When a feed is down the table plus the last good fetch is
used, and `rates_as_of` says how current that is. Add a decision here
by hand only to correct the record, and bump LAST_VERIFIED.
"""
from bisect import bisect_right
from datetime import date
from decimal import Decimal
from typing import Optional

from engine.models import Country

D = Decimal

LAST_VERIFIED = date(2026, 10, 9)

REPO_RATE_IN: list[tuple[date, Decimal]] = [
    (date(2018, 8, 1), D("0.0650")),
    (date(2019, 2, 7), D("0.0625")),
    (date(2019, 4, 4), D("0.0600")),
    (date(2019, 6, 6), D("0.0575")),
    (date(2019, 8, 7), D("0.0540")),
    (date(2019, 10, 4), D("0.0515")),
    (date(2020, 3, 27), D("0.0440")),
    (date(2020, 5, 22), D("0.0400")),
    (date(2022, 5, 4), D("0.0440")),
    (date(2022, 6, 8), D("0.0490")),
    (date(2022, 8, 5), D("0.0540")),
    (date(2022, 9, 30), D("0.0590")),
    (date(2022, 12, 7), D("0.0625")),
    (date(2023, 2, 8), D("0.0650")),
    (date(2025, 2, 7), D("0.0625")),
    (date(2025, 4, 9), D("0.0600")),
    (date(2025, 6, 6), D("0.0550")),
    (date(2025, 12, 5), D("0.0525")),
    (date(2026, 10, 7), D("0.0550")),
]

FED_FUNDS_UPPER_US: list[tuple[date, Decimal]] = [
    (date(2018, 12, 19), D("0.0250")),
    (date(2019, 7, 31), D("0.0225")),
    (date(2019, 9, 18), D("0.0200")),
    (date(2019, 10, 30), D("0.0175")),
    (date(2020, 3, 3), D("0.0125")),
    (date(2020, 3, 15), D("0.0025")),
    (date(2022, 3, 16), D("0.0050")),
    (date(2022, 5, 4), D("0.0100")),
    (date(2022, 6, 15), D("0.0175")),
    (date(2022, 7, 27), D("0.0250")),
    (date(2022, 9, 21), D("0.0325")),
    (date(2022, 11, 2), D("0.0400")),
    (date(2022, 12, 14), D("0.0450")),
    (date(2023, 2, 1), D("0.0475")),
    (date(2023, 3, 22), D("0.0500")),
    (date(2023, 5, 3), D("0.0525")),
    (date(2023, 7, 26), D("0.0550")),
    (date(2024, 9, 18), D("0.0500")),
    (date(2024, 11, 7), D("0.0475")),
    (date(2024, 12, 18), D("0.0450")),
    (date(2025, 9, 17), D("0.0425")),
    (date(2025, 10, 29), D("0.0400")),
    (date(2025, 12, 10), D("0.0375")),
    (date(2026, 9, 16), D("0.0400")),
]

_TABLE = {Country.IN: REPO_RATE_IN, Country.US: FED_FUNDS_UPPER_US}
# Largest move accepted from a feed in one decision. The biggest on record
# here is the Fed's 1-point cut of 15 Mar 2020; anything larger is a misread.
MAX_STEP = D("0.0100")
MAX_RATE = D("0.20")

# Filled by apply_live: changes after the table, and the day a feed last
# confirmed the rate. Replaced whole, never mutated, so readers need no lock.
_live: dict[Country, list[tuple[date, Decimal]]] = {}
_confirmed: dict[Country, date] = {}


class LiveRateError(ValueError):
    """A fetched change that would contradict or corrupt the history."""


def apply_live(country: Country, changes: list[tuple[date, Decimal]], confirmed_on: date) -> None:
    """Record decisions a feed found after the verified table ends.

    `changes` are (announcement date, rate), oldest first; entries on or
    before the table's last date are ignored (the table wins there).
    Raises LiveRateError, leaving the history unchanged, when the changes
    are out of order, implausible, or repeat the rate already in force.
    """
    table = _TABLE[country]
    table_end = table[-1][0]
    last_day, prev = table[-1]
    new: list[tuple[date, Decimal]] = []
    for day, rate in changes:
        if day <= table_end:
            continue
        if day <= last_day:
            raise LiveRateError(f"{country.value} changes out of order at {day}")
        if not (D("0") <= rate <= MAX_RATE):
            raise LiveRateError(f"{country.value} rate {rate} on {day} is out of range")
        if abs(rate - prev) > MAX_STEP:
            raise LiveRateError(f"{country.value} rate jumps from {prev} to {rate} on {day}")
        if rate == prev:
            raise LiveRateError(f"{country.value} change on {day} repeats {rate}")
        new.append((day, rate))
        last_day, prev = day, rate
    if confirmed_on < last_day:
        raise LiveRateError(f"{country.value} confirmed on {confirmed_on}, before its last change")
    _live[country] = new
    _confirmed[country] = confirmed_on


def clear_live() -> None:
    """Forget fetched data (tests, or a feed found to be wrong)."""
    _live.clear()
    _confirmed.clear()


def rates_as_of(country: Country) -> date:
    """The day the history was last known to be complete."""
    return max(LAST_VERIFIED, _confirmed.get(country, LAST_VERIFIED))


def history(country: Country) -> list[tuple[date, Decimal]]:
    return _TABLE[country] + _live.get(country, [])


def earliest_date(country: Country) -> date:
    return _TABLE[country][0][0]


def rate_on(country: Country, day: date) -> Optional[Decimal]:
    """Policy rate in force on `day`, or None before the table starts."""
    series = history(country)
    i = bisect_right([d for d, _ in series], day)
    return series[i - 1][1] if i else None


def rates_between(country: Country, start: date, end: date) -> list[Decimal]:
    """Every rate in force at some point in [start, end] (inclusive)."""
    if end < start:
        start, end = end, start
    out = []
    first = rate_on(country, start)
    if first is not None:
        out.append(first)
    out.extend(r for d, r in history(country) if start < d <= end)
    return out


def changes_between(
    country: Country, start: date, end: date,
) -> list[tuple[date, Decimal, Decimal]]:
    """(date, old, new) for each change with start < date <= end."""
    series = history(country)
    out = []
    for i, (d, r) in enumerate(series):
        if start < d <= end and i > 0:
            out.append((d, series[i - 1][1], r))
    return out
