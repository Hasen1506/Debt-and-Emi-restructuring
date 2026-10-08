"""What banks actually lent at last quarter, from their own websites (roadmap PR G).

RBI requires every scheduled commercial bank to publish "the interest rate
range of contracted loans for the past quarter for different categories of
advances granted to individual borrowers along with mean interest rates for
such loans", and the APR:
    RBI/2014-15/422, DBR.Leg.No.BC.64/09.07.005/2014-15, "Display of
    information by banks", January 22, 2015, para 2(a).
    https://www.rbi.org.in/Scripts/NotificationUser.aspx?Id=9508&Mode=0
(Its para 2(b), the old key fact sheet, was replaced by the KFS circular of
15 Apr 2024; para 2(a) still stands.)

Unlike a headline "from 9.99%" rate, these are the rates borrowers were
really charged. This module holds one parser per lender for that page. Each
parser reads the bank's own table and returns rows with the minimum, maximum
and mean, the quarter, and (where the bank publishes it) the APR. Every row
is checked (min ≤ mean ≤ max, all between 3% and 60%, the quarter known);
a row that fails is dropped with its reason, and a page that can't be read
gives no rows. **No number here is ever typed in by hand**: the committed
data file (data/rate_disclosures/<date>.json) is the output of
scripts/fetch_rate_disclosures.py, run by .github/workflows/rate-disclosures.yml.

Pages and their parsers were checked against the live pages on 2026-10-08;
saved copies (trimmed) are the test fixtures, so CI never goes online.
"""
from __future__ import annotations

import html as _html
import re
from dataclasses import dataclass, field
from datetime import date, timedelta
from decimal import Decimal, InvalidOperation
from html.parser import HTMLParser
from typing import Callable, Optional

D = Decimal

RULE = "RBI/2014-15/422, DBR.Leg.No.BC.64/09.07.005/2014-15, 22 Jan 2015, para 2(a)"
RULE_URL = "https://www.rbi.org.in/Scripts/NotificationUser.aspx?Id=9508&Mode=0"

LOW, HIGH = D("0.03"), D("0.60")
_MON = {m: i for i, m in enumerate(
    ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"], 1)}


# "Apr 2026 to Jun 2026", "April 2026 to June 2026", "Apr'26 - Jun'26"
_SPAN = r"([A-Za-z]{3,9}\.?\s*'?\s*\d{2,4}\s*(?:to|-)\s*[A-Za-z]{3,9}\.?\s*'?\s*\d{2,4})"


class PageChanged(ValueError):
    """The page no longer has the table this parser knows."""


@dataclass
class Row:
    label: str                          # the bank's own product name
    category: Optional[str]             # the app's loan type, or None
    min: Optional[Decimal]
    max: Optional[Decimal]
    mean: Optional[Decimal]
    period_start: date
    period_end: date
    mean_kind: str = "mean"             # "mean" | "weighted average" | "average"
    apr_min: Optional[Decimal] = None
    apr_max: Optional[Decimal] = None
    apr_mean: Optional[Decimal] = None


@dataclass
class Parsed:
    rows: list[Row] = field(default_factory=list)
    rejected: list[dict] = field(default_factory=list)


# ─────────────────────────────────────────────────────────────────────────────
# HTML helpers (stdlib only)
# ─────────────────────────────────────────────────────────────────────────────

class _Tables(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.tables: list[list[list[str]]] = []
        self._stack: list[list[list[str]]] = []
        self._cell: Optional[list[str]] = None
        self._skip = 0

    def handle_starttag(self, tag, attrs):
        if tag in ("script", "style"):
            self._skip += 1
        elif tag == "table":
            self._stack.append([])
        elif tag == "tr" and self._stack:
            self._stack[-1].append([])
        elif tag in ("td", "th") and self._stack:
            if not self._stack[-1]:
                self._stack[-1].append([])
            self._cell = []
        elif tag == "br" and self._cell is not None:
            self._cell.append(" ")

    def handle_endtag(self, tag):
        if tag in ("script", "style"):
            self._skip = max(0, self._skip - 1)
        elif tag in ("td", "th") and self._cell is not None and self._stack:
            self._stack[-1][-1].append(re.sub(r"\s+", " ", "".join(self._cell)).strip())
            self._cell = None
        elif tag == "table" and self._stack:
            self.tables.append([r for r in self._stack.pop() if r])

    def handle_data(self, data):
        if self._cell is not None and not self._skip:
            self._cell.append(data)


def tables(page: str) -> list[list[list[str]]]:
    p = _Tables()
    p.feed(page)
    return p.tables


def text(page: str) -> str:
    t = re.sub(r"(?is)<(script|style)\b.*?</\1>", " ", page)
    t = _html.unescape(re.sub(r"<[^>]+>", " ", t))
    return re.sub(r"\s+", " ", t)


def pct(cell: str) -> Optional[Decimal]:
    """'9.97%', '16.50% per annum', '12.2' (a table headed "(%)") → 0.0997 ..."""
    m = re.search(r"(\d+(?:\.\d+)?)", cell or "")
    if not m:
        return None
    try:
        return D(m.group(1)) / D("100")
    except InvalidOperation:
        return None


# ─────────────────────────────────────────────────────────────────────────────
# Quarters (Indian financial year: Q1 = Apr-Jun)
# ─────────────────────────────────────────────────────────────────────────────

def _month_end(y: int, m: int) -> date:
    first_of_next = date(y + 1, 1, 1) if m == 12 else date(y, m + 1, 1)
    return first_of_next - timedelta(days=1)


def fy_quarter(q: int, fy_start_year: int) -> tuple[date, date]:
    start_month = {1: 4, 2: 7, 3: 10, 4: 1}[q]
    y = fy_start_year if q != 4 else fy_start_year + 1
    return date(y, start_month, 1), _month_end(y, start_month + 2)


def _year(s: str) -> int:
    y = int(s)
    return y + 2000 if y < 100 else y


def period(s: str) -> Optional[tuple[date, date]]:
    """A quarter from the bank's own words. Only whole quarters are accepted."""
    s = s.replace("\u2019", "'").replace("\u2013", "-")
    mon = r"(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?"
    # "Apr 2026 to Jun 2026", "April 2026 to June 2026", "Apr'26 - Jun'26"
    m = re.search(mon + r"\s*'?\s*(\d{2,4})\s*(?:to|-|–)\s*" + mon + r"\s*'?\s*(\d{2,4})", s, re.I)
    if m:
        a = date(_year(m.group(2)), _MON[m.group(1).lower()[:3]], 1)
        b_m, b_y = _MON[m.group(3).lower()[:3]], _year(m.group(4))
        if (b_y * 12 + b_m) - (a.year * 12 + a.month) == 2:
            return a, _month_end(b_y, b_m)
        return None
    # "quarter ended June 30th, 2026", "Quarter ended on June-2026"
    m = re.search(r"quarter\s+ended\s+(?:on\s+)?" + mon + r"[\s\-]*(?:\d{1,2}(?:st|nd|rd|th)?,?\s*)?(\d{4})", s, re.I)
    if m:
        em, ey = _MON[m.group(1).lower()[:3]], int(m.group(2))
        if em in (3, 6, 9, 12):
            sm = em - 2
            return date(ey, sm, 1), _month_end(ey, em)
        return None
    # "Q1 FY 2026-27", "Q1 FY 26-27", "q1-fy-26-27", "Q1 (2026-27)"
    m = re.search(r"q\s*-?([1-4])\s*[-\s(]*(?:fy\s*[-:]?\s*)?(\d{2,4})\s*-\s*(\d{2})\b", s, re.I)
    if m:
        return fy_quarter(int(m.group(1)), _year(m.group(2)))
    return None


def period_label(a: date, b: date) -> str:
    q = {4: 1, 7: 2, 10: 3, 1: 4}.get(a.month)
    fy = a.year if a.month >= 4 else a.year - 1
    span = f"{a.strftime('%b')}-{b.strftime('%b %Y')}"
    return f"{span} (Q{q} FY {fy}-{str(fy + 1)[2:]})" if q else span


# ─────────────────────────────────────────────────────────────────────────────
# Categories
# ─────────────────────────────────────────────────────────────────────────────

def category(label: str) -> Optional[str]:
    """The app's loan type for a bank's product name, or None when it is a
    product the app doesn't model (LAP, business, used car, two-wheeler ...)."""
    s = label.lower()
    if re.search(r"against property|lap\b|business|commercial|construction|inventory|micro|msme|agri|crop|"
                 r"securities|consumer durable|cross-sell|used|two wheeler|tfe|\bdf\b|\bilg\b|\bbbg\b|"
                 r"credit card|top.?up|over ?draft|mfi", s):
        return None
    if re.search(r"\bgold\b|\bgln\b", s):
        return "gold_loan"
    if re.search(r"hous|home", s):
        return "home_loan"
    if re.search(r"new car|car loan|auto", s):
        return "auto_loan"
    if re.search(r"educat", s):
        return "education_loan"
    if re.search(r"personal", s):
        return "personal_loan"
    return None


# ─────────────────────────────────────────────────────────────────────────────
# Lenders
# ─────────────────────────────────────────────────────────────────────────────

def _need(cond: bool, what: str) -> None:
    if not cond:
        raise PageChanged(what)


def _find_table(page: str, *must: str) -> list[list[str]]:
    for t in tables(page):
        flat = " | ".join(" | ".join(r) for r in t[:6]).lower()
        if all(m.lower() in flat for m in must):
            return t
    raise PageChanged(f"no table with {must}")


def parse_hdfc(page: str, url: str = "") -> list[Row]:
    """HDFC Bank, personal loan: "Rate Offered To The Customer During The
    Period Apr 2026 to Jun 2026" with Min/Max/Avg IRR, then the APR table."""
    t = text(page)
    m = re.search(r"Rate Offered To The Customer During The Period\s+" + _SPAN, t, re.I)
    _need(m is not None, "HDFC period line")
    per = period(m.group(1))
    _need(per is not None, "HDFC period")
    irr = _find_table(page, "min irr", "max irr", "avg irr")
    vals = {r[0].strip().lower(): pct(r[1]) for r in irr if len(r) >= 2}
    try:
        apr = _find_table(page, "min apr", "max apr", "avg apr")
        avals = {r[0].strip().lower(): pct(r[1]) for r in apr if len(r) >= 2}
    except PageChanged:
        avals = {}
    return [Row("Personal Loan", "personal_loan", vals.get("min irr"), vals.get("max irr"), vals.get("avg irr"),
                per[0], per[1], "average",
                avals.get("min apr"), avals.get("max apr"), avals.get("avg apr"))]


def parse_icici_pl(page: str, url: str = "") -> list[Row]:
    """ICICI Bank, personal loan: "Interest Rate Range for Personal Loans for
    period April 2026 to June 2026", columns Maximum | Minimum | Mean."""
    t = text(page)
    m = re.search(r"Interest Rate Range for Personal Loans for period\s+" + _SPAN, t, re.I)
    _need(m is not None, "ICICI period line")
    per = period(m.group(1))
    _need(per is not None, "ICICI period")
    tab = _find_table(page, "maximum", "minimum", "mean")
    head = [c.lower() for c in tab[0]]
    ix = {k: next(i for i, c in enumerate(head) if c.startswith(k)) for k in ("minimum", "maximum", "mean")}
    out = []
    for r in tab[1:]:
        if len(r) == len(head) and re.search(r"[A-Za-z]", r[0]):
            out.append(Row(r[0], category(r[0]), pct(r[ix["minimum"]]), pct(r[ix["maximum"]]),
                           pct(r[ix["mean"]]), per[0], per[1]))
    return out


def parse_icici_car(page: str, url: str = "") -> list[Row]:
    """ICICI Bank, car loans: "Quarter ended on June-2026", Minimum | Maximum | Mean."""
    tab = _find_table(page, "quarter ended", "minimum", "maximum", "mean")
    per = period(" ".join(tab[0]))
    _need(per is not None, "ICICI car period")
    hi = next(i for i, r in enumerate(tab) if any(c.lower() == "minimum" for c in r))
    head = [c.lower() for c in tab[hi]]
    ix = {k: head.index(k) for k in ("minimum", "maximum", "mean")}
    out = []
    for r in tab[hi + 1:]:
        if len(r) == len(head):
            out.append(Row(r[0], category(r[0]), pct(r[ix["minimum"]]), pct(r[ix["maximum"]]),
                           pct(r[ix["mean"]]), per[0], per[1]))
    return out


def parse_axis(page: str, url: str = "") -> list[Row]:
    """Axis Bank, personal loan: "Rate of Interest disbursed Apr'26 - Jun'26"
    (Min ROI | Max ROI) then "Mean Rate"."""
    tab = _find_table(page, "rate of interest disbursed", "mean rate", "min roi", "max roi")
    head = " ".join(" ".join(r) for r in tab[:2])
    m = re.search(r"disbursed\s+" + _SPAN, head.replace("\u2019", "'"), re.I)
    _need(m is not None, "Axis period")
    per = period(m.group(1))
    _need(per is not None, "Axis period")
    _need(re.search(r"min roi.*max roi", head, re.I) is not None, "Axis column order")
    out = []
    for r in tab[2:]:
        if len(r) == 4:
            out.append(Row(r[0], category(r[0]), pct(r[1]), pct(r[2]), pct(r[3]), per[0], per[1]))
    return out


def parse_kotak(page: str, url: str = "") -> list[Row]:
    """Kotak Mahindra Bank: "Interest rate range of contracted Consumer loans
    for the quarter ended June 30th, 2026 ..." (Minimum (%) | Maximum (%) |
    Mean (%)), and the same for commercial loans to individuals."""
    t = text(page)
    out: list[Row] = []
    for t_ in tables(page):
        if len(t_) < 3:
            continue
        sub = [c.lower() for c in t_[1]]
        if not (len(sub) == 3 and sub[0].startswith("minimum") and sub[1].startswith("maximum")
                and sub[2].startswith("mean")):
            continue
        head = " ".join(t_[0]).lower()
        if "contracted" not in head:
            continue
        kind = "Consumer" if "range of contracted" in head else "Commercial"
        m = re.search(r"Interest rate range of contracted " + kind + r" Loans for the (quarter ended [A-Za-z]+ \d{1,2}"
                      r"(?:st|nd|rd|th)?,? \d{4})", t, re.I)
        per = period(m.group(1)) if m else None
        if per is None:
            continue
        for r in t_[2:]:
            if len(r) == 4:
                out.append(Row(r[0], category(r[0]), pct(r[1]), pct(r[2]), pct(r[3]), per[0], per[1]))
    _need(bool(out), "Kotak contracted-loan tables")
    return out


def parse_idfc(page: str, url: str = "") -> list[Row]:
    """IDFC FIRST Bank: "Interest rate range of contracted loans for the past
    quarter" (Min ROI | Max ROI | Weighted Avg. ROI); the quarter is in the
    page's address ("...-for-the-quarter-q1-fy-26-27")."""
    per = period(url) if url else None
    if per is None:
        m = re.search(r"for the quarter\s+(Q[1-4]\s*FY\s*\d{2,4}\s*-\s*\d{2})", text(page), re.I)
        per = period(m.group(1)) if m else None
    _need(per is not None, "IDFC quarter")
    tab = _find_table(page, "min roi", "max roi", "weighted avg")
    head = [c.lower() for c in tab[0]]
    _need(head[1:4] == ["min roi", "max roi", "weighted avg. roi"], "IDFC column order")
    return [Row(r[0], category(r[0]), pct(r[1]), pct(r[2]), pct(r[3]), per[0], per[1], "weighted average")
            for r in tab[1:] if len(r) == 4]


def parse_sbi(page: str, url: str = "") -> list[Row]:
    """SBI, personal loan: the page gives only "Mean ROI (Q1 FY 2026-27): x%".
    The range beside it is SBI's rate card (what it offers), not the range
    of loans contracted, so only the mean is recorded."""
    m = re.search(r"Mean ROI\s*\((Q[1-4]\s*FY\s*\d{4}\s*-\s*\d{2})\)\s*:\s*(\d+(?:\.\d+)?)\s*%", text(page), re.I)
    _need(m is not None, "SBI mean ROI")
    per = period(m.group(1))
    _need(per is not None, "SBI quarter")
    return [Row("SBI Personal Loan scheme", "personal_loan", None, None, D(m.group(2)) / 100, per[0], per[1])]


@dataclass(frozen=True)
class Source:
    lender_id: str
    name: str
    url: str
    parse: Callable[[str, str], list[Row]]
    # The disclosure page's address changes each quarter; find it from here.
    index_url: Optional[str] = None
    index_link: Optional[str] = None


SOURCES: list[Source] = [
    Source("IN_SBI", "SBI",
           "https://sbi.bank.in/web/interest-rates/interest-rates/loan-schemes-interest-rates/personal-loans-schemes",
           parse_sbi),
    Source("IN_HDFC", "HDFC Bank", "https://www.hdfc.bank.in/personal-loan/interest-rates-and-charges", parse_hdfc),
    Source("IN_ICICI_PL", "ICICI Bank",
           "https://www.icici.bank.in/personal-banking/loans/personal-loan/personal-loan-interest-rates",
           parse_icici_pl),
    Source("IN_ICICI_CAR", "ICICI Bank",
           "https://www.icici.bank.in/personal-banking/loans/car-loan/service-charges", parse_icici_car),
    Source("IN_AXIS", "Axis Bank", "https://www.axis.bank.in/loans/personal-loan/interest-rates-charges", parse_axis),
    Source("IN_KOTAK", "Kotak Mahindra Bank", "https://www.kotak.bank.in/en/rates/interest-rates.html", parse_kotak),
    Source("IN_IDFC", "IDFC FIRST Bank",
           "https://www.idfcfirst.bank.in/investors/regulatory-disclosures/"
           "interest-rate-range-contracted-loans-for-the-quarter-q1-fy-26-27",
           parse_idfc,
           index_url="https://www.idfcfirst.bank.in/investors/regulatory-disclosures",
           index_link=r'href="([^"]*interest-rate-range-contracted-loans-for-the-quarter-q[1-4]-fy-\d{2}-\d{2})"'),
]


def check(rows: list[Row]) -> Parsed:
    """Keep only rows that make sense; say why the others were dropped."""
    out = Parsed()
    for r in rows:
        nums = [x for x in (r.min, r.max, r.mean) if x is not None]
        why = None
        if r.mean is None:
            why = "no mean rate"
        elif any(not (LOW <= x <= HIGH) for x in nums):
            why = "a rate outside 3%-60%"
        elif r.min is not None and r.max is not None and not (r.min <= r.mean <= r.max):
            why = f"the mean {r.mean * 100:f}% is outside the range {r.min * 100:f}%-{r.max * 100:f}%"
        elif (r.min is None) != (r.max is None):
            why = "only one end of the range"
        elif r.apr_mean is not None and r.apr_min is not None and r.apr_max is not None and \
                not (r.apr_min <= r.apr_mean <= r.apr_max):
            r.apr_min = r.apr_max = r.apr_mean = None   # keep the rate, drop an APR that doesn't add up
        if why:
            out.rejected.append({"label": r.label, "reason": why})
        else:
            out.rows.append(r)
    return out


def parse(source: Source, page: str, url: Optional[str] = None) -> Parsed:
    """One lender's page → checked rows. A page the parser no longer
    recognises gives no rows (the lender doesn't appear), never an error."""
    try:
        rows = source.parse(page, url or source.url)
    except (PageChanged, StopIteration, ValueError, IndexError) as exc:
        p = Parsed()
        p.rejected.append({"label": "(page)", "reason": f"not readable: {exc}"})
        return p
    return check(rows)


def _f(d: Optional[Decimal]) -> Optional[str]:
    return None if d is None else format(d.normalize(), "f")


def row_dict(r: Row) -> dict:
    return {
        "label": r.label, "category": r.category,
        "min": _f(r.min), "max": _f(r.max), "mean": _f(r.mean), "mean_kind": r.mean_kind,
        "apr_min": _f(r.apr_min), "apr_max": _f(r.apr_max), "apr_mean": _f(r.apr_mean),
        "period_start": r.period_start.isoformat(), "period_end": r.period_end.isoformat(),
        "period_label": period_label(r.period_start, r.period_end),
    }
