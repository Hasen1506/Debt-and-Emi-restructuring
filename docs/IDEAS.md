# Ideas (not implemented)

Suggestions that came up while implementing the 2026-10-07 roadmap. None of these is built; each needs a yes from the founder first. Newest PR's copy of this file is the full list.

## From PR A (accuracy)
- **Confirm the tax bracket once.** When the bracket is estimated from take-home, show a one-tap "Is 37% right?" chip on Home with Yes / Enter gross pay. An estimate the user has confirmed stops being re-estimated.
- **"Outstanding → after this month" strip on Home.** One line per currency: today's balance, minus this month's principal, plus this month's interest, equals next month's balance, using the same numbers as the schedule footer.
- **Payoff quote letter.** For a loan the plan clears this month, generate the "foreclosure / payoff statement" request to the bank, since the bank's figure (with per-diem interest to the payment day) is what the user must actually send.

## From PR B (FX)
- **Store the rate history.** Keep each day's fetched rate (not just the latest) so the schedule can show what a foreign EMI cost in rupees/dollars in past months, and Activity can value a logged payment at that day's rate.
- **Rate-move alert.** When a foreign loan's converted EMI moves more than a set % since the last plan, say so on Home ("Your ₹ EMI now costs $12 more a month").
- **Server-side daily refresh.** Today the refresh runs when the app opens; a nightly API job could refresh every signed-in profile's rates so a plan opened on a new device is already current.

## From PR C (true APR)
- **True APR does not drive the payoff order in PR C.** It is shown beside the effective rate only. Founder decision (2026-10-07): rank by the forward-looking marginal cost of the next rupee prepaid instead (not the all-in true APR, which includes sunk fees). That is being built as PR J, so this entry is closed by J.
- **APR on offers.** Show the same true-APR breakdown on balance-transfer and consolidation offers, so a "10.5% + 2% fee" offer is compared on one number with the loans it would replace.

## From PR E (your rules)
- **Rule: "keep this loan for the tax break".** A one-tap rule that parks a deductible home or education loan last, with its after-tax rate shown, instead of making the user pin everything else above it.
- **Drag to reorder.** The custom order uses ↑/↓ buttons today; drag handles would be quicker on a phone.
- **Per-rule cost.** Show what each rule costs on its own (pin vs small-first), not only the total against Avalanche, so the user can drop the expensive one.

## From PR D (your own values)
- **One config file for policy constants.** GST, tax slabs, BT/refi hurdles and the cash-advisor floors are still constants in code. A versioned `config/<country>/<FY>.json`, read by engine and web, would make Budget-day updates one file. (The audit's §2 "Assumptions page" is now built for the user's own values; this is the policy side.)
- **"Why this default?" links.** Each default on the Assumptions page could link to where it comes from (SBI 1-yr FD rate, 10-yr Nifty CAGR, the broker's charges) with its as-of date.
- **Per-asset selling cost in the asset form.** The engine accepts `selling_cost_pct` per holding; only the per-type value is editable in the web today.

## From PR I (tools)
- **Next policy date on New debt check.** With Right time gone, a floating-rate offer could still show one quiet line: "The next RBI/Fed decision is on <date>; a floating rate moves with it", from the meeting calendar the app already keeps, with no odds and no wait/borrow verdict.
- **Start a purchase from a goal.** A home or car goal on Goals could open New debt check in purchase mode with its price, date and saved amount filled in.
- **Fold Loan check into New debt check too.** Loan check (is my existing loan's rate fair?) is the third "loan before/after signing" tool; a third mode would leave one place for every loan question.

## From PR J (marginal-cost order)
- **Fee-aware look-ahead for prepayment fees.** A fee charged on each prepaid rupee is a one-off cost whose size depends on when the loan is prepaid, so a per-year figure (fee × 12 / months left, as built) is a good guide but not always the best order: on sampled portfolios with fees, a fixed order beat it about 1 time in 11. A small look-ahead (try the top two loans for the next few months and keep the cheaper) would close the gap.
- **The invest-vs-prepay gate on the same number.** The gate that decides whether extra goes to debt at all still compares the all-in effective rate (sunk fees included) with the after-tax return. Comparing the marginal cost instead would make the two decisions agree.
- **GST on foreclosure charges.** Indian banks add 18% GST to a prepayment/foreclosure fee; neither the order nor the simulator counts it yet.
- **"Why this loan first" on Plan too.** Home and Spare cash show the breakdown; the Plan's schedule could show it beside the first loan, with the second loan's figure for comparison.
