"""POST /api/complaints/in — complaint letter, deadlines and escalation.

Takes the same loan facts as /api/loan-check and re-runs the check here, so
the amount claimed is always the server's own figure, never one sent in.

No personal details are accepted. Letters come back with placeholders
("[Full name]", "[Loan account number]", …) that the browser fills in, so a
borrower's name and account number never have to leave their device.
"""
from datetime import date
from decimal import Decimal
from typing import Literal, Optional

from fastapi import APIRouter
from pydantic import Field

from api.routes.loan_check import (
    CitationOut, LoanCheckRequest, bad, citation_out, parse_date, run_loan_check,
)
from api.schemas import _Base
from engine.complaint_deadlines import Reply, Timeline, TimelineInputError, india_timeline
from engine.complaints_in import (
    ACCOUNT, ADDRESS, BANK_NAME, BANK_REFERENCE, DRAFT_NOTICE, EMAIL, NAME, OPTIONAL_LINES, PHONE,
    SELF_CHECK,
    Letter, NoResetChoiceIssue, NothingToClaim, OmbudsmanComplaint, grievance_letter,
    io_followup_letter, ombudsman_complaint, reset_choice_letter,
)

router = APIRouter(tags=["complaints"])


class ComplaintRequest(LoanCheckRequest):
    # Leave sent_on out for a draft; add it once the complaint has gone.
    sent_on: Optional[str] = None           # "YYYY-MM-DD"
    received_on: Optional[str] = None       # delivery date, if posted
    reply: Reply = Reply.NONE
    reply_on: Optional[str] = None
    io_reviewed: bool = False               # the reply says the IO reviewed it
    bank_reference: Optional[str] = Field(None, max_length=60)


class AnnexureRowOut(_Base):
    month: str
    should_be: str
    charged: str
    excess: str


class LetterOut(_Base):
    kind: str
    recipient: list[str]
    date_line: str
    subject: str
    paragraphs: list[str]
    requests: list[str]
    closing: list[str]
    sign_off: list[str]
    enclosures: list[str]
    citations: list[CitationOut]
    claim_amount: Decimal
    annexure_title: str
    annexure_note: str
    annexure: list[AnnexureRowOut]
    annexure_total: str
    text: str


class MilestoneOut(_Base):
    key: str
    label: str
    day: str
    state: str
    note: str


class TimelineOut(_Base):
    market: str
    stage: str
    milestones: list[MilestoneOut]
    next_action: str
    days_left: Optional[int]
    escalation_opens: Optional[str]
    escalation_deadline: Optional[str]
    notes: list[str]


class OmbudsmanFieldOut(_Base):
    label: str
    value: str
    hint: str


class OmbudsmanOut(_Base):
    fields: list[OmbudsmanFieldOut]
    facts: str
    relief: str
    declarations: list[str]
    documents: list[str]
    opens: Optional[str]
    deadline: Optional[str]
    how_to_file: list[str]
    citations: list[CitationOut]
    claim_amount: Decimal


class Placeholders(_Base):
    name: str = NAME
    account: str = ACCOUNT
    phone: str = PHONE
    email: str = EMAIL
    address: str = ADDRESS
    bank_reference: str = BANK_REFERENCE
    bank_name: str = BANK_NAME
    # Sign-off lines to drop when the borrower leaves them blank.
    optional_lines: list[str] = list(OPTIONAL_LINES)


class ComplaintResponse(_Base):
    letter: LetterOut
    timeline: Optional[TimelineOut]
    io_followup: Optional[LetterOut]
    ombudsman: Optional[OmbudsmanOut]
    placeholders: Placeholders
    # Critique #54: every letter is a draft the borrower checks and sends.
    draft_notice: str = DRAFT_NOTICE
    self_check: list[str] = list(SELF_CHECK)


def _letter_out(x: Letter) -> LetterOut:
    return LetterOut(
        kind=x.kind, recipient=x.recipient, date_line=x.date_line, subject=x.subject,
        paragraphs=x.paragraphs, requests=x.requests, closing=x.closing,
        sign_off=x.sign_off, enclosures=x.enclosures,
        citations=[citation_out(c) for c in x.citations],
        claim_amount=x.claim_amount, annexure_title=x.annexure_title,
        annexure_note=x.annexure_note,
        annexure=[AnnexureRowOut(**vars(r)) for r in x.annexure],
        annexure_total=x.annexure_total, text=x.text(),
    )


def _timeline_out(t: Timeline) -> TimelineOut:
    return TimelineOut(
        market=t.market, stage=t.stage,
        milestones=[
            MilestoneOut(key=m.key, label=m.label, day=m.day.isoformat(), state=m.state, note=m.note)
            for m in t.milestones
        ],
        next_action=t.next_action, days_left=t.days_left,
        escalation_opens=t.escalation_opens.isoformat() if t.escalation_opens else None,
        escalation_deadline=t.escalation_deadline.isoformat() if t.escalation_deadline else None,
        notes=t.notes,
    )


def _ombudsman_out(c: OmbudsmanComplaint) -> OmbudsmanOut:
    return OmbudsmanOut(
        fields=[OmbudsmanFieldOut(label=f.label, value=f.value, hint=f.hint) for f in c.fields],
        facts=c.facts, relief=c.relief, declarations=c.declarations, documents=c.documents,
        opens=c.opens.isoformat() if c.opens else None,
        deadline=c.deadline.isoformat() if c.deadline else None,
        how_to_file=c.how_to_file,
        citations=[citation_out(x) for x in c.citations],
        claim_amount=c.claim_amount,
    )


def _timeline_field(message: str) -> str:
    m = message.lower()
    if "reply" in m:
        return "reply_on"
    if "received" in m:
        return "received_on"
    return "sent_on"


@router.post("/complaints/in", response_model=ComplaintResponse)
def complaint_in(req: ComplaintRequest) -> ComplaintResponse:
    inp, result = run_loan_check(req)
    sent_on = parse_date("sent_on", req.sent_on) if req.sent_on else None
    received_on = parse_date("received_on", req.received_on) if req.received_on else None
    reply_on = parse_date("reply_on", req.reply_on) if req.reply_on else None
    if sent_on is None and (received_on or reply_on or req.reply != Reply.NONE):
        raise bad("sent_on", "Still needed: the date the complaint was sent.")

    try:
        letter = grievance_letter(inp, result, sent_on=sent_on)
    except NothingToClaim as e:
        raise bad("claim", str(e))

    timeline = io = omb = None
    if sent_on is not None:
        try:
            timeline = india_timeline(
                sent_on, today=inp.as_of, received_on=received_on,
                reply=req.reply, reply_on=reply_on, io_reviewed=req.io_reviewed,
            )
        except TimelineInputError as e:
            raise bad(_timeline_field(str(e)), str(e))
        if timeline.stage == "internal_ombudsman":
            io = io_followup_letter(
                inp, result, sent_on=sent_on, reply=req.reply, reply_on=reply_on,
                received_on=received_on, bank_reference=req.bank_reference, today=inp.as_of,
            )
        if timeline.stage not in ("fixed", "window_closed"):
            omb = ombudsman_complaint(
                inp, result, timeline, sent_on=sent_on, reply=req.reply,
                reply_on=reply_on, bank_reference=req.bank_reference,
            )

    return ComplaintResponse(
        letter=_letter_out(letter),
        timeline=_timeline_out(timeline) if timeline else None,
        io_followup=_letter_out(io) if io else None,
        ombudsman=_ombudsman_out(omb) if omb else None,
        placeholders=Placeholders(),
    )


# ─────────────────────────────────────────────────────────────────────────────
# EMI raised or tenure extended without the choice (audit 80+ A11)
# ─────────────────────────────────────────────────────────────────────────────

class ResetChoiceRequest(LoanCheckRequest):
    # What the borrower wants applied: a higher EMI (same end date), a longer
    # tenure (same EMI), or "undecided" (ask for the options first).
    preference: Literal["emi", "tenure", "undecided"] = "undecided"


class ResetChoiceResponse(_Base):
    letter: LetterOut
    placeholders: Placeholders
    draft_notice: str = DRAFT_NOTICE


@router.post("/complaints/in/reset-choice", response_model=ResetChoiceResponse)
def reset_choice(req: ResetChoiceRequest) -> ResetChoiceResponse:
    """A letter for "my EMI (or tenure) was raised after the rate rise and I
    was never offered the choice". Re-runs Loan Check so the finding and
    figures are the server's own; claims no money."""
    inp, result = run_loan_check(req)
    try:
        letter = reset_choice_letter(inp, result, preference=req.preference)
    except NoResetChoiceIssue as e:
        raise bad("choice_offered", str(e))
    return ResetChoiceResponse(letter=_letter_out(letter), placeholders=Placeholders())
