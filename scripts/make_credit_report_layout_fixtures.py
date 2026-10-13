"""Write SYNTHETIC credit-report fixtures in the layouts bureau PDFs actually use
(UX50 D-01): a space-aligned table (CIBIL-style), a "|" table (Experian-style),
stacked label/value lines (Equifax-style), and a table flattened to one cell per
line, as a plain text extraction or a copy-paste from a PDF viewer gives
(CRIF-style). Each is written as text and, for the tables, as a PDF drawn at
column x-positions, the way a bureau's report generator draws it.

Everything is made up: invented people, lenders, account numbers and figures.
None of it is a real credit report.

    python scripts/make_credit_report_layout_fixtures.py
"""
from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "engine" / "tests" / "fixtures" / "credit_report" / "layouts"
BANNER = "SYNTHETIC SAMPLE - not a real credit report (RightDue test fixture)"

ACCOUNTS = [
    # lender, type, acct no, ownership, opened, sanctioned, balance, overdue, emi, status, reported
    ("SAMPLE HFC", "Housing Loan", "HL00123456", "Joint", "15-03-2021", "45,00,000", "38,12,450", "0", "39,500", "Active", "30-09-2026"),
    ("DEMO BANK", "Credit Card", "4111XXXXXXXX4321", "Individual", "02-07-2019", "1,50,000", "64,210", "3,500", "-", "Active", "30-09-2026"),
    ("QUICKPAY FINANCE", "Consumer Loan", "CD99887766", "Individual", "10-01-2026", "42,000", "21,000", "0", "3,500", "Active", "23-09-2026"),
    ("OLD AUTO FINANCE", "Auto Loan", "AL55554444", "Individual", "01-04-2017", "5,00,000", "0", "0", "-", "Closed", "31-03-2022"),
]
EXPECTED = [
    {"lender": "SAMPLE HFC", "loan_type": "home_loan", "outstanding": "3812450", "emi": "39500", "account_last4": "3456", "reported": "2026-09-30"},
    {"lender": "DEMO BANK", "loan_type": "credit_card", "outstanding": "64210", "emi": None, "account_last4": "4321", "reported": "2026-09-30"},
    {"lender": "QUICKPAY FINANCE", "loan_type": "personal_loan", "outstanding": "21000", "emi": "3500", "account_last4": "7766", "reported": "2026-09-23"},
]
HEAD = ["Lender", "Account Type", "Account No", "Ownership", "Date Opened", "Sanctioned Amount",
        "Current Balance", "Amount Overdue", "EMI Amount", "Account Status", "Date Reported"]
WIDTHS = [20, 16, 20, 12, 13, 19, 17, 16, 12, 16, 13]


def _pad(cells):
    return "".join(str(c).ljust(w) for c, w in zip(cells, WIDTHS)).rstrip()


def cibil_table() -> str:
    rows = [_pad(HEAD)] + [_pad(a) for a in ACCOUNTS]
    return "\n".join([BANNER, "TransUnion CIBIL  Consumer Credit Report", "CIBIL Score 742      Report Date 05-10-2026",
                      "ACCOUNT INFORMATION", *rows, "ENQUIRY INFORMATION", "ANOTHER BANK    Personal Loan    01-09-2026"]) + "\n"


def experian_pipes() -> str:
    rows = ["| " + " | ".join(HEAD) + " |"] + ["| " + " | ".join(a) + " |" for a in ACCOUNTS]
    return "\n".join([BANNER, "Experian Credit Information Company of India", "Experian Credit Score 781",
                      "Report Date 05/10/2026", "Credit Account Summary", *rows]) + "\n"


def equifax_stacked() -> str:
    out = [BANNER, "Equifax Credit Information Services", "Equifax Risk Score 3.0", "688", "Report Date", "05-10-2026",
           "Account Details"]
    for a in ACCOUNTS:
        for h, v in zip(HEAD, a):
            out += [h, v]
    out += ["Enquiries", "ANOTHER BANK"]
    return "\n".join(out) + "\n"


def crif_columns() -> str:
    out = [BANNER, "CRIF High Mark Credit Information Services", "PERFORM CONSUMER 2.2 SCORE 705",
           "Report Date 05-10-2026", "Account Information", *HEAD]
    for a in ACCOUNTS:
        out += list(a)
    return "\n".join(out) + "\n"


def table_pdf(path: Path, title_lines: list[str], pipes: bool = False) -> None:
    from reportlab.lib.pagesizes import A4, landscape
    from reportlab.pdfgen import canvas

    c = canvas.Canvas(str(path), pagesize=landscape(A4))
    c.setTitle("Synthetic credit report (not real)")
    y = 560
    for t in title_lines:
        c.setFont("Helvetica", 10)
        c.drawString(30, y, t)
        y -= 16
    xs, x = [], 30
    for w in WIDTHS:
        xs.append(x)
        x += w * 3.6
    for r, row in enumerate([HEAD] + [list(a) for a in ACCOUNTS]):
        y -= 18
        c.setFont("Helvetica-Bold" if r == 0 else "Helvetica", 6)
        for xx, cell in zip(xs, row):
            c.drawString(xx, y, cell)
        if pipes:
            c.line(30, y - 4, x, y - 4)
    c.showPage()
    c.save()


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    texts = {"cibil_table": cibil_table(), "experian_pipes": experian_pipes(),
             "equifax_stacked": equifax_stacked(), "crif_columns": crif_columns()}
    for name, t in texts.items():
        (OUT / f"{name}.synthetic.txt").write_text(t, encoding="utf-8")
    table_pdf(OUT / "cibil_table.synthetic.pdf", [BANNER, "TransUnion CIBIL Consumer Credit Report",
                                                  "CIBIL Score 742", "Report Date 05-10-2026", "ACCOUNT INFORMATION"])
    table_pdf(OUT / "experian_table.synthetic.pdf", [BANNER, "Experian Credit Information Company of India",
                                                     "Experian Credit Score 781", "Report Date 05/10/2026"], pipes=True)
    (OUT / "expected.json").write_text(json.dumps(EXPECTED, indent=1) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
