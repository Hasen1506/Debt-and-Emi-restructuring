"""Central-bank policy-rate history — RBI repo rate and Fed funds target.

Loan Check needs the rate *history*, not just today's value: whether a
floating-rate loan passed on a cut depends on what the benchmark did
between the loan's start and now. Each entry is (effective date, rate)
where the date is the policy announcement day; the rate holds until the
next entry.

Sources, re-checked 26 Sep 2026:
- RBI: monetary policy statements on rbi.org.in. Latest: 5.25% since the
  5 Dec 2025 cut, held at the Feb, Apr, Jun and Aug 2026 meetings
  (Aug 2026: SDF 5.00%, MSF 5.50%, repo at their midpoint).
- Fed: FOMC statements on federalreserve.gov. Latest: target range raised
  to 3.75–4.00% on 16 Sep 2026. We store the upper bound.

Phase 5 of ROADMAP.md replaces this hand-kept table with fetched data.
Until then, add each new decision here and bump LAST_VERIFIED.
"""
from bisect import bisect_right
from datetime import date
from decimal import Decimal
from typing import Optional

from engine.models import Country

D = Decimal

LAST_VERIFIED = date(2026, 9, 26)

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

_HISTORY = {Country.IN: REPO_RATE_IN, Country.US: FED_FUNDS_UPPER_US}


def history(country: Country) -> list[tuple[date, Decimal]]:
    return _HISTORY[country]


def earliest_date(country: Country) -> date:
    return _HISTORY[country][0][0]


def rate_on(country: Country, day: date) -> Optional[Decimal]:
    """Policy rate in force on `day`, or None before the table starts."""
    series = _HISTORY[country]
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
    out.extend(r for d, r in _HISTORY[country] if start < d <= end)
    return out


def changes_between(
    country: Country, start: date, end: date,
) -> list[tuple[date, Decimal, Decimal]]:
    """(date, old, new) for each change with start < date <= end."""
    series = _HISTORY[country]
    out = []
    for i, (d, r) in enumerate(series):
        if start < d <= end and i > 0:
            out.append((d, series[i - 1][1], r))
    return out
