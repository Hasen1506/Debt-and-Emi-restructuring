"""India complaint letters for a missed repo-rate cut, and the escalation path.

1. Grievance letter to the bank (Principal Nodal Officer / Grievance
   Redressal Officer).
2. If the bank rejects it wholly or partly without an Internal Ombudsman
   review: a follow-up asking for that review.
3. When the RBI Ombudsman opens: the complaint pre-filled for
   cms.rbi.org.in.

Rules every letter follows (tested by the fuzz suite):
- It claims **only** the missed rate cut. "The bank charges new borrowers
  less" is never claimed: no bank has to refund that, and asking for it
  weakens the complaint. (A lost version summed every finding.)
- Facts are in the third person and the letter never says "you": a letter
  is read by the bank, and app copy's "you" means the borrower.
- Amounts come from the Loan Check result, never recomputed here, and are
  never negative.
- Personal details are placeholders unless given. The web app fills them in
  the browser, so a name and account number need not reach the server.
- Nothing is sent for the borrower. Every letter is a draft: the screen
  shows DRAFT_NOTICE and asks the borrower to tick SELF_CHECK before it
  offers copy or download (critique #54). A lawyer's review of the three
  templates is the right fix and is recorded in docs/BOTTLENECKS.md; until
  then the citations are tied to the RBI's own words (engine/citations.py).
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from datetime import date, timedelta
from decimal import Decimal
from typing import Optional

from engine.citations import (
    CB_CONDUCT_DIRECTIONS_2025, EBLR_CIRCULAR_2019, EBLR_RESET, EBLR_SPREAD,
    INTEREST_RATES_DIRECTIONS_2025, IO_DIRECTIONS_2026, IO_ESCALATION, NBFC_CONDUCT_DIRECTIONS_2025,
    NHB_COMPLAINT, RBIOS_2026, RBIOS_ACCESS, RBIOS_COMPENSATION, Citation,
)
from engine.complaint_deadlines import REPLY_DAYS_IN, Reply, Timeline
from engine.lenders import EBLR_BOUND, LenderType
from engine.loan_check import (
    BankAction, Benchmark, Finding, LoanCheckInput, LoanCheckResult, OverchargeMonth,
    _inr, _pct, find_lender,
)

D = Decimal

NAME = "[Full name]"
ACCOUNT = "[Loan account number]"
PHONE = "[Phone]"
EMAIL = "[Email]"
ADDRESS = "[Postal address]"
BANK_REFERENCE = "[Bank's complaint reference]"
BANK_NAME = "[Bank name]"
# The web app drops a sign-off line that is exactly one of these when the
# borrower leaves it blank.
OPTIONAL_LINES = (PHONE, EMAIL, ADDRESS)

CMS_PORTAL = "https://cms.rbi.org.in"
CRPC_EMAIL = "crpc@rbi.org.in"
CRPC_POST = (
    "Centralised Receipt and Processing Centre, Reserve Bank of India, "
    "Central Vista, Sector 17, Chandigarh – 160017"
)


DRAFT_NOTICE = (
    "Draft. Check before sending. RightDue wrote this from the numbers you "
    "entered; it has not been reviewed by a lawyer, and RightDue never sends "
    "it for you."
)

# What the borrower confirms before the screen offers copy or download.
SELF_CHECK: tuple[str, ...] = (
    "The bank name, loan account number and my contact details are right.",
    "The starting rate and month match my sanction letter or loan agreement.",
    "The current rate matches my latest statement or rate-change letter.",
    "I checked whether the bank told me in writing that my spread changed, "
    "and entered it if so.",
    "The loan is from a bank (not a housing finance company or NBFC) and is "
    "linked to the RBI repo rate, or was required to be.",
    "I read the rules quoted with the letter and they match my situation.",
    "I will keep a copy and the date it was sent or received.",
)


_YOU = re.compile(r"\byou(r|rs|rself|'re|'ve|'ll|'d)?\b", re.IGNORECASE)


def stray_you(text: str) -> Optional[str]:
    """The first "you" in a letter, if any. "Yours faithfully" is the one
    allowed use: it is the sign-off, not app copy that leaked in."""
    m = _YOU.search(text.replace("Yours faithfully,", ""))
    return m.group(0) if m else None


class NothingToClaim(ValueError):
    """The loan check found nothing a grievance letter can claim."""


@dataclass(frozen=True)
class Borrower:
    name: str = NAME
    account: str = ACCOUNT
    phone: str = PHONE
    email: str = EMAIL
    address: str = ADDRESS


@dataclass(frozen=True)
class AnnexureRow:
    month: str               # "Apr 2026"
    should_be: str           # "8.15%"
    charged: str
    excess: str              # "₹2,500"


@dataclass
class Letter:
    kind: str                # grievance | io_followup | reset_choice
    recipient: list[str]
    date_line: str
    subject: str
    paragraphs: list[str]
    requests: list[str]
    closing: list[str]
    sign_off: list[str]
    enclosures: list[str]
    citations: list[Citation]
    claim_amount: Decimal
    annexure_title: str = ""
    annexure_note: str = ""
    annexure: list[AnnexureRow] = field(default_factory=list)
    annexure_total: str = ""

    def text(self) -> str:
        out = [*self.recipient, "", self.date_line, "", f"Subject: {self.subject}", "",
               "Dear Sir or Madam,", ""]
        for p in self.paragraphs:
            out += [p, ""]
        if self.requests:
            out += ["The Bank is requested to:", ""]
            out += [f"{i}. {r}" for i, r in enumerate(self.requests, 1)]
            out.append("")
        for p in self.closing:
            out += [p, ""]
        out += ["Yours faithfully,", "", *self.sign_off]
        if self.enclosures:
            out += ["", "Enclosures:"] + [f"- {e}" for e in self.enclosures]
        if self.annexure:
            w = max(len(r.month) for r in self.annexure) + 3
            out += ["", self.annexure_title, "",
                    f"{'Month':<{w}}{'Should be':<12}{'Charged':<10}Excess interest"]
            out += [f"{r.month:<{w}}{r.should_be:<12}{r.charged:<10}{r.excess}" for r in self.annexure]
            out += [f"{'Total':<{w + 22}}{self.annexure_total}", "", self.annexure_note]
        return "\n".join(out).rstrip() + "\n"


@dataclass
class OmbudsmanField:
    label: str
    value: str
    hint: str = ""


@dataclass
class OmbudsmanComplaint:
    """What to enter at cms.rbi.org.in, in the order the facts are asked for."""
    fields: list[OmbudsmanField]
    facts: str               # third person; pasted into the description box
    relief: str
    declarations: list[str]  # confirm on the portal only if true
    documents: list[str]
    opens: Optional[date]
    deadline: Optional[date]
    how_to_file: list[str]
    citations: list[Citation]
    claim_amount: Decimal


def _long(d: date) -> str:
    return f"{d.day} {d:%B %Y}"


def _month(d: date) -> str:
    return f"{d:%B %Y}"


def _missed(result: LoanCheckResult) -> Finding:
    found = [f for f in result.findings if f.kind == "missed_rate_cut" and f.claimable]
    if found:
        return found[0]
    kinds = {f.kind for f in result.findings}
    if "old_benchmark" in kinds:
        raise NothingToClaim(
            "This loan is on MCLR or base rate, which does not follow the repo "
            "rate. The fix is to ask for a switch to the repo-linked rate, not "
            "a complaint about missed cuts."
        )
    if "rule_not_binding" in kinds:
        raise NothingToClaim(
            "The RBI repo-rate rule binds banks, not housing finance companies, "
            "NBFCs, regional rural banks or co-operative banks, so there is no "
            "rate-cut refund to claim. Loan Check lists what does apply."
        )
    if "below_expected" in kinds:
        raise NothingToClaim(
            "The rate is below what the repo moves imply: that is in the "
            "borrower's favour, so there is nothing to claim."
        )
    if "pricing_gap" in kinds:
        raise NothingToClaim(
            "The rate follows the RBI repo rate. Paying more than new "
            "borrowers is not something a bank has to refund; ask for a lower "
            "spread or a switch to its current rate instead."
        )
    raise NothingToClaim("The rate matches the RBI repo rate, so there is nothing to claim.")


def _lender_name(inp: LoanCheckInput) -> str:
    card = find_lender(inp.lender)
    if card:
        return card.name
    return inp.lender.strip() if inp.lender and inp.lender.strip() else BANK_NAME


def _sign_off(b: Borrower) -> list[str]:
    return [b.name, f"Loan account: {b.account}", b.phone, b.email, b.address]


def _annexure(rows: list[OverchargeMonth]) -> list[AnnexureRow]:
    return [
        AnnexureRow(
            month=f"{r.month:%b %Y}", should_be=_pct(r.expected_rate),
            charged=_pct(r.charged_rate), excess=_inr(r.amount),
        )
        for r in rows
    ]


def _rate_story(inp: LoanCheckInput, result: LoanCheckResult, f: Finding) -> list[str]:
    """Third-person facts: the loan, the repo moves, the expected rate."""
    rs, rr, rt = result.repo_at_start, result.repo_reference_now, result.repo_today
    assert rs is not None and rr is not None and result.expected_rate is not None
    exp = result.expected_rate

    if inp.benchmark == Benchmark.REPO:
        linked = "on a floating rate linked to the RBI policy repo rate"
        benchmark_note = ""
    else:
        linked = "on a floating rate"
        benchmark_note = (
            " As a floating-rate retail loan made after 1 October 2019, it must "
            "be linked to an external benchmark, and this complaint treats that "
            "benchmark as the RBI policy repo rate. If the Bank's records show "
            "another external benchmark, please name it and give its value at "
            "each reset."
        )
    facts = (
        f"Home loan account {ACCOUNT} began in {_month(inp.loan_start)} at "
        f"{_pct(inp.start_rate)} a year, {linked}. The rate charged today is "
        f"{_pct(inp.current_rate)}.{benchmark_note}"
    )

    if rr < rs:
        move = f"The repo rate was {_pct(rs)} when the loan was priced and is {_pct(rr)} now"
    elif rr > rs:
        move = f"The repo rate has risen from {_pct(rs)} when the loan was priced to {_pct(rr)} now"
    else:
        move = f"The repo rate is {_pct(rr)} now, as it was when the loan was priced"
    if rt < rr:
        move += (
            f" (the most recent cut, to {_pct(rt)}, is left out because the "
            f"next reset may not have happened yet)"
        )
    calc = (
        f"{move}. With the spread unchanged, the loan rate should be "
        f"{_pct(exp)} ({_pct(inp.start_rate)} + {_pct(rr)} − {_pct(rs)}). The "
        f"rate charged, {_pct(inp.current_rate)}, is {_pct(f.rate_gap)} higher."
    )
    rule = (
        f"Under paragraphs 38 and 33 of the {INTEREST_RATES_DIRECTIONS_2025}, "
        f"which carry forward {EBLR_CIRCULAR_2019}, the rate on a loan linked "
        f"to an external benchmark must be reset at least once in three months, "
        f"and the spread over the benchmark may change only in limited cases: "
        f"the credit risk premium when the borrower's credit assessment "
        f"undergoes a substantial change, as agreed in the loan contract, and "
        f"other parts of the spread once in three years."
    )
    return [facts, calc, rule]


def _fill(text: str, b: Borrower) -> str:
    """The account number sits inside running text; fill it in last."""
    return text.replace(ACCOUNT, b.account)


def grievance_letter(
    inp: LoanCheckInput,
    result: LoanCheckResult,
    borrower: Borrower = Borrower(),
    sent_on: Optional[date] = None,
) -> Letter:
    f = _missed(result)
    exp = result.expected_rate
    lender = _lender_name(inp)
    when = sent_on or inp.as_of
    cut = result.repo_reference_now < result.repo_at_start

    paras = _rate_story(inp, result, f)
    if f.overcharged_so_far > 0:
        first, last = f.overcharge_months[0].month, f.overcharge_months[-1].month
        span = _month(first) if first == last else f"{_month(first)} to {_month(last)}"
        paras.append(
            f"From {span} ({f.months_overcharged} month"
            f"{'s' if f.months_overcharged != 1 else ''}), the excess interest "
            f"comes to about {_inr(f.overcharged_so_far)}. It is counted at the "
            f"present outstanding balance of {_inr(inp.outstanding)}, which is "
            f"lower than the balance in those months, and only for months after "
            f"the three-month reset window had passed. The month-by-month "
            f"working is in the annexure."
        )
    if f.amount_this_year > 0:
        paras.append(
            f"If the rate is not corrected, the excess over the next 12 months "
            f"is about {_inr(f.amount_this_year)}."
        )

    requests = [
        f"Reset the rate on this loan to {_pct(exp)} from the next reset date, "
        f"and confirm the new rate and EMI in writing.",
    ]
    if f.overcharged_so_far > 0:
        requests.append(
            f"Refund, or credit to the loan account, the excess interest charged, "
            f"estimated at {_inr(f.overcharged_so_far)}. If the Bank's own "
            f"calculation differs, please share it month by month."
        )
    requests += [
        f"Provide a statement showing, for each reset since "
        f"{_month(inp.loan_start)}, the benchmark rate, the spread and the "
        f"rate applied.",
        "If the spread on this loan has been changed, state when, by how much, "
        "and on which ground in the loan agreement.",
    ]

    closing = [
        "Please register this as a complaint and share the complaint reference "
        "number. If the Bank resolves it only in part or rejects it, the "
        "Internal Ombudsman directions require the Bank to escalate it to its "
        f"Internal Ombudsman and to give a final decision within {REPLY_DAYS_IN} "
        "days of receiving it. If there is no reply within that time, or the reply does "
        "not resolve the complaint, it will be taken to the RBI Ombudsman under "
        f"the {RBIOS_2026}.",
    ]
    rows = f.overcharge_months if f.overcharged_so_far > 0 else []
    letter = Letter(
        kind="grievance",
        recipient=["The Principal Nodal Officer / Grievance Redressal Officer", lender],
        date_line=_long(when),
        subject=(
            f"Complaint: RBI repo rate {'cuts' if cut else 'changes'} not passed "
            f"on, home loan account {ACCOUNT}"
        ),
        paragraphs=paras,
        requests=requests,
        closing=closing,
        sign_off=_sign_off(borrower),
        enclosures=[
            "Latest loan account statement",
            "Sanction letter or loan agreement page showing the rate and spread",
            "Any rate-reset notices received",
        ],
        citations=[EBLR_RESET, EBLR_SPREAD, IO_ESCALATION, RBIOS_ACCESS],
        claim_amount=f.overcharged_so_far,
        annexure_title="Annexure: excess interest, month by month" if rows else "",
        annexure_note=(
            f"Each month: present balance {_inr(inp.outstanding)} × (rate charged "
            f"− rate that should apply) ÷ 12, rounded down to the rupee."
        ) if rows else "",
        annexure=_annexure(rows),
        annexure_total=_inr(f.overcharged_so_far) if rows else "",
    )
    return _filled(letter, borrower)


def _filled(letter: Letter, b: Borrower) -> Letter:
    letter.subject = _fill(letter.subject, b)
    letter.paragraphs = [_fill(p, b) for p in letter.paragraphs]
    letter.requests = [_fill(p, b) for p in letter.requests]
    letter.closing = [_fill(p, b) for p in letter.closing]
    return letter


def io_followup_letter(
    inp: LoanCheckInput,
    result: LoanCheckResult,
    sent_on: date,
    reply: Reply,
    reply_on: date,
    received_on: Optional[date] = None,
    bank_reference: Optional[str] = None,
    borrower: Borrower = Borrower(),
    today: Optional[date] = None,
) -> Letter:
    if reply not in (Reply.PARTLY, Reply.REJECTED):
        raise ValueError("The follow-up is only for a complaint rejected wholly or in part.")
    f = _missed(result)
    lender = _lender_name(inp)
    ref = bank_reference.strip() if bank_reference and bank_reference.strip() else BANK_REFERENCE
    decision_due = (received_on or sent_on) + timedelta(days=REPLY_DAYS_IN)
    how = "rejected it" if reply == Reply.REJECTED else "accepted it only in part"
    claim = (
        f", and about {_inr(f.overcharged_so_far)} of excess interest has been charged"
        if f.overcharged_so_far > 0 else ""
    )
    paras = [
        f"A complaint about home loan account {ACCOUNT} was sent to the Bank "
        f"on {_long(sent_on)}. The Bank's reply of {_long(reply_on)} (reference "
        f"{ref}) {how} and does not say that the Internal Ombudsman reviewed it.",
        f"The complaint is that the rate on the loan has not followed the RBI "
        f"repo rate: it should be about {_pct(result.expected_rate)} but is "
        f"{_pct(inp.current_rate)}{claim}.",
        f"Under clause 14 of the {IO_DIRECTIONS_2026}, a complaint that the "
        f"Bank partially resolves or wholly rejects must be escalated "
        f"automatically to its Internal Ombudsman for review, and the final "
        f"decision must reach the complainant within {REPLY_DAYS_IN} days of "
        f"the Bank receiving the complaint: in this case by {_long(decision_due)}.",
    ]
    letter = Letter(
        kind="io_followup",
        recipient=["The Principal Nodal Officer / Grievance Redressal Officer", lender],
        date_line=_long(today or reply_on),
        subject=f"Complaint {ref}: request for Internal Ombudsman review",
        paragraphs=paras,
        requests=[
            "Confirm that the complaint has been escalated to the Bank's Internal Ombudsman.",
            f"Send the Internal Ombudsman's decision, with reasons, by {_long(decision_due)}.",
        ],
        closing=[
            "If the final decision does not resolve the complaint, it will be "
            f"taken to the RBI Ombudsman under the {RBIOS_2026}.",
        ],
        sign_off=_sign_off(borrower),
        enclosures=["Copy of the original complaint", "The Bank's reply"],
        citations=[IO_ESCALATION, RBIOS_ACCESS],
        claim_amount=f.overcharged_so_far,
    )
    return _filled(letter, borrower)


def ombudsman_complaint(
    inp: LoanCheckInput,
    result: LoanCheckResult,
    timeline: Timeline,
    sent_on: date,
    reply: Reply = Reply.NONE,
    reply_on: Optional[date] = None,
    bank_reference: Optional[str] = None,
    borrower: Borrower = Borrower(),
) -> OmbudsmanComplaint:
    f = _missed(result)
    lender = _lender_name(inp)
    exp = result.expected_rate
    ref = bank_reference.strip() if bank_reference and bank_reference.strip() else BANK_REFERENCE
    if reply != Reply.NONE and reply_on is None:
        raise ValueError("Still needed: the date of the bank's reply.")
    if reply == Reply.NONE:
        reply_text = f"No reply within {REPLY_DAYS_IN} days"
    elif reply == Reply.REJECTED:
        reply_text = f"Rejected on {_long(reply_on)}"
    elif reply == Reply.PARTLY:
        reply_text = f"Partly accepted on {_long(reply_on)}"
    else:
        reply_text = f"Fixed on {_long(reply_on)}"

    claim = (
        f" About {_inr(f.overcharged_so_far)} of excess interest was charged "
        f"from {_month(f.overcharge_months[0].month)} to "
        f"{_month(f.overcharge_months[-1].month)}, counted at the present balance."
        if f.overcharged_so_far > 0 else ""
    )
    bank_said = (
        f"The Bank did not reply within {REPLY_DAYS_IN} days."
        if reply == Reply.NONE else
        f"The Bank's reply of {_long(reply_on)} did not resolve it."
    )
    linked = (
        "linked to the RBI repo rate" if inp.benchmark == Benchmark.REPO else
        "which, as a retail loan made after 1 October 2019, must be linked to an "
        "external benchmark (taken here as the RBI repo rate)"
    )
    facts = (
        f"The complainant holds home loan account {borrower.account} with {lender}, "
        f"which began in {_month(inp.loan_start)} at {_pct(inp.start_rate)} on a "
        f"floating rate {linked}. The repo rate has moved from "
        f"{_pct(result.repo_at_start)} to {_pct(result.repo_reference_now)}, so with "
        f"the spread unchanged the rate should be about {_pct(exp)}; the Bank "
        f"charges {_pct(inp.current_rate)}. The Interest Rates on Advances "
        f"Directions, 2025 require the rate to be reset at least once in three "
        f"months and allow the spread to change only in limited cases.{claim} "
        f"A written complaint was made to the Bank on {_long(sent_on)} "
        f"(reference {ref}). {bank_said}"
    )
    relief = f"Direct the Bank to reset the rate to {_pct(exp)}"
    relief += (
        f" and refund the excess interest of about {_inr(f.overcharged_so_far)}, "
        f"with its own month-by-month calculation."
        if f.overcharged_so_far > 0 else "."
    )
    fields = [
        OmbudsmanField("Type of regulated entity", "Bank"),
        OmbudsmanField("Name of the bank", lender),
        OmbudsmanField("Loan account number", borrower.account),
        OmbudsmanField("Complaint first made to the bank on", _long(sent_on)),
        OmbudsmanField("Bank's complaint reference", ref),
        OmbudsmanField("Bank's reply", reply_text),
        OmbudsmanField(
            "Category", "Loans and advances: interest rate",
            "Pick the closest option the portal offers.",
        ),
        OmbudsmanField("Amount in dispute", _inr(f.overcharged_so_far) if f.overcharged_so_far > 0 else "₹0"),
    ]
    return OmbudsmanComplaint(
        fields=fields,
        facts=facts,
        relief=relief,
        declarations=[
            "The complaint was first made to the bank in writing.",
            "The same complaint is not pending before, or decided by, a court, "
            "tribunal, arbitrator or other forum.",
            "The same complaint has not already been decided by an RBI Ombudsman.",
        ],
        documents=[
            "The complaint sent to the bank, with proof of the date it was sent",
            "The bank's reply, if any",
            "Latest loan account statement",
            "Sanction letter or loan agreement page showing the rate and spread",
        ],
        opens=timeline.escalation_opens,
        deadline=timeline.escalation_deadline,
        how_to_file=[
            f"Online: {CMS_PORTAL} (free).",
            f"Email: {CRPC_EMAIL}.",
            f"Post: {CRPC_POST}.",
        ],
        citations=[RBIOS_ACCESS, RBIOS_COMPENSATION, EBLR_RESET, EBLR_SPREAD],
        claim_amount=f.overcharged_so_far,
    )


# ─────────────────────────────────────────────────────────────────────────────
# EMI raised (or tenure extended) without offering the choice (audit 80+ A11)
# ─────────────────────────────────────────────────────────────────────────────

class NoResetChoiceIssue(ValueError):
    """The check found no change made without the borrower's choice."""


RESET_PREFERENCES = ("emi", "tenure", "undecided")

_DID = {
    BankAction.EMI_RAISED: "increased the EMI",
    BankAction.TENURE_EXTENDED: "extended the tenure (the number of EMIs)",
    BankAction.BOTH: "increased the EMI and extended the tenure",
}


def reset_choice_letter(
    inp: LoanCheckInput,
    result: LoanCheckResult,
    preference: str = "undecided",
    borrower: Borrower = Borrower(),
    sent_on: Optional[date] = None,
) -> Letter:
    """A letter asking the lender to offer, in writing, the choice the
    reset rules require, and to apply the borrower's choice.

    It claims no money: the borrower's complaint is the missing choice. The
    lender type picks the rule quoted (para 349 for banks, para 31 for NBFCs
    and, through para 176(3), housing finance companies) and where an
    unresolved complaint goes next."""
    found = [f for f in result.findings if f.kind == "choice_not_offered"]
    if not found:
        raise NoResetChoiceIssue(
            "Loan Check did not find a change made without the choice. Answer "
            "'what did the lender do after the rise' and 'was the choice offered'."
        )
    if preference not in RESET_PREFERENCES:
        raise ValueError(f"preference must be one of {RESET_PREFERENCES}")
    f = found[0]
    lender = _lender_name(inp)
    when = sent_on or inp.as_of
    kind = result.lender_type
    rr = result.rate_rise
    if kind in EBLR_BOUND:
        rule_src = f"paragraph 349 of the {CB_CONDUCT_DIRECTIONS_2025}"
        entity = "the Bank"
    elif kind == LenderType.HFC:
        rule_src = (
            f"paragraph 31 of the {NBFC_CONDUCT_DIRECTIONS_2025}, which applies to housing "
            f"finance companies under paragraph 176(3) of the Housing Finance Companies "
            f"Directions, 2025"
        )
        entity = "the Company"
    elif kind == LenderType.NBFC:
        rule_src = f"paragraph 31 of the {NBFC_CONDUCT_DIRECTIONS_2025}"
        entity = "the Company"
    else:
        rule_src = (
            "the RBI circular RBI/2023-24/55 (DOR.MCS.REC.32/01.01.003/2023-24, 18 August "
            "2023) on reset of floating interest rate on EMI-based personal loans"
        )
        entity = "the Bank"
    action = _DID[inp.bank_action]
    move = (
        f" after the RBI raised the policy repo rate from {_pct(rr.repo_from)} to "
        f"{_pct(rr.repo_to)} on {_long(rr.decided)}" if rr is not None else
        " at the last reset of the floating interest rate"
    )
    paras = [
        f"Loan account {ACCOUNT} is on a floating interest rate. The rate charged "
        f"today is {_pct(inp.current_rate)} a year, with {inp.tenure_months_remaining} "
        f"instalments left and an outstanding balance of {_inr(inp.outstanding)}.",
        f"{entity[0].upper()}{entity[1:]} {action}{move}, without first offering the "
        f"borrower a choice between a higher EMI, a longer tenure or a combination of "
        f"both, or the option to prepay.",
        f"Under {rule_src}, any increase in the EMI or tenor or both must be communicated "
        f"to the borrower immediately, and the borrower must be given the choice to opt "
        f"for enhancement in EMI or elongation of tenor or for a combination of both "
        f"options, and to prepay, either in part or in full. Where rates are reset for a "
        f"whole class of borrowers because the reference benchmark has increased, the "
        f"options also include a switch to a fixed rate where the lender offers one, and "
        f"elongation of tenor must not result in negative amortisation.",
    ]
    if rr is not None:
        im = rr.impact
        figures = (
            f"On the present balance, keeping the same end date means an EMI of about "
            f"{_inr(im.emi_after)} instead of {_inr(im.emi_before)}"
        )
        if im.tenure_option_possible:
            figures += (
                f"; keeping the EMI means about {im.months_change} more instalments and "
                f"about {_inr(im.tenure_premium)} more interest than raising the EMI"
            )
        figures += ". These are the borrower's own estimates; the lender's figures are requested below."
        paras.append(figures)

    if preference == "emi":
        choice = (
            "Apply the borrower's choice from the next instalment: keep the original end "
            "date and increase the EMI, and confirm the new EMI in writing."
        )
    elif preference == "tenure":
        choice = (
            "Apply the borrower's choice from the next instalment: keep the EMI unchanged "
            "and extend the tenure, provided this does not result in negative amortisation, "
            "and confirm the new number of instalments in writing."
        )
    else:
        choice = (
            "Hold the change already made open to the borrower's choice, which will be "
            "given in writing within 15 days of receiving the options."
        )
    requests = [
        "Set out in writing the options available on this loan at this reset: a higher "
        "EMI, a longer tenure, a combination of both, a switch to a fixed rate if offered, "
        "and prepayment in part or in full, with the EMI, the number of instalments and "
        "the total interest under each, and any charge for each option.",
        choice,
        "Confirm the interest rate now applied, the benchmark rate and the spread, the EMI "
        "and the number of instalments left, and share the quarterly statement of "
        "principal and interest recovered, EMI amount, instalments left and the "
        "annualised rate.",
        "Reverse any charge levied for a change the borrower did not choose.",
    ]
    if kind in EBLR_BOUND:
        escalate = (
            "Please register this as a complaint and share the reference number. If it is "
            "not resolved within 30 days, or is rejected, it will be taken to the RBI "
            f"Ombudsman under the {RBIOS_2026}."
        )
        cites = list(f.citations) + [RBIOS_ACCESS]
    elif kind == LenderType.HFC:
        escalate = (
            "Please register this as a complaint and share the reference number. If it is "
            "not resolved within a month, it will be taken to the National Housing Bank "
            "through its complaint system (GRIDS)."
        )
        cites = list(f.citations) + [NHB_COMPLAINT]
    else:
        escalate = (
            "Please register this as a complaint and share the reference number. If it is "
            "not resolved within 30 days, it will be taken to the RBI Ombudsman where the "
            f"{RBIOS_2026} covers the lender."
        )
        cites = list(f.citations) + [RBIOS_ACCESS]
    letter = Letter(
        kind="reset_choice",
        recipient=["The Grievance Redressal Officer", lender],
        date_line=_long(when),
        subject=(
            f"Floating-rate reset on home loan account {ACCOUNT}: choice of EMI or "
            f"tenure not offered"
        ),
        paragraphs=paras,
        requests=requests,
        closing=[escalate],
        sign_off=_sign_off(borrower),
        enclosures=[
            "Latest loan account statement",
            "The rate-change message or letter received, if any",
        ],
        citations=cites,
        claim_amount=D("0"),
    )
    return _filled(letter, borrower)
