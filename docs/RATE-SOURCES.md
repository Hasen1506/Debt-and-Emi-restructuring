# Rate sources and how they refresh (audit 80+ A21, E1, W4 cron design)

Written 14 Oct 2026. Companion to `docs/RATES.md` (your own KFS terms and the
banks' quarterly disclosures) and `docs/LOAN-CHECK-HIKE-CYCLE.md`.

The rule since A21: **a rate shown as a lender's rate must have been read off
that lender's own page, or an RBI page, with a date.** Anything else is
labelled "typical, unverified" and is never quoted as the lender's rate,
never prefilled, and never used by Loan Check (`engine/rate_cards.py`
UNVERIFIED_LABEL; `loan_check.find_lender`; `restructuring_scan._country_pool`;
web `RateRangeHint`). Since E1, a cheaper-loan saving is costed at the
**middle** of the bank's published range, with the saving at each end shown,
never at its floor (nobody is promised the floor; it goes to the best credit
profiles).

## 1. Where an accurate rate comes from, by lender type

| Lender type | What it must publish | Where RightDue reads it | Status |
|---|---|---|---|
| **RBI policy rate** (repo) | MPC resolution on each decision day | rbi.org.in home page + press release (`api/rates_feed.py`, checked against the verified table in `engine/policy_rates.py`) | Automated: `policy-rates.yml`, weekly + MPC days |
| **Scheduled commercial banks: repo-linked (EBLR/RLLR) home loans** | The external benchmark and spread; reset at least once in three months (Interest Rate on Advances Directions, `engine/citations.py` EBLR_RESET; EBLR circular 4 Sep 2019, <https://www.rbi.org.in/Scripts/NotificationUser.aspx?Id=11677&Mode=0>) | Bank's own interest-rate page (Tier-A cards: SBI, HDFC Bank, ICICI Bank, Axis Bank, Kotak, PNB) | Read by hand, dated per card (`last_verified`); the weekly market-data report flags a card for re-reading when the repo moves away from `REPO_BASIS_IN` or the card is 120+ days old |
| **Banks: MCLR-linked loans** | MCLR reviewed monthly and published | Bank's MCLR page; RBI's monthly "Lending and Deposit Rates of SCBs" release for the median 1-year MCLR (e.g. <https://www.rbi.org.in/Scripts/BS_PressReleaseDisplay.aspx?prid=63049>) | Not scraped. Loan Check asks the borrower for their own rate history instead, which is what matters for their loan |
| **Banks: what they actually lent at** | Range and mean of rates on loans contracted last quarter, by category (RBI 22 Jan 2015 para 2(a), <https://www.rbi.org.in/Scripts/NotificationUser.aspx?Id=9508&Mode=0>) | `engine/rate_disclosures.py` parsers for SBI, HDFC, ICICI, Axis, Kotak, IDFC FIRST | Automated: `rate-disclosures.yml`, weekly, commits only on change. The best "what will I really get" source |
| **Small finance banks** | Same interest-rate rules as commercial banks (SFB Interest Rate on Advances Directions, `_URL_SFB_IRA` in `engine/citations.py`) | Bank pages | Tier-B/C only today → shown as "typical, unverified" |
| **NBFCs and housing finance companies** | Not on EBLR; each prices off its own benchmark (e.g. a prime lending rate). Fair Practices Code: the interest-rate model and the range/approach to risk gradation on its website (now in the NBFC and HFC Responsible Business Conduct Directions, `engine/citations.py`) | Lender's own page | Tier-B/C only → "typical, unverified". Loan Check treats an HFC/NBFC by its own rules (reset-choice letter goes the NHB/RBI route) |
| **Your own loan** | Key Facts Statement for every retail loan sanctioned from 1 Oct 2024 (RBI 15 Apr 2024, <https://www.rbi.org.in/Scripts/NotificationUser.aspx?Id=12663&Mode=0>) | KFS import (`engine/kfs.py`) | The most accurate source of all; preferred over any card |
| **US** (for the US side) | Fed funds target; mortgage average | FRED DFEDTARU/DFEDTARL; FRED MORTGAGE30US (Freddie Mac PMMS) | Automated (`policy-rates.yml`, `market-data.yml`) |

Aggregators (BankBazaar, Paisabazaar and similar) are **not** a source: they
show "starting from" floors, are commercial lead-generators, and their
figures can't be traced to the lender.

## 2. The jobs that keep them fresh (GitHub Actions)

All data jobs run only their own data tests and propose changes through
`.github/actions/data-pr` (a PR that merges itself when tests pass, or waits
for review when `DATA_PR_MODE=review`). None pushes straight to main; none
redeploys unless a file changed (`api/tests/test_data_workflows.py`).

| Workflow | When (IST) | Writes | Cost |
|---|---|---|---|
| `policy-rates.yml` | Mon 08:30, **and 12:00 on each scheduled RBI MPC decision day** | `api/data/policy_rates_live.json` | ~58 runs/yr |
| `rate-disclosures.yml` | Mon 09:00 | `api/data/rate_disclosures/<date>.json`, `web/src/lib/rate-disclosures.json` | 52 runs/yr |
| `market-data.yml` | Mon 09:30 | `web/src/lib/market-data.json` + an issue listing what needs a person (stale Tier-A cards, cards priced on an old repo) | 52 runs/yr |

### MPC-day runs, in detail (A19)

- GitHub cron can't read a file, so the decision-day lines in
  `policy-rates.yml` (between the `BEGIN/END generated` markers) are written by
  `python scripts/policy_rate_schedule.py write` from the `scheduled` RBI
  meetings in `api/data/central_bank_calendar.json`. Run it whenever the
  calendar changes (RBI publishes each financial year's MPC dates in March;
  a meeting becomes `held` after it happens).
- `test_policy_rates_also_run_on_every_scheduled_mpc_day` fails if the
  workflow and calendar disagree, so a forgotten regeneration is caught in CI.
- A cron line has no year ("30 6 4 12 *" would also fire on 4 Dec 2027), so
  the cheap `gate` job (checkout of two files, no Python setup) asks the script
  whether today is really a decision day; if not, the fetch job is skipped and
  costs nothing.
- 12:00 IST is two hours after the Governor's 10:00 statement, so the RBI page
  shows the new rate. Scheduled GitHub runs can start late; that only delays
  the check within the day. The weekly run remains the safety net.
- FOMC days are not scheduled (the US side is secondary; press "Run workflow"
  after a Fed meeting if needed).

## 3. What is not automated yet (proposal)

- **Tier-A card ranges** are still read by hand. Proposal: add one parser per
  Tier-A bank's home-loan rate page in the style of `engine/rate_disclosures.py`
  (each row checked; a page it no longer recognises gives no rows, never a
  guess) and run it inside the existing Monday `rate-disclosures.yml` job, so
  no new workflow or extra minutes. Until then, the market-data issue tells a
  person which card to re-read.
- **Tier-B/C cards** stay "typical, unverified" until each lender gets a parser
  or a dated hand reading. They are never used to promise a saving.
- **Held meetings**: the policy-rates bot records rate *changes*; marking a
  meeting `held` with its outcome in `central_bank_calendar.json` is manual.
  See the known gap in `docs/LOAN-CHECK-HIKE-CYCLE.md` §5.
