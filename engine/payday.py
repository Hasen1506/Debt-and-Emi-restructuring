"""Payday email: "this month, pay these, in this order" (grill #2, add #3).

The web app already works out this month's payments (Home's "Pay this
month", lib/pay-this-month.ts, read off the same engine run as /plan). When
a signed-in user turns the payday email on, the app sends the server a
*snapshot* of those rows: a name, an amount and a kind for each payment,
and nothing else (no account numbers, no balances, no lender UPI IDs).
This module checks that snapshot and turns it into the email. It never
re-runs the plan: the server doesn't hold the plan, and running a second
copy of the maths here is how two answers would start to disagree.

RightDue can't see the user's bank. The email says so, and asks the user to
tell us what went out: three signed links (all paid / some / couldn't pay),
or a reply that says "done" when inbound email is configured.

Pure functions only. Sending, tokens and storage live in api/notify.
"""
from __future__ import annotations

import calendar
import html
import re
from dataclasses import dataclass, field
from datetime import date, timedelta
from decimal import ROUND_HALF_UP, Decimal, InvalidOperation
from typing import Any, Optional

D = Decimal

MAX_ROWS = 20
NAME_MAX = 60
MAX_AMOUNT = D("1000000000")          # a typo guard, not a business rule
# A snapshot older than this is shown with "open the app to refresh":
# the plan has moved on (a payment logged, a rate changed) since.
STALE_AFTER_DAYS = 40
# If the scheduler misses payday by more than this, skip the month rather
# than email a "payday" list a week late.
LATE_SEND_GRACE_DAYS = 3

KINDS = {"emi", "minimum", "extra", "clears", "ef", "goals"}
KIND_LABEL = {
    "emi": "EMI",
    "minimum": "minimum due",
    "extra": "EMI + extra",
    "clears": "pays it off",
    "ef": "to your emergency fund",
    "goals": "to your goals",
}
CURRENCIES = {"INR": "₹", "USD": "$"}


class SnapshotError(ValueError):
    pass


@dataclass(frozen=True)
class PayRow:
    name: str
    amount: Decimal
    currency: str
    kind: str
    due_day: Optional[int] = None


@dataclass(frozen=True)
class Snapshot:
    month: str               # "YYYY-MM" the rows are for
    made_on: date            # the day the app computed them
    country: str             # "IN" | "US"
    currency: str            # the user's currency, for the total
    rows: tuple[PayRow, ...]
    total: Decimal


@dataclass
class Digest:
    subject: str
    text: str
    html: str
    stale: bool
    notes: list[str] = field(default_factory=list)


# ── input ───────────────────────────────────────────────────────────────────

_CTRL = re.compile(r"[\x00-\x1f\x7f<>]")


def _clean_name(raw: Any) -> str:
    s = _CTRL.sub(" ", str(raw or "")).strip()
    s = re.sub(r"\s+", " ", s)[:NAME_MAX].strip()
    if not s:
        raise SnapshotError("Each payment needs a name.")
    return s


def _amount(raw: Any) -> Decimal:
    try:
        v = D(str(raw))
    except (InvalidOperation, ValueError):
        raise SnapshotError("An amount is not a number.") from None
    if not v.is_finite() or v <= 0 or v > MAX_AMOUNT:
        raise SnapshotError("An amount is out of range.")
    return v.quantize(D("1"), rounding=ROUND_HALF_UP)


def parse_snapshot(data: dict) -> Snapshot:
    """Check what the app sent. Raises SnapshotError with a plain message."""
    if not isinstance(data, dict):
        raise SnapshotError("The payment list is missing.")
    month = str(data.get("month", ""))
    if not re.fullmatch(r"\d{4}-(0[1-9]|1[0-2])", month):
        raise SnapshotError("The month should look like 2026-11.")
    try:
        made_on = date.fromisoformat(str(data.get("made_on", "")))
    except ValueError:
        raise SnapshotError("The date the list was made is missing.") from None
    country = str(data.get("country", ""))
    if country not in ("IN", "US"):
        raise SnapshotError("Country should be IN or US.")
    currency = str(data.get("currency", ""))
    if currency not in CURRENCIES:
        raise SnapshotError("Currency should be INR or USD.")
    raw_rows = data.get("rows")
    if not isinstance(raw_rows, list) or not raw_rows:
        raise SnapshotError("There are no payments in the list.")
    if len(raw_rows) > MAX_ROWS:
        raise SnapshotError(f"At most {MAX_ROWS} payments.")
    rows = []
    for r in raw_rows:
        if not isinstance(r, dict):
            raise SnapshotError("A payment row is not readable.")
        kind = str(r.get("kind", ""))
        if kind not in KINDS:
            raise SnapshotError("A payment has an unknown kind.")
        ccy = str(r.get("currency", currency))
        if ccy not in CURRENCIES:
            raise SnapshotError("A payment has an unknown currency.")
        due = r.get("due_day")
        due_day = None
        if due not in (None, ""):
            try:
                due_day = int(due)
            except (TypeError, ValueError):
                raise SnapshotError("A due day is not a number.") from None
            if not 1 <= due_day <= 31:
                raise SnapshotError("A due day should be 1 to 31.")
        rows.append(PayRow(_clean_name(r.get("name")), _amount(r.get("amount")), ccy, kind, due_day))
    total = sum((r.amount for r in rows if r.currency == currency), D("0"))
    return Snapshot(month, made_on, country, currency, tuple(rows), total)


def snapshot_to_json(s: Snapshot) -> dict:
    return {
        "month": s.month,
        "made_on": s.made_on.isoformat(),
        "country": s.country,
        "currency": s.currency,
        "rows": [
            {"name": r.name, "amount": str(r.amount), "currency": r.currency, "kind": r.kind,
             **({"due_day": r.due_day} if r.due_day else {})}
            for r in s.rows
        ],
    }


# ── when ────────────────────────────────────────────────────────────────────

def payday_in(year: int, month: int, day: int) -> date:
    """The payday in a given month. Day 31 in a 30-day month is the 30th;
    day 30 in February is the 28th or 29th (the last day, as payroll does)."""
    if not 1 <= day <= 31:
        raise ValueError("payday must be 1 to 31")
    return date(year, month, min(day, calendar.monthrange(year, month)[1]))


def due_payday(today: date, payday_day: int, last_sent_month: Optional[str]) -> Optional[date]:
    """This month's payday if the email should go out today, else None.

    Goes out on payday or up to LATE_SEND_GRACE_DAYS after (a missed cron
    run catches up), once a month.
    """
    pd = payday_in(today.year, today.month, payday_day)
    if last_sent_month == f"{today:%Y-%m}":
        return None
    if pd <= today <= pd + timedelta(days=LATE_SEND_GRACE_DAYS):
        return pd
    return None


# ── words ───────────────────────────────────────────────────────────────────

def money(amount: Decimal, currency: str) -> str:
    """₹12,34,567 (Indian grouping) or $1,234,567."""
    n = int(D(amount).quantize(D("1"), rounding=ROUND_HALF_UP))
    sign = "-" if n < 0 else ""
    s = str(abs(n))
    if currency == "INR":
        if len(s) > 3:
            head, tail = s[:-3], s[-3:]
            groups = []
            while len(head) > 2:
                groups.insert(0, head[-2:])
                head = head[:-2]
            if head:
                groups.insert(0, head)
            s = ",".join(groups) + "," + tail
    else:
        s = f"{abs(n):,}"
    return f"{sign}{CURRENCIES[currency]}{s}"


def _long(d: date) -> str:
    return f"{d.day} {d:%B %Y}"


def _ordinal(n: int) -> str:
    suffix = "th" if 10 <= n % 100 <= 20 else {1: "st", 2: "nd", 3: "rd"}.get(n % 10, "th")
    return f"{n}{suffix}"


def build_digest(
    snap: Snapshot,
    *,
    today: date,
    links: dict[str, str],
    reply_enabled: bool = False,
) -> Digest:
    """The email. `links` needs: all_paid, some_paid, cant_pay, open_app,
    unsubscribe (absolute URLs; the API signs them)."""
    for k in ("all_paid", "some_paid", "cant_pay", "open_app", "unsubscribe"):
        if not links.get(k):
            raise ValueError(f"missing link: {k}")
    stale = (today - snap.made_on).days > STALE_AFTER_DAYS
    loans = [r for r in snap.rows if r.kind not in ("ef", "goals")]
    n = len(snap.rows)
    subject = f"Payday: {money(snap.total, snap.currency)} across {n} payment{'s' if n != 1 else ''}, in this order"

    notes: list[str] = []
    if stale:
        notes.append(
            f"This list is from your plan on {_long(snap.made_on)}. Open RightDue to "
            "refresh it before you pay: a payment you logged or a rate change since "
            "then moves the amounts."
        )
    elif snap.month != f"{today:%Y-%m}":
        notes.append(
            f"This is the list from your plan on {_long(snap.made_on)}. Open RightDue to see "
            "this month's: a loan that cleared or an amount that changed shows there first."
        )
    other_ccy = {r.currency for r in snap.rows} - {snap.currency}
    if other_ccy:
        notes.append("The total counts only the payments in your own currency.")

    lines = []
    for i, r in enumerate(snap.rows, 1):
        due = f" (due on the {_ordinal(r.due_day)})" if r.due_day else ""
        lines.append(f"{i}. {r.name}: {money(r.amount, r.currency)}, {KIND_LABEL[r.kind]}{due}")
    first = loans[0] if loans else None
    why = (
        f"Pay the EMIs and minimums first so nothing is late. The extra goes to {first.name}."
        if first and any(r.kind in ("extra", "clears") for r in loans)
        else "Pay them in this order so nothing is late."
    )
    honesty = (
        "RightDue can't see your bank account, so we don't know what went out. "
        "Tell us with one tap:"
    )
    reply_line = 'Or just reply to this email with the word "done".' if reply_enabled else ""

    text_parts = [
        f"This month ({_long(today)}), your plan says:",
        "",
        *lines,
        "",
        f"Total: {money(snap.total, snap.currency)}",
        why,
        *(["", *notes] if notes else []),
        "",
        honesty,
        f"- All paid: {links['all_paid']}",
        f"- Paid some of it: {links['some_paid']}",
        f"- I can't pay this month: {links['cant_pay']}",
        *([reply_line] if reply_line else []),
        "",
        f"Open your plan: {links['open_app']}",
        "",
        "These amounts come from RightDue's engine and the numbers you entered. "
        "They are estimates, not financial advice.",
        f"You get this because you turned on payday emails. Turn them off: {links['unsubscribe']}",
    ]
    text = "\n".join(text_parts)

    e = html.escape
    btn = ("display:inline-block;padding:10px 14px;margin:4px 6px 4px 0;border:1px solid #111;"
           "color:#111;text-decoration:none;font-weight:600")
    rows_html = "".join(
        f"<tr><td style='padding:4px 8px 4px 0'>{i}.</td><td style='padding:4px 8px'>{e(r.name)}"
        f"{e(f' (due on the {_ordinal(r.due_day)})') if r.due_day else ''}</td>"
        f"<td style='padding:4px 8px;text-align:right;font-family:monospace'>{e(money(r.amount, r.currency))}</td>"
        f"<td style='padding:4px 0;color:#555'>{e(KIND_LABEL[r.kind])}</td></tr>"
        for i, r in enumerate(snap.rows, 1)
    )
    notes_html = "".join(f"<p style='color:#8a5a00'>{e(x)}</p>" for x in notes)
    html_body = (
        f"<p>This month ({e(_long(today))}), your plan says:</p>"
        f"<table style='border-collapse:collapse'>{rows_html}</table>"
        f"<p><strong>Total: {e(money(snap.total, snap.currency))}</strong><br>{e(why)}</p>"
        f"{notes_html}"
        f"<p>{e(honesty)}</p>"
        f"<p><a style='{btn}' href='{e(links['all_paid'])}'>All paid</a>"
        f"<a style='{btn}' href='{e(links['some_paid'])}'>Paid some of it</a>"
        f"<a style='{btn}' href='{e(links['cant_pay'])}'>I can't pay this month</a></p>"
        + (f"<p>{e(reply_line)}</p>" if reply_line else "")
        + f"<p><a href='{e(links['open_app'])}'>Open your plan</a></p>"
        f"<p style='font-size:12px;color:#666'>These amounts come from RightDue's engine and the "
        f"numbers you entered. They are estimates, not financial advice.<br>"
        f"You get this because you turned on payday emails. "
        f"<a href='{e(links['unsubscribe'])}'>Turn them off</a>.</p>"
    )
    return Digest(subject=subject, text=text, html=html_body, stale=stale, notes=notes)


# ── replies ─────────────────────────────────────────────────────────────────

_DONE = re.compile(r"^\s*(done|paid|all paid|yes|ok|okay|ho gaya|हो गया|முடிந்தது)\b[\s.!]*", re.I)
_NOT = re.compile(r"\b(not|didn'?t|did not|couldn'?t|can'?t|cannot|no)\b", re.I)


def reply_says_done(text: str) -> Optional[bool]:
    """Read the first line the user typed above the quoted email.

    True: it says done. False: it says not paid. None: we can't tell (the
    user gets a "we couldn't read that" reply and the links again). Only
    the reply's first non-empty, non-quoted line counts, so the quoted
    original ("Reply 'done'") can never confirm itself.
    """
    for raw in (text or "").splitlines():
        line = raw.strip()
        if not line:
            continue
        if line.startswith(">") or re.match(r"^On .+ wrote:$", line):
            return None
        if _NOT.search(line):
            return False
        return True if _DONE.match(line) else None
    return None
