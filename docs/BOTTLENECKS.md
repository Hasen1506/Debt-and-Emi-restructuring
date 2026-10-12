# Bottlenecks

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
