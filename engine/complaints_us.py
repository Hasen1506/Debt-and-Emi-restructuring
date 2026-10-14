"""US complaint letters: FCBA billing-error notice and RESPA notice of error.

Audit 80+ D11: the landing page markets "Federal, state and card rules for
the USA", but the RESPA and FCBA trackers in engine/complaint_deadlines.py had
no route or letter. These are the two letters, with placeholders only (the
browser fills name, account and address, so they never leave the device).

Primary text (read 14 Oct 2026):
- Reg Z 12 CFR 1026.13 (FCBA billing errors):
  https://www.consumerfinance.gov/rules-policy/regulations/1026/13/
  (b)(1) received "at the address disclosed under § 1026.7(a)(9) or (b)(9)"
  within 60 days of the first statement showing the error; (b)(2) name and
  account; (b)(3) the reasons, type, date and amount; (d)(1) the disputed
  amount need not be paid while it is open, and an issuer autopay must not take
  it if the notice arrives 3 business days before the payment date; (d)(2) no
  adverse credit report on the disputed amount.
- Reg X 12 CFR 1024.35 (RESPA notice of error):
  https://www.consumerfinance.gov/rules-policy/regulations/1024/35/
  (a) written notice with the borrower's name, information identifying the
  loan account and the error; a note on a payment coupon need not count;
  (c) a servicer may designate an address that must be used; (d) receipt
  acknowledged within 5 business days; (e) response, 30 business days
  (complaint_deadlines.py).
- CFPB complaints: https://www.consumerfinance.gov/complaint/

Not reviewed by a lawyer. Every letter is a draft the borrower checks.
"""
from __future__ import annotations

from dataclasses import dataclass, field

NAME = "[Full name]"
ACCOUNT = "[Account number]"
ADDRESS = "[Your mailing address]"
ISSUER = "[Card issuer]"
SERVICER = "[Mortgage servicer]"
ERROR_ADDRESS = "[Billing-error address from your statement]"
NOE_ADDRESS = "[Servicer's notice-of-error address, if it designated one]"
STATEMENT_DATE = "[Statement date]"
TXN_DATE = "[Transaction date]"
AMOUNT = "[Disputed amount, US$]"
DESCRIPTION = "[What the charge says on the statement]"
WHY = "[Why it is wrong: not authorised / not delivered / paid but not credited / wrong amount]"
LOAN_ERROR = "[The error: e.g. payment not credited on [date], wrong escrow charge, late fee charged in error]"

DRAFT_NOTICE = (
    "Draft: check every line against your statement before you send it. "
    "RightDue's letters follow the regulation text; they have not been "
    "reviewed by a lawyer."
)
CFPB_URL = "https://www.consumerfinance.gov/complaint/"
REG_Z_URL = "https://www.consumerfinance.gov/rules-policy/regulations/1026/13/"
REG_X_URL = "https://www.consumerfinance.gov/rules-policy/regulations/1024/35/"


@dataclass(frozen=True)
class UsLetter:
    kind: str                       # "fcba_billing_error" | "respa_notice_of_error"
    send_to: str                    # where it MUST go (the one thing that loses rights)
    subject: str
    paragraphs: list[str]
    how_to_send: list[str]
    if_no_answer: list[str]         # CFPB hand-off
    sources: list[str] = field(default_factory=list)
    draft_notice: str = DRAFT_NOTICE

    def text(self) -> str:
        return "\n\n".join([self.send_to, self.subject, *self.paragraphs])


def fcba_billing_error_letter() -> UsLetter:
    return UsLetter(
        kind="fcba_billing_error",
        send_to=f"{ISSUER}\n{ERROR_ADDRESS}",
        subject=f"Billing error notice, account {ACCOUNT}",
        paragraphs=[
            f"I am writing to dispute a billing error on my statement dated {STATEMENT_DATE}, "
            f"under the Fair Credit Billing Act and Regulation Z, 12 CFR 1026.13.",
            f"Name: {NAME}. Account: {ACCOUNT}.",
            f"The error: {DESCRIPTION}, dated {TXN_DATE}, for {AMOUNT}. {WHY}",
            "Please correct the error, credit any related finance or other charges, and send me "
            "written confirmation. If you believe there is no error, please send me the reasons "
            "and copies of the documents that show I owe the amount.",
            "I understand that while this dispute is open I do not have to pay the disputed amount "
            "or related charges, and that you may not report it as delinquent (12 CFR 1026.13(d)).",
            f"Sincerely,\n{NAME}\n{ADDRESS}",
        ],
        how_to_send=[
            "Send it to the billing-error (\"billing rights\") address printed on your statement. "
            "Not the payment address: a notice sent there may not count (12 CFR 1026.13(b)(1)).",
            "It must reach the issuer within 60 days of the first statement that showed the error.",
            "Send it in writing, by a method that proves delivery (certified mail, return receipt). "
            "Online only if your statement says the issuer accepts billing-error notices that way.",
            "If the issuer takes your payment by autopay, send it at least 3 business days before "
            "the payment date so the disputed amount is not taken.",
            "Keep a copy and the delivery receipt.",
        ],
        if_no_answer=[
            "The issuer must acknowledge within 30 days and resolve within two billing cycles, "
            "never more than 90 days.",
            f"If it does not, or you disagree with its answer, complain to the CFPB: {CFPB_URL}",
        ],
        sources=[REG_Z_URL, CFPB_URL],
    )


def respa_notice_of_error_letter() -> UsLetter:
    return UsLetter(
        kind="respa_notice_of_error",
        send_to=f"{SERVICER}\n{NOE_ADDRESS}",
        subject=f"Notice of error under 12 CFR 1024.35, loan {ACCOUNT}",
        paragraphs=[
            "This is a notice of error under the Real Estate Settlement Procedures Act and "
            "Regulation X, 12 CFR 1024.35.",
            f"Borrower: {NAME}. Loan account: {ACCOUNT}. Property address: {ADDRESS}.",
            f"The error I believe has occurred: {LOAN_ERROR}",
            "Please correct the error and tell me in writing, or, if you conclude there is no "
            "error, explain why in writing and tell me how to get the documents you relied on.",
            f"Sincerely,\n{NAME}",
        ],
        how_to_send=[
            "If your servicer has given you a specific address for notices of error, you must use "
            "it (12 CFR 1024.35(c)). Look on your statement or the servicer's website.",
            "Send it as its own letter; a note on a payment coupon need not count (1024.35(a)).",
            "Use a method that proves delivery, and keep a copy.",
        ],
        if_no_answer=[
            "The servicer must acknowledge within 5 business days and respond within 30 business "
            "days (it may extend once by 15).",
            f"If it does not, or you disagree with its answer, complain to the CFPB: {CFPB_URL}",
        ],
        sources=[REG_X_URL, CFPB_URL],
    )
