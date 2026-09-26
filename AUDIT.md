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

In progress. Found so far:

- **Dead controls.** [CSV] and [PRINT] on the plan chart, the schedule and
  the home page do nothing; [EXPLORE] in the restructure table does
  nothing; its BREAKEVEN column is always "—".
- **Developer text shown to users.** Home: "FULL TRAJECTORY LIVES ON /PLAN
  — NEEDS THE SIMULATION ENGINE".
- **Restructure table hides what to do.** It shows "BALANCE TRANSFER
  49.56% → 3.00%" but not which loan or which bank; the headline and
  rationale the engine writes are dropped in the ledger skin.
- **"Saves/yr" means different things.** Refinance: first-year gross
  saving with no fees; its headline: lifetime saving net of fees.
  Balance transfer: saving over the promo only (6 months), labelled a year.
- **Plan start picker** only moves when salary hikes land. The dates,
  balances and schedule ignore it.
- **Three places answer "should I refinance?"** with different rules:
  the /plan restructure scan (1.5 pp above the market median, 1% assumed
  costs), Loan Check's offer comparison (the real quote, the owed cut,
  ₹10,000 margin), and the Right Time tool.
