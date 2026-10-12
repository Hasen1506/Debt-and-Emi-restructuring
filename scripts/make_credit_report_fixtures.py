"""Write the SYNTHETIC credit-report fixtures used by the credit-report tests.

Every fixture is made up: invented people, lenders' account numbers, scores and
figures. The layout follows each bureau's usual field wording ("MEMBER NAME",
"Subscriber Name", "Lender", "Institution", …), not any real person's report.
None is a real credit report.

    python scripts/make_credit_report_fixtures.py   # rewrites engine/tests/fixtures/credit_report/

Also writes password-protected copies (AES-256, the cipher bureau PDFs use) of
one credit report and of the personal-loan KFS fixture, to test the password
path (grill #18). The passwords are made up and only open these fixtures.
"""
from __future__ import annotations

import io
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "scripts"))

from make_kfs_fixtures import write_pdf  # noqa: E402

OUT = ROOT / "engine" / "tests" / "fixtures" / "credit_report"
KFS = ROOT / "engine" / "tests" / "fixtures" / "kfs"
BANNER = "SYNTHETIC SAMPLE - not a real credit report (RightDue test fixture)"
REPORT_PASSWORD = "test1990"  # made up, like "first four letters of name + birth year"
KFS_PASSWORD = "01011990"     # made up, like a DOB as DDMMYYYY

CIBIL = f"""{BANNER}
TransUnion CIBIL Limited - CONSUMER CIR
CIBIL SCORE: 742
DATE OF REPORT: 05-10-2026
CONSUMER INFORMATION
NAME: TEST PERSON ONE DATE OF BIRTH: 01-01-1990 PAN: AAAAA0000A
ACCOUNT(S)
MEMBER NAME: SAMPLE HOUSING FINANCE ACCOUNT TYPE: HOUSING LOAN
ACCOUNT NUMBER: HL0000123456 OWNERSHIP: JOINT
OPENED: 15-03-2021 DATE REPORTED: 30-09-2026
SANCTIONED: 45,00,000 CURRENT BALANCE: 38,12,450 AMOUNT OVERDUE: 0
EMI: 39,500 REPAYMENT TENURE: 240 INTEREST RATE: 8.65
MEMBER NAME: DEMO BANK ACCOUNT TYPE: CREDIT CARD
ACCOUNT NUMBER: XXXXXXXXXXXX4321 OWNERSHIP: INDIVIDUAL
OPENED: 02-07-2019 DATE REPORTED: 30-09-2026
CREDIT LIMIT: 2,00,000 CURRENT BALANCE: 64,210 AMOUNT OVERDUE: 3,500
MEMBER NAME: QUICKPAY LATER PVT LTD ACCOUNT TYPE: CONSUMER LOAN
ACCOUNT NUMBER: CD99887766 OWNERSHIP: INDIVIDUAL
OPENED: 10-01-2026 DATE REPORTED: 30-09-2026
SANCTIONED: 42,000 CURRENT BALANCE: 21,000 EMI: 3,500 REPAYMENT TENURE: 12
MEMBER NAME: OLD AUTO FINANCE ACCOUNT TYPE: AUTO LOAN (PERSONAL)
ACCOUNT NUMBER: AL55500011 OWNERSHIP: INDIVIDUAL
OPENED: 01-04-2017 CLOSED: 01-04-2022
SANCTIONED: 5,00,000 CURRENT BALANCE: 0
ENQUIRIES
MEMBER NAME: ANOTHER BANK ENQUIRY PURPOSE: PERSONAL LOAN
"""

EXPERIAN = f"""{BANNER}
Experian Credit Information Company of India
Experian Credit Score: 781
Report Date: 01/10/2026
Personal Information
Name: Test Person Two | Date of Birth: 02/02/1992 | PAN: BBBBB1111B
Account Information
Subscriber Name: SAMPLE BANK LTD
Account Type: Personal Loan
Account No: PL20240099
Ownership: Individual
Date Opened: 20/05/2024
Sanction Amt: Rs 6,00,000
Current Balance: Rs 4,10,300
Amount Overdue: Rs 0
Scheduled Monthly Payment Amount: Rs 13,350
Rate of Interest: 13.25%
Repayment Tenure: 60
Account Status: Active
Date Reported: 30/09/2026
Subscriber Name: EDU LENDER NBFC
Account Type: Education Loan
Account No: ED00007777
Ownership: Individual
Date Opened: 01/08/2022
Sanction Amt: Rs 8,00,000
Current Balance: Rs 7,55,000
Account Status: Active
Date Reported: 31/08/2026
Subscriber Name: CARDCO
Account Type: Credit Card
Account No: 5555XXXXXXXX1111
Ownership: Guarantor
Credit Limit: Rs 50,000
Current Balance: Rs 12,000
Account Status: Active
"""

CRIF = f"""{BANNER}
CRIF High Mark Credit Information Services - Credit Report
PERFORM CONSUMER 2.2 SCORE: 705
Date of Issue: 03-10-2026
Account Information
Lender: SAMPLE GOLD FINANCE | Type: Gold Loan | Acct No: GL4400
Ownership: Individual | Disbursed Date: 01-06-2026 | Disbursed Amt: 1,20,000
Current Bal: 1,24,500 | Overdue Amt: 0 | Status: Active
Lender: MICRO NBFC | Type: Two-Wheeler Loan | Acct No: TW7788
Ownership: Individual | Disbursed Date: 15-02-2025 | Disbursed Amt: 90,000
Current Bal: 41,000 | Installment Amt: 3,150 | Overdue Amt: 6,300 | Status: Written-off
"""

EQUIFAX = f"""{BANNER}
Equifax Credit Information Services Private Limited
Equifax Risk Score 3.1: 688
Report Date: 04-10-2026
Account Details
Institution: SAMPLE SMALL FINANCE BANK
Type: Business Loan General
Account Number: BL1234
Ownership Type: Individual
Date Opened: 10-10-2023
Sanction Amount: 3,00,000
Balance: 1,10,000
Past Due Amount: 0
Installment Amount: 9,800
Status: Settled
Institution: BNPL TEST CO
Type: BNPL
Account Number: BN0001
Ownership Type: Individual
Date Opened: 01-09-2026
Sanction Amount: 10,000
Balance: 6,000
Status: Open
"""

FIXTURES = {"cibil": CIBIL, "experian": EXPERIAN, "crif": CRIF, "equifax": EQUIFAX}


def encrypt(src: bytes, password: str) -> bytes:
    from pypdf import PdfReader, PdfWriter

    w = PdfWriter(clone_from=PdfReader(io.BytesIO(src)))
    w.encrypt(user_password=password, owner_password=password + "-owner", algorithm="AES-256")
    buf = io.BytesIO()
    w.write(buf)
    return buf.getvalue()


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    for name, text in FIXTURES.items():
        (OUT / f"{name}.synthetic.txt").write_text(text, encoding="utf-8")
    write_pdf(OUT / "cibil.synthetic.pdf", CIBIL.splitlines())
    (OUT / "cibil_locked.synthetic.pdf").write_bytes(encrypt((OUT / "cibil.synthetic.pdf").read_bytes(), REPORT_PASSWORD))
    (KFS / "personal_fixed_locked.synthetic.pdf").write_bytes(
        encrypt((KFS / "personal_fixed.synthetic.pdf").read_bytes(), KFS_PASSWORD)
    )
    (OUT / "passwords.json").write_text(
        json.dumps({"cibil_locked": REPORT_PASSWORD, "kfs_personal_fixed_locked": KFS_PASSWORD}, indent=2) + "\n",
        encoding="utf-8",
    )
    print("wrote", OUT)


if __name__ == "__main__":
    main()
