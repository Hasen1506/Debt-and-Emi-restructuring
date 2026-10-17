# Loan Check in a rate-rise cycle (audit 80+ A11, A16, A19)

A plain explainer for the founder. Written 14 Oct 2026. Every rule below has
its source link; the code that applies it is named so it can be checked.

## 1. What changed

The RBI raised the repo rate by 0.25 points to **5.50%** on **7 Oct 2026**
(MPC resolution, <https://www.rbi.org.in/Scripts/BS_PressReleaseDisplay.aspx?prid=63742>).
The next decision is due on **4 Dec 2026** (meeting 2-4 Dec; schedule:
<https://www.rbi.org.in/Scripts/BS_PressReleaseDisplay.aspx?prid=62422>, held in
`api/data/central_bank_calendar.json`).

Loan Check was built for a cutting cycle ("did your bank pass on the cuts?").
In a rising cycle most well-run repo-linked loans simply go up, so that
question mostly answers "nothing to claim". What a borrower now asks is:

1. How much does my EMI go up, or how many months get added instead?
2. Did my bank give me that choice, as it must?
3. Did it pass rises on faster than it passed on cuts?

Loan Check now leads with those three (`engine/rate_reset.py`,
`engine/loan_check.py`), and the old cut check still runs underneath.

## 2. Do Indian banks really fail to pass rates on? Yes, and the RBI says so

This is not a hypothetical the tool invents. Primary sources:

- **The RBI's own reason for the 2023 reset rules.** The circular of 18 Aug
  2023 (RBI/2023-24/55, "Reset of Floating Interest Rate on EMI based Personal
  Loans", <https://www.rbi.org.in/Scripts/NotificationUser.aspx?Id=12529>,
  re-read 14 Oct 2026) says: "in the wake of rising interest rates, several
  consumer grievances related to elongation of loan tenor and/or increase in
  EMI amount, without proper communication with and/or consent of the
  borrowers have been received." The last hiking cycle (2022-23) is exactly
  when this went wrong.
- **Penalties for not resetting rates on time.** Example verified 14 Oct 2026:
  DCB Bank, ₹63.6 lakh, order of 13 Mar 2024, because it "failed to reset the
  interest rates at the prescribed periodicity in certain MCLR linked floating
  rate advances" and "failed to benchmark … floating rate retail loans … to an
  external benchmark" (<https://www.rbi.org.in/Scripts/BS_PressReleaseDisplay.aspx?prid=57520>).
  The W4 research also found RBI penalty releases on Tamilnad Mercantile
  Bank, Punjab & Sind Bank (prid 53805), Indian Bank (prid 60305) and Nainital
  Bank (prid 59770) under the interest-rate directions; those four were not
  re-opened in this pass, so quote the DCB one when you need a single example.
- **Many loans are still on the slower benchmark.** At end-March 2026, 30.2%
  of banks' floating-rate rupee loans were still MCLR-linked (67.6% EBLR)
  (RBI, "Lending and Deposit Rates of Scheduled Commercial Banks – June
  2026", <https://www.rbi.org.in/Scripts/BS_PressReleaseDisplay.aspx?prid=63049>).
  MCLR loans reset once a year on their reset date and follow the repo
  slowly; that is where "cuts arrived late, rises arrived fast" shows up.

## 3. The categories of failure, and what Loan Check catches

| # | Failure | Rule | What Loan Check does |
|---|---|---|---|
| 1 | **EMI raised or tenure stretched without asking** | Reset circular para 2: the borrower "shall also be given the choice to opt for (i) enhancement in EMI or elongation of tenor or for a combination of both options; and, (ii) to prepay". Now para 349 of the Commercial Banks Responsible Business Conduct Directions 2025, para 31 of the NBFC/HFC ones (`engine/citations.py` RESET_CHOICES_BANK / RESET_CHOICES_NBFC) | Asks "did your bank let you choose?". If not: finding `choice_not_offered` and a ready letter (`api/complaints_in.py` reset_choice_letter, `POST /api/complaints/in/reset-choice`), addressed by lender type (bank → bank's grievance officer then RBI Ombudsman; HFC → NHB route) |
| 2 | **Not told** of the rise | Same para: any increase in EMI/tenor "shall be communicated to the borrower immediately" | Part of the same letter |
| 3 | **Tenure stretched until the EMI no longer covers interest** (negative amortisation) | "REs shall ensure that the elongation of tenor … does not result in negative amortisation" (para 349(5)) | `rate_move_impact` says when keeping today's EMI would no longer cover the interest; the tenure option is then shown as not possible |
| 4 | **Rate not reset on time** (repo-linked) | Repo-linked rate reset at least once in three months (Interest Rate on Advances Directions, para 38, `EBLR_RESET`) | `pass_through`: a cut that took more than three months to reach the loan is flagged; a rise passed on inside the window is allowed |
| 5 | **Rises passed on faster than cuts** | Same reset rule, plus the circular's para 3 asking banks to "monitor transmission" | Finding `asymmetric_pass_through` from the borrower's own rate history ("rises reached your loan in about N months, cuts took about M") |
| 6 | **Cut never passed on / spread raised quietly** | Spread can't be raised unless the borrower's credit risk changed (EBLR directions) | The original `missed_rate_cut` check: the only finding that is a refund-type claim |
| 7 | **Stuck on MCLR / base rate** | Borrower may switch to the external benchmark (para 41, `EBLR_SWITCH`) | `switch_saving`: what moving to the bank's repo-linked rate would save, against the switch fee |

What it does **not** claim: a fixed-rate switch at reset. Since 1 Oct 2025
the RBI changed "shall" to "may, at its option" for offering a fixed rate at
reset (amendment of 29 Sep 2025, footnotes on the circular page above). So
Loan Check mentions a fixed rate only "where the lender offers one" and never
treats its absence as a breach.

All ₹ figures are estimates for a conversation with the lender, never a
refund claim (except #6).

Worked example (golden test, `engine/tests/test_loan_check_hike_cycle.py`):
₹50 lakh at 7.90% with 240 months left; a 0.25-point rise to 8.15% makes the
EMI ₹41,511 → ₹42,290 (same end date), or keeps ₹41,511 for 12 more months,
which costs ₹3,00,896 more interest than paying the higher EMI.

## 4. The bridge (A16)

Every Loan Check result, including "your loan is fine", ends with
"Want us to watch this loan, and your other EMIs, every month?" →
`/onboarding?from=loan-check`, plus a WhatsApp share whose text has no
amounts, rates or lender name, only the link (`web/src/lib/loan-check-hike.ts`).

## 5. The public MPC page (A19): `/rbi-decision`

- Public, no sign-in, nothing saved. Header: the latest decision, its RBI
  source link, when it must reach a repo-linked loan (3 months), and the next
  meeting (`GET /api/rbi-decision/latest`).
- Form: balance, rate, months left (EMI optional) → `POST /api/rbi-decision`:
  new EMI vs added months for this decision, and three **scenarios** for the
  next meeting (no change, +0.25, +0.50). Labelled "Scenarios, not a forecast".
- Bridge to the plan, to the full Loan Check, and a WhatsApp share.

**Update cadence.** The rate history comes from `api/data/policy_rates_live.json`,
proposed by `.github/workflows/policy-rates.yml`:

- every Monday 08:30 IST, and
- at **12:00 IST on each scheduled MPC decision day** (the Governor's statement
  is at 10:00 IST). Those cron lines are generated from the MPC calendar by
  `scripts/policy_rate_schedule.py write`; a test fails if the workflow and
  calendar disagree. A cron line has no year, so a small `gate` job checks the
  date is really a decision day before the fetch runs.
- The data PR merges itself once its tests pass (`DATA_PR_MODE=merge`), and
  the deploy then picks it up, so the page shows a new decision within a few
  hours of it. Press "Run workflow" to do it at once.

Cost: about 58 runs a year, ~2 runner-minutes each.

**Known gap (for the integrator / next pass):** the header shows the last
*change* in the repo rate. After a meeting that holds rates (e.g. if 4 Dec is
a hold) it will still say "7 Oct: 5.25% → 5.50%" with "next decision 5 Feb".
True, but it should say "4 Dec: held at 5.50%". Fix: read the last held
meeting from `central_bank_calendar.json` in `_latest_decision`, and have the
policy-rates bot (or a person) mark the meeting held with its outcome.

## 6. Why the page shows no prediction-market odds

The audit asked whether to show Polymarket/Kalshi odds for the next RBI move.
Research (14 Oct 2026): both list RBI-decision markets (Kalshi series
KXCBDECISIONINDIA; Polymarket "reserve-bank-of-india-decision"), but:

- The **Promotion and Regulation of Online Gaming Act, 2025** came into force
  on **1 May 2026** (MeitY notification S.O. 1994(E), 22 Apr 2026; PIB,
  <https://www.pib.gov.in/PressReleasePage.aspx?PRID=2256973>). It prohibits
  online money games and also bars *advertising and promoting* them and
  "aiding" their offering (MeitY compliance advisory,
  <https://www.meity.gov.in/static/uploads/2026/08/4bf453ab38b49d820f8780ade58177dc.pdf>).
- **Polymarket is blocked in India** under section 69A of the IT Act; MeitY's
  advisory to VPN providers names it
  (<https://www.meity.gov.in/static/uploads/2026/04/c99a3ded4d682879951d238b7a671a39.pdf>,
  April 2026). Kalshi added India to its restricted list in June 2026 after
  being blocked (Economic Times, 23 Jun 2026,
  <https://m.economictimes.com/news/india/kalshi-bars-india-users-after-govt-bans-prediction-markets/amp_articleshow/131929930.cms>).
- The markets are also thin (a few thousand dollars), so the "odds" are noise.

Embedding their prices, or linking to them, on a page aimed at Indian
borrowers risks being read as promoting a banned platform. So the page shows
fixed scenarios and says plainly that RightDue does not predict RBI
decisions. Founder decision recorded: **no odds in India.** (For the US
pages the law is different, but there is no product need today.)
