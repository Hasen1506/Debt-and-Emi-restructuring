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

> **Redesign (1–2 Oct 2026, done):** the move to the Ledger V2 design and the
> strategy personas is recorded in [REDESIGN.md](REDESIGN.md), with the
> before/after walkthroughs. The design files are in `design/`.

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
- **Rebuilt so far (26 Sep 2026, branch `claude/vibrant-bardeen-5bsiyj`):**
  CI (Phase 0), Loan Check (1), India letters and escalation (2), offer
  comparison (3), shared lender outcomes (4, storage needs Postgres before
  launch), live rates (5, first live fetch still to check), the axe pass
  and hydration fixes (6.2), the API fuzz and input bounds (6.3), size cap,
  headers and rate limits (6.4), field errors on every tool.
  **685 tests passing.** Still missing: US letters, cross-browser and load
  suites (6.1, 6.5), verified outcome reports, a manual screen-reader run.
- **Bug hunt and user-view audit (26 Sep 2026): see [`AUDIT.md`](AUDIT.md).**
  Fixed: the /plan chart and every date a month late, 10 engine bugs
  (payoff order vs investing, runaway floating rates, card minimums, tax
  shields, currency totals), 8 tool and slider bugs, three disagreeing tax
  tables, and 18 user-facing problems (one "saves in year 1" measure with
  pay-back, a home page that told over-budget users to pay a loan off,
  placeholders and dead buttons, decimal rate inputs, sideways scrolling on
  phones). Eight product decisions are listed there for the owner.
- **Owner decisions applied (26 Sep 2026, AUDIT.md §3):** Ledger is the only
  skin; Recompute folded into /plan; Windfall + Cash Yield are one Spare
  cash tool; the plan start picker is gone; home shows the plan's own
  debt-free date and this month's move. A walk-through as a new user found
  and fixed a crash on setup step 2 for every new user, the emergency fund
  being topped up twice, and 9 more (W1–W11).
- **Outside review fixed (26 Sep 2026, AUDIT.md §5, O1–O12):** advice
  from missing or assumed data. Setup asks each loan for its rate and EMI
  and lets someone with no debt finish; a cash shortfall shows the gap
  (costs + minimums − income) instead of a payoff date; the Sec 24 note
  follows the regime; "confirm all" no longer logs ₹0 card payments;
  Right time, New Debt Check, Liquidate and the NRI tool start from the
  user's data or blanks, not samples; Purchase Advisor's levers and Spare
  cash's card interest are corrected.
- **Round-2 audit (27 Sep 2026, AUDIT.md §6, R1–R8): all eight fixed.**
  - NRI amounts shown in each loan's own currency, with refinance offers from
    that currency's market;
  - an exchange rate required in setup, and no projection without one;
  - New Debt Check won't say "take" for an EMI the budget can't carry;
  - the profile cookie is compressed, split when large and checked after
    saving, so nine or more loans save;
  - the US mortgage shield counts only interest above the standard deduction;
  - Invest vs Prepay taxes a Treasury at ~80% of the user's rate (not a flat
    80%), shares dated default yields with /plan, and asks for today's yield
    when the answer is within a point;
  - rates outside 0–100% a year are stopped at the field in setup, the
    restructure modal and life events;
  - Loan Check is hidden on a US home and marked India only on /tools.
- **Rounds 4 and 5 (27 Sep 2026, AUDIT.md §7, A1–A12): all twelve fixed.**
  - a foreign loan added from NRI Prepay keeps its currency and rate;
  - US Liquidate uses US capital-gains rules and asks about a main home (§121);
  - Right-Time says "can't afford" when the EMI doesn't fit the budget;
  - Spare cash skips a loan in its lock-in and nets the prepayment fee;
  - Liquidate's hold path pays the loan on schedule, and a positive edge below
    the margin isn't called "worse off";
  - loans have stable ids, so removing one in Setup can't move another's
    Activity history, and the plan counts every logged payment (no 20 cap);
  - Portfolio converts a foreign-priced holding, refuses a quantity of 0 or
    less, and its headline updates on each change;
  - Goals tells a debt-free user the monthly amount instead of pointing at an
    empty /plan.
- **Redesign done (1–2 Oct 2026, [REDESIGN.md](REDESIGN.md), R0–R7).** Five
  tabs (Home, Plan, Activity, Goals & Tools, Profile) in the Ledger V2 style.
  - Setup is 3 screens instead of 6, and amounts take `1.2L` or `50k`.
  - Home lists every payment this month and marks two paid in 2 taps.
  - Plan's chart runs to the plan's own date.
  - Activity logs a part payment or a rate change from one page and previews
    the effect.
  - Goals ask for one amount, and the seven tools share one layout.
  - The payoff order is a persona medallion in the masthead (one tap from any
    page). Profile compares the three orders on your own numbers.
  - NRI prepay starts from today's exchange rate. Right time reads Polymarket's
    odds for the coming RBI/Fed decisions instead of asking what you expect.
  - Every page was checked at 390 px: no sideways scroll, and tap targets of
    24 px or more. The before/after table is in REDESIGN.md, and what R7
    found is in AUDIT.md §8.
  - **Tests:** 745 engine + API, 38 web.
- **Speed (production build, this machine):** every page answers in under
  30 ms, paints in under 100 ms and loads in under 200 ms; 111–184 KB of
  JavaScript per page. The engine's plan run takes 6–35 ms. The one slow
  thing is hosting: Render's free plan sleeps after 15 min, so the first
  visit after that waits 30–60 s.

---

## 2 · What makes the product hard to copy

Goals, trackers and payoff maths are not unique; anyone can build those.
These four things are what we are building toward, and every phase below
serves one of them. Honestly, none is a moat yet (grill #15): the outcome
scorecard needs 5 reports per lender and there are no users, and anyone can
re-read the same public rates. What we can claim today is that the data is
**correct and dated**.

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
4. **Data that is correct and dated.** Every figure carries its source and
   the day it was last checked; scheduled jobs re-read the official sources
   at the pace each one actually changes (policy rates weekly, as they move
   only at RBI/FOMC meetings; Phase 5), never hand-edited JSON. Until there
   are users, seed the outcomes data by personally helping the first ~30
   Loan Check users send their letters.

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
- [ ] Later phases add their suites to CI: Playwright (3 browsers), axe.
  - [x] The fast fuzz slice runs in the normal pytest; the full 20,000-loan
        run is weekly and on demand (`.github/workflows/fuzz.yml`).
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

The usual reply is an offer ("current rate if you pay a fee"). The app compares
(`engine/offer_compare.py`, `POST /api/offers/compare`, "Got an offer? Compare it"
under every Loan Check result):

- [x] **Keep**: stay as is.
- [x] **Pay the fee to reset**: fee (amount or % of the loan, plus GST if quoted
      so) vs interest saved, break-even month.
- [x] **Refinance elsewhere**: new-lender rate, processing fee, stamp duty and
      legal/valuation costs, any charge to close the old loan. A charge on a
      floating-rate loan to an individual is flagged as not allowed (new
      citation: Pre-payment Charges Directions 2025; 2012/2014 circulars).
- [x] Verdict plus plain-language reason and the next step. Refinancing must
      beat the next best choice by ₹10,000 (paperwork, fresh credit check).
- [x] **NEW: owed-cut baseline.** When Loan Check finds a cut the bank owes,
      savings are measured against the loan at that rate, so a fee that only
      buys the owed cut is never shown as a saving ("Don't pay: press for the
      rate cut you are owed").
- [x] **NEW:** "years you expect to keep the loan" (break-even must fall inside
      it) and lower-EMI vs same-EMI (finish sooner) comparison.
- [x] **Golden check** (redone, `test_offer_golden.py`): 300 random quotes,
      854 options, every verdict reached. Rounding rule documented in the
      engine (EMI rounded up to the rupee, interest to the paisa, last EMI
      clears the loan, GST rounded to the rupee). Each option is within ₹2 of
      the closed form for the same EMI (largest seen ≈ ₹1), and within the
      derived bound δ·(s_n − n) of the textbook formula. The old "within ₹51"
      figure could not be reconstructed, so the bounds are now derived and
      stated. A mutation check (GST rate, break-even off by one, interest
      rounding, horizon ignored) fails the test each time.
- [x] Review the smaller decision engines for the same class of bugs. Found
      and fixed:
      - windfall: interest avoided worked out on the whole windfall, not the
        amount applied (and the leftover never mentioned); simple
        rate × amount × years instead of amortised; a **negative** figure when
        investing won, which the screen turned into a nonsense "expected
        return"; zero/negative amounts answered as "No outstanding debt".
      - new debt: processing fee left out of the APR (a fee-bearing "no-cost"
        EMI showed 0%); "real cost" left out interest (a ₹5L loan at 14% showed
        only the fee); APR silently capped at 200%; ₹ and Western digit
        grouping hardcoded for US users; bad input silently answered "take".

## Phase 4 · Shared lender outcomes (Loan Check scorecard) — REBUILD

- [x] Outcome record after a letter: fixed in full / partly / refused / no
      reply, days taken, new rate. Optional anonymous share.
      (`engine/outcomes.py`, `POST /api/outcomes`; the complaint tracker asks
      for the new rate, and a "Help the next borrower" card lists exactly what
      would be sent before anything is.) Only bank, outcome, days and the rate
      before and after are shared: no name, account, amount or date. "No
      reply" is offered only after the 30-day reply window.
- [x] Scorecard per lender, shown only at **≥ 5 reports**: % fixed in full,
      median days, median rate cut (`GET /api/outcomes/scorecard[/lender]`).
      Loan Check shows it under a claimable result, e.g. *"80% fixed in full ·
      median 12 days · median rate cut 0.55%"*; below 5, how many have shared.
- [x] Reports are matched to one bank on the rate-card list
      (`engine/lenders.py`: "HDFC", "HDFC Bank Ltd." → HDFC Bank). A bank not
      on the list is refused, so an invented bank can never get a record.
- [x] Label the scorecard **"unverified"** until reports are verified. **Owner
      decision still pending:** show it labelled (the default,
      `SCORECARD_MODE=labelled`) or hide it (`SCORECARD_MODE=hidden` in
      `render.yaml`) until verification exists.
- [ ] Verified reports: signed-in reporters, or an uploaded bank reply.
- [ ] Monthly "which banks pass on rate cuts" index (after enough data).

**Abuse controls** (each was a real finding last time):
- [x] Rate limit **10 reports/day per client address and 2 per lender**
      (`api/outcomes_store.py`), on top of the per-minute write limit.
- [x] Client IP taken from the proxy chain via **`api/client_ip.py`** with
      **`TRUSTED_PROXY_HOPS`** in `render.yaml`, shared with the rate-limit
      middleware. (Lost bug: the limit could be bypassed with one made-up
      header; 36 fake reports gave a fake bank a 100% success record in
      seconds. Test `test_the_lost_fake_bank_attack_fails` replays it.) Raise
      the hop count if Render ever puts more than one proxy in front of the API.
- [x] The address is kept only as a keyed hash (`OUTCOMES_IP_KEY`, generated
      in `render.yaml`), wiped after two days once no limit needs it.
- [x] Request-size cap (6.4).
- [x] Basic security headers (6.4): nosniff, no-referrer, no-store on writes.
      `Permissions-Policy` not added: the API serves no pages.
- [ ] Known limit: someone using many addresses can still fake a record.
      The real fix is verified reports (above).

**Storage**
- [x] Postgres when `DATABASE_URL` is set, else a SQLite file
      (`api/data/outcomes.sqlite3`). `/api/health` says which.
- [ ] **On Render's free plan the SQLite file is wiped on every deploy.**
      Shared reports need the Postgres add-on before launch (Phase 7).

**Performance**
- [x] Cache the scorecard for 60 s and invalidate when a new report arrives.
      Measured at 100,000 reports: 0.5 s uncached, under a microsecond cached.

---

## Phase 5 · Rates that update themselves — REBUILD

- [x] Current rates no longer come from hand-edited JSON: the verified table
      in `engine/policy_rates.py` plus decisions the feeds find after it
      (`api/rates_feed.py`). Since grill #61 they are fetched by a **weekly
      GitHub Action** (`policy-rates.yml`, `scripts/fetch_policy_rates.py`) into
      the committed `api/data/policy_rates_live.json`; the old 6-hourly thread
      in a container that sleeps after 15 minutes is gone.
      The `current_rates` block is gone from `central_bank_calendar.json`; its
      meeting list is still kept by hand (used to date new decisions and for
      the "decision in N days" hint).
- [x] **US:** Fed funds target range from **FRED** (DFEDTARU/DFEDTARL, the
      keyless CSV). FRED dates a change the day it takes effect; it is moved
      back to the FOMC meeting before it.
- [x] **India:** repo rate from the **RBI website's policy-rate panel**, as the
      midpoint of SDF and MSF, and it must equal the repo rate printed beside
      them. A new rate is dated to the MPC meeting of the last 14 days.
- [x] A fetch is used only if it agrees with the verified table where they
      overlap, and each new decision is in order, 0–20%, a real change, and
      at most 1 point (`policy_rates.apply_live`). Otherwise it counts as a
      failed fetch.
- [x] Before shipping, re-verify the current values from the official sources.
      Confirmed 26 Sep 2026: RBI **5.25%** (cut 5 Dec 2025, held Feb/Apr/Jun/Aug
      2026; SDF 5.00%, MSF 5.50%; next decision 7 Oct) and the Fed raised to
      **3.75–4.00% on 16 Sep 2026**. `central_bank_calendar.json` corrected
      (it said RBI 6.25% / Fed 4.50%).
- [ ] **Check the first live fetch — at deploy.** This sandbox can't reach
      FRED or rbi.org.in (proxy 403), so the parsers were tested on FRED-format
      CSV built from the table and a **hand-made copy** of the RBI panel
      (`api/tests/fixtures/rbi_policy_rates.html`). After deploying, open
      `/api/rates/feed-health`: both sources should say `ok`. Then save the real
      RBI page over the fixture. If RBI blocks the fetch or changes the page,
      feed health says so and the app keeps the verified table.
- [x] `GET /api/rates/feed-health`: last good check per source, age, value;
      **503** when a scheduled meeting passed 7+ days ago with no check after
      it, or the last good check is over 45 days old (weekly cadence, #61).
- [ ] Uptime alerting on `feed-health` (e.g. a free external monitor that
      alerts on any non-200). **Owner to set up** after deploy.
- [x] Fallback: a failed fetch keeps the last good value (committed in
      `api/data/policy_rates_live.json`, so it survives deploys), the weekly
      run goes red, and nothing crashes.
- [x] Show the as-of date everywhere a policy rate is quoted: Loan Check says
      "RBI repo rate as of … Source: …", the central-bank hint card shows it.
  - [x] **Found and fixed:** the rate-card "as of" badge printed
        **"Invalid Date"** for labels like "2026-05 industry norms — confirm SoC".
- [ ] Refresh the rate cards (last verified May 2026). Needs research against
      each bank's published rates; not done in this batch.

---

## Phase 6 · Hardening and tests — REBUILD

All of these were run and passing before the crash; redo each one and keep it in CI.

### 6.1 Cross-browser (Chromium, Firefox, WebKit/Safari)
- [ ] `npx playwright install firefox webkit` (~150 MB; only Chromium is preinstalled).
      **Parked 26 Sep, blocked here:** the cloud sandbox's network policy refuses
      `cdn.playwright.dev` and `playwright.download.prss.microsoft.com`, so Firefox
      and WebKit can only run in GitHub Actions (or after the owner allows those
      hosts under the environment's Network access). Plan when resumed:
      `@playwright/test@1.56.1` + `@axe-core/playwright@4.13.0` as web dev
      dependencies (1.56.1 matches the preinstalled Chromium build 1194);
      `web/playwright.config.ts` with projects chromium / firefox / webkit and
      two `webServer`s (API with `RATES_FEED=off` and a temp
      `OUTCOMES_DATABASE_URL`; web built with `NEXT_PUBLIC_DISABLE_AUTH=true`);
      a new CI job running `npx playwright install --with-deps` then the suite.
- [ ] **Every** month field becomes Month + Year dropdowns. Firefox desktop and
      Safari render `type="month"` as a plain text box, so people typed dates the app couldn't read.
      Loan Check done. No `type="month"` is left in `main`; still to review:
      the `type="date"` inputs in goals, onboarding/assets, lifecycle events,
      decision log and activity ledger (full dates, where a month would do?).
- [ ] Full step-by-step E2E flow (onboarding → Loan Check → letter → outcome)
      passes in all three browsers.

### 6.2 Accessibility (axe)
- [x] **Zero axe violations** (WCAG 2.1 A/AA + best practice) on all 21 pages,
      at desktop (1200 px) and phone (390 px) width, in all three themes
      (ledger, standard, editorial), with a saved profile. Was: colour
      contrast on every page, two `<main>`s on 7 pages, no `<h1>` on 6,
      unlabelled sliders and selects on /plan, content outside landmarks.
- [x] Accent orange darkened for text contrast: `#c96442` (3.7:1) →
      `#ab4f30` (4.5:1+ on every background, 5.4:1 under white text). Also
      darkened: ledger green (`#137a3a`), standard-theme amber, editorial
      muted and marginalia greys.
- [x] Every slider has a label (and a spoken value); the keyboard focus ring
      is never hidden: one `:focus-visible` ring everywhere, and the three
      `outline: none` inputs fixed.
- [x] **Found and fixed:** in the shared `Field`, `Select` and `BankCombobox`
      the ⓘ help button sat *inside* the `<label>`. A label names the first
      control it contains, so every field with a help tip had its label on
      the ⓘ button and an **unnamed input** for screen readers. Likely the
      "screen-reader bug found by accident" below. Labels now use `htmlFor`,
      hints are linked with `aria-describedby`, the bank search box is named.
      Windfall's own field had the same kind of bug (its hint was part of the
      input's name); fixed.
- [x] Every page has one `<main>` (the layout's), a `<header>` with a named
      `<nav>`, a `<footer>`, an `<h1>` (hidden on the ledger skin, which shows
      no page title) and real `<h2>` section titles, plus a "Skip to content"
      link.
- [x] Wide tables on phones are keyboard-scrollable (focusable region with a
      label): Loan Check's repo-rate table, the debts table, the plan schedule.
- [x] Server errors are shown under the field they concern, announced, with
      the input marked invalid (every tool).
- [ ] Check results are announced to screen readers (`aria-live`). Loan Check
      done; the other tools still to do.
- [ ] **Parked 26 Sep:** turn the scratch axe + hydration scripts into
      `web/e2e/pages.spec.ts` (one test per page × theme × width, soft-asserting
      no axe violations, no hydration errors, no uncaught errors, and no
      sideways scroll at 390 px) and run it in CI (see 6.1 for the setup).
- [x] **Fixed:** the Windfall screen threw 8 React hydration errors with a
      saved profile (Recompute had them too). Cause: tools read the profile
      cookie while rendering, so the server drew the demo profile and the
      browser the saved one. The layout now hands its server-side profile to
      `useStoredProfile()` (`lib/use-profile.tsx`); 0 hydration errors on all
      19 pages checked. Also stopped a 404 on every page (the session
      hydrator asked for `/api/user/state` with sign-in switched off).
- [ ] Re-find and fix the screen-reader bug found by accident last time (not
      recorded in the screenshots). The axe pass is clean; a manual
      VoiceOver/NVDA run is what's left.
- [ ] Commit the axe and hydration checks (now scratch Playwright scripts) as
      a CI job with the API and web running, so a regression fails the build.

### 6.3 Property / fuzz tests on the engine
- [x] **20,000 random loans through the API** (`api/tests/test_api_fuzz.py`):
      Loan Check, the complaint letters at random stages, and the offer
      comparison. No server error, every refusal a 422 naming the field, no
      negative amount, no stray "you" in any letter, no leftovers like
      "None". Passes (about 2.5 min: `FUZZ_N=20000 FUZZ_FULL=1`); weekly in CI.
- [x] 300 of those cases in the normal suite (~2 s).
  - [x] Letters: 300 random loans at random complaint stages (`test_letters_fuzz.py`),
        plus 500 random timelines. Loan Check: 300-loan property test.
- [x] Input validation with clear errors, not silent acceptance: negative
      balances, absurd rates (950% → "send 0.095 for 9.5%"), 500 loans in one
      request, and huge numbers. Hostile values in every field of every POST
      endpoint (sampled in CI, all of them in the long run).
  - [x] **Found and fixed:** numbers like `1E+999999` or `1e30` crashed **ten
        endpoints** with a 500 (likely the "huge number crashed the server"
        from last time); `/baseline` crashed on a negative inflation rate and
        `/asset-liquidation` on a 0-year hold; the offer comparison crashed
        formatting a ₹1e30 fee (now "more than the loan itself").
  - [x] Request bodies are bounded (`api/schemas.py` `_In`): numbers finite
        and ≤ 1e12, whole numbers ≤ 100,000, text ≤ 200 characters, lists ≤ 100,
        at most 50 loans, amounts not negative, rates as fractions up to 100%
        (effective APRs up to 1000%), months up to 1,200.
  - [x] **Every 422 has one shape**, `{"detail": {"field", "message"}}`,
        including schema errors and invalid JSON, and the input is not
        echoed back.

### 6.4 Security review of public endpoints
- [ ] Outcome-report endpoints: rate limits, spoof-proof client IP, size caps
      (Phase 4). The middleware below is ready for them.
- [x] Rate limits on every unauthenticated POST (`api/security.py`): per
      client IP, 120 writes a minute (burst 60); sign-in code 2 a minute
      (it sends email), code check 6, admin 2. 429 with Retry-After.
  - [x] Spoof-proof client IP: `X-Forwarded-For` read only
        `TRUSTED_PROXY_HOPS` back from the right.
  - [x] The Next.js server renders /plan by calling the API for every user;
        it sends `INTERNAL_API_TOKEN` and is exempt. The token never reaches
        the browser (checked in a production build). `render.yaml` generates it.
  - [ ] **Confirm on Render after the first deploy** that one proxy hop is
        right (`TRUSTED_PROXY_HOPS=1`): if Render's edge adds a second
        address, every user behind one edge would share a limit.
- [x] Request-size cap (256 KB → 413, with or without a Content-Length) and
      headers: nosniff, no-referrer, `no-store` on writes, HSTS behind HTTPS.
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
- [x] Abuse controls on the outcome network (Phase 4).
- [ ] Postgres for shared outcome reports (the free plan's SQLite file is
      wiped on every deploy) and a decision on the "unverified" label.
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
- [ ] **Remember the offer comparison.** Keep the offer fields in the browser (like
      the complaint tracker) and feed the chosen verdict into the Phase 4
      outcome record ("bank offered 8.15% for ₹25,000; I paid / refused / moved").
- [ ] **Balance-transfer checklist.** When the verdict is "move the loan": the
      documents to ask for (foreclosure letter, list of documents, original title
      deeds), the order to do things in, and a reminder to cancel the old ECS.
- [ ] **Top-up and tenure traps in refinance quotes.** New lenders often bundle a
      top-up loan or stretch the term; show the cost of the stretch separately
      (the engine already supports a different term).
- [ ] **Prepayment amortisation on Windfall.** Show "EMI kept, ends N months
      sooner" vs "EMI lowered" for the windfall, like the offer comparison.
- [ ] **Per-email limit on sign-in codes.** The per-IP limit stops one
      machine; a count of codes sent to the same address in the last 15
      minutes (in the database) also stops someone flooding a victim's inbox
      from many addresses.
- [x] **Field errors on every tool.** Done: `lib/form-errors.ts` puts each
      422 under its field on all nine tools and the offer form; Loan Check's
      engine checks now name their field too.
- [ ] **Bank rate feeds.** Fetch SBI's and HDFC's published EBLR/RLLR the way
      Phase 5 fetches the repo rate, so the "new borrowers pay less" finding
      uses today's rate card instead of May 2026's.
- [x] **Quiet the profile-sync 404s.** Done: skipped when sign-in is off.
- [ ] **Outcome reminder.** 30 days after "Date sent" with no reply recorded,
      prompt the borrower (on their next visit) to record what the bank did.
      Most people won't come back to share on their own; this is where the
      outcome data will come from.
- [ ] **Scorecard page.** A public `/banks` page listing every bank with 5+
      reports, sortable by "fixed in full" and median days. The seed of the
      monthly index, and a reason to share the app.
- [ ] **Report the offer, not just the outcome.** When the bank "fixed" it for
      a fee, record the fee too, so the scorecard can say "usually asks ₹X to
      reset". Ties into "Remember the offer comparison" above.
- [ ] **Announce results on every tool.** Only Loan Check puts its result in
      an `aria-live` region; do the same for the other tools' verdicts.
- [x] **One skin, not three.** Done 26 Sep: Ledger only (AUDIT.md §3).
- [x] **Fewer, merged tools.** Done 26 Sep: Recompute → /plan what-if;
      Windfall + Cash Yield → Spare cash. The refinance half is still open
      (below).
- [x] **Debt-free date on the home page** from the same loader /plan uses.
      Done 26 Sep, streamed so home paints first.
- [ ] **A phone-width check in CI.** Seven tools and /plan scrolled sideways
      at 390 px although the manual pass said none did; the parked
      Playwright suite (6.2) should assert `scrollWidth ≤ 390` on every page.

### From using the app as a new user (26 Sep 2026)

Make it quicker to start:
- [ ] **Shorter setup.** (26 Sep: the credit score moved onto Savings, five
      steps now; loans can be left empty.) Fold the Welcome step (name,
      age) into Review and Income; no BACK on step 1. Loans: show only the fields the chosen type
      needs (a card needs balance, rate, bank; today a card shows ~16 fields,
      including lock-in and part-payment rules that apply only to term loans)
      with the rest under "More details". Income: hike month as a dropdown,
      hike phases and other banks under "More".
- [x] **Add a 60+ age bracket** so senior citizens get the ₹50,000 80D cap.
      Done 26 Sep: "50+" is now 50–59 and 60+.
- [ ] **Liquidate: start with the common case** (sell gold, an FD or funds
      to clear a card); the real-estate form behind "property".
- [ ] **Self-host the font** (`next/font`) so pages don't wait on Google
      Fonts; and move Render to an always-on plan or add a keep-warm ping
      (the free plan's 30–60 s wake-up is the only slow thing measured).

Make the numbers agree everywhere:
- [ ] **One "should I refinance?" rule** across the /plan scan, Loan Check
      offers and Right Time (AUDIT.md §3, still to decide 1).
- [x] **What-if runs the same plan as /plan.** Done 26 Sep (AUDIT.md §4).
- [x] **Per-loan currency in the debts table** for NRIs, and card minimums
      not counted as "extra" in the schedule. Done 26 Sep (AUDIT.md §4).

Make it a habit (the "super app" loop):
- [ ] **Month close.** Once a month: confirm what was paid (one tap per
      loan, prefilled from the plan), update card balances, and see "you're
      N months ahead / behind". The recap card exists but only for users with
      cash accounts, on /debts.
- [ ] **Reminders** for EMI due dates and card statement days (setup already
      asks for the statement day), and after each RBI/Fed decision for
      repo-linked loans.
- [ ] **Progress view**: debt paid off so far, interest avoided vs the
      minimums, and the date moving closer, month by month.
- [ ] **A one-page plan to share or print** (for a partner, or to take to
      the bank).

Tidy the code:
- [ ] **Remove the dead skin branches** still inside shared parts (the
      activity ledger, toggles, alerts and prompts keep "inline"/"aside"/
      "editorial" paths that nothing renders now).
- [ ] **Merge home's simple and detailed modes** (AUDIT.md §3, still to
      decide 2).

### Big ideas (26 Sep 2026, for the owner to pick from)

Bigger bets that would turn this from a calculator into the app people
open every month. Rough order: most leverage first.

**Owner, 26 Sep:** none of these yet; decide later. Liked: Loan Check on
autopilot, the payday checklist, the no-cost EMI checker, couples, and the
stress test with insurance. Dropped: Ask the plan. Notes under each.

- [ ] **No typing: pull the loans in.** India's Account Aggregator network
      (RBI-licensed, consent-based) returns real balances, rates and EMIs
      from the bank; a CIBIL/Experian report upload lists every loan and
      card with lender and outstanding. Setup becomes "connect and check".
      The same pull each month *is* the month close, and a rate that
      didn't fall after a repo cut shows up without the user noticing.
      *Owner: pulling AA data needs a licence.* Right: only a regulated
      Financial Information User can pull. Without one, start with the
      user's own credit report (a PDF read on the device), and partner with
      a regulated lender for AA later.
- [ ] **Loan Check on autopilot.** After each RBI/Fed decision, check every
      repo-linked loan's next reset and send "HDFC should move you to
      8.25% on 1 Jan; here's the letter" before the bank forgets; chase at
      day 30, pre-fill the RBI CMS complaint at day 30+. The scorecard
      becomes a public "which banks pass on cuts" index journalists quote.
      *Owner: yes.*
- [ ] **Fee traps finder.** Spot charges the rules forbid or cap:
      foreclosure charges on floating-rate personal loans (RBI bars them),
      bundled loan insurance, penal interest after the Jan 2024 penal-
      charges rules, processing fees above the sanction letter. Each with
      its letter.
      *Owner: how would it know, if the user never types the fee in?* It
      can't scan in the background. It checks at the moments the user
      already has the number: a foreclosure or prepayment quote (offers,
      what-if), a statement or sanction letter uploaded, the credit report.
      Setup could also ask one yes/no per loan ("insurance added to the
      loan?"). So it rides on the credit-report upload above.
- [ ] **Payday checklist.** On salary day, one screen: pay card X ₹A, part-
      prepay loan Y ₹B, ₹C to the fund, with UPI/AutoPay links and a tick
      per line. Ticks feed the progress view ("3 months ahead").
      *Owner: yes.*
- [ ] **No-cost EMI checker at checkout.** A share-sheet / browser add-on
      that reads the Amazon/Flipkart price and says what the EMI really
      costs against the cash discount (the new-debt engine already does
      the maths).
      *Owner: yes.*
- [ ] ~~**Ask the plan.**~~ *Owner: no.* A chat that answers "can I afford a ₹15L car?" or
      "why the card first?" from the engine's own numbers, and writes the
      phone script for calling the bank. Hindi and other languages.
- [ ] **Couples and households.** Two incomes, joint loans, who pays what;
      one shared plan and date.
      *Owner: yes.*
- [ ] **Tax season mode (Jan–Mar, India).** Old vs new regime *with* the
      loans (home-loan interest and principal favour the old regime),
      80C/80D against prepaying, the 87A cliff and marginal relief.
- [ ] **Borrow against what you own.** Gold at home → a 9% gold loan to
      kill a 42% card; FD → overdraft against FD; the ranker already
      knows the tax and penalties.
      *Owner: why only gold?* It shouldn't be. Every route to swap dear
      unsecured debt for cheaper secured borrowing: gold loan, loan or
      overdraft against an FD, loan against mutual funds or shares, top-up
      home loan, PPF loan, insurance policy loan, card balance transfer;
      in the US a HELOC, 401(k) loan or 0% balance-transfer card. Each shows
      its risk too (gold auctioned, a margin call on pledged funds, the
      home at stake, lost compounding).
- [ ] **NRI remit timing.** Alert when the rupee weakens past a line:
      "remit now: your $ goes 3% further on the home loan".
- [ ] **Stress test with insurance.** Job loss for 6 months, a rate spike,
      a hospital bill: how long the fund lasts, and whether term cover
      clears the loans if the earner dies.
      *Owner: yes, as financial-health recs.* Months of runway if income
      stops, term cover against the loans, health cover, job-loss cover.
      Sizing the cover is fine; naming or selling particular policies needs
      an IRDAI intermediary registration.
- [ ] **A phone widget and a share card.** Debt-free date on the home screen;
      "34 → 31 months" card for WhatsApp, no amounts shown.
- [ ] **Employer benefit (B2B).** Offer it through HR as financial
      wellness; the user pays nothing, the employer pays per seat.
- [ ] **Private by default.** Everything works offline on the device
      (PWA, encrypted local store); sync is opt-in. A trust edge over
      apps that sell leads.
      *Owner: is offline possible?* Yes, in two steps. (1) A PWA that keeps
      the last plan readable offline. (2) New numbers offline need the
      engine in the browser: it uses only Python's standard library, so
      Pyodide can run it as is (a download of a few MB, once), which keeps
      one engine rather than a second copy of the maths in TypeScript.
      Live rates and shared lender reports still need the network.

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

Other API settings (all optional):

| Variable | Default | What it does |
|---|---|---|
| `RATES_FEED` | `on` | `off` skips the committed policy-rate file (tests set it) |
| `RATES_STORE_PATH` | `api/data/policy_rates_live.json` | the committed file the weekly job writes and the API reads at start |
| `RATE_LIMITS` | `on` | `off` turns the per-IP limits off (tests set it) |
| `TRUSTED_PROXY_HOPS` | `0` | proxies in front of the API; `1` on Render |
| `INTERNAL_API_TOKEN` | unset | shared with the web server so its calls aren't limited |
| `MAX_BODY_BYTES` | `262144` | request-size cap |
| `OUTCOMES_DATABASE_URL` | `DATABASE_URL`, else `api/data/outcomes.sqlite3` | where shared outcome reports live |
| `OUTCOMES_IP_KEY` | random per process | key for the hashed client address (daily report limits) |
| `SCORECARD_MODE` | `labelled` | `hidden` keeps lender figures back until reports can be verified |

The full fuzz: `FUZZ_N=20000 FUZZ_FULL=1 python -m pytest api/tests/test_api_fuzz.py -q`.

**In a Codespace:** VS Code only auto-forwards ports started from its own
terminals. If the app doesn't open, go to the **Ports** tab → **Forward a
Port** → `3000`, then open the Forwarded Address. Keep visibility **Private**.
Ignore unrelated ports (e.g. 38085). After the codespace restarts, rerun the
two server commands above.
