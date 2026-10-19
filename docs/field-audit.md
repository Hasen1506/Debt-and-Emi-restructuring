# Which questions to ask once

Counted on 19 Oct 2026 from the round-2 walk of every control (`field-matrix.csv`): **350 controls, 295 unique labels**. Setup is **3 steps** (`SETUP · 3 STEPS`). A first run with one Indian home loan asked **9** things before the plan: take-home, spending, kind of loan, balance, rate, EMI, whether this month's EMI has gone out, an emergency fund, and the payoff order.

After this change the first run is still **3 steps** and asks **8** things. The rate is no longer an empty box. The other number (months, if they typed the EMI, or the EMI, if they typed the months) is shown filled in, and they can change it. The same walk, run again on 19 Oct 2026 after the cuts, saw **335 controls and 280 unique labels**. The 15 labels that left the walk are the rare loan inputs now under More options, and the closed credit-report line, which is no longer a checkbox.

The 295 labels fall into four groups. The groups sum to 295.

| Group | Labels | What it means |
| --- | ---: | --- |
| Asked once, on the screen that owns the fact | 171 | Take-home, spending, the balance, the EMI (or the months), goals, activity, a sale, a new loan, loan-check's starting rate. Nothing earlier can answer them. |
| The same control counted on a second screen | 29 | Plan and Recompute (Recompute opens the plan), Can't pay and US letters, or the same assets form drawn twice. One question. |
| Filled in, and still editable | 25 | The rate, a computed EMI or tenure, tax rate, savings, credit score, taxable income, money for loans this month, and a line read from the credit report. |
| Not on the first run | 70 | Fees, insurance, pre-EMI, lock-in, reset schedule and payment status (these start under More options), plus assumptions, deduction lines and exchange-rate extras, which already live on their own screens. |

## What changed

The sums above are the walk before the cuts. The product changes, and what a person no longer has to type:

1. **One loan question, not two.** On setup, picking the kind of loan fills the rate with the middle of the published rates of the banks RightDue tracks (as of 10 Oct 2026). Those ranges already sit on the RBI repo rate of 5.50% from 7 Oct 2026, plus each bank's spread, so the box is not the repo rate itself. The hint says it is typical and can be wrong. Clearing it brings back "I don't know the rate". Typing a real rate replaces the estimate. Profile does the same when the loan type changes and the rate is still blank or still an estimate.
2. **EMI and months stand in for each other.** Whichever one is typed, the other is shown as a number they can edit. On the profile, an empty EMI with a balance, a rate and months left is the EMI the schedule works out, and an empty tenure is the months the EMI implies. Saving an untouched computed EMI stores that EMI. Cards and pay-later have no tenure, so nothing is invented for them.
3. **A saved loan is not typed again.** Loan check, Sell to repay, and NRI prepay open on the loan they picked: balance, rate and months (and the EMI, where that page used it) are one line with EDIT. Taxable income, the tax rate, savings and the credit score stay filled from the profile. A loan that is not saved yet still asks.
4. **Rare loan inputs start closed.** On the profile loan, the balance, the rate, fixed or floating, the tenure and the EMI stay open. "+ More options" hides the reset schedule, the prepayment fee, the lock-in, how often a prepayment is allowed, pre-EMI months, whether the money was for a house, salary deduction, payment status, the processing fee and the insurance premium. On a card it hides revolving spend, the statement day, the last 4 digits, whose card it is, and the due day. Setup already kept currency, fixed or floating, and the lock-in behind "+ More terms".
5. **Nothing that did nothing.** A closed credit-report line was a checkbox that could not be ticked. It now reads "Closed, nothing to add". Recompute is not a second form: it opens the plan.

What was left on purpose: the letter, the goals, activity, and each tool's own question (what you'd sell, the offer, the starting rate on a loan check). Those are the first time that fact is needed. The calculations are unchanged; the same EMI formula as the engine fills the box.

## Leftovers decided the same day

- The plan chart stops at the month the plan clears. The minimums date stays in the caption.
- The collapsed schedule says "Showing N of M months" and the button is "Show all".
- Spend less: a typed amount stays exact, the drag steps ₹500, and +/− move ₹100.
- The debt choice is "EMIs + all spare cash" (or "Payments + all spare cash" in dollars).
- A windfall slider moves without MY SPLIT. The cushion takes the difference.
- What-if and the calculators stay on this visit only, and say "Not saved".
- Can't-pay answers, including a letter edited by hand, stay in the account and in this browser. START OVER clears that country. RESET TO DRAFT only drops the hand edit.
