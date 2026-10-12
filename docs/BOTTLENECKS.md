# Bottlenecks

Known limits we have chosen to live with for now, and what would remove them.

## Legal review (privacy notice, terms, data handling) — sprint G8

No lawyer has checked the privacy notice (`/privacy`), the terms (`/terms`)
or docs/privacy-and-retention.md. Both pages say so. The alternative in place:
every legal statement cites the DPDP Act 2023 or DPDP Rules 2025 section it
rests on, read from the primary text on meity.gov.in (12 Oct 2026), and a test
(web/tests/g8-security-privacy.cjs) checks the notice still covers the items
rules 3, 9 and 14 ask for. **The right option** is a privacy lawyer's review
before 14 May 2027, when most DPDP duties apply, or before any paid tier.

## Processor contracts — sprint G8

DPDP Act s.8(2) asks for a valid contract with each Data Processor (Neon,
Render, Cloudflare, Resend, Sentry if used). We rely on each provider's
standard terms and data processing addendum; nothing has been reviewed or
signed specifically.

Known limits we've chosen to live with for now, and what would remove each.
Other sprint workstreams add their own sections; keep one heading per item.

## Exact payoff-order search optimises noise (grill #37, founder: "let it be as is, record it")
`engine/fee_order.py` tries every payoff order for up to 5 loans (120 simulator
runs) when a loan has a prepayment fee, and keeps a different order if it's
cheaper by more than `TIE` = ₹1 / $1. Inputs are user-typed balances and rates
that are often off by 5% or more, so a ₹1 win is within the error of the
inputs. On Render's free instance (a fraction of a CPU) 120 runs that take
about 11 ms each locally can add seconds to a page load.
- Kept as is (founder decision, 2026-10-12).
- What would remove it: change the order only when it saves more than
  max(₹500, 0.5% of the plan's interest) and otherwise say "within rounding";
  or cache the search per profile version; or move to a paid instance.

## Card minimum due: formulas are estimates (grill #26)
The issuer formulas in `engine/minimum_payments.py` / `web/src/lib/min-payment.ts`
have no published source on file (`FORMULA_SOURCE[...]["verified"] = False`).
The app labels them "estimated" and asks for the statement's Minimum Amount
Due. The founder doesn't want statement uploads, so the options to improve on
typing it once are: the bank's bill SMS parsed by G6's SMS parser ("Min Amt Due
Rs X"), Account Aggregator data (G6 research), or sourcing each issuer's MITC
PDF with a date and a refresh check.

## Unknown prepayment fees (grill #29)
No integration returns a loan's prepayment fee: Account Aggregator shares
balances and transactions, not agreement terms, and credit reports don't carry
it. The fee is user-typed or read from the KFS. `fee_order.unknown_fee_check`
asks only when a 4% (+GST) illustrative fee would change where the extra goes.

## GST clause text not re-read from CBIC (grill #27)
`engine/tax/gst.py` cites CBIC Notifications 12/2017 and 11/2017-Central Tax
(Rate). The sprint couldn't fetch the CBIC PDFs, so `GST_SOURCE["verified"]` is
False until someone reads the clauses and dates the check.

## Card new-spend interest is month-granular (grill #25)
RBI FAQ 6: while a card revolves, interest runs from each transaction's date.
The simulator works in months, so it charges a full month on that month's
spend (the most it could cost); spend spread through a month really costs
about half. A daily-balance model, or L5's statement goldens, would pin it.
A card paid in full every month ("transactor") pays no interest on spend, and
the simulator doesn't yet model that case separately.
Things the app does with a known limit, the right fix, and why it is not
done yet. Each entry names the workstream that recorded it.

## Legal review of the complaint letters (critique #54, Sprint G5)

**Right option:** a lawyer (consumer-banking or RBI-regulation practice)
reviews the three India templates in `engine/complaints_in.py` — the
grievance letter, the Internal Ombudsman follow-up and the RBI Ombudsman
complaint — and signs off before they are promoted. Re-review whenever a
cited rule changes.

**Why not now:** no lawyer is available to the founder at present.

**What is done instead (Oct 2026):**
1. Every rule a letter cites is tied to the regulation's own words:
   `engine/citations.py` holds the verbatim clause, paragraph, URL and
   date checked, and `engine/tests/test_citations.py` fails if a clause is
   not found word for word in the saved source extract
   (`engine/tests/fixtures/rbi_extracts/`).
2. Every letter is labelled "Draft. Check before sending." and RightDue
   never sends it (`DRAFT_NOTICE`).
3. The screen asks the borrower to tick a self-check list (`SELF_CHECK`:
   details, starting rate, current rate, spread, lender type, the quoted
   rules, keeping a copy) before it offers copy or download.
4. Letters are generated only for lenders the repo-rate rule binds
   (commercial and small finance banks), never for housing finance
   companies, NBFCs, regional rural banks or co-operative banks.

**Next step when a lawyer is found:** give them the three templates, the
citation clauses and the self-check list; record the review date and any
changes here.

## RBI PDFs behind a captcha (Sprint G5)

RBI's updated Master Direction PDFs (rbidocs.rbi.org.in) show an image
captcha to scripted downloads. The HTML versions on rbi.org.in are read
directly; the conduct Directions (commercial banks, NBFCs) were read in a
browser and transcribed. The Housing Finance Companies Directions were read
from the copy the National Housing Bank hosts (as issued, 28 Nov 2025);
RBI's page shows a version updated 1 Oct 2026 that could not be opened.
Re-check paragraphs 137, 146, 163 and 176 against it when possible.
Known limits that were recorded rather than fixed, with the better option when there is one. (Other workstreams add their own sections; G6 owns "Data import".)

## Data import (G6)

- **Statement upload: improve later (founder #26).** The founder doesn't like making users upload statements. What exists now, least to most effort for the user:
  - pasting SMS (in the browser);
  - a credit-report PDF once a year (all loans in one go);
  - the KFS once per loan (fees, rate type, prepayment terms).
  Not built: forwarding a statement email to an inbound address with a parser per bank; AA (needs a licence, see docs/ACCOUNT_AGGREGATOR.md); an Android app that reads SMS automatically.
- **Real-document testing.** The KFS and credit-report parsers are tested only on SYNTHETIC fixtures (engine/tests/fixtures/kfs, engine/tests/fixtures/credit_report). The bureau field labels follow their usual published wording, not real reports. Before relying on them widely, test on real anonymised reports (CIBIL, Experian, CRIF, Equifax, at least two of each) and on about 10 real KFS or sanction letters from different banks (grill #18). Add each as a golden fixture with the personal details removed.
- **No OCR.** Scanned PDFs and photos can't be read; the user pastes text or types instead.
- **English only.** The labels matched are English.
- **Server-side PDF parsing (#19).** PDFs are read on RightDue's server (never stored) because the rules are Python. Parsing in the browser with pdf.js (pdfjs-dist, Apache-2.0) would keep the document on the device. It means porting engine/kfs.py and engine/credit_report.py to TypeScript, with differential tests to keep the two in step. Recommended as its own PR.
- **Automatic SMS reading.** Only an Android app can do it. Google Play allows the SMS permission group only for the default SMS app or under a declared exception. "SMS-based money management (for example, apps that track and manage budget)" is one of those exceptions, covering READ_SMS, RECEIVE_SMS, RECEIVE_MMS and RECEIVE_WAP_PUSH, and the app must declare it in Play Console (https://support.google.com/googleplay/android-developer/answer/10208820). The web app can't read SMS; it takes pasted or shared text.
- **SMS formats drift.** Banks change their SMS wording. The parser is rule-based (web/src/lib/sms-parser.ts), and synthetic examples are in web/tests/sms-parser.cjs. Add a real (anonymised) message to the tests whenever one misparses.
