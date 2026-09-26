# Bug hunt and user-view audit (26 Sep 2026)

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

- **Recompute and the /plan sliders run a plainer simulation than /plan
  itself** (no plan start month, planned resets, goals, emergency-fund
  split or inflation setting), so their "old debt-free date" can differ
  from the one /plan shows. They should call the same simulation with
  the same settings.
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
- **Below the 87A line the true marginal rate is 0**: a new-regime earner
  at ₹10L pays no tax, but the engine (and now the web) report 10.4%. It
  matters for after-tax investment returns in invest-vs-prepay.
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
3. **Mixed-currency loan tables**: the debts table formats every loan in
   the home currency, so a $25k loan shows as ₹25,000 for an NRI.
4. **Card minimums count as "extra"** in the /plan schedule when a card's
   scheduled EMI is 0.
5. **Hosting**: both Render services are on the free plan, which sleeps
   after 15 minutes; the first visit after that waits 30–60 s. That is
   the only slow thing measured (see ROADMAP §1).
