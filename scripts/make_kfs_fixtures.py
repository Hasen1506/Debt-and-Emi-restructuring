"""Write the synthetic Key Facts Statement fixtures used by the KFS tests.

Every fixture is SYNTHETIC: made-up lenders, account numbers and borrowers,
laid out with the field labels of the RBI KFS template (Annex A of circular
RBI/2024-25/18, DOR.STR.REC.13/13.03.00/2024-25, 15 Apr 2024). None is a real
loan document. The figures are worked out here with the engine's own EMI and
the Annex B APR method, except where a fixture is meant to disagree.

    python scripts/make_kfs_fixtures.py      # rewrites engine/tests/fixtures/kfs/

The PDF is written by hand (one page, Helvetica, a text layer) so the test
needs no PDF-writing library; the engine reads it with pypdf.
"""
from __future__ import annotations

import sys
from decimal import Decimal, ROUND_HALF_UP
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from engine.formulas import emi  # noqa: E402
from engine.kfs import apr_from_terms  # noqa: E402

D = Decimal
OUT = ROOT / "engine" / "tests" / "fixtures" / "kfs"
BANNER = "SYNTHETIC SAMPLE - not a real loan document (RightDue test fixture)"


def r0(d: Decimal) -> int:
    return int(d.quantize(D("1"), ROUND_HALF_UP))


def inr(n: int) -> str:
    s = str(n)
    if len(s) <= 3:
        return s
    head = s[:-3]
    parts = []
    while len(head) > 2:
        parts.insert(0, head[-2:])
        head = head[:-2]
    if head:
        parts.insert(0, head)
    return ",".join(parts) + "," + s[-3:]


def apr2(p, r, n, fees) -> str:
    return f"{(apr_from_terms(D(p), D(r), n, D(fees)) * 100).quantize(D('0.01'), ROUND_HALF_UP)}%"


def part2() -> list[str]:
    return [
        "Part 2 (Other qualitative information)",
        "1 Clause of Loan agreement relating to engagement of recovery agents Clause 14",
        "2 Clause of Loan agreement which details grievance redressal mechanism Clause 19",
        "3 Phone number and email id of the nodal grievance redressal officer 1800-000-0000, nodal@example.invalid",
        "4 Whether the loan is, or in future maybe, subject to transfer to other REs or securitisation (Yes/ No) Yes",
    ]


def personal_fixed() -> tuple[str, dict]:
    p, r, n = 500000, "0.135", 60
    e = r0(emi(D(p), D(r), n))
    fee, ins = 10000, 3000
    apr = apr2(p, r, n, fee + ins)
    lines = [
        BANNER,
        "Sample Bank Limited",
        "Personal Loan - Key Facts Statement",
        "Part 1 (Interest rate and fees/charges)",
        "1 Loan proposal/ account No. SBL/PL/2026/000123 Type of Loan Personal Loan",
        f"2 Sanctioned Loan amount (in Rupees) ₹{inr(p)}",
        "3 Disbursal schedule",
        "(i) Disbursement in stages or 100% upfront. 100% upfront",
        "(ii) If it is stage wise, mention the clause of loan agreement having relevant details Not applicable",
        f"4 Loan term (year/months/days) {n} months",
        "5 Instalment details",
        "Type of instalments Number of EPIs EPI (₹) Commencement of repayment, post sanction",
        f"Monthly {n} {inr(e)} 30 days",
        "6 Interest rate (%) and type (fixed or floating or hybrid) 13.50% Fixed",
        "7 Additional Information in case of Floating rate of interest Not applicable",
        "8 Fee/ Charges",
        "Payable to the RE (A) Payable to a third party through RE (B)",
        "One-time/Recurring Amount (in ₹) or Percentage (%) as applicable One-time/Recurring Amount (in ₹) or Percentage (%) as applicable",
        f"(i) Processing fees One-time ₹{inr(fee)} - -",
        f"(ii) Insurance charges - - One-time ₹{inr(ins)}",
        "(iii) Valuation fees - - - -",
        "(iv) Any other (please specify) - - - -",
        f"9 Annual Percentage Rate (APR) (%) {apr}",
        "10 Details of Contingent Charges (in ₹ or %, as applicable)",
        "(i) Penal charges, if any, in case of delayed payment 2% per month on the overdue instalment",
        "(ii) Other penal charges, if any Nil",
        "(iii) Foreclosure charges, if applicable 4% of principal outstanding plus GST",
        "(iv) Charges for switching of loans from floating to fixed rate and vice versa Not applicable",
        "(v) Any other charges (please specify) Nil",
        *part2(),
        "Illustration for computation of APR",
        f"1 Sanctioned Loan amount (in Rupees) (Sl no. 2 of the KFS template - Part 1) {inr(p)}",
        f"9 Annual Percentage rate- Effective annualized interest rate (in percentage) {apr}",
        "11 Due date of payment of instalment and interest 05112026",
    ]
    expect = {
        "lender": "Sample Bank Limited", "loan_type": "personal_loan", "sanctioned_amount": "500000",
        "tenure_months": "60", "emi_count": "60", "emi": str(e), "interest_rate": "0.135", "rate_type": "fixed",
        "apr": str(D(apr[:-1]) / 100), "processing_fee": "10000", "insurance": "3000",
        "prepayment_charge": "0.04", "first_emi_date": "2026-11-05",
    }
    return "\n".join(lines), expect


def home_floating() -> tuple[str, dict]:
    p, n = 5000000, 240
    b, s, r = "0.0525", "0.0275", "0.08"
    e = r0(emi(D(p), D(r), n))
    fee, val = 25000, 5000   # 0.50% of the loan; valuation by a third party
    apr = apr2(p, r, n, fee + val)
    lines = [
        BANNER,
        "Example Housing Finance Limited",
        "Key Facts Statement",
        "Part 1 (Interest rate and fees/charges)",
        "1 Loan proposal/ account No. EHF/HL/2026/004567 Type of Loan Home Loan",
        f"2 Sanctioned Loan amount (in Rupees) ₹{inr(p)}",
        "3 Disbursal schedule",
        "(i) Disbursement in stages or 100% upfront. In stages",
        "(ii) If it is stage wise, mention the clause of loan agreement having relevant details Clause 4.2",
        "4 Loan term (year/months/days) 20 years",
        "5 Instalment details",
        "Type of instalments Number of EPIs EPI (₹) Commencement of repayment, post sanction",
        f"Monthly {n} {inr(e)} 30 days",
        "6 Interest rate (%) and type (fixed or floating or hybrid) 8.00% Floating",
        "7 Additional Information in case of Floating rate of interest",
        "Reference Benchmark Benchmark rate (%) (B) Spread (%) (S) Final rate (%) R = (B) + (S) Reset periodicity (Months) Impact of change in the reference benchmark (for 25 bps change in 'R', change in:)",
        "B S EPI (₹) No. of EPIs",
        "RBI Repo Rate 5.25 2.75 8.00 3 3 - 776 7",
        "8 Fee/ Charges",
        "Payable to the RE (A) Payable to a third party through RE (B)",
        "(i) Processing fees One-time 0.50% of loan amount - -",
        "(ii) Insurance charges - - - -",
        f"(iii) Valuation fees - - One-time ₹{inr(val)}",
        "(iv) Any other (please specify) - - - -",
        f"9 Annual Percentage Rate (APR) (%) {apr}",
        "10 Details of Contingent Charges (in ₹ or %, as applicable)",
        "(i) Penal charges, if any, in case of delayed payment 2% per annum on the overdue amount",
        "(ii) Other penal charges, if any Nil",
        "(iii) Foreclosure charges, if applicable Nil for floating rate loans to individual borrowers",
        "(iv) Charges for switching of loans from floating to fixed rate and vice versa 0.50% of principal outstanding",
        "(v) Any other charges (please specify) Nil",
        *part2(),
    ]
    expect = {
        "lender": "Example Housing Finance Limited", "loan_type": "home_loan", "sanctioned_amount": "5000000",
        "tenure_months": "240", "emi": str(e), "interest_rate": "0.08", "rate_type": "floating",
        "benchmark": "RBI Repo Rate", "benchmark_rate": "0.0525", "spread": "0.0275", "final_rate": "0.08",
        "apr": str(D(apr[:-1]) / 100), "processing_fee": "25000", "valuation": "5000", "prepayment_charge": "0",
    }
    assert D(b) + D(s) == D(r)
    return "\n".join(lines), expect


def annex_b() -> tuple[str, dict]:
    """RBI's own worked example (Annex B of the circular): ₹20,000 at 15% fixed
    over 24 months, EMI ₹970 (969.73 rounded), ₹240 to the RE and ₹160 to a
    third party, APR 17.07%."""
    lines = [
        BANNER,
        "Illustration Bank Limited",
        "Key Facts Statement (figures from the hypothetical loan in Annex B of the RBI circular)",
        "Part 1 (Interest rate and fees/charges)",
        "1 Loan proposal/ account No. ILL/0001 Type of Loan Personal Loan",
        "2 Sanctioned Loan amount (in Rupees) 20,000",
        "4 Loan term (year/months/days) 24 months",
        "5 Instalment details",
        "Type of instalments Number of EPIs EPI (₹) Commencement of repayment, post sanction",
        "Monthly 24 970 30 days",
        "6 Interest rate (%) and type (fixed or floating or hybrid) 15% Fixed",
        "8 Fee/ Charges",
        "(i) Processing fees One-time ₹240 - -",
        "(ii) Insurance charges - - One-time ₹160",
        "(iii) Valuation fees - - - -",
        "(iv) Any other (please specify) - - - -",
        "9 Annual Percentage Rate (APR) (%) 17.07%",
        "10 Details of Contingent Charges (in ₹ or %, as applicable)",
        "(iii) Foreclosure charges, if applicable 3% of principal outstanding",
    ]
    expect = {"sanctioned_amount": "20000", "tenure_months": "24", "emi": "970", "interest_rate": "0.15",
              "rate_type": "fixed", "apr": "0.1707", "processing_fee": "240", "insurance": "160",
              "prepayment_charge": "0.03"}
    return "\n".join(lines), expect


def mismatch() -> tuple[str, dict]:
    """The EMI and APR stated here don't follow from the terms: the EMI is
    too high and the APR is above what the listed fees explain."""
    lines = [
        BANNER,
        "Mismatch Bank Limited",
        "Key Facts Statement",
        "Part 1 (Interest rate and fees/charges)",
        "1 Loan proposal/ account No. MBL/PL/77 Type of Loan Personal Loan",
        "2 Sanctioned Loan amount (in Rupees) ₹3,00,000",
        "4 Loan term (year/months/days) 36 months",
        "5 Instalment details",
        "Type of instalments Number of EPIs EPI (₹) Commencement of repayment, post sanction",
        "Monthly 36 10,500 30 days",
        "6 Interest rate (%) and type (fixed or floating or hybrid) 12.00% Fixed",
        "8 Fee/ Charges",
        "(i) Processing fees One-time ₹5,000 - -",
        "9 Annual Percentage Rate (APR) (%) 15.50%",
        "10 Details of Contingent Charges (in ₹ or %, as applicable)",
        "(iii) Foreclosure charges, if applicable 5% of principal outstanding",
    ]
    return "\n".join(lines), {"emi": "10500", "apr": "0.155"}


def sanction_letter() -> tuple[str, dict]:
    p, r, n = 800000, "0.0925", 60
    e = r0(emi(D(p), D(r), n))
    lines = [
        BANNER,
        "Demo Finance Limited",
        "SANCTION LETTER",
        "Date: 12-03-2023",
        "Dear Customer,",
        "We are pleased to sanction a Car Loan on the following terms:",
        f"Loan Amount: Rs. {inr(p)}/-",
        "Rate of Interest: 9.25% p.a. (Fixed)",
        "Tenure: 5 years",
        f"EMI: Rs. {inr(e)}/-",
        "Processing Fee: Rs. 4,000/- plus GST",
        "First EMI Date: 05-04-2023",
        "Foreclosure / Prepayment charges: 5% of principal outstanding",
    ]
    expect = {"lender": "Demo Finance Limited", "loan_type": "auto_loan", "sanctioned_amount": "800000",
              "tenure_months": "60", "emi": str(e), "interest_rate": "0.0925", "rate_type": "fixed",
              "processing_fee": "4000", "prepayment_charge": "0.05", "first_emi_date": "2023-04-05"}
    return "\n".join(lines), expect


# ── a one-page PDF with a text layer, by hand ───────────────────────────────

def _pdf_escape(s: str) -> str:
    return s.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")


def write_pdf(path: Path, lines: list[str]) -> None:
    body = ["BT", "/F1 8 Tf", "10 TL", "30 810 Td"]
    for ln in lines:
        body.append(f"({_pdf_escape(ln)}) Tj T*")
    body.append("ET")
    stream = "\n".join(body).encode("latin-1")
    objs = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> "
        b"/Contents 5 0 R >>",
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
        b"<< /Length " + str(len(stream)).encode() + b" >>\nstream\n" + stream + b"\nendstream",
    ]
    out = bytearray(b"%PDF-1.4\n")
    offsets = []
    for i, o in enumerate(objs, 1):
        offsets.append(len(out))
        out += f"{i} 0 obj\n".encode() + o + b"\nendobj\n"
    xref = len(out)
    out += f"xref\n0 {len(objs) + 1}\n0000000000 65535 f \n".encode()
    for off in offsets:
        out += f"{off:010d} 00000 n \n".encode()
    out += f"trailer\n<< /Size {len(objs) + 1} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n".encode()
    path.write_bytes(bytes(out))


def write_blank_pdf(path: Path) -> None:
    """A page with no text layer, like a scanned KFS."""
    write_pdf(path, [])


def main() -> None:
    import json
    OUT.mkdir(parents=True, exist_ok=True)
    expected = {}
    for name, fn in (("personal_fixed", personal_fixed), ("home_floating", home_floating),
                     ("annex_b", annex_b), ("mismatch", mismatch), ("sanction_letter", sanction_letter)):
        text, exp = fn()
        (OUT / f"{name}.synthetic.txt").write_text(text + "\n", encoding="utf-8")
        expected[name] = exp
    # The personal-loan KFS as a PDF, with "Rs." for "₹" (Helvetica has no rupee sign).
    text, _ = personal_fixed()
    write_pdf(OUT / "personal_fixed.synthetic.pdf", text.replace("₹", "Rs. ").split("\n"))
    write_blank_pdf(OUT / "scanned.synthetic.pdf")
    (OUT / "expected.json").write_text(json.dumps(expected, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print("wrote", sorted(p.name for p in OUT.iterdir()))


if __name__ == "__main__":
    main()
