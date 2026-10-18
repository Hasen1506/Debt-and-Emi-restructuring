"""Complaint deadline tracker: sent → reply due → escalation open → last day.

Every clock runs from the day the lender *received* the complaint. If the
receipt date is not known, the day it was sent is used and the timeline
says so; for a posted letter the real dates are later by the delivery time.

India (RB-IOS 2026 and the Commercial Banks – Internal Ombudsman
Directions, 2026; see engine/citations.py, checked 12 Oct 2026):
- the bank's final reply is due 30 days after receipt (IO Directions
  clause 14(9));
- a partially resolved or wholly rejected complaint is escalated
  automatically to the bank's Internal Ombudsman inside those same 30 days
  (clause 14(1));
- the RBI Ombudsman is open once a final reply leaves the complaint
  unresolved, or once 30 days pass with no reply;
- it must be reached within 90 days of the later of the end of the reply
  period and the bank's last reply. (Not a year: that was RB-IOS 2021.)

US:
- mortgage notice of error (RESPA, Reg X 12 CFR 1024.35): acknowledgement
  within 5 days and response within 30 days, excluding legal public
  holidays, Saturdays and Sundays; the servicer may extend the response by
  15 such days once, with notice.
- card billing error (FCBA, Reg Z 12 CFR 1026.13): the notice must reach
  the issuer, at the billing-error address on the statement (s.13(b)(1)),
  within 60 days of the statement that first showed the error;
  acknowledgement within 30 days; resolution within two complete billing
  cycles and never later than 90 days. Billing cycles are not known here,
  so the 90-day outer limit is shown.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date, timedelta
from enum import Enum
from typing import Optional

REPLY_DAYS_IN = 30
OMBUDSMAN_WINDOW_DAYS_IN = 90
RESPA_ACK_BUSINESS_DAYS = 5
RESPA_RESPONSE_BUSINESS_DAYS = 30
RESPA_EXTENSION_BUSINESS_DAYS = 15
FCBA_NOTICE_DAYS = 60
FCBA_ACK_DAYS = 30
FCBA_RESOLVE_DAYS = 90


class Reply(str, Enum):
    NONE = "none"            # nothing yet
    FIXED = "fixed"          # fixed in full
    PARTLY = "partly"        # partly accepted
    REJECTED = "rejected"    # rejected in full


@dataclass(frozen=True)
class Milestone:
    key: str
    label: str
    day: date
    state: str               # done | due | overdue | upcoming | missed
    note: str = ""


@dataclass
class Timeline:
    market: str
    stage: str
    milestones: list[Milestone]
    next_action: str
    # Days until the next date the borrower must act by (negative = passed).
    days_left: Optional[int] = None
    escalation_opens: Optional[date] = None
    escalation_deadline: Optional[date] = None
    notes: list[str] = field(default_factory=list)


class TimelineInputError(ValueError):
    pass


def _long(d: date) -> str:
    return f"{d.day} {d:%B %Y}"


def _check_order(sent_on: date, received_on: Optional[date], reply_on: Optional[date], today: date) -> date:
    if sent_on > today:
        raise TimelineInputError("The date sent is in the future.")
    received = received_on or sent_on
    if received < sent_on:
        raise TimelineInputError("The date received is before the date sent.")
    if received > today:
        raise TimelineInputError("The date received is in the future.")
    if reply_on is not None:
        if reply_on < sent_on:
            raise TimelineInputError("The reply date is before the complaint was sent.")
        if reply_on > today:
            raise TimelineInputError("The reply date is in the future.")
    return received


# ── India ───────────────────────────────────────────────────────────────────

def india_timeline(
    sent_on: date,
    today: date,
    received_on: Optional[date] = None,
    reply: Reply = Reply.NONE,
    reply_on: Optional[date] = None,
    io_reviewed: bool = False,
) -> Timeline:
    """`io_reviewed`: the bank's reply says the Internal Ombudsman looked at it."""
    received = _check_order(sent_on, received_on, reply_on, today)
    if reply != Reply.NONE and reply_on is None:
        raise TimelineInputError("Still needed: the date of the bank's reply.")

    notes = []
    if received_on is None:
        notes.append(
            "Dates are counted from the day the complaint was sent. If it went "
            "by post, enter the delivery date to count from when the bank got it."
        )

    reply_due = received + timedelta(days=REPLY_DAYS_IN)
    ms = [Milestone("sent", "Complaint sent", sent_on, "done")]

    if reply == Reply.FIXED:
        ms.append(Milestone("reply", "Bank fixed it", reply_on, "done"))
        return Timeline(
            market="IN", stage="fixed", milestones=ms, notes=notes,
            next_action=(
                "Fixed. Check that the next loan statement shows the new rate "
                "and the refund or credit."
            ),
        )

    rejected = reply in (Reply.PARTLY, Reply.REJECTED)
    final_reply = rejected and io_reviewed
    # Opens on a final unsatisfactory reply, or the day after 30 days of
    # waiting for one — whichever comes first.
    no_reply_opens = reply_due + timedelta(days=1)
    opens = min(reply_on, no_reply_opens) if final_reply else no_reply_opens
    last_contact = reply_on if rejected else None
    deadline = max(reply_due, last_contact or reply_due) + timedelta(days=OMBUDSMAN_WINDOW_DAYS_IN)

    if rejected:
        ms.append(Milestone(
            "reply",
            "Bank rejected it" if reply == Reply.REJECTED else "Bank partly accepted it",
            reply_on, "done",
        ))
        if not io_reviewed:
            ms.append(Milestone(
                "io_decision", "Internal Ombudsman's final decision due", reply_due,
                "overdue" if today > reply_due else "due",
                "The bank must send a rejected complaint to its Internal Ombudsman itself.",
            ))
    else:
        ms.append(Milestone(
            "reply", "Bank's reply due", reply_due,
            "overdue" if today > reply_due else "due",
        ))

    ms.append(Milestone(
        "ombudsman_opens", "RBI Ombudsman open from", opens,
        "done" if today >= opens else "upcoming",
    ))
    ms.append(Milestone(
        "ombudsman_deadline", "Last day to file with the RBI Ombudsman", deadline,
        "missed" if today > deadline else ("due" if today >= opens else "upcoming"),
        "90 days under the 2026 scheme, not a year.",
    ))

    if today > deadline:
        stage = "window_closed"
        next_action = (
            f"The 90-day window to go to the RBI Ombudsman closed on "
            f"{_long(deadline)}. A consumer commission complaint may still be "
            f"possible; get advice."
        )
        days_left = (deadline - today).days
    elif today >= opens:
        stage = "ombudsman_open"
        next_action = (
            f"File with the RBI Ombudsman at cms.rbi.org.in by {_long(deadline)}. "
            f"It is free."
        )
        days_left = (deadline - today).days
    elif rejected:
        stage = "internal_ombudsman"
        next_action = (
            f"The bank rejected the complaint without saying its Internal "
            f"Ombudsman reviewed it. Send the follow-up asking for that review. "
            f"The final decision is due by {_long(reply_due)}; if it does not "
            f"come, the RBI Ombudsman opens on {_long(opens)}."
        )
        days_left = (reply_due - today).days
    else:
        stage = "awaiting_reply"
        next_action = (
            f"Wait for the bank's reply, due by {_long(reply_due)}. If none "
            f"comes, the RBI Ombudsman opens on {_long(opens)}."
        )
        days_left = (reply_due - today).days

    return Timeline(
        market="IN", stage=stage, milestones=ms, next_action=next_action,
        days_left=days_left, escalation_opens=opens, escalation_deadline=deadline,
        notes=notes,
    )


# ── US business days ────────────────────────────────────────────────────────

def _nth_weekday(year: int, month: int, weekday: int, n: int) -> date:
    d = date(year, month, 1)
    d += timedelta(days=(weekday - d.weekday()) % 7)
    return d + timedelta(weeks=n - 1)


def _last_weekday(year: int, month: int, weekday: int) -> date:
    d = date(year + month // 12, month % 12 + 1, 1) - timedelta(days=1)
    return d - timedelta(days=(d.weekday() - weekday) % 7)


def _observed(d: date) -> date:
    if d.weekday() == 5:
        return d - timedelta(days=1)
    if d.weekday() == 6:
        return d + timedelta(days=1)
    return d


def us_legal_public_holidays(year: int) -> set[date]:
    """5 U.S.C. 6103 holidays, on the dates they are observed."""
    mon, thu = 0, 3
    return {
        _observed(date(year, 1, 1)),
        _nth_weekday(year, 1, mon, 3),      # Birthday of Martin Luther King, Jr.
        _nth_weekday(year, 2, mon, 3),      # Washington's Birthday
        _last_weekday(year, 5, mon),        # Memorial Day
        _observed(date(year, 6, 19)),       # Juneteenth
        _observed(date(year, 7, 4)),
        _nth_weekday(year, 9, mon, 1),      # Labor Day
        _nth_weekday(year, 10, mon, 2),     # Columbus Day
        _observed(date(year, 11, 11)),      # Veterans Day
        _nth_weekday(year, 11, thu, 4),     # Thanksgiving
        _observed(date(year, 12, 25)),
    }


def _is_business_day(d: date) -> bool:
    if d.weekday() >= 5:
        return False
    # New Year's Day on a Saturday is observed on 31 Dec of the year before.
    return d not in us_legal_public_holidays(d.year) | us_legal_public_holidays(d.year + 1)


def add_business_days(start: date, n: int) -> date:
    """The day `n` business days after `start` (start itself not counted)."""
    d = start
    left = n
    while left > 0:
        d += timedelta(days=1)
        if _is_business_day(d):
            left -= 1
    return d


def _state(today: date, due: date, done: bool) -> str:
    if done:
        return "done"
    return "overdue" if today > due else "due"


# ── US mortgage: notice of error (RESPA / Reg X) ───────────────────────────

def us_notice_of_error_timeline(
    sent_on: date,
    today: date,
    received_on: Optional[date] = None,
    acknowledged_on: Optional[date] = None,
    responded_on: Optional[date] = None,
    extended: bool = False,
) -> Timeline:
    received = _check_order(sent_on, received_on, responded_on, today)
    notes = []
    if received_on is None:
        notes.append(
            "Dates are counted from the day the notice was sent. Enter the "
            "delivery date from the tracking to count from receipt."
        )
    notes.append(
        "Send it to the servicer's designated address for notices of error, "
        "if it has one; a notice sent elsewhere may not start these clocks."
    )
    ack_due = add_business_days(received, RESPA_ACK_BUSINESS_DAYS)
    resp_due = add_business_days(received, RESPA_RESPONSE_BUSINESS_DAYS)
    ext_due = add_business_days(resp_due, RESPA_EXTENSION_BUSINESS_DAYS)
    final_due = ext_due if extended else resp_due

    ms = [
        Milestone("sent", "Notice of error sent", sent_on, "done"),
        Milestone("ack", "Acknowledgement due", ack_due,
                  _state(today, ack_due, acknowledged_on is not None),
                  "5 business days from receipt."),
        Milestone("response", "Response due", resp_due,
                  "done" if responded_on else ("upcoming" if extended else _state(today, resp_due, False)),
                  "30 business days from receipt."),
    ]
    if extended:
        ms.append(Milestone("response_ext", "Extended response due", ext_due,
                            _state(today, ext_due, responded_on is not None),
                            "Extension of 15 business days, notified by the servicer."))

    if responded_on:
        stage = "responded"
        next_action = (
            "Check the response: it must correct the error or explain why the "
            "servicer believes there was none. If it does neither, complain to "
            "the CFPB at consumerfinance.gov/complaint."
        )
        days_left = None
    elif today > final_due:
        stage = "overdue"
        next_action = (
            f"The response was due on {_long(final_due)}. Complain to the CFPB "
            f"at consumerfinance.gov/complaint and keep a copy of the notice "
            f"and proof of delivery."
        )
        days_left = (final_due - today).days
    else:
        stage = "awaiting_reply"
        next_action = f"Wait for the servicer's response, due by {_long(final_due)}."
        days_left = (final_due - today).days

    return Timeline(
        market="US", stage=stage, milestones=ms, next_action=next_action,
        days_left=days_left, escalation_opens=final_due + timedelta(days=1),
        notes=notes,
    )


# ── US card: billing error (FCBA / Reg Z) ───────────────────────────────────

def us_billing_error_timeline(
    statement_on: date,
    sent_on: date,
    today: date,
    received_on: Optional[date] = None,
    acknowledged_on: Optional[date] = None,
    resolved_on: Optional[date] = None,
) -> Timeline:
    """`statement_on`: the date the first statement showing the error was sent."""
    if statement_on > sent_on:
        raise TimelineInputError("The statement date is after the notice was sent.")
    received = _check_order(sent_on, received_on, resolved_on, today)
    notes = []
    if received_on is None:
        notes.append(
            "Dates are counted from the day the notice was sent. Enter the "
            "delivery date to count from receipt."
        )
    # Audit 80+ D11: Reg Z 12 CFR 1026.13(b)(1): the notice must be "received
    # by a creditor at the address disclosed under § 1026.7(a)(9) or (b)(9)"
    # (the billing-rights address on the statement), not the payment address.
    # https://www.consumerfinance.gov/rules-policy/regulations/1026/13/ (read 14 Oct 2026)
    notes.append(
        "Send it to the billing-error (\"billing rights\") address printed on "
        "the statement, not the payment address; a notice sent elsewhere may "
        "not start these protections. Send it in writing (or electronically "
        "only if the statement says the issuer accepts that)."
    )
    notes.append(
        "Resolution is due within two complete billing cycles, and never later "
        "than 90 days; the 90-day limit is shown."
    )
    notice_by = statement_on + timedelta(days=FCBA_NOTICE_DAYS)
    ack_due = received + timedelta(days=FCBA_ACK_DAYS)
    resolve_due = received + timedelta(days=FCBA_RESOLVE_DAYS)
    on_time = received <= notice_by

    ms = [
        Milestone("notice_by", "Issuer must receive the notice by", notice_by,
                  "done" if on_time else "missed",
                  "60 days from the statement that first showed the error."),
        Milestone("sent", "Billing-error notice sent", sent_on, "done"),
        Milestone("ack", "Acknowledgement due", ack_due,
                  "done" if (acknowledged_on or (resolved_on and resolved_on <= ack_due))
                  else _state(today, ack_due, False),
                  "Not needed if the error is resolved within 30 days."),
        Milestone("resolve", "Resolution due (outer limit)", resolve_due,
                  _state(today, resolve_due, resolved_on is not None)),
    ]
    if not on_time:
        stage = "late_notice"
        next_action = (
            f"The notice reached the issuer after {_long(notice_by)}, so the "
            f"billing-error protections may not apply. Ask the issuer anyway, "
            f"and consider a CFPB complaint."
        )
        days_left = None
    elif resolved_on:
        stage = "resolved"
        next_action = "Check the next statement shows the correction."
        days_left = None
    elif today > resolve_due:
        stage = "overdue"
        next_action = (
            f"Resolution was due by {_long(resolve_due)}. Complain to the CFPB "
            f"at consumerfinance.gov/complaint."
        )
        days_left = (resolve_due - today).days
    else:
        stage = "awaiting_reply"
        next_action = (
            f"While the dispute is open, the disputed amount does not have to be "
            f"paid. Resolution is due by {_long(resolve_due)} at the latest."
        )
        days_left = (resolve_due - today).days

    return Timeline(
        market="US", stage=stage, milestones=ms, next_action=next_action,
        days_left=days_left, escalation_opens=resolve_due + timedelta(days=1),
        notes=notes,
    )
