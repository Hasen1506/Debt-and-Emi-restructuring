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

## Property

`test_property_marginal_order_is_at_least_as_good_as_the_best_fixed_order`:
on 2–4 loan portfolios (IN and US, cards with GST, deductible loans under
their caps, sunk fees, lock-ins), the marginal-cost plan's interest net of
tax is never more than the best of every fixed order (brute force over all
permutations, run through the same simulator). Prepayment fees are left
out of that property on purpose: a per-rupee fee is a one-off whose size
depends on *when* the loan is prepaid, so no per-year rate makes a greedy
order optimal. On sampled fee portfolios a fixed order beat the marginal
order in about 1 in 11 (the old effective-rate order: about 1 in 5). See
docs/IDEAS.md ("Fee-aware look-ahead").
