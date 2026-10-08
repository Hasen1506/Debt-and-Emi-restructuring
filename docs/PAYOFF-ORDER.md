# Payoff order: the marginal cost of the next rupee prepaid

Roadmap PR J, founder decision of 2026-10-07. Avalanche, and the "by rate"
fallback of Your rules, rank loans by what the **next** unit of extra
payment saves on each, looking forward only.

```
marginal cost = (1 + r/12)^12 − 1            interest, compounded monthly
              + GST on that interest          Indian credit cards: 18%
              − tax benefit given up          s.24(b) / s.80E / US §163 mortgage, §221 student loan
              − prepayment fee × 12 / months left
```

* **Sunk costs are out.** The upfront processing fee (and its GST) and
  insurance already paid don't change what the next payment saves.
  `effective_rate` and the true APR still count them: they describe what a
  loan costs in total, not where the next rupee should go.
* **Tax at the margin.** A cap that already binds gives nothing on the
  next rupee: a home loan whose year's interest is over the ₹2L s.24(b)
  cap, US mortgage debt over $750k, US student-loan interest over $2,500.
  Under the cap, the full marginal rate. (The old key used the average
  shield, so a ₹60L home loan at 9% looked like 7.9%; it is 9.38%.)
* **Fee.** A fee charged on each prepaid rupee is spread over the months
  the loan has left (`months left ≤ 0`, an open-ended card: 12).
* **Lock-in.** A loan that can't take an extra payment yet is ranked after
  every open loan (`order_key = total − 100`).

One function, two languages: `engine/marginal_cost.py` and
`web/src/lib/marginal-cost.ts`, kept equal by
`engine/tests/fixtures/marginal_cost_cases.json` (80 formula cases, 448
tax-shield cases, 60 portfolios with their avalanche order;
`scripts/export_marginal_cost_cases.py` regenerates it).

## Where it is used

| Place | Before | Now |
|---|---|---|
| Plan simulation, monthly extra + reinvest cascade (`simulate_plan`) | effective rate | marginal cost |
| Your rules, loans the rules don't place | effective rate | marginal cost |
| Spare cash (`allocate_windfall`, `/api/windfall`) | effective rate | marginal cost, and the rationale gives the breakdown |
| Web strategy orders (`payoff-order.ts`: masthead "same order", rules) | `computeBreakdown().effective` | `userMarginalCosts().orderKey` |
| Home "Pay this month" reason | "it costs the most, X%" | "the next payment saves the most here" + the breakdown ("why this loan first") |

Not changed: the invest-vs-prepay gate (still the effective rate against
the after-tax return) and the true-APR / effective-rate figures shown on
loans.

## Worked example

₹85,000 card at 42%, ₹35L home loan at 8.5% (new regime), $12,000 car
loan at 6.9%:

* card: 51.11% interest compounded + 9.20% GST = **60.31%**
* home: 8.84%, no tax benefit in the new regime = **8.84%**
* car: 7.12% = **7.12%**

## Goldens and fixtures

* Golden E2E (`web/e2e/__golden__`): re-run, **no differences**. Both
  journeys have a card that dominates, and the rest keep their order (India:
  home 8.84% > car 7.12%; USA: card, INR personal 11.57%, mortgage 6.96%
  (no itemising), student loan 5.64% less its §221 tax break).
* Python differential fixtures (`test_differential_reference`,
  `test_differential_pre_pr29`, payoff-rules cases): unchanged; none has a
  fee, a binding cap or a lock-in that reorders its loans.
* On the 60 seeded portfolios of the new fixture, the avalanche order
  differs from the old effective-rate order in **19**, from three causes:
  processing fee / insurance no longer lifting a loan, a binding 24(b) /
  §163 / §221 cap no longer lowering one, and fees / lock-ins now lowering one.

## Prepayment fees: a search, not a rate (PR K)

Founder decision of 2026-10-08: the most accurate order, with fees in the
ranking and in the property test, and no extra friction for people who
don't know their fee.

**Why the per-year fee term isn't enough.** A fee charged on each rupee
prepaid is a one-off whose size depends on *when* the loan is prepaid: its
EMIs shrink what is left to prepay, and a loan that runs out on its own
pays no fee at all. So no per-year rate, the `fee × 12 / months left`
term above included, makes a rate-by-rate (greedy) order optimal. On fee
portfolios sampled on main @ 7f97fc0, a fixed order beat the greedy plan by
more than the rounding slack in 11 of 41 and 7 of 40 (two samples; PR J
measured about 1 in 11 with its own fee generator).

**What the plan does** (`engine/fee_order.py`, called by `simulate_plan`).
When the strategy is Avalanche and an open loan has a fee, the plan is run
for candidate payoff orders on the same simulator and the cheapest is kept:

```
net cost = interest paid (GST on card interest and prepayment fees included)
         − tax the deductible interest saves (marginal rate; ₹2L 24(b) and
           $2,500 §221 caps applied per plan year)
```

* **Up to 5 open loans: exact.** Every order (at most 5! = 120 plan runs,
  about 11 ms each) plus the greedy plan; the plan is never worse than the
  best fixed order.
* **6 or more: greedy plus local swaps.** The greedy plan and the
  rate-only order, then a local search from the better one: swap any two
  loans, or move a loan with a fee to any position; repeat while it gets
  cheaper (at most 6 rounds). Every order of 6–7 loans would be 720–5,040
  runs (about 8–60 s for one plan), too slow per request.
* **Ties** keep the greedy plan, then the rate-only order; another order
  wins only when it is cheaper by more than ₹1 / $1.
* Only Avalanche searches. Your rules and Snowball are the user's own
  order; Spare cash still ranks one payment by marginal cost and checks
  the fee against the interest it saves.

**"Why this loan first".** When the kept plan puts its extra on the loans
in a different order than ranking by rate alone (the marginal cost without
its fee term), the plan returns `payoff_order_note` and Home's "Pay this
month" adds it, e.g.: "A prepayment fee changed this order. By rate alone
the extra would go to your Alpha personal loan (13%) before your Beta
personal loan (12%), but its 5% fee on every amount prepaid costs more than
the interest that prepaying it early saves. Putting the extra on your Beta
personal loan first saves about ₹3,447 over the plan, fees included."

**No friction: what a blank fee means** (`engine/prepayment_fee.py`,
`web/src/lib/prepayment-fee.ts`, one table in
`engine/tests/fixtures/prepayment_fee_defaults.json`). The field stays
optional and never blocks.

| Loan | Blank fee means | Shown as |
|---|---|---|
| India, floating rate, not a card | 0% | "0 (assumed)" + "Assumed 0%: RBI bars prepayment charges on floating-rate loans to individuals (not for business) (RBI Directions, 2 July 2025)." |
| Fixed rate, credit card, or a US loan | no fee assumed (0% in the math) | "Not known" + "Not known, so no fee is assumed. If you can, check your loan agreement or Key Facts Statement for a prepayment charge." |

Source, verified on rbi.org.in on 2026-10-08: **Reserve Bank of India
(Pre-payment Charges on Loans) Directions, 2025**, RBI/2025-26/64,
DoR.MCS.REC.38/01.01.001/2025-26, **July 2, 2025**, para 5(i): "For all
loans granted for purposes other than business to individuals, with or
without co-obligant(s), an RE shall not levy pre-payment charges" (on all
floating rate loans and advances; part or full prepayment, any source of
funds, no lock-in, 5(iii)). It covers loans sanctioned or renewed from
1 January 2026; earlier loans are covered by the circulars it repeals for
their period, e.g. DBOD.Dir.BC.No.110/13.03.00/2013-14 of May 7, 2014
(banks: no foreclosure charges / pre-payment penalties on floating rate
term loans to individual borrowers).
https://www.rbi.org.in/Scripts/NotificationUser.aspx?Id=12878&Mode=0 ·
https://www.rbi.org.in/Scripts/NotificationUser.aspx?Id=8868&Mode=0

No lender-specific fee is ever assumed. The Profile's click-to-fill chip
(per-bank "industry norm" fees in `engine/rate_cards.py`, marked
indicative) is now offered only where no rule fixes the fee, and
`lookup_loan_terms` no longer lets a bank entry put a fee on a
floating-rate Indian loan.

## Property

`test_property_marginal_order_is_at_least_as_good_as_the_best_fixed_order`:
on 2–4 loan portfolios (IN and US, cards with GST, deductible loans under
their caps, sunk fees, lock-ins, and since PR K **prepayment fees of
0.5–5% on about half the loans**), the Avalanche plan's interest net of tax
(fees included) is never more than the best of every fixed order (brute
force over all permutations, run through the same simulator). Four fee
portfolios on which PR J's greedy order lost are kept as fixed regression
cases (`FEE_REGRESSIONS`), and they fail on main @ 7f97fc0.
