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
