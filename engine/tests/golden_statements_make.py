"""Build the simulated golden loan statements (grill #67).

Each statement is computed with the *bank's own published convention*,
independently of the engine (no engine import here), so
test_golden_statements.py checks the engine against how the bank itself
would compute the balance, month by month. They are simulated, anonymised
statements: no real customer's data. Replace or add real statements in the
same JSON shape and the test picks them up.

    python engine/tests/golden_statements_make.py   # rewrites the fixtures

Conventions (sources, fetched 2026-10-12):
  * SBI home loan / car loan: "interest ... on daily reducing balance at
    monthly rests" -> interest for a month = balance x rate x days / 365.
    https://sbi.co.in/web/nri/loans/home-loan ("Interest Calculation on
    Daily Reducing Balance");
    https://sbi.co.in/documents/16012/25448726/171022-MITC+1510222.pdf (car
    loan MITC: "daily reducing balance at monthly rests").
  * Floating reset: RBI "Reset of Floating Interest Rate on Equated Monthly
    Instalments (EMI) based Personal Loans", 18 Aug 2023 (borrower may take
    a higher EMI or a longer tenure; no negative amortisation).
  * Personal loan (generic fixed-rate EMI): monthly rests at rate/12, the
    standard EMI formula. NOT tied to a named bank's published text.
  * HDFC credit card: finance charge "(outstanding x 3.75% per month i.e. 45%
    p.a. x No of days) / 365", from the transaction date on every purchase
    while a balance is carried; 18% GST on the finance charge.
    https://www.hdfc.bank.in/content/dam/hdfcbankpws/in/en/personal-banking/discover-products/cards/statement_related_payment_info.pdf
  * SBI Student Loan: "Simple interest to be charged during moratorium
    period"; accrued interest is added to principal and the EMI is fixed on
    it when repayment starts.
    https://sbi.bank.in/webapp/webfiles/uploads/files/1371638112056_SBI_STUDENT_LOAN_MITC.pdf
    https://sbi.bank.in/web/student-platform/repayment
"""
from __future__ import annotations

import calendar
import json
from decimal import ROUND_HALF_UP, ROUND_UP, Decimal
from pathlib import Path

D = Decimal
OUT = Path(__file__).parent / "fixtures" / "golden_statements"
START = (2026, 11)  # first statement month: Nov 2026 (after the E2E frozen day)


def months(n: int):
    y, m = START
    for _ in range(n):
        yield y, m
        m += 1
        if m == 13:
            y, m = y + 1, 1


def paise(x: Decimal) -> Decimal:
    return x.quantize(D("0.01"), rounding=ROUND_HALF_UP)


def emi(p: Decimal, rate: Decimal, n: int) -> Decimal:
    r = rate / 12
    f = (1 + r) ** n
    return (p * r * f / (f - 1)).quantize(D("1"), rounding=ROUND_UP)


def term_loan(*, p, rate, n, convention, rate_changes=None, reset_option="tenure", count=24):
    """A term loan statement. rate_changes: {statement_month_no: new_rate}."""
    rate_changes = rate_changes or {}
    bal, e = D(p), emi(D(p), D(rate), n)
    first_emi = e
    cur = D(rate)
    rows = []
    for i, (y, m) in enumerate(months(count), start=1):
        if i in rate_changes:
            new = D(rate_changes[i])
            if new > cur and reset_option == "emi":
                # Keep the end date: EMI on the remaining months at the new rate.
                left = n - (i - 1)
                cur = new
                e = emi(bal, cur, left)
            else:
                cur = new  # EMI held: tenure changes
        days = calendar.monthrange(y, m)[1]
        interest = paise(bal * cur * days / 365) if convention == "daily_365" else paise(bal * cur / 12)
        pay = min(e, bal + interest)
        bal = paise(bal + interest - pay)
        rows.append({"month": i, "period": f"{y}-{m:02d}", "days": days, "rate": str(cur),
                     "interest": str(interest), "paid": str(pay), "closing_balance": str(bal)})
    return first_emi, rows


def card(*, opening, apr, spend, payment, count=12, spend_day=10, pay_day=20):
    """HDFC-style revolving card: daily balance, interest from each
    transaction date, 18% GST on interest, billed at the cycle's end."""
    bal = D(opening)
    r = D(apr)
    rows = []
    for i, (y, m) in enumerate(months(count), start=1):
        days = calendar.monthrange(y, m)[1]
        # Carried balance for the whole cycle, less the payment from pay_day;
        # new spend from spend_day (no interest-free period while revolving).
        interest = paise(
            (bal * days - D(payment) * (days - pay_day + 1) + D(spend) * (days - spend_day + 1)) * r / 365
        )
        gst = paise(interest * D("0.18"))
        bal = paise(bal + D(spend) - D(payment) + interest + gst)
        rows.append({"month": i, "period": f"{y}-{m:02d}", "days": days, "rate": str(r),
                     "spend": str(spend), "interest": str(interest), "gst": str(gst),
                     "paid": str(payment), "closing_balance": str(bal)})
    return rows


def education(*, p, rate, moratorium_months, n, count=36):
    """SBI Student Loan: simple interest through the moratorium, added to
    principal at repayment start; then EMI at monthly rests."""
    rows = []
    accrued = D("0")
    y_m = list(months(count))
    for i in range(1, moratorium_months + 1):
        y, m = y_m[i - 1]
        days = calendar.monthrange(y, m)[1]
        accrued += paise(D(p) * D(rate) * days / 365)  # simple: on principal only
        rows.append({"month": i, "period": f"{y}-{m:02d}", "days": days, "rate": str(rate),
                     "interest": str(paise(D(p) * D(rate) * days / 365)), "paid": "0",
                     "closing_balance": str(paise(D(p) + accrued))})
    bal = paise(D(p) + accrued)
    e = emi(bal, D(rate), n)
    for i in range(moratorium_months + 1, count + 1):
        y, m = y_m[i - 1]
        interest = paise(bal * D(rate) / 12)
        pay = min(e, bal + interest)
        bal = paise(bal + interest - pay)
        rows.append({"month": i, "period": f"{y}-{m:02d}", "rate": str(rate),
                     "interest": str(interest), "paid": str(pay), "closing_balance": str(bal)})
    return e, rows


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    fixtures = []

    e, rows = term_loan(p="2500000", rate="0.086", n=240, convention="daily_365",
                        rate_changes={4: "0.0835", 13: "0.0885"}, reset_option="emi", count=24)
    fixtures.append({
        "id": "home_floating_sbi_style", "loan_type": "home", "rate_type": "floating",
        "bank_style": "SBI (EBLR-linked home loan)", "simulated": True,
        "principal": "2500000", "start_rate": "0.086", "tenure_months": 240, "emi": str(e),
        "convention": "daily reducing balance at monthly rests, actual days / 365",
        "rate_changes": {"4": "0.0835", "13": "0.0885"},
        "reset_option": "a cut keeps the EMI (tenure shortens); a rise raises the EMI to keep the end date",
        "sources": ["https://sbi.co.in/web/nri/loans/home-loan",
                    "RBI, Reset of Floating Interest Rate on EMI based Personal Loans, 18 Aug 2023"],
        "rows": rows})

    e, rows = term_loan(p="400000", rate="0.14", n=48, convention="monthly_12", count=48)
    fixtures.append({
        "id": "personal_fixed_monthly", "loan_type": "personal", "rate_type": "fixed",
        "bank_style": "generic fixed-rate personal loan (monthly rests)", "simulated": True,
        "principal": "400000", "start_rate": "0.14", "tenure_months": 48, "emi": str(e),
        "convention": "monthly rests at rate / 12 (standard EMI formula)", "sources": [],
        "rows": rows})

    e, rows = term_loan(p="800000", rate="0.0915", n=60, convention="daily_365", count=60)
    fixtures.append({
        "id": "car_fixed_sbi_style", "loan_type": "car", "rate_type": "fixed",
        "bank_style": "SBI car loan (fixed)", "simulated": True,
        "principal": "800000", "start_rate": "0.0915", "tenure_months": 60, "emi": str(e),
        "convention": "daily reducing balance at monthly rests, actual days / 365",
        "sources": ["https://sbi.co.in/documents/16012/25448726/171022-MITC+1510222.pdf"],
        "rows": rows})

    rows = card(opening="150000", apr="0.45", spend="20000", payment="30000", count=12)
    fixtures.append({
        "id": "card_revolving_hdfc_style", "loan_type": "credit_card", "rate_type": "fixed",
        "bank_style": "HDFC credit card, revolving with new spend", "simulated": True,
        "principal": "150000", "start_rate": "0.45", "monthly_spend": "20000", "payment": "30000",
        "convention": "daily balance x 45%/365 from each transaction date; 18% GST on interest; "
                      "spend on cycle day 10, payment on day 20",
        "sources": ["https://www.hdfc.bank.in/content/dam/hdfcbankpws/in/en/personal-banking/discover-products/cards/statement_related_payment_info.pdf"],
        "rows": rows})

    e, rows = education(p="1000000", rate="0.1015", moratorium_months=12, n=120, count=36)
    fixtures.append({
        "id": "education_moratorium_sbi_style", "loan_type": "education", "rate_type": "floating",
        "bank_style": "SBI Student Loan (interest not serviced during moratorium)", "simulated": True,
        "principal": "1000000", "start_rate": "0.1015", "moratorium_months": 12, "tenure_months": 120,
        "emi": str(e),
        "convention": "simple interest on principal through the moratorium, capitalised at repayment "
                      "start; EMI at monthly rests after",
        "sources": ["https://sbi.bank.in/webapp/webfiles/uploads/files/1371638112056_SBI_STUDENT_LOAN_MITC.pdf",
                    "https://sbi.bank.in/web/student-platform/repayment"],
        "rows": rows})

    for f in fixtures:
        (OUT / f"{f['id']}.json").write_text(json.dumps(f, indent=1) + "\n")
    print("wrote", len(fixtures), "statements to", OUT)


if __name__ == "__main__":
    main()
