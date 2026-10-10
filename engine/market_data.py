"""Readers for the market figures the app quotes: safe yields and inflation forecasts.

scripts/refresh_market_data.py fetches the pages and writes
web/src/lib/market-data.json; this module only reads text. Every reader
returns None when the page doesn't say what it is looking for, and every
figure is checked against a plausible band, so a redesigned page fails
loudly instead of feeding the app a wrong number.

Sources, all official or the bank's own page:

- RBI home page: cut-off yields at the last 91- and 364-day T-bill auctions,
  and the policy repo rate (to cross-check engine/policy_rates.py).
- US Treasury: daily par yield curve CSV, the 1-year yield.
- RBI MPC resolution: the CPI inflation projection for the financial year.
- Federal Reserve Summary of Economic Projections: median PCE inflation.
- SBI and HDFC Bank fixed-deposit pages: the 1-year rate for the public.
- FRED MORTGAGE30US: Freddie Mac's weekly 30-year fixed average (PMMS),
  to tell when the US mortgage rate cards have drifted.
"""
from __future__ import annotations

import csv
import html
import io
import json
import re
from datetime import date, datetime
from decimal import Decimal, InvalidOperation
from functools import lru_cache
from pathlib import Path
from typing import Optional

D = Decimal

# The one copy of the figures, shipped with the web app and read here too
# (the API deploys the whole repository).
SNAPSHOT = Path(__file__).resolve().parent.parent / "web" / "src" / "lib" / "market-data.json"


@lru_cache(maxsize=1)
def snapshot() -> dict:
    return json.loads(SNAPSHOT.read_text(encoding="utf-8"))


def safe_rate(key: str) -> Decimal:
    """Today's quoted yield for a safe vehicle in market-data.json ("fd_in", "hysa_us", ...)."""
    return D(snapshot()["safe"][key]["rate"])


def approx_pct(rate: Decimal) -> str:
    """"~5.6%" for 0.0557."""
    return f"~{(rate * 100).quantize(D('0.1'))}%"

RBI_HOME = "https://www.rbi.org.in/"
TREASURY_CSV = (
    "https://home.treasury.gov/resource-center/data-chart-center/interest-rates/"
    "daily-treasury-rates.csv/{year}/all?type=daily_treasury_yield_curve"
    "&field_tdr_date_value={year}&page&_format=csv"
)
FOMC_CALENDAR = "https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm"
FOMC_SEP = "https://www.federalreserve.gov/monetarypolicy/{page}"
SBI_FD = "https://sbi.co.in/web/interest-rates/deposit-rates/retail-domestic-term-deposits"
HDFC_FD = "https://www.hdfcbank.com/personal/save/deposits/fixed-deposit-interest-rate"
FRED_PMMS = "https://fred.stlouisfed.org/graph/fredgraph.csv?id=MORTGAGE30US"

# Bands a reading must fall in, as fractions. Wide enough for any year this
# century, narrow enough to catch a misread (a date, a tenor, a page count).
BANDS = {
    "tbill": (D("0.01"), D("0.15")),
    "treasury": (D("0"), D("0.15")),
    "cpi": (D("-0.02"), D("0.15")),
    "fd": (D("0.02"), D("0.12")),
    "repo": (D("0.02"), D("0.12")),
    "pmms": (D("0.02"), D("0.15")),
}

_MONTHS = {m: i for i, m in enumerate(
    ["january", "february", "march", "april", "may", "june", "july",
     "august", "september", "october", "november", "december"], start=1)}


def page_text(page: str) -> str:
    """Visible text of an HTML page, whitespace collapsed."""
    page = re.sub(r"(?is)<(script|style)\b.*?</\1>", " ", page)
    text = html.unescape(re.sub(r"<[^>]+>", " ", page))
    # Some pages carry a table a second time as escaped HTML in their text.
    text = html.unescape(re.sub(r"</?[A-Za-z][^<>]*>", " ", text))
    return re.sub(r"\s+", " ", text.replace("\u200b", ""))


def _pct(s: str) -> Optional[Decimal]:
    try:
        return D(s) / 100
    except InvalidOperation:
        return None


def in_band(kind: str, value: Optional[Decimal]) -> Optional[Decimal]:
    lo, hi = BANDS[kind]
    return value if value is not None and lo <= value <= hi else None


def _long_date(s: str) -> Optional[date]:
    m = re.match(r"([A-Za-z]+)\s+(\d{1,2}),\s*(\d{4})", s.strip())
    if not m or m.group(1).lower() not in _MONTHS:
        return None
    return date(int(m.group(3)), _MONTHS[m.group(1).lower()], int(m.group(2)))


# ── India ──────────────────────────────────────────────────────────────────

def rbi_tbills(page: str) -> Optional[dict]:
    """Cut-off yields at the last T-bill auctions on the RBI home page.

    The page prints "91 day T-bills : 5.5747%* 182 day T-bills : ...
    364 day T-bills : 6.2869%* * cut-off at the last auction # as on
    October 08, 2026".
    """
    text = page_text(page)
    out: dict = {}
    for days in ("91", "182", "364"):
        m = re.search(days + r"\s*day T-bills?\s*:\s*(\d{1,2}\.\d{1,4})\s*%", text, re.I)
        value = in_band("tbill", _pct(m.group(1))) if m else None
        if value is None:
            return None
        out[days] = value
    m = re.search(r"364\s*day T-bills?.{0,120}?as on\s+([A-Za-z]+\s+\d{1,2},\s*\d{4})", text, re.I)
    out["as_of"] = _long_date(m.group(1)) if m else None
    return out if out["as_of"] else None


def rbi_repo(page: str) -> Optional[Decimal]:
    m = re.search(r"Policy Repo Rate\s*:\s*(\d{1,2}(?:\.\d{1,2})?)\s*%", page_text(page), re.I)
    return in_band("repo", _pct(m.group(1))) if m else None


def rbi_mpc_link(page: str) -> Optional[str]:
    """Link to the latest MPC resolution on the RBI home page."""
    m = re.search(
        r'href="([^"]*BS_PressReleaseDisplay\.aspx\?prid=\d+)"[^>]*>[^<]*Resolution of the Monetary Policy Committee',
        page, re.I)
    if not m:
        return None
    url = html.unescape(m.group(1))
    return url if url.startswith("http") else "https://www.rbi.org.in/" + url.lstrip("./")


def rbi_cpi_projection(page: str) -> Optional[dict]:
    """"CPI inflation is projected (to be|at) 5.2 per cent for 2026-27"."""
    text = page_text(page)
    m = re.search(
        r"CPI inflation (?:for (\d{4}-\d{2}) )?is (?:now )?projected (?:to be |at )(-?\d{1,2}(?:\.\d)?) per cent"
        r"(?: for (\d{4}-\d{2}))?", text, re.I)
    if not m:
        return None
    year = m.group(1) or m.group(3)
    value = in_band("cpi", _pct(m.group(2)))
    if not year or value is None:
        return None
    # Dated by the last day of the meeting: "Monetary Policy Committee
    # October 5 to 7, 2026".
    meeting = re.search(r"Monetary Policy Committee\s+([A-Za-z]+)\s+\d{1,2}\s*(?:to|-|–)\s*(\d{1,2}),\s*(\d{4})", text)
    decided = _long_date(f"{meeting.group(1)} {meeting.group(2)}, {meeting.group(3)}") if meeting else None
    return {"rate": value, "year": year, "as_of": decided}


def _fd_ok(v: Optional[Decimal]) -> Optional[Decimal]:
    return in_band("fd", v)


def sbi_fd_1y(page: str) -> Optional[Decimal]:
    """SBI's card rate for the public on "1 year to less than 2 years".

    The table lists existing and revised rates for the public, then for
    senior citizens; the second figure is the public's current rate.
    """
    m = re.search(r"1 year to less than 2 years\s+(\d{1,2}\.\d{1,2})\s+(\d{1,2}\.\d{1,2})", page_text(page), re.I)
    return _fd_ok(_pct(m.group(2))) if m else None


def hdfc_fd_1y(page: str) -> Optional[Decimal]:
    """HDFC Bank's rate for the public on "1 Year to < 15 months" (under ₹3 crore)."""
    m = re.search(r"1 Year to < 15 months\s+(\d{1,2}\.\d{1,2})\s*%", page_text(page), re.I)
    return _fd_ok(_pct(m.group(1))) if m else None


# ── USA ────────────────────────────────────────────────────────────────────

def treasury_1y(csv_text: str) -> Optional[dict]:
    """Latest 1-year par yield from the Treasury's daily yield-curve CSV."""
    rows = list(csv.DictReader(io.StringIO(csv_text)))
    best = None
    for row in rows:
        try:
            day = datetime.strptime(row["Date"], "%m/%d/%Y").date()
        except (KeyError, ValueError):
            continue
        value = in_band("treasury", _pct((row.get("1 Yr") or "").strip()))
        if value is not None and (best is None or day > best[0]):
            best = (day, value)
    return {"rate": best[1], "as_of": best[0]} if best else None


def fomc_sep_page(calendar: str) -> Optional[str]:
    """File name of the latest projection table, e.g. fomcprojtabl20260916.htm."""
    pages = sorted(set(re.findall(r"fomcprojtabl(\d{8})\.htm", calendar)))
    return f"fomcprojtabl{pages[-1]}.htm" if pages else None


def fed_pce_median(page: str, sep_date: date) -> Optional[dict]:
    """Median PCE inflation for the year after the projection's year.

    The table reads "Median 1 Central Tendency 2 Range 3 2026 2027 2028
    2029 Longer run ... PCE inflation 3.7 2.3 2.1 2.0 2.0 ..." with the
    medians first.
    """
    text = page_text(page)
    head = re.search(r"Median\b.{0,60}?\s((?:(?:19|20)\d{2}\s+){2,5})Longer run", text)
    row = re.search(r"(?<!Core )PCE inflation\s+((?:-?\d\.\d\s+){3,6})", text)
    if not head or not row:
        return None
    years = [int(y) for y in head.group(1).split()]
    values = row.group(1).split()
    target = sep_date.year + 1
    if target not in years or len(values) <= years.index(target):
        return None
    value = in_band("cpi", _pct(values[years.index(target)]))
    return {"rate": value, "year": target, "as_of": sep_date} if value is not None else None


def fred_latest(csv_text: str, kind: str) -> Optional[dict]:
    """Latest value in a one-series FRED CSV (date, value in percent)."""
    best = None
    for row in csv.reader(io.StringIO(csv_text)):
        if len(row) < 2:
            continue
        try:
            day = date.fromisoformat(row[0])
        except ValueError:
            continue
        value = in_band(kind, _pct(row[1].strip()))
        if value is not None and (best is None or day > best[0]):
            best = (day, value)
    return {"rate": best[1], "as_of": best[0]} if best else None
