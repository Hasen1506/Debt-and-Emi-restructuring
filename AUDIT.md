# Bug hunt and user-view audit (26 Sep 2026)

## PR 21 follow-up · 3 Oct 2026

The merged PR was reviewed through the engine, API and browser. This
follow-up fixes five reproduced findings and the related save/payment gaps:

| Finding | Corrected behavior |
|---|---|
| Consolidation kept the expensive card's opening share after the plan cleared it | Compare the original and replacement repayment schedules with the same strategy, debt budget, emergency fund, goals and life events. The audited 720-score case is held back as costing about ₹7,135 more in the first year. Older path-only clients use each loan's own balance and rate |
| Saving a spending cut left the debt budget unchanged | Reduce expenses and raise an existing debt budget together, preserving cents. Preview reduces the same expense bucket, follows expense inflation, and leaves salary rises/resets intact |
| Activity used the original ₹9,500 EMI for a ₹1,012 final payment | Use the plan's capped payment in due rows, Mark paid, and Other amount; keep the original minimum only to detect stale profile edits |
| The strategy picker promised equal outcomes from today's ordering | Describe the shared starting order and explain that future balances, rates and loans can change the result. The rate-reset regression changes interest from ₹32,580 to ₹34,638 |
| Refinance explanation retained an old tenure-based saving | Rebuild headline, explanation and detail from the same repayment comparison; omit lifetime claims when the horizon does not reach payoff |

Related safeguards: failed expense/profile/budget/log writes roll back the
entire spending cut; profile, budget and commitment reach account storage
in one atomic patch; undo restores both values and refuses to overwrite
later edits. Closed loans are excluded, known closing penalties are included,
and consolidation uses a nominal quoted rate plus a separate up-front fee
with the same 36-month term prefilled in its update dialog. Full-plan API
requests validate matching profiles and derive authoritative balance paths
on the server, avoiding oversized duplicate trajectory payloads.

Validation: 790 Python tests with `FUZZ_FULL=1`, 73 web regression tests,
TypeScript, lint and production build; 40 existing browser scenarios and
9 new audit regressions. The existing four lint warnings remain. Browser
checks use a local auth-bypassed web/API pair with rate feeds disabled;
production OTP delivery and live lender-rate accuracy are outside this
verification. Current lender pages were retried: HDFC returned 403 and the
SBI personal-loan URL returned 404. The rate-card verification item below
remains open; these fixes do not relabel May rates as current quotes.

To rerun the new browser regressions, start the API with `RATES_FEED=off
MARKET_ODDS=off RATE_LIMITS=off` and the web with
`NEXT_PUBLIC_DISABLE_AUTH=true NEXT_PUBLIC_API_BASE_URL=http://localhost:8000`.
With Playwright and Chromium installed, run:

```sh
BASE_URL=http://127.0.0.1:3000 node scripts/pr21-regressions.cjs
```

`PLAYWRIGHT_MODULE`, `CHROME_PATH` and `AUDIT_OUTPUT` optionally select an
external Playwright installation, Chromium executable and JSON report path.

What was checked, what was wrong, and what was done about it. Each bug
was reproduced with real numbers before it was fixed. "Fixed" items name
the commit area; "Proposed" items need a product decision and are listed
for the owner.

## 1 · The debt chart on /plan (and the dates around it)

| # | What the user saw | Cause | Status |
|---|---|---|---|
| C1 | "JUL 2029 · CLEAR" drawn at the far right (2046), not where the plan's line reaches zero | The marker sat on the chart's last point, which is where the *minimums* line ends | Fixed: marker and a guide line at the debt-free month |
| C2 | A solid line along the top of the chart that looks like a third series that never falls | The top gridline was drawn solid and in ink | Fixed: only the zero line is solid |
| C3 | On a phone the chart was ~80 px tall with 3 px text | Fixed 800-wide viewBox scaled down to 314 px | Fixed: drawn at the real width; 3 date labels on phones; compact amounts (₹35.7L) on the axis |
| C4 | Every date was one month late: debt-free "Jul 2029" was Jun 2029; the schedule's month 3 said Dec when it is Nov | Month 1 is the current month, but labels added N months instead of N − 1 (5 places) | Fixed: one helper, `monthIndexToDate` |
| C5 | Goal milestones would have moved a month early with that fix | Goals count months from now, plan months start at 1 | Fixed alongside C4 |
| C6 | "In 1 month, your last EMI clears" when it clears this month | Same off-by-one | Fixed: says "This month" |
| C7 | Schedule table: two columns both headed "HDFC BAN" | Header was the bank name cut to 8 letters | Fixed: "HOME · HDFC", "CARD · HDFC" |
| C8 | A loan cleared in month 1 never got its ★ in the schedule | No earlier row to compare with | Fixed: compares with today's balance |
| C9 | Per-loan chart axis started at "M0", the total chart at "m1", for the same month | Off-by-one in one chart | Fixed |
| C10 | The chart had no text for screen readers | — | Fixed: spoken summary with both clear dates |

## 2 · Engine bugs (simulation, tax shield, minimums)

All reproduced, fixed, and covered by `engine/tests/test_audit_fixes.py`
plus API tests in `api/tests/test_simulation.py`.

| # | Bug | Example | Fix |
|---|---|---|---|
| E1 | **Snowball / hybrid invested every spare rupee while a 42% card sat at its minimum.** The invest-vs-prepay check looked only at the first loan in the payoff order | Car loan 7% (small) + card 42%: avalanche debt-free in 3 months, snowball 26 months with ₹1.5L interest and ₹19L "invested" | Extra goes to the first loan in order that beats the hurdle; invest only if none does |
| E2 | **Floating-rate drift never stopped and the EMI never rose**, so the loan grew forever | ₹30L home loan, +1%/yr drift: ₹82 crore of interest, never cleared | A rise raises the EMI to keep the end date (RBI 2023: no negative amortisation); a cut keeps the EMI; drift stops ±3 points from the start |
| E3 | **Card minimums left out the month's interest** for "interest + x%" formulas (BoA, AmEx, Goldman, SBI Card, Kotak, ICICI) | $5,000 at 24%: minimum $50 against $100 of interest | The month's interest is passed in: $150 |
| E4 | **Minimums-only comparison kept a balance flat when the payment didn't cover interest**, and booked interest never paid | Balance flat at $5,000 for 24 months; "interest" $2,400 while $1,200 was paid | Unpaid interest is added to the balance; totals equal what was paid |
| E5 | **Minimums-only comparison ignored rate resets, drift and pre-EMI** that the plan included | Any floating loan with a reset date | It now runs the plan's own month loop (`minimums_only`); /plan sends it the same planned resets |
| E6 | **Education loan got an 80E saving on the new regime**, where 80E isn't allowed | 10% shown as 7% at a 30% bracket | No shield on the new regime (or when the regime is unknown) |
| E7 | **US mortgage got a tax saving even for people who don't itemise**; `User.itemises` was never read and the web never sent it | 6.5% shown as 4.94% | Shield only for itemisers; the API works it out from the deductions entered (or the mortgage's own interest) against the 2026 standard deduction |
| E8 | **FX drift changed the caller's exchange rates**; a second run started from the drifted rate | INR 0.012 → 0.01179 after one run | The simulation works on its own copy |
| E9 | GST on the processing fee was ~0 (a yearly rate divided again by balance × years) | 12% + 1% fee: 13.00% instead of 13.18% | 18% of the fee rate |
| E10 | The trajectory's total balance added ₹ and $ as plain numbers; the default (ledger) plan charts that total | ₹40L + $25k = "4,025,000" | Total is in the user's currency at that month's rate |

### Tools, surplus and the /plan sliders (fixed)

| # | Bug | Example | Fix |
|---|---|---|---|
| D1 | **Windfall had E1's bug**: under snowball it said "invest it" while a 42% card was open, because a small 7% loan came first; its reason always said "highest effective rate" | ₹1L windfall, car 7% + card 42%, snowball | First loan in order that beats the fund; reason names the order used |
| D2 | **Windfall and Recompute always used avalanche**, even when the user picked snowball on /plan | — | Both send the order saved on /plan |
| D3 | **Job-loss slider did nothing.** It took the lost pay out of `savings_balance`, which the simulation never reads | 6-month job loss: 42 months, ₹5.16L interest, same as no job loss | No take-home for those months, then back: 47 months, ₹6.65L |
| D4 | **Rate-shock slider grew the loan without limit** (E2 by another route) | +4 points, no surplus: ₹30L loan to ₹7.5 crore | Applied as a rate reset, so the EMI rises |
| D5 | **More money went out than came in** once a card was in the plan: the surplus counted the card minimum without its interest, the payment included it | $8k income, $5k costs: over $3k paid some months | The surplus uses the same minimum as the payment; a cash test checks every month |
| D6 | **Emergency fund never filled.** The top-up was "gap ÷ 12" recalculated each month, so it shrank as the fund grew: 65% after a year, trickling for years while holding back debt payments | ₹1.2L gap: ₹10k in month 1, ₹3.5k by month 12 | A fixed ₹10k a month until full |
| D7 | Right Time charged the expected cut on the whole principal every year, about double for a long loan, and printed ₹ for US users and "±-10bps" | ₹5L, 3 years, 0.5% cut: ₹7,500 (really ₹4,300), so it said "wait" | EMI difference × months; user's currency; "-10bps" |
| D8 | Cash Yield's "beats prepaying" compared the fund's *gain* with the loan's *whole* rate, so prepaying always looked better; its amount had no currency sign | Cash at 3%, fund 8%, loan 6%: said "prepay" | Fund rate vs loan rate, amount in ₹/$ |

Consistency gaps still open:

- ~~Recompute and the /plan sliders run a plainer simulation than /plan~~
  Fixed 26 Sep (§4, P1).
- **Right Time ignores whether the loan is floating.** A floating loan
  (most Indian home loans) moves with the repo rate anyway, so waiting
  for a cut only matters for fixed-rate loans or to avoid a reset lag.

### Same formulas kept in two places (fixed)

| # | Problem | Fix |
|---|---|---|
| T1 | **Three sets of tax tables that disagreed.** Engine: India FY2026-27, US 2026. `web/src/lib/tax-brackets.ts`: labelled "FY 2026-27" but held India's 2024 slabs (30% from ₹15L) and US 2025 figures. `web/src/lib/deductions.ts`: India 2024, US 2024 ($14,600 standard deduction). Onboarding saves the marginal rate from the last one, so an ₹18L salaried user on the new regime was planned at **30% instead of 20.8%** | The engine's tables are exported to `web/src/lib/tax-tables.json` (`scripts/export_tax_tables.py`); both web modules read it; `engine/tests/test_tax_tables_export.py` fails if it falls behind. Web and engine now give identical tax and marginal rates (checked at ₹10L, ₹18L, ₹30L, old and new regime, US $120k) |
| T2 | The web's marginal rate left out surcharge and cess; its deduction saving ignored the 87A rebate (a ₹1.5L 80C claim that takes ₹6L under the ₹5L rebate line saves ₹33,800, not ₹30,000) | One tax function per country (`incomeTaxIN`, `federalTaxUS`) used everywhere |
| T3 | US standard deduction was applied only to salaried users | Every US filer gets it |
| T4 | **The browser's copy of the effective-rate formula** (`web/src/lib/effective-apr.ts`, used by home, debts, portfolio, insights, invest-vs-prepay) had E6, E7 and E9 | Fixed the same way; screens with a user pass `usItemises(user)`, which mirrors the API's rule |
| T5 | Two exported functions named `deriveMarginalRate`, one unused | Unused one removed |

Still open (owner):

- **SALT cap** is $10,000 in the engine and the web. The 2025 US budget law
  raised it (about $40,000 for 2025–2029, phased down for high incomes).
  Tax figures are cited law, so this waits for a pasted source. The
  engine's US head-of-household table is also marked "approx" in a comment.
- ~~Below the 87A line the true marginal rate is 0~~ Fixed 26 Sep, with
  the missing marginal relief above the line (§4, T6–T7).
- Profiles saved before this fix keep their stored 30% marginal rate
  until the user re-saves onboarding.

## 3 · User-view audit

Each page read as a user would, asking: what is this for, is it said
twice, and does it agree with the rest of the app?

### Fixed

| # | What the user saw | Fix |
|---|---|---|
| U1 | **"Saves/yr" meant three things.** Balance transfer: the saving during the promo, after the fee. Refinance: a year's rate difference with no costs, while its headline gave a lifetime figure. Consolidation: the fee was multiplied into the rate (12% × 1.0033), so it all but vanished | One measure everywhere: **interest saved in the first 12 months, minus the one-time cost**. Each move also shows its one-time cost and the month it pays back; refinance adds "over the rest of the loan". The consolidation fee is added to the rate |
| U2 | **The top-line "saves ₹X/yr" counted a card twice** when it could be balance-transferred or folded into a consolidation loan | The total takes the biggest saving first and skips moves that touch a loan already counted (₹1.85L → ₹1.50L in the test book) |
| U3 | **Restructure table hid what to do**: no loan, no bank; BREAKEVEN always "—"; [EXPLORE] did nothing | Columns: loan, move to (bank + kind), rate, one-time cost, pays back in, saves in year 1. Under each: the one-line action, the eligibility note and "I took this" (all three existed in the other skins, not in ledger) |
| U4 | Balance transfer suggested **moving an HDFC card balance to HDFC**; banks don't take transfers from their own cards | The card's own bank is never the target ("HDFC", "HDFC Bank Ltd." match) |
| U5 | Refinance said "replace your HDFC home loan with a cheaper one from HDFC" | Same bank reads as "ask HDFC to move your home loan to the rate it offers new borrowers"; floating Indian home loans point to Loan Check first (part of the gap may be cuts already owed) |
| U6 | The scan's comment said personal and education loans are checked for refinance; the gate only allows home and car, so the loop did nothing for them | Loop matches the gate; comment corrected |
| U7 | **Home told an over-budget user to pay a whole loan off as "extra"** (with no surplus it fell back to the balance: "PAY ₹80,000 EXTRA") | With no surplus: "Pay the minimums · find ₹X/mo" |
| U8 | Home's "saves ~₹X/yr" was the whole balance's interest, not what the suggested payment saves (₹65,800 extra → "₹39,648/yr") | Interest the extra avoids: ₹32,610 |
| U9 | **Home's loan table marked the 8.5% home loan "PAY EXTRA" and the 49.6% card "AUTO"**, the opposite of the card above it (it assumed row 1 was the dearest) | The dearest loan is "PAY EXTRA", the rest "MINIMUM" |
| U10 | Two columns, EFFECTIVE and POST-TAX, always showed the same number | POST-TAX removed |
| U11 | Placeholders: "FULL TRAJECTORY LIVES ON /PLAN — NEEDS THE SIMULATION ENGINE", "DEBT-FREE → SEE /PLAN · NEEDS SIMULATION", a **made-up ★★★★☆ rating**, "CLEAR · BAND — P10 → P90" that never had a value | Removed; the debt-free cell says "See plan → date + monthly schedule" |
| U12 | Dead [CSV] and [PRINT] on the home page and the /plan chart | Removed; on the schedule they now work (CSV of every month, print) |
| U13 | "WHY?" and "SHOW MATH ↓" both went to /plan; "show formula ↓" went to /plan, where there is no formula | One "Why? See the plan →"; the rate breakdown links to /debts, where it is |
| U14 | "Effective APR", "real rate", "post-tax", "weighted" on one screen for one idea | "Effective rate", explained once as "after fees + tax" |
| U15 | **14 rate fields asked for decimals** ("0.30 for 30%") while others took percentages, sometimes on the same form (life events: reset rate in %, new loan rate in decimal) | Every rate field takes a percentage; the value saved is unchanged |
| U16 | **The schedule's month 1 was all interest, no principal** (worked out from the balance change, with no month 0) | Uses the engine's interest for each month |
| U17 | **CSV dates a month early in India**: `toISOString()` turns local midnight on the 1st into the previous day in UTC. Same slip in five "today" checks (advance-tax, life events) between midnight and 05:30 | Local dates throughout (`localIsoDate`) |
| U18 | **Pages scrolled sideways on a 390 px phone**: /plan (the 4-up summary strip, the restructure table), home (10 tools in 7 columns), and seven tools (fixed 2- and 3-column forms) | Grids wrap to fewer columns on narrow screens (`fitColumns`); wide tables scroll inside a labelled region. All 19 pages checked fit at 390 px |

### Owner decisions, done (26 Sep 2026)

1. **One skin: Ledger.** Editorial and Default are deleted. What they
   carried that earns its place now renders in Ledger (strategy switcher,
   plain-worded assumptions, the real what-if panel, key dates, surplus
   split, invest-vs-prepay, advance tax, life events, per-loan rate
   breakdown, sign-in/out); duplicates were dropped (list in
   `LEDGER_MISSING.md`). Ledger's "live engine" sliders were made-up
   formulas and are replaced by the engine-backed what-if.
2. **Merged tools.** Recompute → /plan's what-if ("Paid extra, or about
   to?"); Windfall + Cash Yield → **Spare cash** (emergency-fund share at the
   plan's split, where to park it, the rest to the loan the engine picks).
   Old links redirect.
3. **Plan start picker removed.** The plan starts this month from the
   balances entered; the picker only moved the hike month.
4. **Debt-free date on home.** The plan run costs 6–35 ms, so home runs the
   same loader as /plan and streams in the date and this month's move.

Found while doing these (fixed):

| # | Where | Problem |
|---|---|---|
| W1 | Engine | The emergency fund got a fixed gap/12 top-up *plus* the slider's share; at 0%, or with any goal, the slider was ignored. The split is now the only top-up when given. |
| W2 | /plan | Monthly outlay counted the emergency-fund share as a debt payment; the surplus split's header and slices used different surpluses. |
| W3 | Home | "This month" guessed "whole surplus to the highest-rate loan" three ways, ignoring the strategy and the split; now it is the plan's month 1. A NEXT ACTION box repeated the card under it. |
| W4 | /debts | "VS NEXT" compared the dearest loan with list position 2 (could be itself); "BALANCE TRANSFER" offered on any loan; empty CASH MANAGEMENT header; "HDFC Bank: HDFC Bank". |
| W5 | Spare cash | Windfall logged the payment against the highest-rate loan whatever the strategy chose; score estimate used the first card and the Indian model. |
| W6 | Setup | **Every new user crashed on step 2** (`new Decimal('')` on a blank income stream). A blank-safe `dec()` now backs every form-value conversion. |
| W7 | Setup | Ended on /debts (now home); cards flagged "never updated" seconds after entry; an info button inside a button; "never uploaded" wasn't true once signed in. |
| W8 | Tax | The ₹50k senior 80D cap applied from age 50; seniors are 60+. Standard cap until there's a 60+ bracket. |
| W9 | Inputs | Eight more fields took decimals (fees, insurance, rate drift, state tax, asset return, savings yield, growth); Purchase asked for "YYYY-MM" as text. |
| W10 | Tools | Headers read "§8B" (spec numbering); Invest vs prepay ignored the profile (India, 11%, 30%). |
| W11 | Chrome | Home's mode toggles showed on every page; Goals and Portfolio had no nav link; no favicon. |

### Still for the owner to decide

1. **"Should I refinance?" still has three rules**: the /plan restructure
   scan (1.5 points over the market median, 1% assumed costs), Loan
   Check's offer comparison (the real quote, ₹10,000 margin) and Right
   Time (expected rate cut). One engine for all three would remove the
   disagreement.
2. **Home has three modes** (simple, detailed, calm). Detailed adds little
   over simple; merging them leaves one home plus the calm view.
3. ~~Mixed-currency loan tables~~ Done 26 Sep (§4, W14).
4. ~~Card minimums count as "extra"~~ Done 26 Sep (§4, W15).
5. **Hosting**: both Render services are on the free plan, which sleeps
   after 15 minutes; the first visit after that waits 30–60 s. That is
   the only slow thing measured (see ROADMAP §1).

## 4 · Second sweep: untouched engines, odd inputs, odd profiles (26 Sep 2026)

The five engines no earlier pass had read (goals, credit score,
cross-border, penalties, asset sales), every decision endpoint with
boundary inputs, and home / plan / debts / goals / insights / portfolio
under five profiles: no loans, every loan paid off, over budget, US, and
an Indian user with a dollar loan. Each bug reproduced with numbers
first; each fix has a test (672 pass).

### Engines

| # | Bug | Example | Fix |
|---|---|---|---|
| A1 | **Property seller charged stamp duty + registration** (the buyer's costs in India) | ₹1 crore flat: ₹8.5L of "selling costs" instead of ₹1.5L brokerage; ~₹7L of proceeds missing | Seller pays brokerage only; the state no longer matters, so the field is gone from Liquidate and setup |
| A2 | **Property held ≤ 24 months taxed as long-term** | Held 13 months, ₹8.5L gain: 12.5% instead of the slab rate | Short-term at the slab rate; caveat says waiting past 2 years moves it to 12.5% |
| A3 | **Liquidate sent "2024-25" as this year's FY** | Pre-2024 flats got too little indexation, so too much tax | The API works out both FYs |
| A4 | **Cess added twice** on debt funds, short-term gold and SGB | ₹1L gain at 31.2%: ₹32,448 instead of ₹31,200 | The profile's rate already includes cess |
| A5 | An FD with no break penalty was charged 1% | 0% entered → ₹1,000 on ₹1L | 0 stays 0 |
| A6 | Hold-vs-sell dropped part years | A 0.5-year horizon compared nothing | Compounds the part year |
| S1 | **Rising card use predicted no score change** | 10% → 70% utilisation: 0 points | Mirrors the same-size drop (−52 to −32) |
| S2 | Paying off a card with nothing on it: +5 to +10 points | — | 0 |
| S3 | A US score of 880 was accepted (FICO tops out at 850); /score-band took any number | — | 422 |
| X1 | Cross-border took an FX rate of 0 or below, or 300%/yr drift | EMI shown as 0 or negative | Bounded |
| R1 | Right time: "No meaningful change expected (−50bps)" when a real cut was too small or too far off | ₹5L loan, 50bps cut: saves ₹4,180 | Says which: "saves only ~₹4,180" / "expected in 12 months" |
| R2 | Urgency took any text ("whenever" = urgent); recompute with a loan that isn't there said "saves nothing" | — | 422 naming the field |
| T6 | **New-regime marginal relief missing** | ₹12.1L taxable: ₹63,960 tax instead of ₹10,400 | Engine and web cap the tax at the income above ₹12L |
| T7 | Marginal rate 10.4% (new) / 5.2% (old) below the 87A line, where no tax is due | ₹10L earner's tax shield and investment tax drag | 0 at or below the line |

### Plan and pages

| # | What the user saw | Fix |
|---|---|---|
| W12 | **Every loan paid off → home and /debts crashed** (no "dearest loan") | Paid-off loans aren't open positions; home and /debts say DEBT-FREE; /plan shows a debt-free page instead of "NOT IN LIFETIME", an outlay with no loans and an empty chart |
| W13 | A paid-off loan's EMI was still taken out of the surplus (browser and the engine's /plan snapshot) | ₹53,300 shown as ₹43,047 while the plan itself used ₹53,300 |
| W14 | **Mixed currencies** (was "to decide 3"): a $25k loan read ₹25,000; TOTAL EMI, monthly interest and the plan's outlay added ₹ and $ as plain numbers | Rows in each loan's currency; totals converted ("TOTAL IN INR") |
| W15 | **Card minimums counted as extra** (was "to decide 4"), and a cleared loan's EMI kept being subtracted from "extra" | The engine reports each month's total and extra (above each loan's minimum) in the user's currency; schedule and outlay use them |
| W16 | "₹-29,200/MO"; a blank amount made the formatter throw | "−₹29,200"; blank reads 0 |
| P1 | **What-if ran a plainer plan than /plan** (no planned events, EF split, goals, rising costs, refunds, activity-adjusted balances), so "before" could differ from the plan's date | Compare takes the same plan fields as /simulate, built by one function; /plan passes its run settings to the panel |
| W17 | Seniors never got the ₹50,000 80D cap ("50+" mixed 50–59 with 60+) | 50–59 and 60+ brackets; 60+ gets the senior cap |

Checked and fine: the goals engine (serial fill, expiry, deferred start),
penalties, windfall with no loans / more cash than debt, new-debt with a
cash price above the list price, zero income, 0% EMI loans, EMI below the
interest, a card with no EMI, a ₹100 crore balance, ten loans.


---

## 5 · Outside review: advice from missing or assumed data (26 Sep 2026)

An outside reviewer ran six first-time-user profiles over 18 routes, the
main tool forms, activity logging and a 375 px screen. The ordinary
home-loan path worked; these gave confident advice from data nobody
entered. All fixed in the PR after the first merge.

| # | What the user saw | Fix |
|---|---|---|
| O1 | **A blank rate or EMI became a 0% loan.** A ₹1 lakh card with no rate: home said invest ₹30,000 and showed Jul 2033. A ₹20 lakh home loan with neither: 0% and "not in lifetime" | Setup asks each loan for its rate (a card's above 0) and an instalment loan's EMI, with the error under the field. Saved profiles missing them: home, /plan and the table name what to add; no projection |
| O2 | **A cash shortfall still got a payoff date.** ₹30,000 in, ₹34,000 costs, ₹1 lakh card: "find ₹4,000/mo", debt-free Jul 2042 | The engine reports each month's shortfall (costs + minimums − income, ₹9,000 here); card minimums count in the web surplus; home and /plan say "no date yet · short ₹9,000/mo" and what it's made of |
| O3 | **Activity's Sec 24 note ignored the regime**: a new-regime self-occupied loan "saved ₹68,250" and went "from 8.75% to 8.75%" | Uses the deduction the plan counts (none under the new regime, ₹2 lakh cap under the old) and says when there is none |
| O4 | **"Confirm all · no changes" logged a ₹0 card payment as "paid in full"**, kept after reload | Logs only open loans with an EMI; cards are left for the user to log |
| O5 | **Right time assumed a 50 bps cut in 3 months** (and a ₹50 lakh loan): "Wait, save ₹3,69,508" in one click | Expected change and amount start blank and are required; months come from the RBI/Fed calendar with the date shown; the verdict states the expectation |
| O6 | Purchase Advisor suggested "price ≤ ₹20 lakh" and "down payment ≥ 20%", the values entered, and a bigger down payment when saving it was the problem | Each lever appears only when it fixes something: the highest price that fits both, the extra months, a bigger down payment only if it can be saved by the date |
| O7 | Liquidate gave "Sell the asset, ₹9.77 lakh ahead" for a sample property the user never entered | Starts blank; debt and income from the profile; required fields; the verdict names its growth assumption |
| O8 | New Debt Check assumed a 720 score and a ₹3 lakh loan: "Take the EMI" on the first click | Amounts blank; score from the profile or blank (no score estimate then); says when it used a typical rate |
| O9 | Spare cash: ₹85,000 off a 34% card "avoids ₹2,408 over the loan's life", one month's interest | A card is paid down at the usual payment or the bank's minimum (₹1,07,909 at the minimum); the page says which |
| O10 | NRI tool opened on a ₹35 lakh sample loan; ₹→₹ failed with a 502 | Opens on the profile's loan with its yield and tax rate; the same currency is 1 without a fetch |
| O11 | An empty goal read "₹0 required" and "can't be funded" | No verdict until an amount is entered; empty goals aren't sent to the plan |
| O12 | No debt meant no way through setup (to goals, portfolio, purchase planning); separate Savings and Credit steps | Loans can be left empty; home offers goals, a purchase, portfolio; credit score sits on the Savings step (five steps) |

Not verified by the reviewer or here: sign-in and database sync, and a
public deployment.

## 6 · Round-2 user audit (27 Sep 2026)

A second outside audit of `main` at 550f8b7, using a local build with sign-in
disabled, a controlled FX response, reloads and a CSV export. All eight are
fixed on the PR after the second merge.

| # | What the user saw | Fix |
|---|---|---|
| R1 (P0) | **NRI amounts in the wrong currency**: a ₹20 lakh SBI home loan for a US resident gave "PAY EXTRA: $480,000", "$20,000/mo comes back", "clears $2,000,000", and a Wells Fargo refinance | Each loan's amounts are shown in its own currency with the user-currency value alongside, on home's move, /plan's clear dates, the freed-cash note and the schedule. Refinance, balance transfer and consolidation look for lenders in the loan currency's market, merge only same-currency loans, and return savings in the user's currency |
| R2 (P0) | **A failed FX fetch treated ₹ as $**: a −$14,000 shortfall next to a four-month payoff, with no warning | Setup asks for the rate for each foreign currency, filled from today's quote. When the quote fails, the rate must be entered before Continue. Every page uses that saved rate. A profile without one gets no projection, and home, /debts and /plan ask for the rate |
| R3 (P0) | **"Take the EMI" for a $7,294 EMI** on $4,500 income, $3,200 costs and a $12k card, with "add to profile" | The tool sends the monthly room from the profile (income − costs − current payments). An EMI above it gets "Can't afford the EMI" with the gap and no add button, or "Pay cash" when savings cover the price. "Take" says what the EMI leaves each month |
| R4 (P1) | **Nine loans didn't save**: the one-cookie profile passed ~4 KB, and a reload restarted setup | The profile cookie is compressed with lz-string: nine loans take 1.6 KB, forty take 3.6 KB. Past 3.8 KB it is split across numbered cookies (ninety loans take two). It is read back after saving; on a failed save the old cookies are restored and the user is told |
| R5 (P1) | **The US mortgage shield jumped** from 6.75% at $230k to 4.73% at $240k, and /plan said "no loan tax deductions" | Only interest above the standard deduction is shielded, as a share of the mortgage interest: $350k gives 6.11%. Engine, API and web use the same share. The tax-refund projection is worked out with the toggle off too, so its label matches |
| R6 (P1) | **Invest vs Prepay taxed Treasury interest at 80%** whatever the user's rate (5.00% → 1.00% at 0% tax); the 5.00% default was undated; /plan worked it out another way | Each instrument says how it is taxed: the user's rate or a share of it (a Treasury pays ~80% of it, as state tax doesn't apply), a flat capital-gains rate, or none. The tool and /plan use one function and one set of default yields, each with its date and source. The Treasury default is the 4.50% 1-yr par yield of 25 Sep 2026. Within a point of the loan, the tool asks for today's yield (or to use the default anyway) before a verdict, and /plan says to check it. 4.80% loan, 0% tax: 4.50% → 4.50%, "check the yield" |
| R7 (P2) | **Setup saved −5% and 500% rates**, which the engine rejects, and the plan said "unreachable" | Rates below 0 or above 100% a year (the API's bounds) get an error at the field in setup, the restructure modal and life events, and aren't saved. A profile saved earlier with one gets no projection, and home and /plan ask for "a valid interest rate (500% isn't accepted)" |
| R8 (P3) | **US users were sent to Loan Check**, which is India-only | Each tool names the countries it covers. A US home lists seven tools; /tools shows Loan Check as "INDIA ONLY" with no link |

The plan CSV's `pay_loan,pay_loan` headers were fixed with R1: each column now
has a position, type, lender and currency.

## 7 · Rounds 4 and 5 user audits (27 Sep 2026)

Two more outside audits of `main` at 3c2ed00 (the round-2 merge), using a
local build with sign-in disabled, seeded Activity storage and a mocked
quote. Round 4 covered the tools, round 5 Activity, Setup edits, Portfolio
and debt-free Goals. All twelve are fixed on the PR after the third merge.

| # | What the user saw | Fix |
|---|---|---|
| A1 (P0) | **NRI Prepay saved a ₹20 lakh loan as $2,000,000**, with a $17,356 EMI and an $11,356 monthly shortfall on home | The added loan is tagged with its currency and the rate used goes into the profile when it has none: home shows ₹20,00,000 (≈ $20,833), EMI ₹17,356 (≈ $181). A currency the profile can't hold (GBP, EUR…) or a foreign loan with no rate is declined with a note. Each tool's add button says Added only when the profile saved |
| A2 (P0) | **US Liquidate applied India's LTCG** ($31,817.50 on a $100k→$350k sale), Maharashtra costs, and Finance Act, surcharge, 80EEA and RBI text | A US sale goes through the engine's US path: 0/15/20% federal long-term rate, NIIT, state rate, US selling costs, and the §121 exclusion. The form asks whether it's a main home before a verdict. Its hints, defaults (HYSA yield, 2.5% inflation) and tax label are US ones. The result lists how the tax was worked out: $33,300 as a rental, $0 as a qualifying main home |
| A3 (P0) | **Right-Time said "Borrow now"** for a $7,294 EMI on $1,060 of monthly room, and offered to add it | The page sends the profile's monthly room. An EMI above it gets "Can't afford the EMI" with the gap, keeps the timing view as a note, and has no add button. A loan that fits says what it leaves. With no profile the verdict says it judged the timing only |
| A4 (P1) | **Spare cash sent ₹20,000 to a loan in a three-month lock-in** and ignored its 5% fee | The plan's gates apply: a locked loan (or one in pre-EMI) is passed over and named. With every loan locked, the page says keep it in savings. A fee comes out of the payment as in the plan: ₹1,000 of ₹20,000, "₹7,362 saved after fee". A fee above the saving rules the loan out, and a part-payment limit is noted. Setup's lock-in field now says it counts months from now |
| A5 (P1) | **Liquidate's five-year "keep" compounded the whole ₹1 lakh for five years**, though the loan's EMI clears it | With the loan's monthly payment (from the picked loan, or entered), both paths spend it each month. Keeping the asset pays the loan down and then invests the payment; selling invests it from month one. Without a payment, the old sum is labelled a stress case. The ranker uses each loan's EMI. A loan in another currency is converted at the saved rate |
| A6 (P2) | **"Selling leaves you 25,404 worse off"** beside Edge +₹25,404 | A positive edge below the 10% margin reads "only 25,404 better off, below the 35,000 it should gain"; the page shows the margin |
| A7 (P0) | **Removing HDFC moved its ₹19,000 payment onto ICICI** (and ICICI's balance fell ₹10,000); an ICICI entry could drop out instead | Loans have stable ids, given on save and once to older profiles when the app loads (while positions still match). Entries carry the id and are pointed at the loan's current position when read, so a removed loan's entries attach to nothing. Planned rate resets use the id too |
| A8 (P1) | **The 21st payment didn't move the plan**: the cookie kept the newest 20 entries | The cookie holds one total per loan (by id), compressed: 21 × ₹1,000 now gives −₹21,000. The plan's banner says "logged payments" and "−₹10,000", not "missed/partial" and "+−" |
| A9 (P0) | **An INR 100 quote counted as $100**, so 10 shares showed $1,000 | A quote in another currency is converted at today's rate (else the profile's saved rate), with its currency, rate and date beside it: $10.40. With no rate it isn't added, and the page says why. Pence and cent quotes (GBp, ZAc) count in pounds and rand |
| A10 (P2) | **A quantity of −5 was accepted** and took $500 off the total | Quantity must be a number above zero; the message says shorts aren't tracked |
| A11 (P2) | **The Portfolio headline said "no holdings"** beside a holding until a reload | Each add, refresh or removal redraws it. It no longer rounds to whole units and prints ".00" ($10.40 read $10.00) |
| A12 (P2) | **Debt-free Goals said "open /plan for the full projection"**; /plan shows "No debts on file" | With no loan to project, the goal says what to put aside each month, and the header links home |

Also from round 5, noted but not scored: "Confirm EMIs paid" leaves the plan
unchanged because the plan already counts scheduled EMIs. The bar now says
so, and to update the Setup balance if it predates the EMI.

## 8 · Redesign finish: walkthroughs and the phone pass (2 Oct 2026)

R7 of [REDESIGN.md](REDESIGN.md) ran all six walkthroughs on the finished
redesign and loaded every page at 390 px with five profiles. What they turned
up, all fixed on the R7 PR:

| # | What the user saw | Fix |
|---|---|---|
| F1 (P0) | **One asset saved without a purchase date stopped the plan**: every request carrying the profile, /simulate included, returned 422 | The API takes a blank date and leaves that asset out of the engine's list (its sale can't be taxed without one); the rest runs. The assets form won't save without a date or year, and says so at the field. A test covers the 422 |
| F2 (P1) | **The persona art was cropped and crude**: drawn at 3:2 for 2:1 cards, so feet, the god and the big snowball were cut off; bodies were loose polygons; the 40 px medallions blurred | Redrawn at 2:1 with pictogram figures and flat planes, one idea per scene; medallions cut down to read at 32 px; the unused glyphs removed |
| F3 (P2) | Setup's plan preview showed **"$4,044.00", "$2,783.03"** | Whole amounts, as on every other page |
| F4 (P2) | A user with **no loans** was told "Order: Avalanche … Change it on Plan" | The line shows only with loans, and points to the switch at the top of each page |
| F5 (P2) | **Two wordings for the same orders**: "pure psychological momentum", "then math" beside the personas' rules | One line each, in the personas' words |
| F6 (P2) | Activity said **"plan debt-free MAR 2031 · no change"** | "plan still debt-free in Mar 2031" |
| F7 (P1) | **/profile/assets was 484 px wide on a phone** | Its grid drops to one column |
| F8 (P1) | **Tap targets 11–16 px tall** across the app (every bracket link and button, the tabs, sliders, the "i" tips) | At least 24 px to a finger without moving the layout (`.l-hit`); rows of brackets spaced so their areas don't overlap |
| F9 (P2) | On a phone the tabs ran to two lines, and Home repeated the payoff order just below the masthead that shows it | Tabs fit one line (tighter tracking under 480 px); Home's line drops the order |

**Still open**
- Plan converts foreign loans at the rate saved in setup, which goes stale. NRI prepay already starts from today's rate. Proposed: refresh the saved rate when today's can be fetched, and say on Plan which day's rate it used.
- `/profile/assets` has its copy and capitals fixed but still uses the old form styling (rounded boxes); it should move to Ledger fields.
- The medallion's three pips are 14×10. They pass WCAG 2.5.8 because the medallion beside them opens the same three choices as full-width buttons; on a phone the medallion is the easier tap.
- Polymarket, frankfurter and open.er-api are blocked from the build container, so Right time's odds and the live exchange rate need a first look once deployed.

## 9 · Owner feedback (2 Oct 2026)

Reproduced with a new user: ₹1.5L take-home, ₹60k spending, a ₹2L personal loan at 14% and an ₹80k card at 42%.

| # | What the owner saw | Cause | Fix |
|---|---|---|---|
| F1 | A payment bigger than what's owed | Home called ₹80,500 on an ₹80,000 card PAYS IT OFF, judged against the opening balance; the month's interest left ₹2,300 owing | The label reads the engine's balance after the month; extra rows say what's still owed |
| F2 | "Total to pay" didn't match Plan's amount; who decides the emergency fund? | The plan put every rupee of spare cash on debts and offered no choice | `debt_budget` in the engine (EMIs + minimums + extra a month, the rest stays with the user, freed EMIs still roll forward). TO DEBTS chip on Plan; Home says how much is extra and links to it; the emergency fund is offered, not imposed |
| F3 | Changing strategy changes nothing | With the card both the smallest and the dearest debt, all three orders are the same | The switch says "Same plan: all three pay Credit card first, then Personal loan" |
| F4 | The bonus tool said "Failed to fetch" | Free-plan API asleep: the host answers 502/503 without CORS headers while it wakes | Browser calculations retry for about 30 seconds, then say so in words; sign-in and reports aren't retried |
| F5 | Plan takes seconds to load | Not the engine (about 50 ms for all calls) or the page (0.05–0.6 s warm): both free-plan services sleep after 15 minutes | Owner decision: an always-on plan for the API at least |
| — | Spare cash said "emergency fund = full" with no fund set | — | Says none is set |

### Walking every page as a user

The owner asked for a pass as a user: does each section say what it is, and does any link strand you? Findings and fixes:

| # | What was confusing | Fix |
|---|---|---|
| U1 | Plan's pay-rise link opened one Profile section with no way to see the rest or go back | Profile shows "← Back to Plan" (or wherever you came from), a strip of every part (edits carry across), and the link lands on the hike field. Banks moved to the Savings part, where the summary lists them |
| U2 | "$" before every heading read as dollars on a rupee plan; "OCT 26" read as 26 October; "STMT #1138" meant nothing; "Avalanche" didn't say what it switches; "[IN · ₹]" did nothing | Prompt glyph gone; months read OCT 2026 (OCT '26 on the chart axis); STMT and "/ LEDGER" gone; the switch is labelled PAYOFF ORDER; the pin says INDIA · ₹ and opens Profile |
| U3 | Activity listed the card at its ₹4,000 minimum while Home said to pay ₹80,500; its PAID / OTHER were small brackets | Activity takes the plan's own payment for the month (same cached run as Home) and records it as Home does; same big buttons |
| U4 | "Open positions" is trading talk; the card-balance reminder floated between two sections and said "(never)" | Your loans and cards, with where the numbers come from; the reminder sits inside it and says "not updated since you added it" |
| U5 | Plan's "Cash flow restoring soon" said ₹9,500 comes back "in 3 months" beside a KPI saying 4 months, and urged "pre-decide" with jargon buttons (Goal SIP, Boost EF) | "After your last payment": names the month and the whole ₹90,000 a month now going to debts; offers Save for a goal / Set an emergency fund / Try it in What if, without telling the user which |
| U6 | Goal priority "Save for it first" read as before debts | "Against your other goals: Before the others / Soonest date first"; "start from a plan" is "start from a template" |
| U7 | Tools hard to notice (small OPEN at the far right, a 10px "[← ALL TOOLS]") | Whole-row links on Goals with each tool's name; Home ends with "Something came up?" listing every question; each tool ends with the other tools. This brings back a tools list on Home, which the redesign had removed |

### Honest numbers and clearer pictures (H1, D1)

| # | What was wrong | Fix |
|---|---|---|
| H1a | Cheaper rates promised ₹18,624 a year for moving an ₹80,000 card the plan pays off this month, with no word on whose rate it was or whether the user would get it | Savings use the balances the plan leaves each month; a move the plan makes pointless is listed under "looked at, not worth it now" with why. Each offer names the bank, says it is the advertised rate and when it was last checked, and what the user's credit score means. The Profile score now counts: below what lenders usually take (CIBIL 700 / FICO 670 unsecured) the move is held back; a middling score prices a loan at the middle of the bank's range. Engine text uses Indian grouping |
| H1b | "Rising costs +4.6%" gave no source, and could not be changed; a second set of defaults (5.5% / 3.0%) in the code disagreed | One source: RBI's forecast for 2026–27 (5.0%, 5 Aug 2026) or the Fed's median for 2027 (2.3%, 16 Sep 2026), said on the chip. "Your own rate" sets it; saving a rate turns rising costs on. Invest-vs-prepay uses the same rate |
| H1c | Plan note: "So spare cash goes to the loan, after an emergency fund" read as an instruction; the emergency-fund split's help showed engine variable names and a file path | The note says why the plan pays the loan and where to keep cash aside if you'd rather; the help is in plain words and says the amount is your call |
| D1a | What if showed "→ DEBT-FREE −1 MO → INTEREST −₹17,420" and nothing to judge the size by | "Debt-free 1 month sooner · ₹17,420 less interest", then two pairs of bars: the debt-free date and the interest paid, on your plan and with the change |
| D1b | Goals' progress was an 8-character text bar squeezed under the amount; "GOALS NEED ₹0/MO" showed in red when every goal was on track and just starts after the debts | A real bar the width of the SAVED SO FAR column; "TO GOALS NOW · NOT YET · SAVING STARTS JAN 2027, AFTER DEBTS" |
| F6 | Found by the full fuzz run: an asset sale with an empty purchase date crashed (500); Right time's 422 had no field/message | Both return a 422 naming the field |

Still to check: HDFC's "0% for 6 months + 1.5% fee" balance transfer and the other rate cards are as noted in May 2026; they need checking against the banks' current pages (part of the tool accuracy pass).

### Tool results and their numbers (U1 tools, A1 part 1, 3 Oct 2026)

Each tool run as the ₹1.5 lakh take-home user (₹2 lakh personal loan at 14%, ₹80,000 card at 42%).

| # | What was wrong | Fix |
|---|---|---|
| A1a | Liquidate: picking the card left its monthly payment blank, so "keep it" assumed the card went unpaid for five years at 42%. Selling a ₹40 lakh flat to clear ₹80,000 came out "Sell it" | The EMI, or the card's minimum, fills the payment; the same case now reads "Keep it". When the loan is a small part of what a sale raises, the answer says the rest is the asset against spare cash |
| A1b | Liquidate: shares, funds or gold opened from the ranker were taxed as property (24 months, indexation, stamp-duty costs). The hint said "a year is enough", which is wrong for Indian property | The API taxes each asset by its own rules (shares: 12.5% above ₹1.25 lakh after a year, plus cess); the page says it works out a property sale unless opened from your assets, and gives 2 years for Indian property. "Net gain" was the cash left after the loan and is named so |
| A1c | CII for 2025-26 and 2026-27 were provisional guesses (380, 397). CBDT notified 376 (1 Jul 2025) and 384 (15 Jul 2026): the guesses overstated indexed cost and understated tax on pre-2024 property | Table updated; 2027-28 is the only provisional year |
| A1d | Safe rates were May 2026 guesses from before RBI's cuts: FD 7.10%, T-bill 7.0%, liquid fund 6.8%, US savings 4.5% | Dated September quotes: 1-year FD 6.25% (SBI, HDFC Bank), 364-day T-bill 5.91% (RBI auction 9 Sep 2026), liquid fund about 6.5%, top US savings about 4.25%. Setup, Profile, Liquidate and the idle-cash check read the same numbers |
| A1e | Quick setup's tax rate was the bare slab: 20% at ₹1.5 lakh take-home where Profile said 20.8% (with cess), and 10% inside the 87A rebate where Profile said 0 | One calculation for both |
| A1f | Purchase started loans at hard-coded rates: a car at 10.5% (banks' middle about 9.0%), "something else" at 11% (personal loans about 15.5%), and Indian rates for US users | Starts at the middle of the big banks' advertised rates for that loan and country, and says so |
| A1g | Prices rose at an old 4.6% in Liquidate (and the API default) | The central bank's forecast or the user's own rate |
| A1h | Bank lists in New debt and Right time showed 28 Indian banks as "published rates"; 22 of them were estimated from their peers, not read off the bank | Only the 6 banks whose advertised ranges were noted are listed, with the date (14 May 2026) and "check before you apply". New debt takes a rate you were quoted, as Right time does |
| U1a | New debt said "fees included" with no fee entered, and its bank list wasn't cheapest first before an amount was typed | "No fee entered" and how to add one; sorted by rate |
| U1b | Purchase said "10.50% after tax" for a car loan with no tax break; future years listed 2036 first | "At 9.00%, no tax break"; this year first |

### Remaining tools and pages (U1 pages, A1 part 2, 3 Oct 2026)

Loan check with an SBI loan from June 2022 (7.55%, now 8.90%); NRI prepay as a US earner with a ₹40 lakh SBI loan; Spare cash with ₹1.5 lakh; then Profile's loans, setup, Activity's log and Portfolio at 390px.

| # | What was wrong | Fix |
|---|---|---|
| A1i | Loan check said the loan "started at 7.55% when the repo rate was 4.00%": the repo was 4.40–4.90% in June 2022. The engine takes the lowest of the two months before, in case the rate was fixed at sanction (the cautious figure), but didn't say so. THE MATH showed "repo rate = 26 Sep 2026", a date under a rate's name; rate cards were dated "2026-05-14" | The finding names the start month and why the lowest rate is used; THE MATH shows today's repo rate (5.25%) with its source; dates read 14 May 2026. The rate history itself checks out: RBI 5.25% since 5 Dec 2025, next decision 7 Oct; Fed 3.75–4.00% after the 16 Sep 2026 rise |
| A1j | NRI prepay took the rupee as flat against every currency but the dollar, so a Dubai or London earner's loan looked dearer than history suggests (nudging to prepay) | The rupee's 20-year slide for each currency offered, rounded: AED and USD 3%, EUR 3%, AUD 3%, GBP 2%, CAD 2.5%, SGD 4.5% a year (the dirham is pegged to the dollar). The help says the trend depends on the currency |
| A1k | A missing exchange rate kept NRI prepay on "Fetching today's rate…" for 30 seconds: the browser retried the API's own "provider unavailable" answer as if the host were waking | Only a non-JSON 502/503/504 (the host's page) is retried; the profile's rate fills in at once |
| A1l | Spare cash and Home showed the card at 42.00% and the reason as "Highest effective rate (49.56%)"; NRI prepay's reason read "every unit clears debt at the higher rate" | "The dearest debt left: 42.00% a year, 49.56% counting GST on the interest"; plain reasons in NRI prepay; one loan is "your only loan" |
| U1c | Profile's loan and card boxes were 583px wide on a 390px phone, cutting off the right column | Columns fold to one on a phone |
| U1d | A card showed loan-only fields (rate type, prepayment fee, lock-in, part-payment gap, processing fee, insurance), and its help said "/plan", "/portfolio", "drives the trajectory" and "(unspecified bank)… (country default)" | Hidden for cards; help in plain words; the minimum is "the usual rule" with today's estimate as the placeholder |
| U1e | Activity's log: "Rate" and "New rate" had no unit; the date was a bare "From" | "% a year"; "Starting from" |
| U1f | Portfolio opened with the credit card (a debt) above what you own; two "add" paths (by value, by ticker) weren't told apart; "the sell-to-repay tool" and "Find what to liquidate" named a tool that doesn't exist under that name | Cards move to the end under "Your cards · what you owe on them"; the empty state says which path is which; the action asks the tool's own question |

Setup (three steps, 390px) needed nothing: the tax bracket (16% on ₹1.2 lakh take-home, new regime), the debt-free date and the first month's numbers all check out.

### Last of the accuracy pass (A1 part 3, 3 Oct 2026)

| # | What was wrong | Fix |
|---|---|---|
| A1m | Purchase said cars lose "15–25% the first year and about half by year 5" with no source, and told anyone on a loan over 5 years they'd "owe more than it is worth for most of the loan". With the usual 15% down that isn't true: on a 7-year loan at 9% the balance stays below the car's value throughout | Each country's published figures: in India, IRDAI's value table for insurance (15% off after a year, 50% by year 5); in the US, Carfax (about 20% in the first year, about 60% in five). The second warning is worked out from the user's own price, down payment, rate and term, and names the months they would owe more than the car is worth (0% down for 7 years in India: the first 19 months), or doesn't appear |
| A1n | Spare cash's 1-year Treasury default was 4.5%, dated 25 Sep 2026 | 4.54%, the close on 30 Sep 2026 |
| A1o | The US rate cards gave personal-loan rates for Chase and Bank of America (neither makes personal loans; Chase lends only against a card's limit), Goldman Sachs (stopped in 2023) and Ally (sold its lending arm in 2024), and a mortgage range for Ally (no applications since 31 Jan 2025). The cheapest US consolidation target, the one Plan's refinance suggestion names, was Chase at 6.99%: a loan the user can't get | Those ranges removed (a test keeps them out); Discover, which still lends under Capital One, starts at 6.99%. The cheapest target is now Wells Fargo at 7.49% |

**Rate cards: not yet re-verified.** Spot checks on 3 Oct 2026 (rate-comparison sites; the banks' own pages are blocked from this container) found the May figures out of date. SBI home loans now 7.25–8.55% (card: 7.50–8.70%); SBI Xpress Credit 11.15–14.30% (card: 10.30–14.85%); HDFC personal loans 9.99–24% with a ₹6,500 fee (card: 10.50–24%, 0.5%); SBI's home loan fee 0.35% capped at ₹10,000 (card: 0.5%). The comparison sites also disagree with each other (HDFC home loans 7.75–13.20% on one, 8.70–9.10% on another), so the cards were not rewritten from them. Needed: the banks' rate pages allowed in this environment's network settings, then one pass over all six Indian and six US cards. (Products a lender no longer offers are already gone: A1o.)

## 10 · What the app assumes, and the month after payday (3 Oct 2026)

The owner's questions: spending isn't the same every month; someone opening the app after payday has paid some EMIs and not others, and doesn't know which month or balance the app means; most people can't say whether a loan is fixed or floating (let alone RLLR or MCLR), and then wonder whether to wait for a rate decision; where should modelling (pay rises, the debt-free date) sit; and what else is made up, and how is it corrected.

### Where things go

- **Home (first page) is this month:** what to pay, what's already paid, what's owed now, and the debt-free date with what it rests on ("at ₹70,000/mo to debts, rates as today").
- **Plan (second page) is the modelling:** the choices (payoff order, total to debts, pay rises, rising costs), what the plan takes as given (below), life events, what if.

### Fixed

| # | What was wrong | Fix |
|---|---|---|
| M1 | A balance typed in an earlier month was taken as already having that month's EMI off; one typed this month as still owing it. At the turn of the month one of the two was wrong: an EMI paid before setup was asked for again on Home and the plan ran a month ahead, or an EMI still to come was never taken off (a ₹2,40,000 loan stayed at ₹2,40,000 in November) | Setup and Profile ask "Has October's EMI gone out?" (PAID ALREADY / NOT YET) for each EMI loan whose balance is new or changed, and save the answer with the balance. The roll-forward counts the EMI once either way; balances saved before keep the old reading. Paid already: recorded in Activity, so Home shows it paid |
| M1b | Home's loan list showed the start-of-month balance whatever had been paid, and Pay this month said ALL DONE once the EMI was in though the plan's ₹60,000 extra wasn't | Each loan says whether this month's EMI is paid (AFTER OCT EMI / OCT EMI TO PAY / PART-PAID / NOT PAID) and shows what's owed now; the totals follow. EMI paid without the extra reads EMI PAID with MARK EXTRA PAID |
| M1c | Setup's preview (₹8,940 interest) and Plan (₹9,310) disagreed | The preview uses Plan's balances |
| M1d | Plan's Activity note: "The engine bumped your loan balances… from your /activity ledger", shown even when nothing changed a balance; "$ AFTER YOUR LAST PAYMENT" on a rupee plan | Plain words, only when the log changed a balance; the leftover "$" label prefix is gone |
| M2 | Every new loan started as fixed, under setup's optional terms. Most Indian bank home loans are floating (repo-linked since Oct 2019), so What if's rate rise passed them by and Plan showed no reset dates | "Fixed or floating rate" with Not sure (taken as the usual: Indian bank home and education loans floating; personal, car, gold, pay-later and US mortgages fixed) and how to tell (the loan letter's "Type of interest", or an EMI or tenure that changed without asking). Loans saved before keep their type; Profile and Plan flag one that differs from the usual |
| M3 | The plan's data and guesses weren't said anywhere: balance dates, rates held at today's, card new spending of ₹0, the card minimum rule, spending flat, no new loans | Plan: "What this plan takes as given", each row YOU SAID / ASSUMED / CHECK with where to change it; a stale balance (a card over 45 days, a loan over 120) or an old "fixed" home loan opens the list |
| M4 | The plan assumes the same spending, so the same total to debts, every month; real months vary, and nothing set what was actually paid beside the plan | Plan: "What you've paid", the last three months from Activity beside the plan's monthly total. A month counts once every running EMI loan has an entry; one-off sums (a bonus, a sale, a loan closed) are kept apart. With two full months the plan is run again at the average: "At ₹57,233 a month you'd be debt-free in Jun 2035, 4 yrs later", with USE ₹57,233 A MONTH (or RAISE MY TOTAL when paying more than a set total) and UPDATE SPENDING. Home's date adds the date at that pace when it differs. After the month turns, Home rewrites the activity cookie so the months move on |
| M5 | Plan gave the RBI / Fed rate and meeting date, and near a meeting told everyone to hold off a big prepayment, though a prepayment saves interest from the day it's made and an existing floating loan follows on its own | "If RBI moves rates": each loan that follows it, with the months a quarter point adds or takes off at the same EMI (what banks usually do) and the EMI change if the months are kept, from its reset on file or "within three months if repo-linked, six to twelve if MCLR"; US cards the interest change, from the next statement. Fixed loans (and Indian cards) are named as unaffected. "Do you need to wait?": not for loans you have or a prepayment; a decision matters for a new loan or a switch. Plan's givens link to it |
| M6 | A loan added from New debt (dated today) paid an EMI in the plan's first month, so the plan ran an EMI ahead and Home asked for an EMI not yet due; a planned loan in Life events paid one in the month it arrived | The engine takes the month of the first EMI: before it a loan is owed but neither accrues nor pays. New debt's loans and a planned loan's first EMI are the month after; Setup and Profile's EMI question has NEW LOAN · FIRST EMI IN NOV; Home says FIRST EMI IN NOV |
| M6b | Profile listed repo-linked loans as resetting monthly (RBI's rule is at least every three months), asked for the next reset as YYYY-MM while the pages read a full date ("undefined NOV"), and dropped an expected rate change silently when the reset frequency was left at "not sure" | Options say every three months (most repo-linked), six or twelve (MCLR), and US adjustable / HELOC; the next reset is a date (an old YYYY-MM reads as the 1st); an expected change with no reset on file applies every three months (US yearly) |

### Known limits

- "What you've paid" knows a loan from when its balance was entered or first logged. A loan whose balance was re-entered later isn't expected in earlier months, so a month with it unlogged can still count. One-offs are told apart by their source tag (Windfall, Liquidate) or a loan closed.
- The pace needs two fully logged months, so a new user sees "Once two months have every loan's payment logged…" for the first two months.
- Rate cards still need the banks' sites allowed in the environment's network settings (§9).
