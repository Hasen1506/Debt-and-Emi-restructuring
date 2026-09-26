# ROADMAP — RightDue (Debt & EMI Restructuring app)

> **Why this file exists.** Between June and September 2026 a large block of
> work was done in a GitHub Codespace: new features, hundreds of bug and
> logic fixes, cross-browser, accessibility, fuzz, security and load testing.
> None of it was ever committed or pushed. The codespace crashed, and the
> recovery attempts ("Export changes to a branch", branch `recovered-codespace`)
> came back identical to `main`. **That work is gone and has to be redone.**
>
> This roadmap rebuilds the full list from the surviving screenshots of those
> sessions, so nothing is forgotten. Everything marked **REBUILD** existed
> before and must be built again; **NEW** was planned but never started;
> **HAVE** is already in the repo today.

---

## 0 · Ground rules (so this never happens again)

1. **Commit and push after every finished step.** The lost sessions ran under
   "Do not commit unless asked. Do not push." That rule is what cost the
   work. It is reversed: small commits, pushed to a branch, the same day.
2. Work on a branch, open a PR, merge to `main` when green. Never leave a
   finished phase sitting unmerged.
3. CI (Phase 0) runs on every push, so a broken build is caught on GitHub,
   not in a codespace that might disappear.
4. Tick the boxes in this file in the same commit that does the work.

---

## 1 · Where the code stands today

- **Baseline:** `main` at the 24 May 2026 code commit (`eded8e8`) plus uploaded docs.
- **Tests:** `engine/tests` + `api/tests` = **300 passing** (checked 26 Sep 2026).
- **Stack:** Python engine (`engine/`), FastAPI (`api/`), Next.js 14 web (`web/`),
  Render blueprint (`render.yaml`), optional Postgres + email OTP auth.
- **Already present that the rebuild builds on:**
  - Restructuring scan: balance transfer, consolidation, refinance (`engine/restructuring_scan.py`)
  - Decision engines: windfall, new-debt, quick-recompute, cash-yield, right-time-to-borrow (`engine/decisions.py`)
  - Central-bank rates + MPC/FOMC calendar, **static JSON with manual admin update** (`api/routes/rates.py`, `api/data/central_bank_calendar.json`)
  - Rate cards "verified May 2026" (`engine/rate_cards.py`, `web/src/lib/rate-cards.json`)
  - Ledger skin screens, plus the list of sub-features the skin dropped (`LEDGER_MISSING.md`)
- **Not present at all:** Loan Check, lender letters, lender-outcome network,
  offer comparison, live rate feeds, Playwright / axe / fuzz / load test suites, CI.

---

## 2 · What makes the product hard to copy

Goals, trackers and payoff maths are not unique; anyone can build those.
These four things are the moat, and every phase below serves one of them:

1. **Shared lender outcomes.** After sending a letter, users record what the
   lender did (fixed in full, partly, refused, no reply, days taken, new rate)
   and can share it anonymously. Once a lender has **5 reports**, Loan Check
   shows e.g. *"HDFC Bank: 80% fixed in full · median 12 days · median rate
   cut 0.55%"*. This data only exists because borrowers sent letters through
   the app, so it can't be scraped or bought. Later: a monthly *"which banks
   pass on rate cuts"* index, which also brings in users.
2. **Knowing the right procedure.** Each finding cites the exact rule and
   invokes the formal process that forces an answer:
   - **India:** RBI directions, then a pre-filled RBI Ombudsman complaint.
   - **US mortgages:** a formal *notice of error* (servicer must acknowledge within 5 business days).
   - **US cards:** a *billing-error notice*.
   - **Either market:** if the lender refuses or goes quiet, the app hands over the regulator complaint, pre-filled.
3. **Neutrality.** The app earns nothing from lenders. Loan marketplaces can't
   say "don't refinance, ask for the reset you're owed", because refinancing
   is how they get paid.
4. **Data that stays current by itself.** Rates refresh from official
   sources every 6 hours (Phase 5), never hand-edited JSON.

### Will banks reply? (product principle)

Most will reply **if the letter goes through the right channel**. Whether they
fix it is a separate question, and that's where the app helps most.

- **India:** banks ignore casual emails and branch conversations. They answer
  complaints registered through their **grievance channel**, because those
  are counted and reported to the RBI. If a bank rejects one, even partly,
  RBI rules send it to the bank's own **Internal Ombudsman** before the final
  answer. Silence also helps the borrower: after **30 days** the case can go
  to the **RBI Ombudsman**, which is free.
- **US:** replying is a legal duty.
  - A mortgage servicer must **acknowledge a written notice of error within 5
    business days and respond within 30**.
  - A card issuer must **resolve a billing-error notice within two billing cycles**.
  - Phone calls start neither deadline, so the app always produces a written notice.
- **The usual reply is an offer, not a yes or no:** typically *"you can have
  the current rate if you pay a fee"*. Most borrowers can't judge whether that
  is worth it, so the offer comparison (Phase 3) is the core of the app.
- People don't need to understand the rules. **The app's job is to know the
  rules and tell them the next step at every turn.**

---

## Phase 0 · Safety net — NEW (do first, ~½ day)

- [x] GitHub Actions CI on every push/PR: `pytest engine/tests api/tests`,
      `npm run typecheck`, `npm run lint`, `npm run build` in `web/`
      (`.github/workflows/ci.yml`).
  - [x] `next lint` had never been configured (it stopped at an interactive
        prompt). Added `web/.eslintrc.json`; the stylistic
        `react/no-unescaped-entities` rule is off.
  - [x] Lint found a real crash: `BudgetMonthCard` returned before its hooks,
        so the hook order changed when the budget moved between zero and
        non-zero. Fixed.
- [ ] Later phases add their suites to CI: Playwright (3 browsers), axe, the fast fuzz slice.
- [x] `ROADMAP.md` "Running locally" section kept current (§ bottom).
- [ ] Delete the two recovery branches (`codespace-scaling-lamp-575pwg47jjrh79wv`,
      `recovered-codespace`); both are identical to `main`. **Owner to do**
      (GitHub → Branches → bin icon); Claude only pushes to its own branch.

---

## Phase 1 · Loan Check — the core finding — REBUILD

The home-loan finding: *your floating-rate lender did not pass on rate cuts
it owed you*, plus how much that costs you this year.

**Inputs**
- [x] "Month you took the loan" and "Loan start month": **Month dropdown +
      Year dropdown**, never `<input type="month">` (see Phase 6.1).
      `web/src/components/MonthYearPicker.tsx`; says "Still needed: the year"
      when only half is picked.
- [x] Starting rate (two fields: benchmark + spread, or the headline rate) and current rate.
- [x] If only one of the two starting-rate fields is filled, show **"Still needed: …"**
      (on screen and from the API).
- [x] A rate typed as a fraction (`0.0855` meaning 8.55%) is caught in **both**
      the starting-rate and current-rate fields, with a one-click "Use 8.55%"
      fix (`web/src/lib/rate-input.ts`). The spread field has its own check.
- [x] Screen at `/tools/loan-check`, first in the Tools list; reachable
      without onboarding (it needs only the loan's own facts). Pre-fills from
      a real profile's home loan, never from the demo profile.
- [x] Server **rejects** a date it can't parse with a clear error; it must not
      silently skip the check (`POST /api/loan-check`, 422 with `field` + `message`). (Lost bug: typing "03/2019" in Firefox made the
      rate-cut finding quietly disappear.)

**Findings**
- [x] **Missed rate cut**: repo/benchmark moved down since the loan's last
      reset, but the loan rate didn't follow. Reset frequency per RBI EBLR
      rules (at least quarterly). `engine/loan_check.py`; every estimate
      leans to the smaller claim (lowest repo around the start incl. 2 months
      of sanction lag, highest repo in the 3-month reset window, today's
      balance, whole months only).
- [x] **Pricing gap**: you pay more than new borrowers at the same lender.
      Shown as information; **not** claimed as a refund (Phase 2). Measured
      from the rate *after* the missed cut is fixed, so the two never double-count.
- [x] **Amount at stake "this year"**: floored at zero (next 12 months, EMI held). (Lost bug: this could go
      negative and print "Refund … estimated at −₹6,952".)
- [x] Each finding carries its rule citation and the next step.
- [x] **Old benchmark** (NEW): loans from before Oct 2019 or marked MCLR /
      base rate get a "switch to the repo-linked rate" finding instead of a
      bogus repo comparison.
- [x] Repo-rate history 2018→today in `engine/policy_rates.py` (RBI + Fed),
      re-checked 26 Sep 2026. Phase 5 replaces it with fetched data.
- [x] Server-side checks: rate sent as a percentage, rate outside 1–30%,
      start rate below the repo rate of the day, huge balances, future months.

---

## Phase 2 · Letters and escalation, per market — REBUILD

> **Rules changed while the work was lost** (checked 26 Sep 2026):
> - The rate rules now live in the **RBI (Commercial Banks – Interest Rates on
>   Advances) Directions, 2025** (28 Nov 2025), which carry forward the 2019
>   external-benchmark circular. Letters cite both.
> - The **Reserve Bank – Integrated Ombudsman Scheme, 2026** replaced RB-IOS 2021
>   on **1 Jul 2026**. The window to reach the RBI Ombudsman is now **90 days**
>   (from the end of the bank's 30-day reply period or its last reply, whichever
>   is later), not a year. Compensation: up to ₹30 lakh plus ₹3 lakh.
> - Since Jan 2026 banks must pass every wholly or partly rejected complaint to
>   their Internal Ombudsman automatically, with a final answer within 30 days.
> - A draft "Interest Rates on Loans and Advances Directions, 2026" would apply
>   from 1 Apr 2027 at the earliest. Revisit the citations when it is final.

- [x] **India — grievance-channel complaint** to the bank, pre-filled with
      loan facts, the finding and the RBI direction it relies on
      (`engine/complaints_in.py`, `POST /api/complaints/in`, Loan Check page).
  - [x] The refund request claims **only the missed rate cut**. (Lost bug: it
        summed every finding, including "you pay more than new borrowers",
        which a bank isn't obliged to refund and weakened the complaint.)
  - [x] Month-by-month annexure; each month rounded down, so it adds up to the claim.
  - [x] Name, account number and contact details are filled in the browser;
        the API never receives them.
  - [x] Step 2: bank rejects fully or partly → the bank must route it to its
        **Internal Ombudsman**; the app says so, tracks it, and writes a
        follow-up when the rejection skipped that review.
  - [x] Step 3: no reply in 30 days or an unsatisfactory reply → **pre-filled
        RBI Ombudsman complaint** (CMS portal fields, facts, relief, documents,
        declarations), free to file.
- [ ] **US mortgage — notice of error** (RESPA / Reg X): acknowledgement due in
      5 business days, response in 30 business days. Tracker counts both.
  - [x] Deadlines in `engine/complaint_deadlines.py` (business days, US legal
        public holidays, 15-day extension).
  - [ ] The letter itself and a screen (needs the US Loan Check, see New ideas).
- [ ] **US card — billing-error notice** (FCBA / Reg Z): must be sent within 60
      days of the statement; resolution within two billing cycles.
  - [x] Deadlines in the engine (60-day notice limit, 30-day acknowledgement,
        90-day outer limit for resolution).
  - [ ] The letter itself and a screen.
- [ ] **Regulator complaint hand-off** (RBI Ombudsman / CFPB) when the lender
      refuses or goes quiet. India done; CFPB pending with the US letters.
- [x] Letter facts are written in third person. **No stray "you" is ever left
      in a letter**; enforced by the fuzz suite (`test_letters_fuzz.py`).
- [ ] **Citation check**: every rule a letter cites is checked against the
      regulation text (test fixture holding quoted clauses + source URLs).
  - [x] Fixture `engine/tests/fixtures/citation_sources.json` and
        `test_citations.py`: sources, key facts the summary must carry, and no
        "verified" flag without the quoted text.
  - [ ] Paste the actual clauses. rbi.org.in can't be reached from the build
        environment, so this needs a session with access, or the owner.
- [x] Deadline tracker: sent date → reply due → Internal Ombudsman →
      RBI Ombudsman opens → last day. Remembered in the browser.

---

## Phase 3 · The lender's reply — offer comparison — REBUILD

The usual reply is an offer ("current rate if you pay a fee"). The app compares:

- [ ] **Keep**: stay as is.
- [ ] **Pay the fee to reset**: fee vs interest saved over the remaining term, break-even month.
- [ ] **Refinance elsewhere**: new-lender rate, processing fee, stamp duty and
      legal costs, prepayment penalty where applicable.
- [ ] Verdict plus plain-language reason and the next step.
- [ ] **Golden check** (was done before, redo): run 300 lender quotes. "Keep"
      must match to the rupee; "refinance" within ₹51 of the formula, the
      difference being standard bank rounding. Document the rounding rule used.
- [ ] Review the smaller decision engines for the same class of bugs:
      `allocate_windfall` (`WindfallAllocation`) and `evaluate_new_debt` in
      `engine/decisions.py`. The lost session had reached exactly this step.

---

## Phase 4 · Shared lender outcomes (Loan Check scorecard) — REBUILD

- [ ] Outcome record after a letter: fixed in full / partly / refused / no
      reply, days taken, new rate. Optional anonymous share.
- [ ] Scorecard per lender, shown only at **≥ 5 reports**: % fixed in full,
      median days, median rate cut.
- [ ] Label the scorecard **"unverified"** until reports are verified (sign-in,
      or uploading the bank's reply). **Owner decision pending:** show it
      labelled, or hide it until verification exists.
- [ ] Monthly "which banks pass on rate cuts" index (after enough data).

**Abuse controls** (each was a real finding last time):
- [ ] Rate limit **10 reports/day per client address and 2 per lender**.
- [ ] Client IP taken from the proxy chain via **`api/client_ip.py`** with
      **`TRUSTED_PROXY_HOPS`** in `render.yaml`. (Lost bug: the limit could be
      bypassed with one made-up header; 36 fake reports gave a fake bank a
      100% success record in seconds.) Raise the hop count if Render ever puts
      more than one proxy in front of the API.
- [ ] Request-size cap.
- [ ] Basic security headers (3), e.g. `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`.
- [ ] Known limit: someone using many addresses can still fake a record.
      The real fix is verified reports (above).

**Performance**
- [ ] Cache the scorecard for 60 s and invalidate when a new report arrives.
      (Lost measurement: 1.3 s per page view at 100,000 reports → ~3 ms cached.)

---

## Phase 5 · Rates that update themselves — REBUILD

- [ ] Replace the hand-edited `outcome_rate` values in
      `api/data/central_bank_calendar.json` with fetched data, refreshed **every 6 hours**.
- [ ] **US:** Fed funds target range from **FRED** (public API).
- [ ] **India:** repo rate from **RBI's daily release**. The repo rate isn't
      published on its own there; it sits exactly midway between the SDF and
      MSF rates, so derive it as their midpoint and cross-check.
- [x] Before shipping, re-verify the current values from the official sources.
      Confirmed 26 Sep 2026: RBI **5.25%** (cut 5 Dec 2025, held Feb/Apr/Jun/Aug
      2026; SDF 5.00%, MSF 5.50%; next decision 7 Oct) and the Fed raised to
      **3.75–4.00% on 16 Sep 2026**. `central_bank_calendar.json` corrected
      (it said RBI 6.25% / Fed 4.50%).
- [ ] `GET /api/rates/feed-health`: last successful fetch per source, age, status.
- [ ] Uptime alerting on `feed-health` (e.g. a free external monitor).
- [ ] Fallback: if a feed fails, keep the last good value, flag it "as of <date>", and never crash.
- [ ] Refresh the rate cards (last verified May 2026) and show the as-of date everywhere a rate is quoted.

---

## Phase 6 · Hardening and tests — REBUILD

All of these were run and passing before the crash; redo each one and keep it in CI.

### 6.1 Cross-browser (Chromium, Firefox, WebKit/Safari)
- [ ] `npx playwright install firefox webkit` (~150 MB; only Chromium is preinstalled).
- [ ] **Every** month field becomes Month + Year dropdowns. Firefox desktop and
      Safari render `type="month"` as a plain text box, so people typed dates the app couldn't read.
      Loan Check done. No `type="month"` is left in `main`; still to review:
      the `type="date"` inputs in goals, onboarding/assets, lifecycle events,
      decision log and activity ledger (full dates, where a month would do?).
- [ ] Full step-by-step E2E flow (onboarding → Loan Check → letter → outcome)
      passes in all three browsers.

### 6.2 Accessibility (axe)
- [ ] **Zero axe violations on all 24 screens at desktop and phone width.**
- [ ] Accent orange darkened slightly for text contrast (`#c96442` is too faint as text).
- [ ] Every slider has a label; the keyboard focus ring is never hidden.
- [x] **Found and fixed:** in the shared `Field`, `Select` and `BankCombobox`
      the ⓘ help button sat *inside* the `<label>`. A label names the first
      control it contains, so every field with a help tip had its label on
      the ⓘ button and an **unnamed input** for screen readers. Likely the
      "screen-reader bug found by accident" below. Labels now use `htmlFor`,
      hints are linked with `aria-describedby`, the bank search box is named.
- [ ] Every page has headings and landmarks, plus a "Skip to content" link.
- [ ] Wide tables on phones are keyboard-scrollable (focusable region with a label).
      Loan Check's repo-rate table done.
- [ ] Check results are announced to screen readers (`aria-live`). Loan Check done.
- [ ] Re-find and fix the screen-reader bug found by accident last time (not
      recorded in the screenshots; the axe pass plus a manual VoiceOver/NVDA run should surface it).

### 6.3 Property / fuzz tests on the engine
- [ ] 20,000 random loans through the API: no crashes, no negative "amount at
      stake", no "you" left in any letter.
- [ ] 300 of those cases in the normal suite (~2 s).
  - [x] Letters: 300 random loans at random complaint stages (`test_letters_fuzz.py`),
        plus 500 random timelines. Loan Check: 300-loan property test.
- [ ] Input validation with clear errors, not silent acceptance: negative
      balances, absurd rates (e.g. 950%), 500 loans in one request, and huge
      numbers (one crashed the server last time).

### 6.4 Security review of public endpoints
- [ ] Outcome-report endpoints: rate limits, spoof-proof client IP, size caps (Phase 4).
- [ ] Rate limits on every unauthenticated POST.
- [ ] **Before launch only:** Content-Security-Policy and `frame-ancestors` /
      `X-Frame-Options`. They were left off because they stop the app opening
      in VS Code's built-in preview.

### 6.5 Load test
- [ ] 50 concurrent users with no errors (redo with k6 or Locust; commit the script).
- [ ] Note: Render's free plan sleeps when idle, so the first visit after a quiet spell is slow.
      Move to `starter` before real traffic.

### 6.6 Golden tests against real banks — needs the owner
- [ ] Engine EMI / interest / rate-cut figures match **real SBI and HDFC
      statements** and the banks' own EMI calculators **to the rupee**. A wrong
      figure in a letter to a bank does the most damage. Needs real
      statements (redacted) from the owner or volunteers.

### 6.7 Usability
- [ ] Sessions with about 5 real borrowers. Only real users can answer "will people use it?"

---

## Phase 7 · Launch readiness — NEW

The honest status before the crash: *a working, tested demo, not ready to launch.* Remaining:

- [ ] Validation with real users; whether lenders actually reply is still untested.
- [ ] **Legal review of the letters** (India + US).
- [ ] Public hosting **with a database**: auth and cross-device sync. Browser-only
      storage means clearing site data loses the tracker.
- [ ] Privacy policy and terms.
- [ ] Rate cards refreshed (Phase 5).
- [ ] Abuse controls on the outcome network (Phase 4).
- [ ] Uptime alerting on `/api/rates/feed-health` (Phase 5).
- [ ] Trademark search and domain for **RightDue**.
- [ ] CSP + anti-framing headers switched on (Phase 6.4).
- [ ] Deferred Ledger-skin items: walk `LEDGER_MISSING.md` and decide per item (re-introduce / v2 / drop).

---

## New ideas (added while rebuilding)

Ideas that came up during the rebuild. Not in the lost work; each needs a
yes/no from the owner before it is scheduled.

- [ ] **Negative-amortisation check** (Loan Check). RBI's Aug 2023 circular on
      resetting floating-rate EMI loans says a rate rise must not leave the EMI
      below the interest due, and at each reset the bank must offer a switch to
      a fixed rate and a choice of higher EMI or longer tenure. Flag a loan whose
      EMI no longer covers its interest, or whose tenure was stretched without
      asking. Verify the circular's text first.
- [ ] **Reset watch after every RBI decision.** When the repo rate changes, each
      user with a repo-linked loan gets a dated reminder: "your rate should drop
      to X% by <date + 3 months>". If the statement still shows the old rate
      after that date, Loan Check opens with the finding ready. Builds on Phase 5.
- [ ] **Statement upload** (SBI / HDFC PDFs first). Read the actual rate history
      from the statement instead of asking for the start rate and last-change
      month, which makes the overcharge exact instead of cautious. Pairs with the
      golden tests in 6.6.
- [ ] **EMI or tenure on a rate cut.** When a cut is passed on, banks usually
      keep the EMI and shorten the tenure. Show the interest difference between
      the two and let the user ask for the one they want.
- [ ] **Spread-change claim.** If the user gives their spread history, flag a
      spread raised without a change in their credit assessment (allowed only in
      narrow cases) as its own claim.
- [ ] **Other repo-linked loans.** The 2019 rules cover all new floating-rate
      personal and retail loans, not just home loans: extend Loan Check to
      floating-rate auto, education and personal loans.
- [ ] **US Loan Check: adjustable-rate mortgages.** Index (SOFR) + margin vs the
      rate charged, within the note's caps; errors feed the Phase 2 notice of error.
- [ ] **Shareable result card.** A result image or link without personal details
      ("My bank owed me 0.75%"). Brings in users and outcome reports (Phase 4).
- [ ] **Reminder before the 90-day window closes.** Since the 2026 scheme cut the
      RBI Ombudsman window from a year to 90 days, missing it is now the biggest
      risk. Email or push reminders at 30, 7 and 1 days left (needs sign-in and
      the user's consent; the email goes only to the user).
- [ ] **Switch letter for MCLR / base-rate loans.** Loan Check already finds these
      (old benchmark). Add a letter asking to move to the repo-linked rate, with
      the conversion fee weighed against the saving (uses Phase 3's comparison).
- [ ] **PDF letter.** Download the letter as a PDF with a signature line, as well
      as .txt, for borrowers who post it.
- [ ] **Consumer commission route.** When the Ombudsman window has closed or the
      award is unsatisfactory, explain filing with the consumer commission
      (e-Daakhil). Verify the current process and time limits first.
- [ ] **Watch the draft 2026 interest-rate directions.** When final, update
      `engine/citations.py`, the letters and the citation fixture.
- [ ] **Quiet the profile-sync 404s.** In no-database trial mode the web app still
      calls `GET /api/user/state` on every page, which 404s. Skip the call when sync is off.

---

## Unknowns — fill these in

The screenshots don't capture everything. Add anything you remember here:

- [ ] The **"hundreds of bugs and logic issues"** fixed in the lost sessions.
      Only the ones above were recorded. Plan: a fresh full audit of the
      engine and web app after Phase 1 (the fuzz and E2E suites will catch most regressions).
- [ ] The **new strategies** that were designed. Not in the screenshots; list them here.
- [ ] Anything else that was in the old `ROADMAP.md` "deferred" list.

---

## Suggested order

| # | Phase | Why this order |
|---|---|---|
| 1 | 0 · CI | Stops the next loss and catches regressions from day one |
| 2 | 6.1 month fields + 1 · Loan Check | The core finding; the month-field bug hid it for Firefox/Safari users |
| 3 | 2 · Letters | A finding is useless without the letter that forces a reply (India done; US letters wait for the US Loan Check) |
| 4 | 6.3 fuzz | Letters and amounts must never be wrong or negative |
| 5 | 3 · Offer comparison | What users need once the bank replies |
| 6 | 5 · Live rates | Findings depend on current repo/Fed rates |
| 7 | 4 · Outcomes network + 6.4 security | Needs letters in the wild; must be abuse-proof from day one |
| 8 | 6.2 a11y, 6.5 load | Before any public traffic |
| 9 | 6.6 golden, 6.7 usability, 7 · launch | Need real statements and real people |

---

## Running locally

```bash
# API (http://localhost:8000)
pip install -r requirements-dev.txt   # app deps + pytest
uvicorn api.main:app --reload

# Web (http://localhost:3000), in a second terminal
cd web && npm install && npm run dev

# Tests
python -m pytest engine/tests api/tests -q
cd web && npm run typecheck && npm run lint && npm run build
```

CI runs exactly these on every push (`.github/workflows/ci.yml`).

Leave `DATABASE_URL` unset and set `NEXT_PUBLIC_DISABLE_AUTH=true` for
trial mode (no login, no sync). `CORS_ORIGINS` defaults to `http://localhost:3000`.

**In a Codespace:** VS Code only auto-forwards ports started from its own
terminals. If the app doesn't open, go to the **Ports** tab → **Forward a
Port** → `3000`, then open the Forwarded Address. Keep visibility **Private**.
Ignore unrelated ports (e.g. 38085). After the codespace restarts, rerun the
two server commands above.
