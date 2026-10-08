# Rates: your own, and what banks lent at (roadmap PR G)

Two sources, neither of them a number typed into the code.

## 1. Your loan's own terms, from its Key Facts Statement

RBI circular RBI/2024-25/18, DOR.STR.REC.13/13.03.00/2024-25, *Key Facts
Statement (KFS) for Loans & Advances*, 15 April 2024
(<https://www.rbi.org.in/Scripts/NotificationUser.aspx?Id=12663&Mode=0>):
every retail and MSME term loan sanctioned on or after 1 October 2024 comes
with a KFS in the format of its Annex A, stating the rate type, rate, APR
(computed as in Annex B), every fee and charge, and the amortisation
schedule. A charge that isn't in the KFS can't be taken without the
borrower's consent (para 8). Credit cards are exempt (para 10).

**Profile → Loans → "Import from Key Facts Statement / sanction letter"**
(India). Upload the PDF or paste its text.

- `POST /api/kfs/read` (`api/routes/kfs.py`, `engine/kfs.py`) reads it with
  plain-text rules on the document's text layer (pypdf for a PDF). No outside
  service or AI model sees it, and nothing is stored. A scanned PDF (no text
  layer) gets a plain "paste the text instead".
- It reads: lender, loan type, sanctioned amount, tenure, rate type, rate,
  benchmark + spread (floating), APR, processing fee and other fees,
  prepayment / foreclosure charge, EMI, first EMI date. The labels are Annex
  A's own, plus the usual sanction-letter wording for older loans.
- **Cross-checks.** The EMI is worked out again from amount, rate and tenure;
  the APR as Annex B does it (IRR of the net amount disbursed against the
  EMIs, monthly rate × 12; RBI's own example, ₹20,000 at 15% for 24 months
  with ₹400 of charges, comes out at its 17.07%). A gap is said in plain
  words: a misread field, or (APR above what the listed fees explain) charges
  the KFS doesn't list. Benchmark + spread must equal the final rate.
- **Review before anything is saved.** Every field is shown, editable, and
  marked *from your KFS* (with the line it came from), *worked out from your
  KFS* (today's balance and months left from the schedule when the first EMI
  is past; the processing fee spread per year), or *you entered*. "Add this
  loan" puts it in the form; the user still saves the Profile.
- The KFS prepayment charge fills the loan's fee and replaces PR K's default
  (including the RBI 0% for floating-rate loans); the fee field says it came
  from the KFS until the user changes it.
- Fixtures (`engine/tests/fixtures/kfs/`) are synthetic documents laid out
  with Annex A's labels, written by `scripts/make_kfs_fixtures.py`.

## 2. What banks actually lent at, from their own disclosures

RBI/2014-15/422, DBR.Leg.No.BC.64/09.07.005/2014-15, *Display of information
by banks*, 22 January 2015, para 2(a)
(<https://www.rbi.org.in/Scripts/NotificationUser.aspx?Id=9508&Mode=0>):
banks must publish the interest-rate range of loans contracted in the past
quarter, by category of advance to individuals, with the mean rate, and the
APR.

- `engine/rate_disclosures.py` has one parser per lender page; each checks
  its rows (min ≤ mean ≤ max, 3–60%, a whole quarter) and drops a row that
  doesn't add up, with the reason. A page it no longer recognises gives no
  rows, so that lender simply isn't shown.
- `scripts/fetch_rate_disclosures.py` fetches the pages and writes
  `api/data/rate_disclosures/<date>.json` and the web copy
  `web/src/lib/rate-disclosures.json`, with each lender's source URL and
  fetch time, only when the figures changed.
- `.github/workflows/rate-disclosures.yml` runs it every Monday 09:00 IST (and
  on demand), runs the disclosure tests, and commits the new file.
- Profile → Loans shows, under the rate: "N banks lent personal loans at
  X–Y% in <quarter>; the middle bank's mean was Z%", where the user's rate
  sits, and each bank's line with its source link. "You may be able to
  refinance" appears only when the rate is a point or more above the middle
  bank's mean **and** moving the balance at that mean for the same months
  saves more than the foreclosure charge (with 18% GST) by at least 1% of the
  balance; it says how much room a new lender's fees have.

Lenders parsed (pages checked 2026-10-08, all for Apr–Jun 2026):
SBI (personal loan; publishes only the mean), HDFC Bank (personal loan, with
APR), ICICI Bank (personal loan; new and used car), Axis Bank (personal loan),
Kotak Mahindra Bank (housing, LAP, personal, education, gold and others),
IDFC FIRST Bank (personal, home, new car, education, gold and others). Bank of
Baroda's page publishes only its rate card, not the contracted range, so it
isn't included.

## What went

`engine/rate_cards.py` no longer carries per-bank "industry norm" prepayment
fees (the 2–5% figures) or the 2% / 3% / 5% country defaults for fixed-rate
home, personal and auto loans. They had no source. A fixed-rate loan's fee is
now unknown until the user enters it or imports it from the KFS.
