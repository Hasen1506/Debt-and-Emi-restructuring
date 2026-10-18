# Intentional differences between engine versions

The differential suite (`engine/tests/test_differential_pre_pr29.py`) runs the
current engine and the pre-PR-29 engine (commit `c753849`, read with
`git archive`) on the same seeded profiles. Every place the two are allowed to
disagree is listed here, with the direction the change must point. A
difference that is not on this list fails the suite: either it is a
regression, or it is a new intended change and belongs here (with a test)
before it merges.

The second differential file (`engine/tests/test_differential_reference.py`)
has no allowed differences: the engine must match an exact-fraction textbook
reference to a millionth of a rupee/dollar (EMI, remaining balance,
flat→reducing) or a ten-thousandth (month-by-month schedules).

## Where the engines must be identical (to 1e-9)

| Domain | Test | Why nothing may change |
|---|---|---|
| One EMI loan in the user's own currency (cards left out since sprint G1, see G1-ADB); no prepayment fee, moratorium or pre-EMI; Indian new regime / US (no tax shield) | `test_single_loan_untouched_inputs_are_identical` (400 profiles) | PR #29 touched none of these inputs |
| Minimums-only baseline on 2–5 own-currency EMI loans (no cards since G1) | `test_multi_loan_baseline_is_identical` (250 profiles) | The baseline never cascades and these loans carry no GST |

## Allowed differences, and the direction each must point

| ID | Change | Old engine (`c753849`) | Current engine | What the test asserts | Test |
|---|---|---|---|---|---|
| H2 | Freed money from a loan that clears walks the whole payoff order | Gave it to the next loan only; anything above that loan's balance was dropped | Keeps walking until it is used up | Total interest never higher, debt-free month never later; at least half the profiles are unchanged (the fix only bites when freed money overflows the next loan) | `test_multi_loan_plan_differs_only_by_the_cascade_fix` |
| P2-13 | 18% GST on Indian card finance charges | Interest without GST | Interest × 1.18 in the cash flow | First month's interest between 1.18 × 2/3 and 1.18× the old figure (since G1 it's on the average daily balance) | `test_indian_card_interest_carries_18pct_gst` |
| M1 | Interest during a moratorium (first EMI 2+ months away) is capitalised | Interest before the first EMI vanished | It accrues onto the balance (simple interest on the principal for an education loan, SBI Student Loan MITC, since G1) | Total interest strictly higher | `test_moratorium_interest_is_capitalised` |
| H4 | A foreign-currency loan with no saved exchange rate is refused | Treated ₹ and $ as 1:1, silently | Engine raises `MissingFxRate`; the API answers 422 | Old engine returns a plan; new engine refuses, for both plan and baseline | `test_foreign_loan_without_rate_is_refused_not_converted_1_to_1` |
| Hike schedule | A salary hike schedule applies on its own | Phases were ignored unless a flat annual hike was also set | Phases raise income as scheduled | Total interest never higher, and lower in at least one profile | `test_hike_schedule_alone_now_raises_income` |
| P2-14 | During pre-EMI the committed payment is the interest only | The full EMI was committed | Interest only | First month's spare cash never lower | `test_pre_emi_minimum_is_interest_only` |
| G1-ADB (sprint G1) | Card interest on the average daily balance: spend carries half a cycle, the payment stops interest on its part for the last third, a card paid in full pays none on new spend | Whole month on balance + spend | `simulation.card_cycle_interest` | US card: first-month and total interest never higher | `test_card_interest_on_the_average_daily_balance` |
| #38 gap borrowing (sprint L2) | A month short of cash is paid from the emergency fund, then borrowed at a card rate (`engine/gap_debt.py`) and repaid first | The gap was assumed found somewhere, free | Gap borrowing charges card interest (GST on Indian cards) and must be repaid before the plan is debt-free | Never short: identical. Short: total interest never lower, debt-free never sooner. The older domains run with `gap_as_debt=False` | `test_short_months_are_borrowed_at_card_rates` |
| Prepayment fee gate (this PR) | A loan whose prepayment fee costs more than the interest the extra payment saves is not prepaid | Prepaid anyway, so the "optimised" plan could cost more than paying minimums | Prepays only when (1 − fee) × (1 + r)^k > 1, k = months the extra would otherwise have grown | The new plan never costs more than its own minimums-only baseline; the old engine did in some seeded profiles | `test_prepayment_fee_gate_never_prepays_at_a_loss` |
| C6 (Audit 80+ C3/C6) | An EMI loan's last contractual month pays whatever is left (banks adjust the final instalment) | The paisa-rounding residual of a quantised EMI ran into an extra month (a 241st payment) | Paid in the contract month | In the two IDENTICAL domains a profile may differ only this way: debt-free never later and at most one month sooner, total interest never higher and lower by at most one month's interest on the residual, Σ 0.005 × ((1 + r/12)^n − 1) + ₹0.01. H2's bound gains the same allowance. The reference differential gives the final month the same top-up and compares schedules with `gap_as_debt=False` (pay = EMI exactly, so the top-up would otherwise be borrowed and repaid a month later) | `test_single_loan_untouched_inputs_are_identical`, `test_multi_loan_baseline_is_identical`, `test_multi_loan_plan_differs_only_by_the_cascade_fix`, `test_differential_reference.py` |

- **E7 (audit 80, 14 Oct 2026): US student loans with no PSLF/IDR answer.**
  A US education loan whose `forgiveness_track` is unset or `"unsure"` gets its
  required payment only; extra is held until the user says it isn't heading
  for forgiveness (`"none"`). The minimums baseline is unchanged; the plan can
  only keep such a loan longer. `test_differential_pre_pr29.py` checks these
  cases on the baseline only (`_us_student_loan_held`).
  `test_differential_reference.py::test_plan_with_surplus_matches_reference`
  gives such a loan no extra in the reference (the spare is kept, as when
  prepaying isn't worth it).

### Also changed in this PR, covered by the property suite rather than the differential one

* **Shortfall leftover.** In a month short of cash, the unused part of a
  clearing loan's minimum now first reduces the shortfall (money the user had
  to find elsewhere) instead of being cascaded onto other loans. Before, a tiny
  prepayment that moved a clearing month could make the plan cost more
  interest. Invariants: `test_lump_sum_prepayment_never_increases_interest`,
  `test_extra_monthly_payment_never_increases_interest`,
  `test_reinvested_refund_never_increases_interest`.
* **Loan amounts keep their cents in the web app** (`formatLoanAmount`,
  `web/src/lib/currency.ts`). A $42,042.04 loan was shown as $42,042.00, so a
  profile's loan rows did not add up to its total. The converted "≈" figure
  is still whole units. Covered by the USA and India golden journeys
  (`web/e2e/`).

PR #29 also applied the user's marginal tax rate to the prepay-vs-invest
hurdle. The differential suite keeps that out of the "identical" domains
(Indian new regime, US) and it is covered by `engine/tests/test_audit_2026_10_07.py`.

## Adding a difference

1. Make the change and see which differential test fails.
2. Add a row above: ID, old vs new behaviour, and the direction it must point.
3. Add (or extend) a `DIRECTION` test in `test_differential_pre_pr29.py` that
   asserts that direction on seeded profiles, and narrow any `IDENTICAL`
   domain the change now touches.
