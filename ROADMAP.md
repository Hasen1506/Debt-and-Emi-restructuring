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

- [ ] GitHub Actions CI on every push/PR: `pytest engine/tests api/tests`,
      `npm run typecheck`, `npm run lint`, `npm run build` in `web/`.
- [ ] Later phases add their suites to CI: Playwright (3 browsers), axe, the fast fuzz slice.
- [ ] `ROADMAP.md` "Running locally" section kept current (§ bottom).
- [ ] Delete the two recovery branches (`codespace-scaling-lamp-575pwg47jjrh79wv`,
      `recovered-codespace`); both are identical to `main`.

---

## Phase 1 · Loan Check — the core finding — REBUILD

The home-loan finding: *your floating-rate lender did not pass on rate cuts
it owed you*, plus how much that costs you this year.

**Inputs**
- [ ] "Month you took the loan" and "Loan start month": **Month dropdown +
      Year dropdown**, never `<input type="month">` (see Phase 6.1).
- [ ] Starting rate (two fields: benchmark + spread, or the headline rate) and current rate.
- [ ] If only one of the two starting-rate fields is filled, show **"Still needed: …"**.
- [ ] A rate typed as a fraction (`0.0855` meaning 8.55%) is caught in **both**
      the starting-rate and current-rate fields.
- [ ] Server **rejects** a date it can't parse with a clear error; it must not
      silently skip the check. (Lost bug: typing "03/2019" in Firefox made the
      rate-cut finding quietly disappear.)

**Findings**
- [ ] **Missed rate cut**: repo/benchmark moved down since the loan's last
      reset, but the loan rate didn't follow. Reset frequency per RBI EBLR
      rules (at least quarterly).
- [ ] **Pricing gap**: you pay more than new borrowers at the same lender.
      Shown as information; **not** claimed as a refund (Phase 2).
- [ ] **Amount at stake "this year"**: floored at zero. (Lost bug: this could go
      negative and print "Refund … estimated at −₹6,952".)
- [ ] Each finding carries its rule citation and the next step.

---

## Phase 2 · Letters and escalation, per market — REBUILD

- [ ] **India — grievance-channel complaint** to the bank, pre-filled with
      loan facts, the finding and the RBI direction it relies on.
  - [ ] The refund request claims **only the missed rate cut**. (Lost bug: it
        summed every finding, including "you pay more than new borrowers",
        which a bank isn't obliged to refund and weakened the complaint.)
  - [ ] Step 2: bank rejects fully or partly → the bank must route it to its
        **Internal Ombudsman**; the app says so and tracks it.
  - [ ] Step 3: no reply in 30 days or an unsatisfactory reply → **pre-filled
        RBI Ombudsman complaint** (CMS portal fields), free to file.
- [ ] **US mortgage — notice of error** (RESPA / Reg X): acknowledgement due in
      5 business days, response in 30 business days. Tracker counts both.
- [ ] **US card — billing-error notice** (FCBA / Reg Z): must be sent within 60
      days of the statement; resolution within two billing cycles.
- [ ] **Regulator complaint hand-off** (RBI Ombudsman / CFPB) when the lender
      refuses or goes quiet.
- [ ] Letter facts are written in third person. **No stray "you" is ever left
      in a letter**; enforced by the fuzz suite.
- [ ] **Citation check**: every rule a letter cites is checked against the
      regulation text (test fixture holding quoted clauses + source URLs).
- [ ] Deadline tracker: sent date → acknowledgement due → response due → escalation available.

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
- [ ] Before shipping, re-verify the current values from the official sources.
      The lost session reported RBI at **5.25%** (held at all 2026 meetings,
      next decision 7 Oct) and the Fed raised to **3.75–4.00% on 16 Sep 2026**.
      The repo JSON still says RBI 6.25% / Fed 4.50%, which is stale.
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
- [ ] Full step-by-step E2E flow (onboarding → Loan Check → letter → outcome)
      passes in all three browsers.

### 6.2 Accessibility (axe)
- [ ] **Zero axe violations on all 24 screens at desktop and phone width.**
- [ ] Accent orange darkened slightly for text contrast (`#c96442` is too faint as text).
- [ ] Every slider has a label; the keyboard focus ring is never hidden.
- [ ] Every page has headings and landmarks, plus a "Skip to content" link.
- [ ] Wide tables on phones are keyboard-scrollable (focusable region with a label).
- [ ] Check results are announced to screen readers (`aria-live`).
- [ ] Re-find and fix the screen-reader bug found by accident last time (not
      recorded in the screenshots; the axe pass plus a manual VoiceOver/NVDA run should surface it).

### 6.3 Property / fuzz tests on the engine
- [ ] 20,000 random loans through the API: no crashes, no negative "amount at
      stake", no "you" left in any letter.
- [ ] 300 of those cases in the normal suite (~2 s).
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
| 3 | 2 · Letters | A finding is useless without the letter that forces a reply |
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
pip install -r requirements.txt
uvicorn api.main:app --reload

# Web (http://localhost:3000), in a second terminal
cd web && npm install && npm run dev

# Tests
python -m pytest engine/tests api/tests -q
cd web && npm run typecheck && npm run lint
```

Leave `DATABASE_URL` unset and set `NEXT_PUBLIC_DISABLE_AUTH=true` for
trial mode (no login, no sync). `CORS_ORIGINS` defaults to `http://localhost:3000`.

**In a Codespace:** VS Code only auto-forwards ports started from its own
terminals. If the app doesn't open, go to the **Ports** tab → **Forward a
Port** → `3000`, then open the Forwarded Address. Keep visibility **Private**.
Ignore unrelated ports (e.g. 38085). After the codespace restarts, rerun the
two server commands above.
