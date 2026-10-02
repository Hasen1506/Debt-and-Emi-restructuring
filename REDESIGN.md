# Redesign · Ledger V2 + strategy personas

The plan for rebuilding the web app in the newest Claude Design files.
Read **Resume here** first after any compaction or new session.

## Resume here

- **Status:** the redesign is done (R0–R7). R6.5 redrew the persona art after the owner's review.
- **Last finished step:** R7.3. ROADMAP and AUDIT are updated; AUDIT §8 has what the walkthroughs and the phone pass found (all fixed) and what's still open.
- **Next, for the owner to pick from (AUDIT §8, still open):**
  - refresh the saved exchange rate when today's can be fetched, and say on Plan which day's rate it used;
  - move `/profile/assets` to Ledger fields;
  - look at Right time's odds and NRI prepay's live rate once deployed.
- **Open PR:** #17 · `claude/vibrant-bardeen-5bsiyj` (R6.5 + R7); merge when CI is green
- **Can't check from this container:** Polymarket, frankfurter and open.er-api are blocked here. The odds and FX code is tested against responses shaped like theirs; look at Right time and NRI prepay once deployed. Whether Polymarket lists RBI decisions is unconfirmed; without them Right time says it has no odds and judges on today's rate. For local work, `MARKET_ODDS_FILE=<saved Gamma events>` serves odds offline

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

## Capitals and wording (one rule everywhere)

- **Capitals:** buttons, chips, tabs, section headers, table headers and KPI labels. The source text is written in sentence case and the component sets `textTransform: 'uppercase'` (LChip, LSectionHeader, tool headers), so the same words never show up in two cases.
- **Sentence case:** field labels, hints, names (goal names, tool questions in a list) and every full sentence. A full sentence is never in capitals, and a label never starts with a lowercase letter.
- **Brackets:** a solid button has spaces inside, `[ ADD GOAL ]` (LButton). A text action has none, `[EDIT]` (LBracket).
- **Loans** are named by `loanLabel()` in `lib/loan-types`: "Home loan", or "HDFC credit card" when the lender is on file. A car loan is a "car loan", never "auto loan".
- **Dates:** `02 Oct 2026` (en-GB), and `Oct 2026` for a month. No US-style `Oct 2, 2026`.
- **Shapes:** square corners on inputs, chips and buttons.

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
- [x] R3.4 Life events as a ledger list (date · what · status · IT HAPPENED / CANCEL / REOPEN / DELETE) with a short form: chips for what changes (my pay · a loan's rate · a new loan), amount fields that take `32L`, field errors shown in place, and saving re-runs the plan (it didn't before: the chart only changed after a reload). The rate-reset reminder opens the form on that loan and its reset date. Notes (at most three, each with its working): prepay or save (the dearest loan against the best safe rate after tax), the home loan's tax saving (or why there is none), a pay rise that crosses a tax bracket. Activity's notes went: the real rate and the monthly surplus are on Home, and the no-cost-EMI tip showed for any floating-rate loan
- [x] R3.5 What if, in ledger rows with no nested cards: spend less each month (from this month or later; DO IT saves the cut), if floating rates change (off, and says why, when no loan floats), pay a lump sum (into which loan, ★ the plan's pick; I PAID THIS logs it). Each shows → DEBT-FREE ±n MO and → INTEREST ±amount as it changes; the line that repeated them in words went (goal changes still show). Loan names read "Credit card · ₹1,50,000", not "Unnamed · credit card". Advance tax (self-employed) is a register like Home's: MARK PAID in one tap, OTHER AMOUNT takes `2.34L`, a missed instalment gets the red strip, and the penalty is in plain words

### R4 · Activity
- [x] R4.1 Month strip, collapsible months, prominent due date: entries by month, newest first, a JUMP strip, the two latest months open. The current month lists each EMI or card minimum due and not logged (PAID in one tap, MARK n EMIS PAID, OTHER for part/missed/more); this replaced the "nothing changed" bar. Rows: date · what · planned · paid · status · effect, with EDIT and UNDO; stacked at phone width
- [x] R4.2 Log-entry dialog: payment (in full, part, missed, extra with where it came from, paid off; a card's balance now), rate change, pay change, spending (this month's total, or a new monthly amount), new loan. A preview shows the debt-free month and interest before saving, from the plan's inputs (`loadPlanInputs`, split out of `loadPlan`). A rate or pay change dated today or earlier goes into the profile; a later one waits on Plan. The life-event form is shared with Plan (`LifeEventForm`); the old 2,139-line `ActivityLedger` is gone
- [x] R4.3 Decision-log entries shown in the same history: plan choices (payoff order, emergency-fund share, goals) with their effect on the debt-free date, and spending cuts made for a goal (IT HELD / UNDO, "STILL HOLDING?" after 30 days). UNDO only where it restores something (the old page offered it on every decision and restored nothing for most). `/decisions` → `/activity`
- [x] R4.4 Walkthrough W6 (results below)
- [x] R4.5 Balances move with the months: the plan starts from the balances as entered, so each month that passes leaves them one EMI's principal too high until the user updates them. Roll them forward from the month they were entered (scheduled payments + logged entries). Also: an extra logged in Activity this month still counts on top of the plan's own extra for the month (Home's MARK PAID doesn't). **Done:** each loan carries `balance_as_of` (Setup; Profile when a balance changes; a tool's new loan; a confirmed new-loan event). `lib/roll-forward` takes off the EMIs due in the months after that one, for the plan and for Home, Goals and Portfolio, and Activity says which balances moved. An extra logged from this month's spare cash holds back the part the plan already pays this month (`plannedExtra`). Not rolled: cards, flat-rate and pre-EMI loans, and loans saved before this change (no date until their balance is next saved)

### R5 · Goals & Tools, Windfall
- [x] R5.1 Goal ledger: one row per goal (# · goal · target · put in with a progress bar · by · a month · status) with OPEN · EDIT · CANCEL (ARCHIVE once funded); the ★ goal has the accent strip; rows stack at phone width. KPIs: goals, on track, need a look, what the goals need a month against the spare cash. OPEN: when saving starts and how much (with debts, saving waits for the last month that still makes the date: START NOW / CLEAR DEBTS FIRST), the money put in (ADD today's amount, REMOVE), and when short, what closes it, each with one button (MOVE IT, LOWER IT, MAKE IT FIRST, CUT SPENDING), or the backups it leans on (emergency fund, selling, a loan, with WHAT TO SELL →). A note when where it's kept doesn't suit the date. Cancelled and archived goals keep the money, leave the plan (not in the goals cookie) and fold under CLOSED (REOPEN · DELETE); edits and cancels show in Activity with UNDO (restored by goal id). One calculation, `lib/goal-line`, feeds the row, the panel and the form. Templates stay as one line of brackets; their note shows on the page instead of an alert
- [x] R5.2 New-goal form: what it's for (chips, which name the goal), how much (`15L`), by when (1/2/3/5 years, or month and year), priority (★ first / in date order). Optional, folded: already saved, where it's kept, whether the date can move, buffer, backups. The monthly amount and status show before saving
- [x] R5.3 Tools list under the goals, one row per question (question · what it does · OPEN →). `/tools` → `/goals#tools`; each tool's header links back. A tool for one country, or NRIs only (NRI prepay), shows only to them
- [x] R5.4 Windfall rev 3: amount (`1L`) and where it comes from; 02 WHERE IT GOES with ENGINE PICK · BEST / MY SPLIT, a pool meter, one slider per target (emergency fund, loans by rate, goals), each with its effect (debt-free −n mo and interest for a debt on its own; new progress for a goal; how full the fund gets), the split bar, KPIs from one plan run with the whole split (debt-free, interest saved, to goals, kept), LOG IT, the math. Engine pick: the fund's plan share, then loan after loan in the payoff order (`api.windfall` again on what's left), then the rest of the fund, then the engine's investment. Runs as you type
- [x] R5.5 Other tool pages on one skeleton (01 input · 02 result · the math); start from a saved loan. All seven: Invest or prepay, NRI prepay, Loan check, Sell to repay, New debt check, Big purchase, Right time
- [x] R5.6 Walkthroughs W4, W5 (in the R5.1–R5.4 table below), plus tool heights after R5.5

**R5.5 build notes** (2 Oct 2026, before compaction):
- Only Windfall has the numbered layout. The other seven (`new-debt`, `purchase`, `liquidate`, `invest-vs-prepay`, `right-time`, `loan-check`, `nri-prepay`, each `app/tools/<id>/tool.tsx`) use `components/Card` and `ToolPrimitives` (`Field`, `Select`), with no amount field on `kind="money"`.
- Move Windfall's `Head` (numbered `01`, accent `02`) and `Sub` into a shared `components/ledger/LToolSteps.tsx`. Put each tool on: 01 · the inputs (bordered box) → 02 · the answer (2px box, KPIs via `LKpi`) → THE MATH (`LMathBlock`). Keep each tool's logic and API calls. Drop `components/Card` where it goes.
- Money fields → `kind="money"`, with the currency from the profile (or the loan's currency).
- Start from a saved loan: `loan-check` (pick a home loan → balance, months left, rate, lender, start month), `invest-vs-prepay` (pick a loan → its rate; marginal rate from the profile), `nri-prepay` (its loan picker first, not "optional"). Prefill from the profile: `liquidate` (taxable income), `new-debt` (savings, credit score). `right-time` and `purchase` are about new loans, so there's no saved loan to start from.
- Test each tool at 1200 and 390 with Priya, plus `profiles.mjs` for noloans, us, nri.

### R6 · Strategy personas
- [x] R6.1 Persona art as SVG symbols (authored once; 40px medallion, full triptych): `public/art/personas.svg` (3 scenes, 3 medallions; redrawn in R6.5), drawn through `components/personas/Persona.tsx`
- [x] R6.2 Medallion in the masthead; click → switch strategy: a pip switches in one click; the medallion opens the three with what each does. Shown only when there is debt
- [x] R6.3 Triptych at the bottom of Profile with real numbers per strategy (debt-free date, total interest, extra cost vs Avalanche): `components/personas/StrategyCompare.tsx` runs the three orders on Plan's own inputs (`loadStrategyOutcomesFromCookies`) and streams in after the rest of Profile; a card switches. When the three come out the same (Priya, Sam) or a month is short, one line says so instead of three identical cards. The Hybrid figure's split was clipped in scene coordinates inside a translated group (in the design file too), which hid half of it; it now splits down its own middle
- [x] R6.4 Walkthrough W3 (see After R6 below)
- [x] R6.5 Art redrawn (owner: "looks kind of worse graphically"). The design file's scenes were 3:2 but the cards show 2:1, which cropped the figures' feet, the god and the big snowball; the bodies were loose polygons; the 40px medallions blurred; the three glyphs were the same triangle. Now: scenes drawn at 480×240, figures as pictograms (round strokes, a separate head), flat planes, one idea each (pushing the boulder up to a summit flag; balancing a boulder and a snowball on the ridge; a snowball let go at the top, growing as it rolls). The medallions are cut down to read at 32px. The unused glyphs are gone. Card figures line up across the three cards whatever the rule's length

### R7 · Finish
- [x] R7.1 All six walkthroughs again; before/after table under "After (R7.1)"
- [x] R7.2 Phone width (390px) pass on every page: all 19 routes with Priya, and the six main pages with the US, NRI, no-loans and over-budget profiles (43 page loads). None scroll sideways, none show NaN or console errors. Fixed:
  - `/profile/assets` was 484 px wide: its two-column grid now drops to one column on a phone.
  - Tap targets: Ledger's bracket links and buttons were 11–16 px tall. A `.l-hit` class (globals.css) reaches each to at least 26 px without moving anything, on `LBracket` and the bracket links built by hand. Sliders are 24 px tall. The "i" tips, setup's step numbers and the dismiss crosses are padded out. Rows of brackets (goal templates, the schedule's CSV/PRINT) sit 14 px apart, so neighbouring hit areas don't overlap.
  - The five tabs fit one line on a phone (tighter tracking under 480 px, via `--nav-tracking`), which takes a row off the masthead.
  - Home's settings line no longer repeats the payoff order shown in the masthead just above it.
  - Left as is: the medallion's three pips are 14×10. The medallion beside them (40 px) opens the same three choices as full-width buttons, which meets WCAG 2.5.8 as an equivalent control.
- [x] R7.3 ROADMAP and AUDIT updated (AUDIT §8 lists what R7 found and what's still open)

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
- **Fixed (owner approved, before R4):** the US default is now 1% of the balance plus interest and fees, or $35;
  Chase $40, Citi $41, Capital One and Apple Card $25, Amex $40, Bank of America $35 (all 1% + interest + fees);
  Discover the greatest of 2%, $20 + interest + fees, or $35; Synchrony the greatest of 3.5%, 1% + interest + fees, or $25.
  No minimum asks for more than the card owes. The US test profile ($8,000 Chase card at 25%, $18,000 car loan)
  on minimums only: never clear and $131,925 of interest in 50 years → clear in 19 yrs 8 mo, $17,496.

### Before R2 (current Home, Priya's profile)

- Home shows one line, "PAY EXTRA: ₹24,300 → — CREDIT CARD": the extra only. The EMIs and the card minimum due this month aren't on Home.
- **Marking two paid** (the card and the personal-loan EMI): 7 clicks, 1 amount typed, and a move to Activity (`[I PAID THIS]` → log form: loan, kind, amount, log; twice).
- Height: 958 at 1200px, 1,395 at 390px.

### Before R3 (current Plan)

- Priya's Plan: 2,478 px at 1200, 3,541 at 390.
- W3 switching strategy: 1 click (the switch sat in "How this plan is built", 290 px down).
- The chart's x-axis runs to the minimums' payoff (Aug 2049), so Priya's plan (Mar 2031) fills the first fifth of it.
- A US card minimum that never clears showed "MONTHS SAVED 0".

### After R3 (new Plan)

| | Before | After |
|---|---|---|
| Priya's Plan, height at 1200 / 390 | 2,478 / 3,541 | **2,008 / 2,679** |
| Assumptions | a block of toggles and a slider ("How this plan is built") | one row of chips, each opening its control |
| Chart's x-axis (Priya) | Oct 26 → Aug 49 (the minimums' payoff); the plan filled the first fifth | Oct 26 → May 32, a marker per loan paid off, "minimums: clear Aug 49 →" at the edge |
| Key dates, surplus allocation, invest-vs-prepay, bracket card | four separate sections | dates on the chart and in the schedule; this month's money on Home; one Notes section (at most three) |
| W3 switch strategy | 1 click (switch sat 290 px down) | 2 clicks (chip, then the order), 149 px down; the R6 medallion makes it one |
| Add the new rate at a reset | find "Life events", pick the kind, the loan and the date, type the rate | ADD THE NEW RATE on the reminder: loan and date filled in, type the rate; the plan re-runs on save |

- A US card whose minimum never clears now reads "TIME SAVED — · MINIMUMS ALONE NEVER CLEAR IT" instead of "0".
- Checked with the over-budget, US, NRI, US mortgage, self-employed, no-loans and paid-off profiles: no sideways scroll at 390.

### Before R4 (current Activity, Priya's profile, three months of entries)

- Height: 1,289 at 1200px; 2,235 at 390px, and 427px wide at 390 (sideways scroll).
- Loans with no lender read "Unnamed · card"; a card's "Paid in full" defaulted to ₹0; dates were "2026-10-01".
- **W6** (half the personal-loan EMI, then the home-loan rate up to 9.1%): 8 clicks, 2 values typed, 2 pages (the partial in Activity's form, the rate in Plan's life events). Neither showed what it did to the plan.

### After R4 (new Activity)

| | Before | After |
|---|---|---|
| Height (1200 / 390) | 1,289 / 2,235, sideways scroll at 390 | 900 / 1,096, none |
| W6 | 8 clicks, 2 typed, 2 pages, no effect shown | 6 clicks, 2 typed, 1 page: OTHER on the personal loan's due row (loan and "part" filled in), the amount, SAVE; LOG AN ENTRY → RATE CHANGE → home loan → rate → SAVE. Each previews its effect: interest +₹4,208 (₹595 fee estimate shown), then +₹45,833 |
| This month's EMIs | "CONFIRM EMIS PAID · NO CHANGES" bar | a due row per loan, PAID in one tap |
| A balance entered in July, in October | still July's (one EMI's principal too high per month) | rolled forward: ₹35,00,000 → ₹34,79,110 after 2 EMIs, said on Activity; Home shows the same |
| An extra logged from this month's spare cash | counted on top of the plan's own extra for the month | the plan's share waits for the month to end, as Home's MARK PAID does; the preview says so |
| Plan decisions | a separate /decisions page | rows in the same history |

- Checked with the no-loans, paid-off, over-budget, US, NRI and default profiles: no sideways scroll at 390, no NaN.

### After R2 (new Home, Priya's profile)

| | Before | After |
|---|---|---|
| What Home says to pay | the extra only ("₹24,300 → card") | every payment this month: card ₹31,800 (₹7,500 minimum + ₹24,300 extra), home loan ₹24,500, personal loan ₹13,700, total ₹70,000 |
| **Mark two paid** (card + personal loan) | 7 clicks, 1 typed, on Activity | **2 clicks, 0 typed, on Home** |
| Plan after marking | (an extra logged this month moved the plan, counted twice) | unchanged: Mar 2031 on Home and Plan; the extra comes off next month |
| Height at 1200 / 390 | 958 / 1,395 | 1,746 / 2,700 |

- Home is taller because it now carries what was on Debts (open positions, each rate's breakdown) and Plan (cheaper rates); the Debts page is gone (`/debts` → `/#positions`).
- Checked with the over-budget, US, NRI, missing-rate and missing-exchange-rate profiles: no sideways scroll at 390, each gets its own message (short this month; add the rate; add the exchange rate).

### After R6 (strategy personas)

| | Before | After |
|---|---|---|
| W3 · switch strategy | 2 clicks on Plan (the STRATEGY chip, then the order), 149 px down; nowhere else | **1 click** on the masthead pip, on every page with debt (y = 96 at 1200, 173 at 390) |
| Comparing the orders | Plan's strategy panel: three rows of month and interest, behind the chip | Profile, PAYOFF ORDER: the three personas with debt-free date, total interest and the extra against Avalanche; a card switches |

- W3 with Sam (card + car + mortgage): his card is both the smallest debt and the dearest, so all three orders come out the same (Feb 2030, $44,284). Profile says that in one line; Plan says it in its strategy panel.
- With orders that differ (card $8,000 at 24.99%, store card $800, personal loan $3,000, car): one pip click takes Plan from $1,114 to $1,250 in interest and the first payoff from the Chase card to the Target card; Profile shows Hybrid +$26, Snowball +$137, the same as Plan for each.

### After (R7.1)

All six again on the finished app (2 Oct 2026, 1200 wide unless noted). "Before" is the first measurement of each, on the code it replaced.

| Walkthrough | Before | After |
|---|---|---|
| **W1** · Priya's setup | 6 screens, 10 typed, 11 clicks; the loans screen had 37 fields and was 3,545 px | **3 screens, 10 typed, 7 clicks**; 11 fields, 1,444 px; amounts group as typed and take `1.2L`, `50k` |
| **W1** · mark two paid | 7 clicks, 1 typed, on Activity | **2 clicks, 0 typed, on Home**; the plan stays at Mar 2031 |
| **W2** · Arjun, NRI | amounts in the wrong currency (AUDIT R1); NRI prepay ran on the rate saved in the profile | setup in 8 typed, 8 clicks; each loan in its own currency; NRI prepay starts from today's rate ("as of 01 Oct 2026") and says when it falls back to the profile's |
| **W3** · Sam switches the order | 1 click, only on Plan, 290 px down | **1 click on the masthead, from any page with debt** (y = 96; 173 at 390); with orders that differ, interest goes $1,114 → $1,250 on Plan, as Profile's cards said |
| **W4** · Meera's house goal | 1 click, 2 typed, two different monthly figures | 3 clicks, **1 typed** (`15L`); one figure, "₹43,750 a month until Oct 2029 · ON TRACK", before saving |
| **W5** · Priya's ₹1L bonus | URL typed, 1 typed, 2 clicks; one target only | 1 click to the tool, **1 typed**, 1 click; the split shows as you type; Home then shows ₹29,50,000 owed and Plan Dec 2030, as the preview said |
| **W6** · half an EMI, then a rate rise | 8 clicks, 2 typed, 2 pages; no effect shown | **6 clicks, 2 typed, 1 page**; each entry previews its effect, and saving says "plan still debt-free in Mar 2031" |

Fixed on the way:
- Setup's plan preview showed US amounts with cents ("$4,044.00", "$2,783.03"). It is now whole amounts, as on every other page.
- Setup told a user with no loans "Order: Avalanche … Change it on Plan". The line now shows only when there are loans, and it points to the switch at the top of every page.
- The strategy one-liners on Plan and in setup ("pure psychological momentum", "then math") now use the personas' words: "Highest rate first, for the least interest", and so on. The unused long descriptions are gone.
- Activity's save message read "plan debt-free MAR 2031 · no change". It is now "plan still debt-free in Mar 2031".

### After R5.5 (the seven tools)

Each tool: 01 the inputs, 02 the answer (one sentence, then the figures that decide it), then THE MATH. Heights are with an answer showing.

| Tool | Profile | Height 1200 / 390 | Typed to get an answer | Starts from |
|---|---|---|---|---|
| Invest or prepay | Priya | 1,081 / 1,624 | 0 | her dearest loan's rate, her tax rate, her country's choices |
| NRI prepay | NRI | 1,250 / 1,933 | 0 | the saved loan; the exchange rate from the profile |
| Loan check | Priya | 3,487 / 5,990 | 2 (start month, start rate) | her home loan: lender, balance, months, rate |
| Right time | Priya | 1,353 / 2,174 | 1 (`30L`) + 1 chip (the expected cut) | her bank's published rate; the next RBI date |
| Big purchase | no loans | 1,407 / 2,219 | 1 (the price) | savings from the profile; typical terms per kind |
| New debt | Priya | 1,603 / 2,270 | 1 (`3L`) | the cheapest bank, savings and credit score from the profile |
| Sell to repay | with assets | 2,717 / 4,910 | 3 (paid, year, sale price) | the dearest loan, taxable income from the profile; the ranker above |

- No NaN or sideways scroll at 390 on any of them, for Priya, no loans, US and NRI.
- Engine answers now read in plain words: "A 0.25% cut is expected in 1 month", not "25bps in 1m"; "Borrowing really costs about 12.6% a year", not "Real APR ≈ 12.6%. Acceptable"; "Selling leaves you only ₹42,887 better off over 5 years", not "Failed gates: …".
- Found on the way: an asset saved with only a year (`2021`), as the asset form does when the price is approximate, made every call carrying the profile fail with 422, the plan included. Fixed in `api/schemas.py`.

### Before R5 (current Goals, Tools, Windfall)

- Goals with two goals (Priya): 2,697 px at 1200; 4,901 at 390, where it also scrolled sideways (672 px wide). Tools and Windfall (empty) fit in 900 at 1200.
- The GOALS & TOOLS tab opened `/goals`, which had no link to any tool; `/tools` could only be reached by typing it.
- **W4 · Meera adds a house goal:** 1 click (the kind), 2 values typed (amount, `YYYY-MM`). The card then showed two different monthly amounts for the same goal: "Saving starts Mar 2028 · ₹105,000/mo for 15 months" and "put aside about 49k a month from now". With no debts there was nothing to wait for.
- **W5 · Priya's ₹1L bonus:** typed URL, 1 value, 2 clicks (WHERE SHOULD IT GO, LOG IT). All ₹1L to the card, which is right; but one target only. A larger amount said "the loan clears; keep this or run it again", and there was no way to split it or send part to a goal.

### After R5.1–R5.4

| | Before | After |
|---|---|---|
| Goals (two goals), height at 1200 / 390 | 2,697 / 4,901 (672 wide) | **900 / 900** (390 wide) |
| Goals & Tools with no goals, 1200 / 390 | 900 / 1,311 (goals only) | 1,009 / 1,667 (goal form and the tools) |
| W4 · Meera, house goal | 1 click, 2 typed, two monthly figures | 3 clicks (A home, 3 years, ADD GOAL), **1 typed** (`15L`); "Put aside ₹43,750 a month until Oct 2029 · ON TRACK" before saving |
| W5 · Priya, ₹1L bonus | URL typed, 1 typed, 2 clicks; one target | From Goals & Tools: 1 click to the tool, **1 typed** (`1L`), 1 click (LOG IT); the split shows as you type |

- W5 engine pick: ₹1,00,000 to the card (42%), "debt-free −3 mo · interest −₹67,918" on its slider; KPIs Dec 2030, 3 months sooner. After LOG IT, Home shows ₹29,50,000 owed and Plan Dec 2030, as the preview said.
- MY SPLIT (₹50,000 card, the rest to the house goal): the goal stops at what's left of the pool; Jan 2031, 2 months sooner, ₹50,000 to goals.
- No loans (Meera, ₹1L): all of it to the emergency fund (gap ₹1.5L), not just the plan's 30% share.
- Windfall at 390 with a result: 1,854 px, no sideways scroll. No NaN or sideways scroll on Goals or Windfall for noloans, paidoff, overbudget, us, nri.
