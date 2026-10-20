"""Read a loan's Key Facts Statement (KFS) or sanction letter (roadmap PR G).

Why the KFS: RBI circular RBI/2024-25/18, DOR.STR.REC.13/13.03.00/2024-25,
"Key Facts Statement (KFS) for Loans & Advances", April 15, 2024, makes a KFS
in its standard format (Annex A) mandatory for every new retail and MSME term
loan sanctioned on or after October 1, 2024 (para 11). It states the rate type,
the rate of interest, the APR (computed as in Annex B), every fee and charge
(para 8: a fee not in the KFS can't be charged without the borrower's consent)
and the amortisation schedule (Annex C). Credit cards are exempt (para 10).
    https://www.rbi.org.in/Scripts/NotificationUser.aspx?Id=12663&Mode=0

The labels matched here are Annex A's own (Part 1, rows 1-10), plus the usual
wording of a bank's sanction letter for loans sanctioned before the KFS rules.

Rules this module keeps:
- **Nothing is saved.** It returns what it read, line by line, for the user to
  confirm or change; the web form decides what to keep.
- **Read on RightDue's server, never stored.** (Grill #19: this used to say
  "local only", which was wrong: the PDF goes to POST /api/kfs/read.) Plain-text
  rules on the document's own text layer (pypdf, in a child process with a
  timeout, engine/pdf_text.py). No outside service and no AI model sees it. A
  password, when the PDF has one, is used once in memory and never kept.
- **Every value carries its source line**, so the form can show "from your
  KFS: <the line>" beside it.
- **Cross-checks.** The EMI and the APR are worked out again from the terms
  read (Annex B method: IRR on the net amount disbursed, reducing balance,
  monthly rate × 12). A gap is reported in plain words, because it means a
  misread field or a charge the KFS left out.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from datetime import date
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
from typing import Optional

from engine.formulas import emi as emi_formula, remaining_balance
from engine.pdf_text import DEFAULT_TIMEOUT_S, MAX_PDF_BYTES, MAX_PDF_PAGES, PdfTextError, read_pdf_text

D = Decimal

CIRCULAR = "RBI/2024-25/18, DOR.STR.REC.13/13.03.00/2024-25, April 15, 2024"
CIRCULAR_URL = "https://www.rbi.org.in/Scripts/NotificationUser.aspx?Id=12663&Mode=0"
KFS_FROM = date(2024, 10, 1)

MAX_TEXT_CHARS = 200_000

# A stated EMI is rounded to the rupee (Annex B: 969.73 shown as 970).
EMI_TOLERANCE_RUPEES = D("2")
EMI_TOLERANCE_SHARE = D("0.002")
# Annex B rounds the APR to two decimals; rounding the EMI moves it by about
# 0.03 points (17.07% exact vs 17.10% on the rounded EMI). Beyond 0.10 points
# the terms read don't explain the stated APR.
APR_TOLERANCE = D("0.0010")
# Benchmark + spread must equal the final rate (Annex A row 7).
SPREAD_TOLERANCE = D("0.0002")


class KfsReadError(ValueError):
    """The document has no text that can be read (e.g. a scanned image)."""


@dataclass
class Found:
    value: str        # normalised: rates and shares as fractions ("0.105"), money in rupees, months as ints, ISO dates
    source: str       # the line it came from, as printed
    note: str = ""    # e.g. "₹10,000, as 2.0% of the loan"


@dataclass
class Check:
    kind: str         # "emi" | "apr" | "spread"
    ok: bool
    stated: Optional[str]
    computed: Optional[str]
    message: str


@dataclass
class KfsResult:
    is_kfs: bool                         # Annex A labels found (vs a sanction letter)
    fields: dict[str, Found] = field(default_factory=dict)
    checks: list[Check] = field(default_factory=list)
    loan: dict[str, Optional[str]] = field(default_factory=dict)
    derived: dict[str, str] = field(default_factory=dict)   # loan field -> how it was worked out
    warnings: list[str] = field(default_factory=list)


# ─────────────────────────────────────────────────────────────────────────────
# Text
# ─────────────────────────────────────────────────────────────────────────────

_PDF_MESSAGES = {
    "too_big": "The PDF is larger than 4 MB. Paste the KFS text instead.",
    "not_pdf": "That file is not a PDF. Upload the KFS as a PDF, or paste its text.",
    "needs_password": (
        "This PDF is password-protected. Type the password your bank gave you (often your date of "
        "birth, or part of your name, PAN or mobile number). It is used once to open the file and never kept."
    ),
    "wrong_password": "That password didn't open the PDF. Check it against the email or letter the file came with.",
    "unreadable": "The PDF could not be read. Paste the KFS text instead.",
    "scan": (
        "This PDF has no text to read; it looks like a scan. Paste the KFS text instead, "
        "or type the figures in yourself."
    ),
    "timeout": "This PDF took too long to read. Paste the KFS text instead.",
    # audit80 D15: refused before parsing, or another upload is being read.
    "too_complex": "This PDF is too complex to read safely. Paste its text instead.",
    "busy": "We're reading another file right now. Try again in a minute.",
}


def pdf_text(data: bytes, password: Optional[str] = None, *, timeout: float = DEFAULT_TIMEOUT_S) -> str:
    """The text layer of a PDF, page by page (first MAX_PDF_PAGES pages). Raises
    KfsReadError when there is none (a scan), the file isn't a PDF, it needs a
    password (used in memory once, never kept), or the parse runs out of time.
    The parse runs in a child process (engine/pdf_text.py), see grill #60."""
    try:
        return read_pdf_text(data, password, max_pages=MAX_PDF_PAGES, timeout=timeout)
    except PdfTextError as exc:
        err = KfsReadError(_PDF_MESSAGES.get(exc.kind, _PDF_MESSAGES["unreadable"]))
        err.kind = exc.kind  # type: ignore[attr-defined]
        raise err from exc


def _lines(text: str) -> list[str]:
    text = text.replace("\r", "\n").replace("\u00a0", " ").replace("\u2013", "-").replace("\u2014", "-")
    out = []
    for raw in text.split("\n"):
        line = re.sub(r"[ \t]+", " ", raw).strip()
        if line:
            out.append(line)
    return out


# ─────────────────────────────────────────────────────────────────────────────
# Numbers, money, dates
# ─────────────────────────────────────────────────────────────────────────────

_NUM = r"\d{1,3}(?:,\d{2,3})+(?:\.\d+)?|\d+(?:\.\d+)?"
_PCT = re.compile(r"(\d+(?:\.\d+)?)\s*%")
_MONEY = re.compile(
    r"(?:₹|(?<![a-z])(?:rs\.?|inr|rupees))\s*(" + _NUM + r")\s*(lakhs?|lacs?|crores?|cr\b)?(?:\s*/-)?"
    r"|(" + _NUM + r")\s*(lakhs?|lacs?|crores?)",
    re.I,
)
_BARE = re.compile(r"(?<![\w.])(" + _NUM + r")(?![\w%])")
_MONTHS = {m: i for i, m in enumerate(
    ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"], 1)}


def _dec(s: str) -> Optional[Decimal]:
    try:
        return D(s.replace(",", ""))
    except (InvalidOperation, AttributeError):
        return None


def _scale(n: Decimal, unit: Optional[str]) -> Decimal:
    u = (unit or "").lower()
    if u.startswith(("lakh", "lac")):
        return n * D("100000")
    if u.startswith(("crore", "cr")):
        return n * D("10000000")
    return n


def _money(s: str) -> Optional[Decimal]:
    m = _MONEY.search(s)
    if m:
        if m.group(1):
            n = _dec(m.group(1))
            return None if n is None else _scale(n, m.group(2))
        n = _dec(m.group(3))
        return None if n is None else _scale(n, m.group(4))
    return None


def _bare_numbers(s: str) -> list[Decimal]:
    out = []
    for m in _BARE.finditer(s):
        n = _dec(m.group(1))
        if n is not None:
            out.append(n)
    return out


def _amount(s: str) -> Optional[Decimal]:
    """A rupee amount: marked with ₹/Rs/INR or lakh/crore, else the largest bare number."""
    m = _money(s)
    if m is not None:
        return m
    nums = [n for n in _bare_numbers(s) if n >= 100]
    return max(nums) if nums else None


def _pct(s: str) -> Optional[Decimal]:
    m = _PCT.search(s)
    return None if not m else D(m.group(1)) / D("100")


def _date(s: str) -> Optional[date]:
    m = re.search(r"(?<!\d)(\d{4})-(\d{1,2})-(\d{1,2})(?!\d)", s)   # ISO 2025-11-05
    if m:
        try:
            return date(int(m.group(1)), int(m.group(2)), int(m.group(3)))
        except ValueError:
            pass
    m = re.search(r"(?<!\d)(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})(?!\d)", s)
    if m:
        try:
            return date(int(m.group(3)), int(m.group(2)), int(m.group(1)))
        except ValueError:
            pass
    m = re.search(r"(\d{1,2})(?:st|nd|rd|th)?[\s\-/]+([A-Za-z]{3})[a-z]*[\s\-/,]+(\d{4})", s)
    if m and m.group(2).lower()[:3] in _MONTHS:
        try:
            return date(int(m.group(3)), _MONTHS[m.group(2).lower()[:3]], int(m.group(1)))
        except ValueError:
            pass
    m = re.search(r"([A-Za-z]{3})[a-z]*\s+(\d{1,2}),?\s+(\d{4})", s)
    if m and m.group(1).lower()[:3] in _MONTHS:
        try:
            return date(int(m.group(3)), _MONTHS[m.group(1).lower()[:3]], int(m.group(2)))
        except ValueError:
            pass
    # Bare DDMMYYYY last, and only as a whole token: an application or account
    # number would otherwise win over a real date on the same line.
    m = re.search(r"(?<![\d,.])(\d{2})(\d{2})(\d{4})(?![\d,.])", s)
    if m:
        try:
            return date(int(m.group(3)), int(m.group(2)), int(m.group(1)))
        except ValueError:
            pass
    return None


def _months(s: str) -> Optional[int]:
    m = re.search(r"(\d+(?:\.\d+)?)\s*(years?|yrs?|months?|mths?|days?)", s, re.I)
    if not m:
        return None
    n = D(m.group(1))
    u = m.group(2).lower()
    if u.startswith("y"):
        # "15 years 6 months": add the months that follow the years.
        extra = re.match(r"\s*(?:and\s*|,\s*)?(\d+)\s*(?:months?|mths?)\b", s[m.end():], re.I)
        return int(n * 12) + (int(extra.group(1)) if extra else 0)
    if u.startswith("d"):
        return int((n / D("30.4375")).to_integral_value(ROUND_HALF_UP))
    return int(n)


def _fmt(d: Decimal, places: str = "0.000001") -> str:
    return format(d.quantize(D(places), ROUND_HALF_UP).normalize(), "f")


# ─────────────────────────────────────────────────────────────────────────────
# Labels (Annex A, Part 1) and sanction-letter wording
# ─────────────────────────────────────────────────────────────────────────────

LABELS: dict[str, list[str]] = {
    "loan_type": [r"type of loan", r"loan type", r"product(?: name)?\s*:", r"facility\s*:"],
    "sanctioned_amount": [r"sanctioned loan amount", r"sanctioned amount", r"loan amount sanctioned",
                          r"amount of loan", r"loan amount"],
    "tenure": [r"loan term", r"tenure of (?:the )?loan", r"loan tenure", r"tenure", r"repayment period"],
    "interest": [r"interest rate \(%\) and type", r"rate of interest", r"interest rate"],
    "apr": [r"annual percentage rate", r"\bapr\b"],
    "processing_fee": [r"processing fees?", r"processing charges?"],
    "insurance": [r"insurance charges?", r"insurance premium"],
    "valuation": [r"valuation fees?", r"valuation charges?"],
    "other_fee": [r"any other \(please specify\)"],
    "foreclosure": [r"foreclosure charges?", r"pre-?payment charges?", r"prepayment penalty",
                    r"part[- ]?prepayment charges?", r"pre-?closure charges?"],
    "emi": [r"\bemi amount\b", r"equated monthly instal?ments?", r"\bemi\b\s*(?:\(₹\)|\(rs\.?\))?\s*:",
            r"monthly instal?ment"],
    "first_emi": [r"first (?:emi|instal?ment)(?: due)? date", r"date of first (?:emi|instal?ment)",
                  r"due date of payment of instal?ment", r"first emi"],
}
# Annex A labels that only a KFS has.
KFS_MARKERS = [r"key facts? statement", r"annual percentage rate", r"details of contingent charges",
               r"disbursal schedule", r"instal?ment details"]

LOAN_TYPES = [
    ("home_loan", r"home|housing|mortgage(?! against)"),
    ("auto_loan", r"car|auto|vehicle|two[- ]?wheeler"),
    ("education_loan", r"education|student"),
    ("gold_loan", r"gold"),
    ("personal_loan", r"personal|consumer|unsecured"),
]
LENDER_RE = re.compile(
    r"([A-Z][A-Za-z&.' ]{1,60}?\b(?:Bank|Finance|Financial Services|Fincorp|Housing Finance|Capital|Credit)"
    r"(?: of India)?(?: Ltd\.?| Limited)?)\b"
)


# The start of the next numbered row of the KFS table: "9 Annual ...", "(iii) Valuation ...".
_ROW = re.compile(r"^\(?(?:\d{1,2}|[ivx]{1,4}|[a-e])\)?\.?\s+[A-Za-z]", re.I)


def _find(lines: list[str], key: str, start: int = 0) -> Optional[tuple[int, str, str]]:
    """First line at or after `start` holding one of `key`'s labels:
    (index, line, the text after the label). When the label ends the line,
    the next line is the value."""
    for pat in LABELS[key]:
        rx = re.compile(pat, re.I)
        for i in range(start, len(lines)):
            m = rx.search(lines[i])
            if not m:
                continue
            raw = lines[i][m.end():]
            rest = raw.strip(" :-|\t")
            # Drop the rest of the label printed in brackets, e.g. "(in Rupees)".
            rest = re.sub(r"^\((?:in )?(?:rupees|₹|rs\.?|%|year/months/days|years?/months?/days?|"
                          r"fixed or floating or hybrid)\)\s*", "", rest, flags=re.I).strip(" :-|")
            if not rest and "-" in raw:
                return i, lines[i], "-"      # a row of dashes: nothing charged
            if not rest and i + 1 < len(lines) and not _ROW.match(lines[i + 1]):
                return i, lines[i], lines[i + 1]
            return i, lines[i], rest
    return None


def _src(line: str) -> str:
    return line if len(line) <= 200 else line[:197] + "..."


# ─────────────────────────────────────────────────────────────────────────────
# Reading
# ─────────────────────────────────────────────────────────────────────────────

def _lender(lines: list[str]) -> Optional[Found]:
    for line in lines[:25]:
        if re.search(r"(?i)key facts|sanction letter|annex|part \d", line) and not re.search(
                r"(?i)\b(bank|finance)\b", line):
            continue
        m = LENDER_RE.search(line)
        if m:
            name = re.sub(r"\s+", " ", m.group(1)).strip(" .,")
            if len(name.split()) >= 2:
                return Found(name, _src(line))
    return None


def _loan_type(lines: list[str]) -> Optional[Found]:
    hit = _find(lines, "loan_type")
    text = hit[2] if hit else ""
    if hit:
        for lt, rx in LOAN_TYPES:
            if re.search(rx, text, re.I):
                return Found(lt, _src(hit[1]))
    # No label: the document's title often names it ("Personal Loan - Key Facts Statement").
    for line in lines[:15]:
        for lt, rx in LOAN_TYPES:
            if re.search(r"(?i)(" + rx + r")\s+loan", line):
                return Found(lt, _src(line))
    return None


def _interest(lines: list[str], res: KfsResult) -> None:
    hit = _find(lines, "interest")
    if not hit:
        return
    i, line, rest = hit
    window = " ".join([rest] + lines[i + 1:i + 2])
    rate = _pct(rest) or _pct(window)
    if rate is None:
        nums = [n for n in _bare_numbers(rest) if D("1") <= n <= D("60")]
        rate = nums[0] / D("100") if nums else None
    if rate is not None:
        res.fields["interest_rate"] = Found(_fmt(rate), _src(line if _pct(rest) or not _pct(window) else
                                                              line + " " + lines[i + 1]))
    # The type is on the same line; the next line counts only when it isn't
    # the next numbered row (Annex A row 7 says "Floating" in its label).
    nxt = lines[i + 1] if i + 1 < len(lines) and not re.match(r"^\(?\d+\)?\s+[A-Za-z]", lines[i + 1]) else ""
    kind = re.search(r"(?i)\b(fixed|floating|hybrid|variable|repo[- ]linked)\b", rest) or \
        re.search(r"(?i)\b(fixed|floating|hybrid|variable|repo[- ]linked)\b", nxt)
    if kind:
        k = kind.group(1).lower()
        k = "floating" if k in ("variable", "repo-linked", "repo linked") else k
        res.fields["rate_type"] = Found(k, _src(line))


_DATE_IN_ROW = re.compile(
    r"(?i)(?<!\d)(?:\d{4}-\d{1,2}-\d{1,2}|\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4}|"
    r"\d{1,2}(?:st|nd|rd|th)?\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?,?\s+\d{4})(?!\d)"
)


def _floating(lines: list[str], res: KfsResult) -> None:
    """Annex A row 7: Reference Benchmark | Benchmark rate (B) | Spread (S) | Final rate R = B + S | reset."""
    for i, line in enumerate(lines):
        if not re.search(r"(?i)reference\s*benchmark|benchmark\s*rate", line):
            continue
        for j in range(i, min(i + 8, len(lines))):
            cand = lines[j]
            if re.search(r"(?i)\bspread\b.*\(s\)|reset|impact of change|periodicity", cand) and not \
                    re.search(r"\d+\.\d+", cand):
                continue
            # A date in the row ("as on 01.04.2025") is not the rate, spread or final rate.
            cand = _DATE_IN_ROW.sub(" ", cand)
            nums = [n for n in _bare_numbers(cand) if n <= D("40")]
            m = re.match(r"\s*([A-Za-z][A-Za-z0-9 ()\-./]*?)\s*[:|]?\s*(\d)", cand)
            if len(nums) >= 3 and m and not re.search(r"(?i)^\s*(reference|benchmark)\s*$", m.group(1)):
                name = re.sub(r"(?i)^(reference benchmark|benchmark)\s*[:|-]?\s*", "", m.group(1)).strip(" :|-")
                name = re.sub(r"(?i)\s+as\s+(?:on|of)\s*$", "", name)
                b, s, r = nums[0], nums[1], nums[2]
                if name:
                    res.fields["benchmark"] = Found(name, _src(cand))
                res.fields["benchmark_rate"] = Found(_fmt(b / 100), _src(cand))
                res.fields["spread"] = Found(_fmt(s / 100), _src(cand))
                res.fields["final_rate"] = Found(_fmt(r / 100), _src(cand))
                return
    # Sanction-letter wording: "Repo Rate (5.25%) + Spread 2.75% = 8.00%".
    for line in lines:
        m = re.search(r"(?i)(repo rate|rllr|eblr|mclr|t-?bill)[^%\d]*(\d+(?:\.\d+)?)\s*%?\s*\)?\s*\+\s*"
                      r"(?:spread\s*)?(?:of\s*)?(\d+(?:\.\d+)?)\s*%", line)
        if m:
            res.fields["benchmark"] = Found(m.group(1).upper() if len(m.group(1)) <= 5 else m.group(1).title(),
                                            _src(line))
            res.fields["benchmark_rate"] = Found(_fmt(D(m.group(2)) / 100), _src(line))
            res.fields["spread"] = Found(_fmt(D(m.group(3)) / 100), _src(line))
            tail = _PCT.findall(line[m.end():])
            if tail:
                res.fields["final_rate"] = Found(_fmt(D(tail[0]) / 100), _src(line))
            return


def _instalments(lines: list[str], res: KfsResult) -> None:
    """Annex A row 5: Type of instalments | Number of EPIs | EPI (₹) | Commencement of repayment."""
    for i, line in enumerate(lines):
        if not re.search(r"(?i)type of instal?ments?", line):
            continue
        for j in range(i, min(i + 5, len(lines))):
            cand = lines[j]
            m = re.search(r"(?i)\b(monthly|quarterly|half[- ]yearly|yearly|annual)\b", cand)
            if not m:
                continue
            after = cand[m.end():]
            nums = _bare_numbers(after)
            if len(nums) >= 2:
                res.fields["frequency"] = Found(m.group(1).lower(), _src(cand))
                res.fields["emi_count"] = Found(str(int(nums[0])), _src(cand))
                money = _money(after)
                res.fields["emi"] = Found(_fmt(money if money is not None else nums[1], "0.01"), _src(cand))
                comm = re.search(r"(?i)(\d+)\s*days?", after)
                when = _date(after)
                if when:
                    res.fields["first_emi_date"] = Found(when.isoformat(), _src(cand))
                elif comm:
                    res.fields["repayment_starts"] = Found(f"{comm.group(1)} days after sanction", _src(cand))
                return


def _fee(lines: list[str], key: str, sanctioned: Optional[Decimal]) -> Optional[tuple[Found, Decimal]]:
    """A fee row: (Found, rupees). A % fee is converted at the sanctioned amount."""
    hit = _find(lines, key)
    if not hit:
        return None
    _, line, rest = hit
    if re.fullmatch(r"(?i)\W*(nil|na|n\.a\.|not applicable|none|-|0)\W*", rest or "-"):
        return Found("0", _src(line), "Nil"), D("0")
    amt = _money(rest)
    pct = _pct(rest)
    capped = pct is not None and amt is not None and re.search(
        r"(?i)\b(max(?:imum)?|cap(?:ped)?|up\s*to|not\s+exceeding|subject\s+to)\b", rest)
    if capped:
        # "2% of the loan, max Rs 10,000": the % fee, capped at the amount.
        if not sanctioned:
            return None
        rupees = min((sanctioned * pct).quantize(D("1"), ROUND_HALF_UP), amt)
        return Found(_fmt(rupees, "0.01"), _src(line),
                     f"{_fmt(pct * 100, '0.01')}% of the loan, capped at {_fmt(amt, '0.01')}"), rupees
    if amt is None and pct is not None and sanctioned:
        rupees = (sanctioned * pct).quantize(D("1"), ROUND_HALF_UP)
        return Found(_fmt(rupees, "0.01"), _src(line), f"{_fmt(pct * 100, '0.01')}% of the loan"), rupees
    if amt is None and pct is not None:
        return None   # "2 % of the loan" with no loan amount read: not Rs 2
    if amt is None:
        nums = [n for n in _bare_numbers(rest) if n >= 1]
        amt = max(nums) if nums else None
    if amt is None:
        return None
    return Found(_fmt(amt, "0.01"), _src(line)), amt


def _foreclosure(lines: list[str]) -> Optional[Found]:
    hit = _find(lines, "foreclosure")
    if not hit:
        return None
    _, line, rest = hit
    if re.search(r"(?i)\b(nil|not applicable|no (?:charges?|penalty)|n\.?a\.?|none)\b", rest) and not _pct(rest):
        return Found("0", _src(line), "Nil")
    pct = _pct(rest)
    if pct is not None:
        gst = " plus GST" if re.search(r"(?i)gst|taxes", rest) else ""
        return Found(_fmt(pct), _src(line), f"{_fmt(pct * 100, '0.01')}% of the amount prepaid{gst}")
    return None


def read_kfs(text: str, as_of: Optional[date] = None) -> KfsResult:
    """Read a KFS or sanction letter's text. `as_of` (today, from the caller)
    is used only to work out the balance and EMIs left when the first EMI is
    already past."""
    if len(text) > MAX_TEXT_CHARS:
        raise KfsReadError("That is more text than a KFS; paste just the Key Facts Statement pages.")
    lines = _lines(text)
    if len(lines) < 3:
        raise KfsReadError("There is too little text to read. Paste the whole Key Facts Statement.")
    joined = "\n".join(lines)
    res = KfsResult(is_kfs=sum(bool(re.search(p, joined, re.I)) for p in KFS_MARKERS) >= 2)

    if (f := _lender(lines)) is not None:
        res.fields["lender"] = f
    if (f := _loan_type(lines)) is not None:
        res.fields["loan_type"] = f

    hit = _find(lines, "sanctioned_amount")
    sanctioned = None
    if hit:
        sanctioned = _amount(hit[2])
        if sanctioned is not None:
            res.fields["sanctioned_amount"] = Found(_fmt(sanctioned, "0.01"), _src(hit[1]))

    hit = _find(lines, "tenure")
    if hit and (n := _months(hit[2])):
        res.fields["tenure_months"] = Found(str(n), _src(hit[1]))

    _instalments(lines, res)
    if "emi" not in res.fields and (hit := _find(lines, "emi")):
        amt = _amount(hit[2])
        if amt is not None:
            res.fields["emi"] = Found(_fmt(amt, "0.01"), _src(hit[1]))
    if "tenure_months" not in res.fields and "emi_count" in res.fields \
            and res.fields.get("frequency", Found("monthly", "")).value == "monthly":
        res.fields["tenure_months"] = Found(res.fields["emi_count"].value, res.fields["emi_count"].source)

    _interest(lines, res)
    _floating(lines, res)
    if "rate_type" not in res.fields and "benchmark" in res.fields:
        res.fields["rate_type"] = Found("floating", res.fields["benchmark"].source)
    if "interest_rate" not in res.fields and "final_rate" in res.fields:
        res.fields["interest_rate"] = Found(res.fields["final_rate"].value, res.fields["final_rate"].source)

    hit = _find(lines, "apr")
    if hit:
        apr = _pct(hit[2])
        if apr is None:
            nums = [n for n in _bare_numbers(hit[2]) if D("1") <= n <= D("80")]
            apr = nums[-1] / D("100") if nums else None
        if apr is not None:
            res.fields["apr"] = Found(_fmt(apr), _src(hit[1]))

    other_fees = D("0")
    if (got := _fee(lines, "processing_fee", sanctioned)) is not None:
        res.fields["processing_fee"] = got[0]
    for key in ("insurance", "valuation", "other_fee"):
        if (got2 := _fee(lines, key, sanctioned)) is not None and got2[1] > 0:
            res.fields[key] = got2[0]
            other_fees += got2[1]

    if (f := _foreclosure(lines)) is not None:
        res.fields["prepayment_charge"] = f

    if "first_emi_date" not in res.fields and (hit := _find(lines, "first_emi")):
        when = _date(hit[2])
        if when:
            res.fields["first_emi_date"] = Found(when.isoformat(), _src(hit[1]))

    if not res.fields:
        raise KfsReadError(
            "No loan terms could be found in this text. Check it is the Key Facts Statement or "
            "sanction letter, or type the figures in yourself."
        )
    _check(res, other_fees)
    _to_loan(res, as_of)
    if not res.is_kfs:
        res.warnings.append(
            "This doesn't look like an RBI Key Facts Statement, so some terms may be missing. "
            "Loans sanctioned from 1 Oct 2024 come with one (RBI circular of 15 Apr 2024)."
        )
    for key, label in (("interest_rate", "interest rate"), ("sanctioned_amount", "loan amount"),
                       ("tenure_months", "tenure"), ("emi", "EMI")):
        if key not in res.fields:
            res.warnings.append(f"The {label} couldn't be found; type it in.")
    return res


# ─────────────────────────────────────────────────────────────────────────────
# Cross-checks
# ─────────────────────────────────────────────────────────────────────────────

def _v(res: KfsResult, key: str) -> Optional[Decimal]:
    f = res.fields.get(key)
    return None if f is None else _dec(f.value)


def apr_from_terms(principal: Decimal, rate: Decimal, months: int, fees: Decimal) -> Optional[Decimal]:
    """Annex B: IRR of the net amount disbursed (loan less every fee) against
    the EMIs, reducing balance, monthly rate × 12. None when the fees eat the
    whole loan (no IRR) or the IRR is past the search cap of 100% a month."""
    p = float(principal)
    pay = float(emi_formula(principal, rate, months))
    net = p - float(fees)
    if net <= 0 or pay * (1 - 2.0 ** -months) > net:
        return None
    lo, hi = 0.0, 1.0
    for _ in range(200):
        mid = (lo + hi) / 2
        pv = pay * (1 - (1 + mid) ** -months) / mid if mid else pay * months
        lo, hi = (mid, hi) if pv > net else (lo, mid)
    return D(repr((lo + hi) / 2 * 12))


def _pc(d: Decimal) -> str:
    return f"{_fmt(d * 100, '0.01')}%"


def _rs(d: Decimal) -> str:
    """Rupees with Indian grouping: ₹12,34,567."""
    digits = str(abs(int(d.quantize(D("1"), ROUND_HALF_UP))))
    if len(digits) <= 3:
        return f"₹{digits}"
    head = re.sub(r"(\d)(?=(\d{2})+$)", r"\1,", digits[:-3])
    return f"₹{head},{digits[-3:]}"


def _check(res: KfsResult, other_fees: Decimal) -> None:
    p, r = _v(res, "sanctioned_amount"), _v(res, "interest_rate")
    n_raw = res.fields.get("tenure_months")
    n = int(n_raw.value) if n_raw else None
    stated_emi = _v(res, "emi")
    if p and r is not None and n:
        computed = emi_formula(p, r, n)
        if stated_emi:
            gap = abs(computed - stated_emi)
            ok = gap <= max(EMI_TOLERANCE_RUPEES, computed * EMI_TOLERANCE_SHARE)
            res.checks.append(Check(
                "emi", ok, _fmt(stated_emi, "0.01"), _fmt(computed, "0.01"),
                f"The EMI checks out: {_rs(p)} at {_pc(r)} over {n} months is {_rs(computed)} a month."
                if ok else
                f"The EMI doesn't match. {_rs(p)} at {_pc(r)} over {n} months comes to {_rs(computed)} a month, "
                f"but the document says {_rs(stated_emi)}. One of the amount, rate or tenure may have been "
                f"read wrongly, so check them against the document."
            ))
    fee = _v(res, "processing_fee") or D("0")
    stated_apr = _v(res, "apr")
    if p and r is not None and n and stated_apr:
        computed_apr = apr_from_terms(p, r, n, fee + other_fees)
    if p and r is not None and n and stated_apr and computed_apr is None:
        res.warnings.append(
            f"The fees read ({_rs(fee + other_fees)}) leave almost nothing of the {_rs(p)} loan, so the "
            f"APR can't be checked. A fee or the loan amount was probably read wrongly."
        )
    elif p and r is not None and n and stated_apr:
        gap = stated_apr - computed_apr
        ok = abs(gap) <= APR_TOLERANCE
        fees_txt = f"{_rs(fee + other_fees)} of fees" if fee + other_fees > 0 else "no fees"
        if ok:
            msg = (f"The APR checks out: {_pc(r)} with {fees_txt} works out to {_pc(computed_apr)}, "
                   f"against {_pc(stated_apr)} stated.")
        elif gap > 0:
            msg = (f"The APR stated ({_pc(stated_apr)}) is higher than the {_pc(computed_apr)} that {_pc(r)} "
                   f"with {fees_txt} works out to. Either a fee wasn't read, or the loan carries charges the "
                   f"KFS doesn't list as fees. RBI says a charge that isn't in the KFS can't be taken without "
                   f"your consent, so ask the lender what makes up the difference.")
        else:
            msg = (f"The APR stated ({_pc(stated_apr)}) is lower than the {_pc(computed_apr)} that {_pc(r)} "
                   f"with {fees_txt} works out to. A fee or the rate may have been read wrongly; check them "
                   f"against the document.")
        res.checks.append(Check("apr", ok, _fmt(stated_apr), _fmt(computed_apr), msg))
    b, s, fr = _v(res, "benchmark_rate"), _v(res, "spread"), _v(res, "final_rate")
    if b is not None and s is not None and fr is not None:
        ok = abs(b + s - fr) <= SPREAD_TOLERANCE
        res.checks.append(Check(
            "spread", ok, _fmt(fr), _fmt(b + s),
            f"Benchmark {_pc(b)} + spread {_pc(s)} = {_pc(fr)}, as stated." if ok else
            f"Benchmark {_pc(b)} + spread {_pc(s)} is {_pc(b + s)}, not the {_pc(fr)} stated. "
            f"Check which one the document means as your rate."
        ))
        if r is not None and abs(fr - r) > SPREAD_TOLERANCE:
            res.warnings.append(
                f"The floating-rate table gives {_pc(fr)} but the interest-rate row says {_pc(r)}; "
                f"the form uses {_pc(r)}. Change it if the table is right."
            )


# ─────────────────────────────────────────────────────────────────────────────
# The loan the form would fill in (never saved here)
# ─────────────────────────────────────────────────────────────────────────────

def _months_between(first: date, today: date) -> int:
    """EMIs due from `first` up to and including `today`."""
    if today < first:
        return 0
    import calendar
    k = (today.year - first.year) * 12 + (today.month - first.month)
    # An EMI on the 29th-31st falls due on the last day of a shorter month.
    due_day = min(first.day, calendar.monthrange(today.year, today.month)[1])
    if today.day >= due_day:
        k += 1
    return k


def _to_loan(res: KfsResult, as_of: Optional[date]) -> None:
    f = res.fields
    loan: dict[str, Optional[str]] = {
        "bank": f["lender"].value if "lender" in f else None,
        "loan_type": f["loan_type"].value if "loan_type" in f else None,
        "rate_type": (f["rate_type"].value if f["rate_type"].value in ("fixed", "floating") else None)
        if "rate_type" in f else None,
        "nominal_rate": f["interest_rate"].value if "interest_rate" in f else None,
        "scheduled_emi": f["emi"].value if "emi" in f else None,
        "outstanding": f["sanctioned_amount"].value if "sanctioned_amount" in f else None,
        "tenure_months_remaining": f["tenure_months"].value if "tenure_months" in f else None,
        "prepayment_penalty_pct": f["prepayment_charge"].value if "prepayment_charge" in f else None,
        "processing_fee_amortised": None,
        "first_emi_month": None,
    }
    if "rate_type" in f and f["rate_type"].value == "hybrid":
        res.warnings.append(
            "The rate is hybrid (fixed for a while, then floating). Pick the one it is on today."
        )
    p, n = _v(res, "sanctioned_amount"), loan["tenure_months_remaining"]
    fee = _v(res, "processing_fee")
    if fee is not None and p and n and int(n) > 0:
        years = D(int(n)) / D("12")
        loan["processing_fee_amortised"] = _fmt(fee / p / years)
        res.derived["processing_fee_amortised"] = (
            f"{_rs(fee)} processing fee spread over {int(n)} months: {_pc(fee / p / years)} a year"
        )
    first = f.get("first_emi_date")
    if first:
        fd = date.fromisoformat(first.value)
        today = as_of or date.today()
        paid = _months_between(fd, today)
        if paid == 0:
            loan["first_emi_month"] = fd.strftime("%Y-%m")
        elif p and n and int(n) > 0 and loan["nominal_rate"] is not None:
            total = int(n)
            paid = min(paid, total)
            left = remaining_balance(p, D(loan["nominal_rate"]), total, paid)
            loan["outstanding"] = _fmt(left, "0.01")
            loan["tenure_months_remaining"] = str(total - paid)
            res.derived["outstanding"] = (
                f"{paid} EMI{'s' if paid != 1 else ''} due since {fd.strftime('%d %b %Y')} taken off the "
                f"{_rs(p)} sanctioned, on the KFS schedule. Check it against your latest statement."
            )
            res.derived["tenure_months_remaining"] = f"{total} months less the {paid} EMIs due so far"
    res.loan = loan


def to_dict(res: KfsResult) -> dict:
    return {
        "is_kfs": res.is_kfs,
        "fields": {k: {"value": v.value, "source": v.source, "note": v.note} for k, v in res.fields.items()},
        "checks": [c.__dict__ for c in res.checks],
        "loan": res.loan,
        "derived": res.derived,
        "warnings": res.warnings,
        "circular": CIRCULAR,
        "circular_url": CIRCULAR_URL,
    }
