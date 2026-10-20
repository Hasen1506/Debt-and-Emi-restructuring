"""Loan cleared: the letter to the lender, and the dates that follow.

When a loan is paid off the job isn't quite over. The borrower wants a
closure (no-dues) letter, the original documents back, the lender's charge
removed from the registry, and the credit bureaus told. This module drafts
that request and works out the dates the RBI rules set, so the celebration
screen can say "you're done, here is the last letter".

Every rule below was read in the RBI's own text (as of 12 Oct 2026):

* Property documents (secured loans to individuals): released, and the
  registered charge removed, within 30 days of full repayment; if late and
  the lender is at fault, ₹5,000 for each day of delay; a further 30 days
  (60 in all) when the documents were lost or damaged.
  - First issued: RBI circular RBI/2023-24/60, "Responsible Lending Conduct
    – Release of Movable / Immovable Property Documents on Repayment /
    Settlement of Personal Loans", 13 Sep 2023, paras 2, 6, 7; in force
    for releases due on or after 1 Dec 2023.
    https://www.rbi.org.in/Scripts/NotificationUser.aspx?Id=12535
  - That circular was withdrawn on 28 Nov 2025 when RBI consolidated its
    rules. The same text now sits in the Responsible Business Conduct
    Directions, 2025 for each kind of lender:
    commercial banks: RBI (Commercial Banks – Responsible Business Conduct)
    Directions, 2025, section F "Release of Movable / Immovable Property
    Documents on Repayment / Settlement of Personal Loans" (paras 354–360 in
    the version updated as on 1 July 2026);
    https://www.rbi.org.in/Scripts/BS_ViewMasDirections.aspx?id=13140
    NBFCs, including housing finance companies: RBI (Non-Banking Financial
    Companies – Responsible Business Conduct) Directions, 2025, section F
    (from para 35, version updated as on 1 July 2026).
    https://rbidocs.rbi.org.in/rdocs/notification/PDFs/362MD26CA543937BA439A97E1BCFC08CF5808.PDF
  - "Personal loans" there means loans to individuals: consumer credit
    (including vehicle loans, gold loans, card dues), education loans,
    housing loans and loans to buy financial assets (RBI circular
    "XBRL Returns – Harmonization of Banking Statistics", 4 Jan 2018).
    A loan taken for a business is outside it.
    https://www.rbi.org.in/Scripts/NotificationUser.aspx?Id=11199&Mode=0
* Credit card closure: honoured within seven working days once all dues
  are paid; ₹500 for each calendar day of delay after that, as long as
  nothing is outstanding. RBI (Commercial Banks – Credit Cards and Debit
  Cards: Issuance and Conduct) Directions, 2025, section E "Closure of
  Credit Card" (28 Nov 2025; the NBFC and small finance bank versions carry
  the same section). First in the Master Direction of 21 Apr 2022, para
  8(a); "calendar day" since the 7 Mar 2024 amendment.
  https://www.rbi.org.in/Scripts/BS_ViewMasDirections.aspx?id=13155
* Gold loans at a commercial bank: the pledged gold back on the day of
  repayment, and never more than seven working days later; ₹5,000 a day
  when the bank is at fault. Commercial Banks – Responsible Business
  Conduct Directions, 2025, section H.4 and H.6 (paras 377 and 388 in the
  1 July 2026 version). For other lenders the letter asks for the gold back
  without quoting a day count we haven't read in their directions.

Paragraph numbers move when RBI updates a direction, so the letter quotes
section titles and the user checks the current text (the self-check list
says so). This is a draft for the borrower to read before sending. It is
not legal advice.

US: no federal rule sets a lien-release deadline (it is state law), so the
US letter asks for the paid-in-full letter and lien release without
quoting a deadline.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date, timedelta
from typing import Optional

AS_OF = "12 October 2026"

DOCS_RELEASE_DAYS = 30
DOCS_LOST_EXTRA_DAYS = 30
DOCS_DELAY_COMPENSATION_INR = 5000
CARD_CLOSE_WORKING_DAYS = 7
CARD_DELAY_PENALTY_INR = 500
GOLD_RELEASE_WORKING_DAYS = 7
GOLD_DELAY_COMPENSATION_INR = 5000

LOAN_TYPES = {"home_loan", "auto_loan", "personal_loan", "credit_card", "education_loan", "gold_loan", "bnpl"}
# Secured by something the lender must hand back. An education loan can be
# secured too; the user says so with `secured=True`.
SECURED_IN = {"home_loan", "auto_loan", "gold_loan"}
VEHICLE = {"auto_loan"}
# The app's other loan types, read as the closure rule they fall under.
LOAN_TYPE_ALIASES = {
    "loan_against_property": "home_loan",
    "home_topup": "home_loan",
    "two_wheeler_loan": "auto_loan",
    "medical_loan": "personal_loan",
}
LENDER_KINDS = {"bank", "nbfc", "hfc", "small_finance_bank", "cooperative_bank", "unknown"}

CIRCULAR_2023 = (
    "RBI circular RBI/2023-24/60, 'Responsible Lending Conduct – Release of Movable / "
    "Immovable Property Documents on Repayment/ Settlement of Personal Loans' (13 September 2023)"
)
CB_RBC = (
    "RBI (Commercial Banks – Responsible Business Conduct) Directions, 2025, section "
    "'Release of Movable / Immovable Property Documents on Repayment / Settlement of Personal Loans'"
)
NBFC_RBC = (
    "RBI (Non-Banking Financial Companies – Responsible Business Conduct) Directions, 2025, section "
    "'Release of Movable / Immovable Property Documents on Repayment / Settlement of Personal Loans'"
)
CARD_DIRECTIONS = (
    "RBI Credit Cards and Debit Cards: Issuance and Conduct Directions, 2025 for your card issuer's "
    "type (commercial bank, small finance bank or NBFC), section 'Closure of Credit Card'"
)
CB_GOLD = (
    "RBI (Commercial Banks – Responsible Business Conduct) Directions, 2025, section "
    "'Release of collateral after repayment' (lending against gold and silver collateral)"
)

SOURCES = {
    "circular_2023": "https://www.rbi.org.in/Scripts/NotificationUser.aspx?Id=12535",
    "cb_rbc": "https://www.rbi.org.in/Scripts/BS_ViewMasDirections.aspx?id=13140",
    "nbfc_rbc": "https://rbidocs.rbi.org.in/rdocs/notification/PDFs/362MD26CA543937BA439A97E1BCFC08CF5808.PDF",
    "personal_loans_definition": "https://www.rbi.org.in/Scripts/NotificationUser.aspx?Id=11199&Mode=0",
    "card_directions": "https://www.rbi.org.in/Scripts/BS_ViewMasDirections.aspx?id=13155",
}


class ClosureInputError(ValueError):
    pass


@dataclass(frozen=True)
class KeyDate:
    key: str
    label: str
    day: date
    note: str = ""


@dataclass
class ClosureLetter:
    market: str
    subject: str
    body: str
    key_dates: list[KeyDate]
    checklist: list[str]
    citations: list[dict]
    notes: list[str] = field(default_factory=list)
    draft: bool = True            # always: the user reads it before sending


def add_working_days(start: date, n: int) -> date:
    """n working days after `start`, skipping Saturdays and Sundays only.
    Bank holidays add days the bank may also count; the letter says so."""
    d = start
    left = n
    while left > 0:
        d += timedelta(days=1)
        if d.weekday() < 5:
            left -= 1
    return d


def _inr(n: int) -> str:
    s = str(n)
    if len(s) > 3:
        head, tail = s[:-3], s[-3:]
        parts = []
        while len(head) > 2:
            parts.insert(0, head[-2:])
            head = head[:-2]
        if head:
            parts.insert(0, head)
        s = ",".join(parts) + "," + tail
    return f"₹{s}"


def _long(d: date) -> str:
    return f"{d.day} {d:%B %Y}"


def _docs_rule(lender_kind: str) -> tuple[str, str]:
    if lender_kind == "bank":
        return CB_RBC, SOURCES["cb_rbc"]
    if lender_kind in ("nbfc", "hfc"):
        return NBFC_RBC, SOURCES["nbfc_rbc"]
    # Small finance, co-operative and unknown lenders: the 2023 circular
    # covered them all; quote it and point to their type's current directions.
    return (
        f"{CIRCULAR_2023}, now carried in the RBI Responsible Business Conduct Directions, 2025 "
        "for your lender's type",
        SOURCES["circular_2023"],
    )


SELF_CHECK = [
    "Your name, loan account number and the closure date match your last statement.",
    "The loan really shows ₹0 (or $0) due: ask for the final statement first if you're not sure.",
    "The rule quoted is the one for your lender's type (bank, NBFC or housing finance company). "
    "RBI renumbers paragraphs when it updates a direction, so check the section on rbi.org.in.",
    "You're sending it through a channel that gives you a dated record: the lender's grievance "
    "email or portal, or a letter you can prove was delivered.",
    "Keep a copy of the letter and the lender's reply.",
]


def closure_letter(
    *,
    market: str,
    loan_type: str,
    lender: str,
    closed_on: date,
    today: date,
    lender_kind: str = "unknown",
    business_purpose: bool = False,
    docs_lost: bool = False,
    secured: Optional[bool] = None,
) -> ClosureLetter:
    """Draft the closure request for one loan.

    `closed_on`: the day the loan was paid in full (the last payment).
    """
    if market not in ("IN", "US"):
        raise ClosureInputError("Market should be IN or US.")
    if lender_kind not in LENDER_KINDS:
        raise ClosureInputError("Unknown lender type.")
    loan_type = LOAN_TYPE_ALIASES.get(loan_type, loan_type)
    if loan_type == "people_loan":
        raise ClosureInputError("A loan from a person has no lender rules to cite; ask them for a written note instead.")
    if loan_type not in LOAN_TYPES:
        raise ClosureInputError("Unknown loan type.")
    if closed_on > today:
        raise ClosureInputError("The closure date is in the future.")
    lender = " ".join((lender or "").split())[:80] or "[Lender name]"

    placeholders = (
        "[Your name]\n[Your address]\n[Your phone]  [Your email]\n\n"
        f"To: {lender}, Customer Service / Grievance Redressal Officer\n"
        f"Date: {_long(today)}\n\n"
    )
    if market == "US":
        return _us_letter(loan_type, lender, closed_on, today, placeholders, secured)

    is_card = loan_type == "credit_card"
    key_dates: list[KeyDate] = []
    citations: list[dict] = []
    notes: list[str] = []

    if is_card:
        # The clock runs from the closure request: this letter, sent today.
        due = add_working_days(today, CARD_CLOSE_WORKING_DAYS)
        key_dates.append(KeyDate(
            "card_closed_by", "Card account closed by", due,
            "Seven working days from your request (counted from today, the date on this letter) "
            "once nothing is due. Saturdays and Sundays are skipped here; a bank holiday can add a day.",
        ))
        key_dates.append(KeyDate(
            "card_penalty_from", f"{_inr(CARD_DELAY_PENALTY_INR)} a day owed to you from", due + timedelta(days=1),
            "If the card is still open and nothing is outstanding.",
        ))
        citations.append({"rule": CARD_DIRECTIONS, "source": SOURCES["card_directions"], "as_of": AS_OF})
        subject = "Request to close my credit card account and confirm no dues"
        body = (
            placeholders
            + f"Subject: {subject}\n\nCard ending: [last 4 digits]\n\n"
            "I have paid the full outstanding on this card"
            f" (last payment on {_long(closed_on)}). Please:\n"
            "1. Close the card account and confirm the closure to me by email or SMS.\n"
            "2. Send a letter confirming that nothing is due on the account.\n"
            "3. Report the closure to the credit information companies.\n\n"
            f"Under the {CARD_DIRECTIONS}, a closure request is to be honoured within seven working "
            f"days once all dues are paid, and a delay after that carries a penalty of "
            f"{_inr(CARD_DELAY_PENALTY_INR)} for each calendar day, payable to the cardholder, "
            "while nothing is outstanding.\n\n"
            "Please treat this letter as my closure request.\n\nYours faithfully,\n[Your name]\n"
        )
    else:
        secured = loan_type in SECURED_IN if secured is None else secured
        subject = "Request for loan closure letter and return of documents" if secured else "Request for loan closure (no-dues) letter"
        asks = ["Send a closure letter (no-dues certificate) confirming the account is closed with nothing due."]
        if secured and loan_type == "gold_loan":
            asks.append("Return the gold I pledged, checked against the pledge receipt.")
        elif secured:
            asks.append("Return all my original property documents.")
            if loan_type in VEHICLE:
                asks.append(
                    "Send the no-objection certificate and signed Form 35 so the hypothecation can be "
                    "removed from my vehicle's registration at the RTO."
                )
            else:
                asks.append("Remove your charge from every registry where it is recorded (for example CERSAI).")
        asks.append("Report the closure to the credit information companies.")

        rule_lines = ""
        if business_purpose:
            notes.append(
                "You said this loan was for a business. RBI's 30-day document rule covers personal "
                "loans (loans to individuals not for business), so the letter asks without quoting it."
            )
        elif secured and loan_type == "gold_loan":
            if lender_kind == "bank":
                due = add_working_days(closed_on, GOLD_RELEASE_WORKING_DAYS)
                key_dates.append(KeyDate("gold_back_by", "Gold returned by", due,
                                         "Same day as repayment, and never more than seven working days later."))
                citations.append({"rule": CB_GOLD, "source": SOURCES["cb_rbc"], "as_of": AS_OF})
                rule_lines = (
                    f"Under the {CB_GOLD}, pledged gold is to be returned on the day of full repayment and "
                    "in any case within seven working days, with compensation of "
                    f"{_inr(GOLD_DELAY_COMPENSATION_INR)} for each day of delay attributable to the bank.\n\n"
                )
            else:
                notes.append(
                    "For gold loans from lenders other than commercial banks, RightDue hasn't checked the "
                    "day count in their directions, so the letter asks for the gold back without one."
                )
        elif secured:
            rule, src = _docs_rule(lender_kind)
            limit = DOCS_RELEASE_DAYS + (DOCS_LOST_EXTRA_DAYS if docs_lost else 0)
            due = closed_on + timedelta(days=limit)
            key_dates.append(KeyDate(
                "documents_by", "Original documents back and charge removed by", due,
                "30 days after full repayment" + ("; 60 if the documents were lost or damaged." if docs_lost else "."),
            ))
            key_dates.append(KeyDate(
                "compensation_from", f"{_inr(DOCS_DELAY_COMPENSATION_INR)} a day owed to you from",
                due + timedelta(days=1),
                "Only when the delay is the lender's fault. The lender must tell you the reason for any delay.",
            ))
            citations.append({"rule": rule, "source": src, "as_of": AS_OF})
            citations.append({"rule": "Meaning of 'personal loans' (loans to individuals, including housing, "
                                      "vehicle and education loans)",
                              "source": SOURCES["personal_loans_definition"], "as_of": AS_OF})
            rule_lines = (
                f"Under the {rule}, original documents are to be released and registered charges removed "
                "within 30 days of full repayment, and a delay attributable to the lender is compensated at "
                f"{_inr(DOCS_DELAY_COMPENSATION_INR)} for each day of delay. I would like to collect the "
                "documents from [branch where the loan was serviced / another office of your choice].\n\n"
            )
        asks_txt = "".join(f"{i}. {a}\n" for i, a in enumerate(asks, 1))
        body = (
            placeholders
            + f"Subject: {subject}\n\nLoan account number: [account number]\n\n"
            f"I repaid this loan in full on {_long(closed_on)}. Please:\n{asks_txt}\n"
            + rule_lines
            + "Please confirm in writing when each of these is done.\n\nYours faithfully,\n[Your name]\n"
        )

    return ClosureLetter(
        market="IN", subject=subject, body=body, key_dates=key_dates,
        checklist=list(SELF_CHECK), citations=citations, notes=notes,
    )


def _us_letter(loan_type: str, lender: str, closed_on: date, today: date, head: str,
               secured_in: Optional[bool]) -> ClosureLetter:
    is_card = loan_type == "credit_card"
    secured = loan_type in ("home_loan", "auto_loan") if secured_in is None else secured_in
    subject = "Request to close my account" if is_card else "Request for paid-in-full letter" + (" and lien release" if secured else "")
    asks = ["Confirm in writing that the account is paid in full with a zero balance."]
    if is_card:
        asks.insert(0, "Close the account.")
    if secured:
        asks.append("Release your lien and send me the release (or the title, for a vehicle).")
    asks.append("Report the account to the credit bureaus as paid / closed.")
    asks_txt = "".join(f"{i}. {a}\n" for i, a in enumerate(asks, 1))
    body = (
        head + f"Subject: {subject}\n\nAccount number: [account number]\n\n"
        f"I paid this account in full on {_long(closed_on)}. Please:\n{asks_txt}\n"
        "Please confirm in writing when each of these is done.\n\nSincerely,\n[Your name]\n"
    )
    notes = ["How fast a lien must be released is set by state law, so this letter doesn't quote a deadline."] if secured else []
    return ClosureLetter(market="US", subject=subject, body=body, key_dates=[],
                         checklist=list(SELF_CHECK[:2] + SELF_CHECK[3:]), citations=[], notes=notes)
