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

Found; being fixed in the next commits.

| # | Bug | Example |
|---|---|---|
| E1 | **Snowball / hybrid invest every spare rupee while a 42% card sits at its minimum.** The invest-vs-prepay check looked only at the first loan in the payoff order; if that loan's rate was below the investment hurdle, all surplus was invested | Car loan 7% (small) + card 42%: avalanche debt-free in 3 months, snowball 26 months with ₹1.5L interest and ₹19L "invested" |
| E2 | **Floating-rate drift never stops and the EMI never rises**, so the loan grows forever | ₹30L home loan, +1%/yr drift: ₹82 crore of interest, never cleared. RBI's 2023 rules require the bank to raise the EMI or extend the tenure, never negative amortisation |
| E3 | **Card minimums leave out the month's interest** for banks whose formula is "interest + x%" (BoA, AmEx, Goldman, SBI Card, Kotak, ICICI) | $5,000 at 24%: minimum $50 while interest is $100 |
| E4 | **The minimums-only comparison keeps a balance flat when the payment doesn't cover interest**, and counts interest the user never paid | Same card: balance stays $5,000 for 24 months; "interest paid" $2,400 while only $1,200 was paid |
| E5 | **Baseline ignores rate resets and drift** that the plan includes, so "interest saved" compares different loans | Any floating loan with a reset date |
| E6 | **Education loan gets an 80E tax saving on the new regime**, where 80E isn't allowed | 10% loan shown as 7% at a 30% bracket |
| E7 | **US mortgage gets a tax saving even when the user doesn't itemise** (most don't); `User.itemises` is never read | 6.5% shown as 4.94% |
| E8 | **FX drift changes the caller's exchange rates**; a second run starts from the drifted rate | INR 0.012 → 0.01179 after one 60-month run |
| E9 | GST on the processing fee is ~0: a yearly *rate* is divided by the balance × years as if it were an amount | 12% + 1% fee: 13.0000% instead of 13.18% |
| E10 | The trajectory's total balance adds ₹ and $ together for NRI users; the default (ledger) plan charts that sum | Any user with loans in two currencies |

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
