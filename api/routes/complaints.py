"""POST /api/complaints/in — complaint letter, deadlines and escalation.
POST /api/complaints/us — US card billing error (FCBA) or mortgage notice of
error (RESPA): draft letter with the address rule, deadlines, CFPB hand-off
(audit 80+ D11).

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
from engine.complaint_deadlines import (
    Reply, Timeline, TimelineInputError, india_timeline,
    us_billing_error_timeline, us_notice_of_error_timeline,
)
from engine.complaints_us import UsLetter, fcba_billing_error_letter, respa_notice_of_error_letter
from engine.complaints_in import (
    ACCOUNT, ADDRESS, BANK_NAME, BANK_REFERENCE, DRAFT_NOTICE, EMAIL, NAME, OPTIONAL_LINES, PHONE,
    SELF_CHECK,
    Letter, NothingToClaim, OmbudsmanComplaint, grievance_letter,
    io_followup_letter, ombudsman_complaint,
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


# ── US: FCBA billing error / RESPA notice of error (audit 80+ D11) ─────────

class UsComplaintRequest(_Base):
    kind: Literal["fcba_billing_error", "respa_notice_of_error"]
    # FCBA only: the date of the first statement that showed the error.
    statement_on: Optional[str] = None
    sent_on: Optional[str] = None           # leave out for a draft
    received_on: Optional[str] = None
    acknowledged_on: Optional[str] = None
    resolved_on: Optional[str] = None       # FCBA resolution / RESPA response
    extended: bool = False                  # RESPA: servicer extended by 15 days
    as_of: Optional[str] = None


class UsLetterOut(_Base):
    kind: str
    send_to: str
    subject: str
    paragraphs: list[str]
    how_to_send: list[str]
    if_no_answer: list[str]
    sources: list[str]
    draft_notice: str
    text: str


class UsComplaintResponse(_Base):
    letter: UsLetterOut
    timeline: Optional[TimelineOut]


def _us_letter_out(x: UsLetter) -> UsLetterOut:
    return UsLetterOut(
        kind=x.kind, send_to=x.send_to, subject=x.subject, paragraphs=x.paragraphs,
        how_to_send=x.how_to_send, if_no_answer=x.if_no_answer, sources=x.sources,
        draft_notice=x.draft_notice, text=x.text(),
    )


@router.post("/complaints/us", response_model=UsComplaintResponse)
def complaint_us(req: UsComplaintRequest) -> UsComplaintResponse:
    def opt(name: str) -> Optional[date]:
        v = getattr(req, name)
        return parse_date(name, v) if v else None

    today = opt("as_of") or date.today()
    sent_on, received_on = opt("sent_on"), opt("received_on")
    acknowledged_on, resolved_on = opt("acknowledged_on"), opt("resolved_on")
    statement_on = opt("statement_on")
    if sent_on is None and (received_on or acknowledged_on or resolved_on):
        raise bad("sent_on", "Still needed: the date the notice was sent.")

    timeline = None
    try:
        if req.kind == "fcba_billing_error":
            letter = fcba_billing_error_letter()
            if sent_on is not None:
                if statement_on is None:
                    raise bad("statement_on", "Still needed: the date of the first statement that showed the error.")
                timeline = us_billing_error_timeline(
                    statement_on, sent_on, today=today, received_on=received_on,
                    acknowledged_on=acknowledged_on, resolved_on=resolved_on,
                )
        else:
            letter = respa_notice_of_error_letter()
            if sent_on is not None:
                timeline = us_notice_of_error_timeline(
                    sent_on, today=today, received_on=received_on,
                    acknowledged_on=acknowledged_on, responded_on=resolved_on,
                    extended=req.extended,
                )
    except TimelineInputError as e:
        msg = str(e)
        low = msg.lower()
        field = ("statement_on" if "statement" in low else "resolved_on" if "reply" in low
                 else _timeline_field(msg))
        raise bad(field, msg)

    return UsComplaintResponse(
        letter=_us_letter_out(letter),
        timeline=_timeline_out(timeline) if timeline else None,
    )
