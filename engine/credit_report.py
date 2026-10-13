"""Read a user-downloaded credit report (grill #17 / #56).

India has four credit bureaus (Credit Information Companies registered with
RBI under section 5 of the Credit Information Companies (Regulation) Act,
2005): TransUnion CIBIL, Experian, CRIF High Mark and Equifax (RBI Credit
Information Companies Directions, 2025, para 2(2)). Each gives a person one
free report a year as a password-protected PDF. A report lists every credit
account in the person's name (lender, account type, ownership, dates, the
sanctioned amount or credit limit, the current balance, the amount overdue,
and, when the lender reports it, the EMI, the rate and the tenure). So one
upload replaces most of the setup typing and finds forgotten debts like BNPL
or consumer-durable loans.

Rules this module keeps (the same as engine/kfs.py):
- **Nothing is saved.** It returns what it read, account by account, each
  value with the line it came from. The web form shows every field for the user
  to confirm, change or drop before anything is added.
- **Read on RightDue's server, never stored.** Plain-text rules on the PDF's
  text layer (engine/pdf_text.py: pypdf in a child process with a timeout).
  No outside service and no AI model sees it. The PDF's password is used once
  in memory and never kept.
- **Least data.** Personal details on the report (name, PAN, date of birth,
  addresses, phone numbers, enquiries) are not returned. Account numbers come
  back masked to their last four characters.
- **No guessing.** A field the report doesn't show stays empty. Bureau layouts
  change, and the fixtures here are SYNTHETIC (engine/tests/fixtures/
  credit_report/): field labels follow each bureau's published report wording
  as best known, not a real person's report. Real reports must be tested
  before the parser is trusted widely (see docs/BOTTLENECKS.md).
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from datetime import date
from decimal import Decimal
from typing import Optional

from engine.kfs import _date, _dec, _money  # noqa: PLC2701 — shared number/date readers
from engine.pdf_text import DEFAULT_TIMEOUT_S, PdfTextError, read_pdf_text

D = Decimal

MAX_TEXT_CHARS = 400_000
MAX_PDF_PAGES = 60
MAX_ACCOUNTS = 200

CIC_SOURCE = "RBI Credit Information Companies Directions, 2025, para 2(2) (the four CICs registered under CICRA s.5)"
CIC_SOURCE_URL = "https://www.experian.in/wp-content/uploads/sites/39/2026/01/Credit-Information-Companies-Directions-2025.pdf"

BUREAUS = {
    "cibil": ("TransUnion CIBIL", [r"transunion\s*cibil", r"\bcibil\b"]),
    "experian": ("Experian", [r"\bexperian\b"]),
    "crif": ("CRIF High Mark", [r"crif\s*high\s*mark", r"\bcrif\b"]),
    "equifax": ("Equifax", [r"\bequifax\b"]),
}


NO_ACCOUNTS_MESSAGE = (
    "We couldn't read the accounts in this report yet. This happens with some report layouts, and it's on "
    "our side, not yours. You can paste the report's text instead, or type your loans in."
)


class CreditReportReadError(ValueError):
    """The document can't be read (scan, not a PDF, password, …)."""

    def __init__(self, message: str, kind: str = "unreadable"):
        super().__init__(message)
        self.kind = kind


_PDF_MESSAGES = {
    "too_big": "The PDF is larger than 4 MB. Download the report again, or type your loans in.",
    "not_pdf": "That file is not a PDF. Upload the credit report as the PDF the bureau gave you.",
    "needs_password": (
        "This report is password-protected. Type the password shown on the bureau's download page or in "
        "its email (often your date of birth as DDMMYYYY, or part of your name with your birth year or "
        "mobile number). It is used once to open the file and never kept."
    ),
    "wrong_password": (
        "That password didn't open the report. The download page or email that came with it says which "
        "format to use."
    ),
    "unreadable": "The PDF could not be read. Paste the report's text instead, or type your loans in.",
    "scan": "This PDF has no text to read; it looks like a scan or a photo. Download the PDF from the bureau again.",
    "timeout": "This report took too long to read. Paste its text instead.",
}


def pdf_text(data: bytes, password: Optional[str] = None, *, timeout: float = DEFAULT_TIMEOUT_S) -> str:
    try:
        return read_pdf_text(data, password, max_pages=MAX_PDF_PAGES, timeout=timeout)
    except PdfTextError as exc:
        raise CreditReportReadError(_PDF_MESSAGES.get(exc.kind, _PDF_MESSAGES["unreadable"]), exc.kind) from exc


# ---------------------------------------------------------------- labels
# Canonical field → the labels bureaus print for it (lower case). A label
# counts only when followed by ":" (or " - "), at the start of a line or after
# whitespace / a "|" cell border, so "Term" inside a word never matches.
LABELS: dict[str, list[str]] = {
    "lender": ["member name", "subscriber name", "lender name", "lender", "institution", "credit grantor", "bank name"],
    "account_type": ["account type", "type of loan", "loan type", "credit facility type", "facility type", "acct type", "type"],
    "account_number": ["account number", "account no.", "account no", "acct no", "acct #", "a/c no"],
    "ownership": ["ownership type", "ownership", "account holder type", "relationship"],
    "opened": ["date opened", "date of opening", "opened on", "open date", "disbursed date", "date disbursed", "opened"],
    "closed": ["date closed", "date of closure", "closed on", "close date", "closed"],
    "sanctioned": ["sanctioned amount", "sanction amount", "sanction amt", "sanctioned", "disbursed amount",
                   "disbursed amt", "highest credit", "high credit", "loan amount"],
    "credit_limit": ["credit limit", "card limit", "limit"],
    "balance": ["current balance", "current bal", "outstanding balance", "balance outstanding", "total outstanding",
                "balance"],
    "overdue": ["amount overdue", "overdue amount", "overdue amt", "past due amount", "amount past due", "overdue"],
    "emi": ["scheduled monthly payment amount", "emi amount", "installment amount", "instalment amount",
            "installment amt", "emi", "monthly payment"],
    "rate": ["rate of interest", "interest rate", "roi"],
    "tenure": ["repayment tenure", "tenure (months)", "tenure", "term"],
    "status": ["account status", "credit facility status", "written-off and settled status", "status"],
    "reported": ["date reported and certified", "date reported", "reported on", "last reported"],
    "dpd": ["days past due", "dpd"],
}

_ALL = sorted(((syn, key) for key, syns in LABELS.items() for syn in syns), key=lambda t: -len(t[0]))
_LABEL_TO_KEY = {syn: key for syn, key in _ALL}
_LABEL_RE = re.compile(
    r"(?:(?<=^)|(?<=[\s|]))(" + "|".join(re.escape(s) for s, _ in _ALL) + r")\s*(?::|\s-\s)",
    re.IGNORECASE,
)

# Bureau account types → RightDue loan types (engine/models.LoanType).
TYPE_MAP: list[tuple[str, Optional[str], str]] = [
    (r"credit\s*card|charge\s*card", "credit_card", ""),
    (r"loan\s*against\s*property|\blap\b", "personal_loan",
     "A loan against property: added as a personal loan. Check the rate type and the fees."),
    (r"hous|home|mortgage|property", "home_loan", ""),
    (r"two[\s-]*wheeler|auto|car|vehicle", "auto_loan", ""),
    (r"education|student", "education_loan", ""),
    (r"gold", "gold_loan", ""),
    (r"bnpl|buy\s*now|pay\s*later", "bnpl", ""),
    (r"consumer", "personal_loan",
     "A consumer-durable loan (phone, appliance): added as a personal loan. Often 0% with a fee, so check the terms."),
    (r"personal", "personal_loan", ""),
]


@dataclass
class Found:
    value: str
    source: str
    note: str = ""


@dataclass
class Account:
    fields: dict = field(default_factory=dict)       # key → Found
    loan_type: Optional[str] = None
    is_open: bool = True
    is_guarantor: bool = False
    flags: list = field(default_factory=list)       # plain-words warnings for this account
    loan: Optional[dict] = None                      # the proposal for the form (open loans only)


@dataclass
class CreditReportResult:
    bureau: Optional[str]
    bureau_name: Optional[str]
    score: Optional[Found]
    report_date: Optional[Found]
    accounts: list
    warnings: list


# ---------------------------------------------------------------- helpers
def _lines(text: str) -> list[str]:
    text = text.replace("\r", "\n").replace("\u00a0", " ").replace("\u2013", "-").replace("\u2014", "-")
    out = []
    for raw in text.split("\n"):
        line = re.sub(r"[ \t]+", " ", raw).strip()
        if line:
            out.append(line)
    return out


def detect_bureau(text: str) -> Optional[str]:
    head = text[:6000].lower()
    best = None
    for key, (_, pats) in BUREAUS.items():
        for p in pats:
            m = re.search(p, head)
            if m and (best is None or m.start() < best[1]):
                best = (key, m.start())
    return best[0] if best else None


def _pairs(line: str) -> list[tuple[str, str]]:
    """Every (key, raw value) on a line: the text between one label and the next."""
    hits = list(_LABEL_RE.finditer(line))
    out = []
    for i, m in enumerate(hits):
        end = hits[i + 1].start() if i + 1 < len(hits) else len(line)
        value = line[m.end():end].strip(" |;,")
        out.append((_LABEL_TO_KEY[m.group(1).lower()], value))
    return out


_ACCT_VALUE = re.compile(
    r"((?:account number|account no\.?|acct no|acct #|a/c no)\s*(?::|\s-\s)\s*)([0-9A-Za-z][0-9A-Za-z/\-]*)",
    re.IGNORECASE,
)
_PAN = re.compile(r"\b[A-Z]{5}\d{4}[A-Z]\b")


def redact(line: str) -> str:
    """A source line as it may be shown back: account numbers masked to their
    last four, PANs removed. Applied to every source line returned."""
    line = _ACCT_VALUE.sub(lambda m: m.group(1) + (_mask(m.group(2)) or ""), line)
    return _PAN.sub("XXXXX0000X", line)


def _amount(raw: str) -> Optional[Decimal]:
    if not raw or re.fullmatch(r"[-–—\s]*|na|n/a|nil|not reported", raw.strip(), re.IGNORECASE):
        return None
    m = _money(raw)
    if m is not None:
        return m
    nums = re.findall(r"\d[\d,]*(?:\.\d+)?", raw)
    return _dec(nums[0]) if nums else None


def inr(n: Decimal) -> str:
    """₹ with Indian digit grouping: 3500 → ₹3,500; 3812450 → ₹38,12,450 (D-16)."""
    n = n.quantize(D("0.01"))
    whole, _, frac = format(abs(n), "f").partition(".")
    if len(whole) > 3:
        head, tail = whole[:-3], whole[-3:]
        groups = []
        while len(head) > 2:
            groups.insert(0, head[-2:])
            head = head[:-2]
        if head:
            groups.insert(0, head)
        whole = ",".join(groups + [tail])
    out = "₹" + whole + ("." + frac if frac and frac != "00" else "")
    return ("-" if n < 0 else "") + out


def _fmt(n: Decimal) -> str:
    n = n.quantize(D("0.01"))
    s = format(n.normalize(), "f")
    return s


def _mask(raw: str) -> Optional[str]:
    tail = re.sub(r"[^0-9A-Za-z]", "", raw)
    if not tail:
        return None
    return "XXXX" + tail[-4:]


def _months(raw: str) -> Optional[int]:
    m = re.search(r"(\d+)\s*(years?|yrs?|y)\b", raw, re.IGNORECASE)
    if m:
        return int(m.group(1)) * 12
    m = re.search(r"(\d+)", raw)
    return int(m.group(1)) if m else None


def _loan_type(raw: str) -> tuple[Optional[str], str]:
    for pat, kind, note in TYPE_MAP:
        if re.search(pat, raw, re.IGNORECASE):
            return kind, note
    return None, ""



# ---------------------------------------------------------------- layouts
# Bureau PDFs are not all "Label: value". Many print the accounts as a table
# (one header row, one row per account, columns aligned by spaces or "|"), and
# a plain (non-layout) text extraction or a copy-paste from a PDF viewer turns
# that table into one cell per line (all the headers, then each row's cells).
# Some print a label alone on a line with its value on the next. These readers
# turn each of those layouts into "Label: value | Label: value" lines that the
# label reader below understands, and keep the original line as the source the
# user is shown (D-01, UX50).
_SECTION_END = re.compile(r"^(?:enquir(?:y|ies)|inquir(?:y|ies))(?:\s+(?:information|details|section))?\s*:?$", re.IGNORECASE)
_KNOWN_LABELS = {s for s, _ in _ALL}


def _norm_label(cell: str) -> Optional[str]:
    c = re.sub(r"\s+", " ", cell.strip().strip("|:#").strip()).lower()
    c = c.replace("a/c", "account").replace("acct.", "account").replace("amt.", "amount")
    if c in _KNOWN_LABELS:
        return c
    c2 = re.sub(r"\s*\((?:rs\.?|inr|₹|in rs\.?)\)$", "", c)  # "Current Balance (Rs)"
    c2 = re.sub(r"^(?:rs\.?|₹)\s*", "", c2)
    return c2 if c2 in _KNOWN_LABELS else None


def _cells(raw: str) -> list[tuple[int, int, str]]:
    """Cells of a table line: split on "|" when present, else on runs of 2+ spaces."""
    out = []
    if raw.count("|") >= 2:
        pos = 0
        for part in raw.split("|"):
            if part.strip():
                start = pos + (len(part) - len(part.lstrip()))
                out.append((start, start + len(part.strip()), part.strip()))
            pos += len(part) + 1
        return out
    for m in re.finditer(r"\S+(?: \S+)*", raw):
        out.append((m.start(), m.end(), m.group(0)))
    return out


def _header(raw: str) -> Optional[list[tuple[int, int, Optional[str]]]]:
    if ":" in raw or len(raw) > 1000:
        return None
    cells = _cells(raw)
    if len(cells) < 3:
        return None
    labelled = [(a, b, _norm_label(t)) for a, b, t in cells]
    known = [c for c in labelled if c[2]]
    keys = {_LABEL_TO_KEY[c[2]] for c in known}
    if len(known) >= 3 and len(known) * 10 >= len(labelled) * 6 and "lender" in keys and len(keys) == len(known):
        return labelled
    return None


def _row_values(raw: str, header: list[tuple[int, int, Optional[str]]]) -> Optional[list[str]]:
    cells = _cells(raw)
    if len(cells) < 2:
        return None
    vals = [""] * len(header)
    if len(cells) == len(header):
        return [c[2] for c in cells]
    for a, b, t in cells:
        best, best_score = None, None
        for i, (ha, hb, _) in enumerate(header):
            overlap = min(b, hb) - max(a, ha)
            score = (0, overlap) if overlap > 0 else (1, -min(abs(a - ha), abs(b - hb)))
            score = (-score[0], score[1])
            if best_score is None or score > best_score:
                best, best_score = i, score
        if best is not None:
            vals[best] = (vals[best] + " " + t).strip()
    return vals


def _as_pairs(header_labels: list[Optional[str]], values: list[str]) -> str:
    return " | ".join(f"{lab}: {v}" for lab, v in zip(header_labels, values) if lab and v)


def _mask_cells(source: str, labels: list[Optional[str]], values: list[str]) -> str:
    """The source row with its account number masked to the last four (least data)."""
    for lab, v in zip(labels, values):
        if lab and _LABEL_TO_KEY[lab] == "account_number" and v:
            source = source.replace(v, _mask(v) or "")
    return _PAN.sub("XXXXX0000X", source)


def _logical_lines(text: str) -> list[tuple[str, str]]:
    """(line to parse, line to show as the source). Table rows and stacked
    layouts become "Label: value" lines; everything else passes through."""
    text = text.replace("\r", "\n").replace("\u00a0", " ").replace("\u2013", "-").replace("\u2014", "-").replace("\t", "    ")
    raws = [r.rstrip() for r in text.split("\n")]
    raws = [r for r in raws if r.strip()]
    out: list[tuple[str, str]] = []
    i = 0
    n = len(raws)
    while i < n:
        raw = raws[i]
        tidy = re.sub(r"[ \t]+", " ", raw).strip()
        # 1. A table header row, then one row per account.
        head = _header(raw)
        if head:
            labels = [h[2] for h in head]
            j = i + 1
            rows = 0
            while j < n and rows < MAX_ACCOUNTS:
                r = raws[j]
                if _SECTION_END.match(r.strip()) or _header(r) or _LABEL_RE.search(r):
                    break
                vals = _row_values(r, head)
                if vals is None or sum(1 for v in vals if v) < 2:
                    break
                tidy_r = re.sub(r"[ \t]+", " ", r).strip()
                out.append((_as_pairs(labels, vals), _mask_cells(tidy_r, labels, vals)))
                rows += 1
                j += 1
            if rows:
                i = j
                continue
        # 2. Stacked columns: 3+ label-only lines in a row, then the cells one per line.
        if _norm_label(tidy) and ":" not in tidy:
            k = i
            labels = []
            while k < n and _norm_label(raws[k]) and ":" not in raws[k] and len(labels) < 30:
                labels.append(_norm_label(raws[k]))
                k += 1
            keys = [_LABEL_TO_KEY[lab] for lab in labels]
            if len(labels) >= 3 and "lender" in keys and len(set(keys)) == len(keys):
                j = k
                rows = 0
                while j + len(labels) <= n and rows < MAX_ACCOUNTS:
                    chunk = [re.sub(r"[ \t]+", " ", x).strip() for x in raws[j:j + len(labels)]]
                    # A value may itself look like a label ("Closed" in a status column), so only
                    # the lender cell must not be one; a section heading or a "Label:" line ends the table.
                    if _norm_label(chunk[0]) or any(_SECTION_END.match(x) or _LABEL_RE.search(x) for x in chunk):
                        break
                    out.append((_as_pairs(labels, chunk), _mask_cells(" | ".join(chunk), labels, chunk)))
                    rows += 1
                    j += len(labels)
                if rows:
                    i = j
                    continue
            # 3. Stacked pairs: a label alone on a line, its value on the next.
            if i + 1 < n:
                nxt = re.sub(r"[ \t]+", " ", raws[i + 1]).strip()
                after = raws[i + 2].strip() if i + 2 < n else ""
                # "Account Status" / "Closed" / "Date Reported": a label-looking line is the value
                # when the line after it is a label again (or nothing).
                value_like = not _norm_label(nxt) or not after or bool(_norm_label(after)) or bool(_SECTION_END.match(after))
                if value_like and not _LABEL_RE.search(nxt) and not _SECTION_END.match(nxt):
                    out.append((f"{tidy}: {nxt}", f"{tidy}: {nxt}"))
                    i += 2
                    continue
        out.append((tidy, tidy))
        i += 1
    return out


# ---------------------------------------------------------------- parse
def _blocks(lines: list[tuple[str, str]]) -> list[list[tuple[str, str, str]]]:
    """Split into accounts: a new account starts at a lender label when the
    current one already has a lender."""
    blocks: list[list[tuple[str, str, str]]] = []
    cur: list[tuple[str, str, str]] = []
    have_lender = False
    for line, source in lines:
        if _SECTION_END.match(line):
            break  # enquiries and contact details follow the accounts; they aren't debts
        for key, value in _pairs(line):
            if key == "lender":
                if have_lender:
                    blocks.append(cur)
                    cur = []
                have_lender = True
            if have_lender:
                cur.append((key, value, source))
    if cur:
        blocks.append(cur)
    return blocks[:MAX_ACCOUNTS]


def _account(block: list[tuple[str, str, str]], as_of: Optional[date]) -> Optional[Account]:
    acc = Account()
    f = acc.fields
    for key, raw, line in block:
        line = redact(line)
        if key in f or not raw:
            continue  # the first value for a label wins
        if key in ("sanctioned", "credit_limit", "balance", "overdue", "emi"):
            n = _amount(raw)
            if n is not None:
                f[key] = Found(_fmt(n), line)
        elif key == "rate":
            m = re.search(r"(\d+(?:\.\d+)?)\s*%?", raw)
            if m and D(m.group(1)) <= 60:
                f[key] = Found(format((D(m.group(1)) / 100).normalize(), "f"), line)
        elif key == "tenure":
            n = _months(raw)
            if n:
                f[key] = Found(str(n), line)
        elif key in ("opened", "closed", "reported"):
            d = _date(raw)
            if d:
                f[key] = Found(d.isoformat(), line)
        elif key == "account_number":
            m = _mask(raw)
            if m:
                f[key] = Found(m, line)  # the line is redacted: the full number is never echoed back
        elif key == "dpd":
            m = re.search(r"\d+", raw)
            if m:
                f[key] = Found(m.group(0), line)
        else:
            f[key] = Found(raw[:120], line)
    if "lender" not in f or not any(k in f for k in ("account_type", "balance", "sanctioned", "credit_limit")):
        return None

    acc.loan_type, type_note = _loan_type(f["account_type"].value if "account_type" in f else "")
    if type_note:
        f["account_type"].note = type_note
    status = (f["status"].value if "status" in f else "").lower()
    if "closed" in f or re.search(r"\bclosed\b", status):
        acc.is_open = False
    owner = (f["ownership"].value if "ownership" in f else "").lower()
    acc.is_guarantor = "guarant" in owner

    if re.search(r"written[\s-]*off|\bwo\b", status):
        acc.flags.append("Reported as written off. That hurts your credit score until it's cleared; ask the lender for the closure terms in writing.")
    if re.search(r"settled", status):
        acc.flags.append("Reported as settled, not closed. Lenders read 'settled' as paid less than owed; a full closure needs the balance paid and a letter.")
    if "overdue" in f and D(f["overdue"].value) > 0:
        acc.flags.append(f"{inr(D(f['overdue'].value))} is shown overdue on this account. Check it against your own records.")
    if "joint" in owner:
        acc.flags.append("A joint account: add only your share of the EMI if someone else pays part of it.")
    if acc.is_guarantor:
        acc.flags.append("You are a guarantor, not the borrower. It isn't added as your loan, but you'd owe it if the borrower stops paying.")
    if acc.loan_type is None:
        acc.flags.append("This account type isn't one RightDue plans yet. Add it as a personal loan yourself if you repay it.")
    if acc.is_open and "reported" in f and as_of and (as_of - date.fromisoformat(f["reported"].value)).days > 120:
        acc.flags.append("The lender last reported this more than four months ago, so the balance may be out of date.")

    if acc.is_open and not acc.is_guarantor and acc.loan_type:
        bal = f.get("balance")
        acc.loan = {
            "loan_type": acc.loan_type,
            "lender": f["lender"].value,
            "outstanding": bal.value if bal else None,
            "emi": f["emi"].value if "emi" in f else None,
            "nominal_rate": f["rate"].value if "rate" in f else None,
            "tenure_months": f["tenure"].value if "tenure" in f else None,
            "sanctioned_amount": f["sanctioned"].value if "sanctioned" in f else None,
            "credit_limit": f["credit_limit"].value if "credit_limit" in f else None,
            "opened": f["opened"].value if "opened" in f else None,
            "account_last4": f["account_number"].value[-4:] if "account_number" in f else None,
            # The date the lender reported this balance: the balance is as of then, not today (D-06).
            "reported": f["reported"].value if "reported" in f else None,
            # What the report never carries, so the form asks for it (or the KFS import fills it).
            # A card has no EMI, tenure, rate type or KFS prepayment fee: only its APR is asked (D-07).
            "missing": (["nominal_rate"] if "rate" not in f else []) if acc.loan_type == "credit_card" else [
                k for k, present in (
                    ("emi", "emi" in f), ("nominal_rate", "rate" in f), ("tenure_months", "tenure" in f),
                    ("rate_type", False), ("prepayment_fee", False),
                ) if not present],
        }
    return acc


_SCORE_RE = re.compile(
    r"(?:cibil\s*(?:trans\s*union\s*)?score|credit\s*score|experian\s*credit\s*score|perform\s*consumer[\w .]*score|"
    r"equifax\s*risk\s*score[\w .]*|score)\s*(?:\(.*?\))?\s*[:\-]?\s*(\d{3})\b",
    re.IGNORECASE,
)
_REPORT_DATE_RE = re.compile(r"(?:date\s*of\s*report|report\s*date|date\s*of\s*issue|report\s*generated\s*on)\s*[:\-]?\s*(.+)", re.IGNORECASE)


def read_credit_report(text: str, as_of: Optional[date] = None) -> CreditReportResult:
    if len(text) > MAX_TEXT_CHARS:
        raise CreditReportReadError("The report text is too long to read. Upload the PDF instead.", "too_big")
    lines = _lines(text)
    logical = _logical_lines(text)
    if len("".join(lines)) < 40:
        raise CreditReportReadError("There's no text here to read.", "empty")
    bureau = detect_bureau(text)
    warnings: list[str] = []
    if bureau is None:
        warnings.append("This doesn't look like a CIBIL, Experian, CRIF High Mark or Equifax report. Check every figure.")

    score = None
    for line in lines[:120]:
        m = _SCORE_RE.search(line)
        if m and 300 <= int(m.group(1)) <= 900:
            score = Found(m.group(1), redact(line))
            break
    report_date = None
    for line in lines[:80]:
        m = _REPORT_DATE_RE.search(line)
        if m:
            d = _date(m.group(1))
            if d:
                report_date = Found(d.isoformat(), line)
                break

    accounts = [a for a in (_account(b, as_of) for b in _blocks(logical)) if a]
    if not accounts:
        # Honest copy (D-02): when nothing is read, the likeliest cause is a layout we don't read yet.
        raise CreditReportReadError(NO_ACCOUNTS_MESSAGE, "no_accounts")
    if report_date and as_of and (as_of - date.fromisoformat(report_date.value)).days > 90:
        warnings.append("This report is more than three months old; balances will have moved since. A fresh one is free once a year from each bureau.")
    return CreditReportResult(
        bureau=bureau,
        bureau_name=BUREAUS[bureau][0] if bureau else None,
        score=score,
        report_date=report_date,
        accounts=accounts,
        warnings=warnings,
    )


def to_dict(res: CreditReportResult) -> dict:
    def fd(f: Optional[Found]):
        return None if f is None else {"value": f.value, "source": f.source, "note": f.note}

    return {
        "bureau": res.bureau,
        "bureau_name": res.bureau_name,
        "score": fd(res.score),
        "report_date": fd(res.report_date),
        "accounts": [
            {
                "fields": {k: fd(v) for k, v in a.fields.items()},
                "loan_type": a.loan_type,
                "is_open": a.is_open,
                "is_guarantor": a.is_guarantor,
                "flags": a.flags,
                "loan": a.loan,
            }
            for a in res.accounts
        ],
        "open_loans": sum(1 for a in res.accounts if a.loan),
        "warnings": res.warnings,
        "source": CIC_SOURCE,
        "source_url": CIC_SOURCE_URL,
    }
