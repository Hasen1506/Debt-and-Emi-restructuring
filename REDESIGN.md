# Redesign · Ledger V2 + strategy personas

The plan for rebuilding the web app in the newest Claude Design files.
Read **Resume here** first after any compaction or new session.

## Resume here

- **Phase in progress:** R3 · Plan (not started)
- **Last finished step:** R2 · Home, all six steps (PR #9): context line, cash-flow trio, KPIs, Pay this month with one-tap mark paid, allocation bar, cheaper rates moved from Plan, open positions with rate breakdown; `/debts` retired
- **Next step:** R3 — measure Plan's height at 1200/390 and W3's "switch strategy → plan changes" on the current Plan as the before, then R3.1
- **Open PR:** #9 · `claude/vibrant-bardeen-5bsiyj` (merge when CI is green, then restart the branch from `main`)
- **Waiting on the owner:** whether to change the US default card minimum (see the R1 walkthrough results)

Pause after each phase (or about every five steps, or when context is near 35%):
tick the boxes here, update **Resume here**, push, and ask the owner to `/compact`.

## Source of truth

| What | Where | Use it? |
|---|---|---|
| Ledger V2 screens (rev 3) | `design/ledger-v2/` · `HANDOFF.md` is the designer's spec | **Yes** — layout, type, tokens, copy |
| Strategy personas, medallion (Direction D) + Profile triptych | `design/strategy-personas/` | **Yes** — medallion in the masthead, triptych at the bottom of Profile |
| Older designs in the zip (Default, Editorial, Landing, directions A–D, wireframes, `LEDGER_MISSING.md`) | not copied | No — superseded |
| `LDebtsV2`, `ledger-skin-rest.jsx` originals | in `design/ledger-v2/` | Only for comparison |

To view a design screen: from `web/`, run
`NODE_PATH=$PWD/node_modules node ../design/render/tx.js ../design/ledger-v2 <out>`,
copy `react*.production.min.js` from `node_modules/react{,-dom}/umd/` and `design/render/h.html` into `<out>`,
then open `<out>/h.html?c=LHomeV2` (or `LPlanV2`, `LGoalsScreen`, `LActivityScreen`, `LWindfallV2`, `LInsightsV2`, `LPortfolioScreen`).

## What the user needs (the test for every screen)

A person opens this app for four reasons. Each screen must serve one of them, and nothing should appear on two screens.

1. **"What do I pay this month?"** — and tick it off. *(monthly, 1 minute)*
2. **"When am I debt-free, and what if…?"** *(occasionally)*
3. **"Something happened"** — a bonus, a new loan offer, a rate change, a missed EMI. *(event-driven)*
4. **"Set me up / change my details."** *(once, then rarely)* — this is where typing hurts most.

## Pages: from the design's 9 tabs to 5

| Design tab | Goes to | Why |
|---|---|---|
| Home | **HOME** — trimmed | Answers question 1. Assumptions move to Plan; the tools mini-grid goes (tools live in one place). |
| Plan | **PLAN** — absorbs Notes | Answers question 2. |
| Notes | merged into **PLAN** | Lifecycle events (rate resets) and engine notes are about the plan's future. A separate tab repeats Plan. |
| Activity | **ACTIVITY** — absorbs `/decisions` | One history of everything logged, including decisions taken in tools. |
| Goals & Tools | **GOALS & TOOLS** — trimmed | Answers question 3, plus goals. The 8-card "input spec" becomes the real new-goal form; the worked example and the allocation sandbox go (Windfall and Plan's what-if already do that job). |
| Windfall | a tool inside **GOALS & TOOLS** | It's an event tool, not a place you visit monthly. Rebuilt to rev 3 (per-target sliders). |
| Portfolio | a section of **PROFILE** ("What you own") | Holdings and cash are details you enter, like income. Liquidate and Spare Cash read them. |
| Tax (business only) | inside **PLAN**, self-employed only | The app already has an advance-tax panel; no business profiles exist. No new tab. |
| Setup | **3-step first run**, then **PROFILE** | Profile = Setup in edit mode, with the persona triptych as its last section. |
| Debts (old) | gone | Open positions sit on Home with row expand. |

Masthead: `HOME · PLAN · ACTIVITY · GOALS & TOOLS · PROFILE`, the strategy **medallion** on the right, then the country chip.
Old URLs (`/debts`, `/insights`, `/decisions`, `/portfolio`, `/tools`) redirect to their new home so links and bookmarks keep working.

### Repetition to remove

| Shown today in… | Keep only in… |
|---|---|
| Assumptions: Home grid (9 tiles), Plan chips, Setup | **Plan** chips (editable). Home gets one context line. |
| Debt-free date: Home KPIs and Plan KPIs | Home shows debt-free date + total owed; Plan shows interest saved, months saved, monthly outlay. |
| Tools: Home grid, Tools tab, Goals | **Goals & Tools** only. |
| "Where should money go": Home allocation bar, Goals sandbox, Windfall, Plan what-if | Home bar (this month, read-only) · Windfall (a lump sum) · Plan what-if (monthly changes). Sandbox removed. |
| Restructure: Home and Plan | **Home** only, top opportunity shown, the rest one click away. |
| "Confidence" KPI | Dropped unless it gets a clear meaning. |

## Less typing

Setup today is 6 steps with ~53 labelled fields. Target: a person with two loans finishes in **3 steps and ≤ 12 typed values** (to be confirmed by the R0 baseline).

- **Step 1 · You and your money:** country, take-home pay, monthly spend. Tax regime defaults to New; the marginal rate is worked out from income.
- **Step 2 · What you owe:** one short row per loan — type, lender (optional), balance, rate, and **either** EMI **or** months left (the other is calculated). Cards: balance and APR; the minimum due is calculated. Fees, GST, lock-in, floating-rate reset and prepayment fee sit under "More terms — optional", with the defaults shown.
- **Step 3 · Your plan:** debt-free date and this month's payments, live, before saving.
- Not asked in setup: savings and emergency fund, goals, holdings. Each is asked where it's used (Windfall, Goals, Profile).
- Amount fields accept `50k`, `20L`, `1.5cr`, `$2.4k`.
- Every tool starts from a saved loan instead of asking for balance and rate again.
- Mark-paid on Home is one tap; only "Partial / other" asks for an amount.

## Walkthroughs

Six journeys, run on the current app first (baseline), again after each phase that touches them, and compared at the end.
For each: steps, values typed, clicks, and page height at 1200px and 390px.

| # | Who | Journey |
|---|---|---|
| W1 | Priya · India, salaried · card + personal loan + home loan | First setup → sees what to pay → marks two paid |
| W2 | Arjun · NRI in the US · INR home loan + US card | Setup with two currencies → plan → NRI prepay tool |
| W3 | Sam · US · card + auto + mortgage | Setup → switches strategy with the medallion → plan changes |
| W4 | Meera · India · no debts | Setup → adds a house goal → sees the monthly amount |
| W5 | Priya, later · ₹1L bonus | Windfall → engine pick → logs it → Home and Plan update |
| W6 | Priya, later · missed half an EMI, home-loan rate went up | Logs partial + rate change in Activity → plan updates |

## Phases

Each phase is one PR, merged into `main` when CI is green, so every phase starts from a working app. Pause after each phase.

### R0 · Groundwork
- [x] R0.1 Design files into `design/`; this plan
- [x] R0.2 Baseline: W1 setup and page heights recorded below (W2–W6 measured at the start of their phase)
- [x] R0.3 Primitives: section header (bold + 2px rule, optional `01 /` step), `lStrip` accent strip instead of yellow rows, `LExpandRow`, `LAllocationBar`, `LProgressBar`, `LMathBlock` restyled. Tokens kept at the app's darker accent/green (they pass 4.5:1 contrast; the design's do not)
- [x] R0.4 Masthead with 5 tabs (`aria-current` on the open one); `/insights` → `/activity`. `/debts`, `/portfolio`, `/decisions`, `/tools` keep working and light up their tab; each redirects in the phase that moves its content (R2, R1.5, R4, R5)

### R1 · Setup in three steps, and Profile
- [x] R1.1 Amount field (`kind="money"`, `web/src/lib/amount.ts`): groups digits as you type (25,00,000 for ₹, 2,500,000 for $), takes `50k`, `25L`, `1.5cr`, `$2.4k`, shows "= ₹25 lakh" under the box. On every setup amount; tools switch over in R5
- [x] R1.2 Step 1 · You and your money — country, NRI and work chips; take-home; spend; live "left each month"
- [x] R1.3 Step 2 · What you owe — short loan row, EMI ↔ months, "More terms" collapsed; a saved loan whose numbers weren't touched keeps its months left
- [x] R1.4 Step 3 · Your plan, live preview — same run as Plan (EF split included), so the date and interest match Plan exactly. Old form moved to `/profile`; `/onboarding?step=…` links now go to `/profile?step=…`; `/onboarding/assets` → `/profile/assets`
- [x] R1.5 Profile (edit mode): a summary of eight sections (you · where you live and tax · income and spending · loans · savings, banks and credit score · what you own · payoff order · privacy), each with [EDIT] opening only that part of the form; `?step=loans` opens Loans directly; Cancel and Save return to the summary. Saving now starts from the saved profile, so holdings and Plan's FX drift are no longer dropped (they were, before)
- [x] R1.6 Walkthroughs W1–W4 setup parts (results below)

**R1 build notes** (decided 1 Oct 2026, before compaction):
- New `web/src/components/setup/QuickSetup.tsx` (client) is the page at `/onboarding`. The current 3,800-line form moves to `/profile` (`git mv web/src/app/onboarding/page.tsx web/src/app/profile/page.tsx`) and stays the full editor until R1.5 restyles it. Change links `/onboarding?step=…` → `/profile?step=…`, masthead PROFILE → `/profile`; `/profile` with no saved profile → `/onboarding`.
- QuickSetup starts from the saved profile when there is one and saves the merged object, so loan fields it doesn't show (fees, resets, card details, ids) are kept.
- Step 1: country chips (IN · ₹ / US · $; US adds an "I also have loans in India" chip → `is_nri_us`), work chips (salaried / self-employed → `income_type`), take-home a month, spend a month without EMIs (`kind="money"`). A live "left each month" line.
- Step 2: one block per loan. Type chips; lender (`BankCombobox`, optional); balance (money, in the loan's currency); rate (`kind="percent"`, "APR" for cards); non-cards: EMI, or "I know months left instead" → months, and EMI is worked out with the annuity formula (EMI → months uses `deriveTenureMonths`). "More terms — optional" (collapsed): currency, fixed/floating, prepayment fee, lock-in; everything else lives in Profile. "No loans — skip" button. Checks: `loanDraftErrors`; foreign currency needs an exchange rate (`api.fxRate`, editable, required if the fetch fails — same rule as today).
- Step 3: live preview with `api.simulate({user, strategy, horizon_months: HORIZON_MONTHS, marginal_rate, simulation_start_month: getCountryMonth(country)})` and `api.baseline` → debt-free date, total interest, saved vs paying minimums, this month's first move. Save with `saveProfileClient`, set `BALANCES_ENTERED_KEY`, `router.push('/')`.
- Marginal rate: worked out from take-home (bisection on gross with `computeAnnualTax`, then `classifyBracket(...).marginalRate`), labelled an estimate; Profile can refine it with gross pay.

### R2 · Home
- [x] R2.1 Context line (plan month, tax regime, bracket, payoff order → changed on Plan) + cash-flow trio (take-home − costs = left) + status KPIs (owed, debt-free, interest this month, effective rate). Tools grid and the SIMPLE/DETAILED switch removed; the footer keeps "Feeling overwhelmed?"
- [x] R2.2 Pay This Month register: every payment of the plan's first month (EMI or card minimum + extra, then emergency fund and goals), MARK PAID in one tap, PARTIAL / OTHER takes the amount (or "didn't pay"), UNDO for rows marked on Home. Entries go to Activity (`via: 'home'`). A planned extra marked paid is held back until the month is over (`plannedExtra`), so marking it doesn't move the plan and it isn't counted twice
- [x] R2.3 Allocation bar under the register: one segment per payment (the extra's loan in the accent, savings green, other loans grey)
- [x] R2.4 Cheaper rates (restructure) moved from Plan to Home: one row per move (loans → lender, kind, rate change, fee, payback, year-1 saving), the top row open and the rest one click away; details hold the engine's explanation, rate date, eligibility caveat, "I took this" and the alternative lender
- [x] R2.5 Open positions on Home: one row per loan (rate → effective, EMI or minimum, months left, balance), the dearest flagged, each opening to its effective-rate breakdown; the stale-card nudge above it (update or dismiss for a week). `/debts` → `/#positions`; its cash cards moved to `/portfolio`, its planned-events panel to Plan (`/plan#life-events`)
- [x] R2.6 Walkthrough W1 marking paid (results below)

### R3 · Plan
- [x] R3.1 Assumption chips + KPIs: the facts from Profile on one line (plan start, tax regime, bracket → EDIT IN PROFILE), then one chip per assumption (payoff order, pay rises, rising costs, and when they apply: tax refunds, emergency-fund share, rupee drift), each opening its control below the row. KPIs: debt-free, total interest (and how much less than minimums), time saved, paying this month. "This month's surplus allocation" removed (Home's register shows it; goal order is changed on Goals). The emergency-fund slider re-runs the plan once the slider stops, not on every step of a drag
- [x] R3.2 Trajectory chart: the plan shaded, paying only the minimums dashed, a marker and label where each loan is paid off (the last one reads DEBT-FREE), labelled axes. The x-axis ends a little after the plan's debt-free month instead of where the minimums clear (Priya: May 2032, not Aug 2049), with a note at the edge saying when the minimums finish, or that they never do. Labels that would overlap move up a row. The "Key dates" list (the same dates again) is gone
- [x] R3.3 "Month by month" (the amortisation table) collapsed to the months something happens: ★ a loan paid off (★ DEBT-FREE on the last), ⊕ a rate reset or a planned new rate, ⊙ a pay change or the end of each year, + a planned loan starting. The event sits next to the date, so on a phone it's on screen without scrolling. Below it: the next floating-rate reset when it's within three months (ADD THE NEW RATE · WHAT IF RATES MOVE), and the central bank's rate, as-of date and next meeting for anyone with a floating-rate loan (within two weeks of the meeting: wait before a big prepayment or refinance). Lender names drop "Bank" ("HDFC home loan")
- [ ] R3.4 From Notes: lifecycle events table and the top three engine notes
- [ ] R3.5 What-if sliders with live impact; advance tax for self-employed

### R4 · Activity
- [ ] R4.1 Month strip, collapsible months, prominent due date
- [ ] R4.2 Log-entry dialog: payment · partial · rate update · expense · income · lifecycle, with engine preview
- [ ] R4.3 Decision-log entries shown in the same history
- [ ] R4.4 Walkthrough W6
- [ ] R4.5 Balances move with the months: the plan starts from the balances as entered, so each month that passes leaves them one EMI's principal too high until the user updates them. Roll them forward from the month they were entered (scheduled payments + logged entries). Also: an extra logged in Activity this month still counts on top of the plan's own extra for the month (Home's MARK PAID doesn't)

### R5 · Goals & Tools, Windfall
- [ ] R5.1 Goal ledger: open · edit · cancel/archive; priority accent strip
- [ ] R5.2 New-goal form: 4 required (name, amount, by when, priority) + optional (already saved, where it's kept)
- [ ] R5.3 Tools list, one row per question
- [ ] R5.4 Windfall rev 3: per-target sliders, engine pick vs manual, math block
- [ ] R5.5 Other tool pages on one skeleton (01 input · 02 result · the math); start from a saved loan
- [ ] R5.6 Walkthroughs W4, W5

### R6 · Strategy personas
- [ ] R6.1 Persona art as SVG symbols (authored once; 40px medallion, full triptych)
- [ ] R6.2 Medallion in the masthead; click → switch strategy
- [ ] R6.3 Triptych at the bottom of Profile with real numbers per strategy (debt-free date, total interest, extra cost vs Avalanche)
- [ ] R6.4 Walkthrough W3

### R7 · Finish
- [ ] R7.1 All six walkthroughs again; before/after table here
- [ ] R7.2 Phone width (390px) pass on every page
- [ ] R7.3 ROADMAP and AUDIT updated

## Decisions (defaults, unless the owner says otherwise)

1. **Five tabs** as above.
2. **Persona colours** stay inside the medallion and the triptych; the rest of the app stays Ledger (paper, ink, orange).
3. **Hybrid wording follows the engine:** "clears balances under ₹50,000 ($1,000) first for quick wins, then the highest rate". The design's "above 18% APR" rule is not what the engine does.
4. **Windfall's engine pick** is the engine's own answer (debts, emergency fund, or keep it). Goal sliders are used in manual mode.
5. **Parked:** a business Tax tab; reading bank SMS or statements to skip typing.

## Walkthrough results

### Baseline (R0.2, current app, 1 Oct 2026)

**W1 · Priya's setup** (card ₹1.5L @ 42%, personal loan ₹4L @ 14% EMI ₹13,700, home loan ₹25L @ 8.6% EMI ₹24,500;
take-home ₹1.2L, spend ₹50k). Minimum path, every optional field skipped:

| Screen | Fields on screen | Height at 1200px |
|---|---|---|
| You (optional) | 1 | 900 |
| Country | 1 | 900 |
| Income | 9 | 1,274 |
| Loans (3 loans) | **37** | **3,545** |
| Savings (optional) | 4 | 900 |
| Review | 0 | 1,151 |

- **6 screens, 10 values typed, 11 clicks** (5 continues, 2 "add loan", 3 loan-type picks, finish).
- Amount fields show raw digits (`2500000`): no grouping, so 25 lakh and 2.5 crore look alike. Typing a comma is not accepted.
- 37 fields for 3 loans is what makes it feel long, though only 3 per loan are needed.

**Page heights with Priya's profile** (px):

| Page | 1200 wide | 390 wide |
|---|---|---|
| Home `/` | 918 | 1,403 |
| Plan `/plan` | 2,530 | 3,713 |
| Debts `/debts` | 1,064 | 1,498 |
| Insights `/insights` | 1,468 | 2,657 |
| Goals `/goals` | 900 | 1,375 |
| Tools `/tools` | 900 | 1,305 |
| Portfolio `/portfolio` | 900 | 900 |

W2–W6 are measured at the start of the phase that rebuilds their page (R1, R4, R5, R6), so each "before" is taken on the code it replaces.

### After R1.2–R1.4 (three-step setup)

**W1 · Priya's setup**, same inputs:

| Screen | Fields on screen | Height at 1200px | Height at 390px |
|---|---|---|---|
| You and your money | 2 | 900 | 900 |
| What you owe (3 loans) | **11** (was 37) | **1,420** (was 3,545) | 2,153 |
| Your plan (live preview) | 0 | 900 | — |

- **3 screens (was 6), 10 values typed (the minimum for three loans), 7 clicks (was 11).**
- Amounts group as typed (`25,00,000`) and take `1.2L`, `50k`; the scale shows under the box (`= ₹25 lakh`).
- The preview's debt-free date and total interest match Plan to the rupee (checked on the default profile: Jul 2029, ₹4,98,974).
- Opening setup with a saved profile and saving without changes leaves the profile as it was (only blank defaults such as `variable_expenses: "0"` are added).

**W2–W4 setup parts** (new setup; no baseline was taken on the old form for these):

| Walkthrough | Values typed | Clicks | Heights at 1200px (steps 1/2/3) | At 390px |
|---|---|---|---|---|
| W2 · Arjun, NRI in the US: ₹40L home loan + $6k card | 8 (+1 if today's rate can't be fetched) | 8 | 900 / 1,291 / 900 | 943 / 1,802 / 921 |
| W3 · Sam, US: card + car + mortgage | 10 | 8 | 900 / 1,437 / 900 | — |
| W4 · Meera, India, no loans | 2 | 3 | 900 / 900 / 900 | — |

- W2: the ₹ EMI is converted for "left after EMIs" ($4,500 − $456). With the rates feed off, the exchange rate is asked for, and Continue stops until it's entered.
- **Found (engine, not this phase):** the US default card minimum is "2% of the balance or $35"
  (`engine/minimum_payments.py`, `DEFAULT_FORMULA` and the Chase/Citi/Capital One/Discover/Synchrony rows).
  At 24% APR, 2% a month is exactly the interest, so a card on minimums never clears, and "vs paying minimums"
  is overstated (W2: $182,870; W3: "77 yrs 6 mo sooner"). Most US issuers charge 1% of the balance plus interest
  and fees, with a $25–$41 floor. Changing it moves every US baseline, so it is listed for the owner rather than changed here.

### Before R2 (current Home, Priya's profile)

- Home shows one line, "PAY EXTRA: ₹24,300 → — CREDIT CARD": the extra only. The EMIs and the card minimum due this month aren't on Home.
- **Marking two paid** (the card and the personal-loan EMI): 7 clicks, 1 amount typed, and a move to Activity (`[I PAID THIS]` → log form: loan, kind, amount, log; twice).
- Height: 958 at 1200px, 1,395 at 390px.

### Before R3 (current Plan)

- Priya's Plan: 2,478 px at 1200, 3,541 at 390.
- W3 switching strategy: 1 click (the switch sat in "How this plan is built", 290 px down).
- The chart's x-axis runs to the minimums' payoff (Aug 2049), so Priya's plan (Mar 2031) fills the first fifth of it.
- A US card minimum that never clears showed "MONTHS SAVED 0".

### After R2 (new Home, Priya's profile)

| | Before | After |
|---|---|---|
| What Home says to pay | the extra only ("₹24,300 → card") | every payment this month: card ₹31,800 (₹7,500 minimum + ₹24,300 extra), home loan ₹24,500, personal loan ₹13,700, total ₹70,000 |
| **Mark two paid** (card + personal loan) | 7 clicks, 1 typed, on Activity | **2 clicks, 0 typed, on Home** |
| Plan after marking | (an extra logged this month moved the plan, counted twice) | unchanged: Mar 2031 on Home and Plan; the extra comes off next month |
| Height at 1200 / 390 | 958 / 1,395 | 1,746 / 2,700 |

- Home is taller because it now carries what was on Debts (open positions, each rate's breakdown) and Plan (cheaper rates); the Debts page is gone (`/debts` → `/#positions`).
- Checked with the over-budget, US, NRI, missing-rate and missing-exchange-rate profiles: no sideways scroll at 390, each gets its own message (short this month; add the rate; add the exchange rate).

### After (R7.1)

_Filled in at the end._
