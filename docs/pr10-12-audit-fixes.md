# RightDue: combined PR 10–12 audit and fixes

Reviewed on 2026-10-02 against main `54870ec` (merged PRs #10, #11 and #12). The changes preserve the redesigned pages and fix the behavior underneath them.

## Earlier Plan findings

All seven findings from the previous Plan review still reproduced on current main. Each is fixed and covered by browser regression checks.

| Finding | User-visible correction |
| --- | --- |
| Native mortgage tax shield relabeled in residence currency | Decimal conversion and the converted threshold determine whether the note appears. Missing FX cannot produce a misleading amount. |
| Closed loan reset rows and hidden rate targets | Notes, schedule and forms use eligible open loans. Saves resolve stable IDs against the latest profile, including unique legacy profiles before ID migration. |
| What-if result survives changed strategy/assumptions | Recompute from the current base; cancelled or older requests cannot replace newer results or restore a cleared result. |
| Future spending cut changes today's budget immediately | Future cuts are clearly previews. Saving is available for an immediate cut only, with stale-budget and failed-save checks. |
| Ignoring a pay rise loses its configuration/control | Configured annual and phase-only rises remain visible and can be included again. Fractional rises remain usable. |
| A future loan clears on arrival without a payoff milestone | An actual payment plus a zero closing balance produces the milestone. Missing or truncated data cannot imply repayment. |
| A rate increase's payoff delay appears favorable | Delay and added interest both use the adverse styling. |

Adjacent Plan fixes include actual expense/payment caps, native loan balance caps, cents, loan identity after reordering, removed targets, and preservation of credit score and tax metadata.

## Activity, Goals, Windfall and tools

| Area | Confirmed issue and fix |
| --- | --- |
| Activity payment status | A small payment could be recorded as paid in full. Full/partial/extra/payoff now validate their respective amounts. |
| Activity precision and spending | Payment and budget cents were rounded away; zero spending was rejected. Both now persist exactly. |
| Activity save failure | Storage failure could leave a success row in the UI. The ledger and its plan projection save together before the UI confirms success. |
| Payment targets | A stale deleted or closed target could receive a payment. Saves use current loan IDs and reject unavailable targets. |
| Regular EMI after a windfall | An extra with no regular EMI component hid the outstanding EMI. It now stays due. |
| Spare cash already counted by the plan | Saving before the preview completed could count planned surplus twice. Saving waits for the baseline; the held amount keeps cents. |
| Windfall to goals | Goal allocations remained in spendable savings, or failed to debit the funding account. Allocations now include the goal reserve in cash conservation. |
| Partial cash saves | Failed contribution storage or payment cookies could leave a cash action partially recorded. The local records, projection cookies and profile are checked together and rolled back on failure. |
| Changed split and duplicate logging | A reduced total could retain a stale manual split, and profile refresh could re-enable a logged action. Amount changes clear the split; a logged action remains disabled. |
| Goal saves | UI success could precede storage; a new goal and its initial contribution could save separately. Verified transactions precede UI updates, including rollback with blocked cookies or quota. |
| Goal affordability | Closed loans, card minimums and foreign-currency EMIs were miscounted. Affordability now shares the profile metrics and avoids inventing surplus without FX. |
| Goal spending cuts | Copy promised next month while the budget changed immediately. The action now explicitly says from now and validates the current budget/month; failed saves leave no decision log. Undo rejects a newer budget. |
| Aged balances | Tools could use original balances while Plan used balances after completed EMIs. Client advice now shares the aging step; tool prefills follow hydration. Saving unrelated Setup changes preserves balance anchors. |
| Stale advice | NRI advice/payment actions and loan-check complaints/offers could remain after edits. Result fingerprints invalidate obsolete advice; payoff also verifies the current profile and saved currency. |
| Asynchronous Windfall results | Older split/preview/parking responses could survive new inputs or clearing. Cancelled effects cannot restore obsolete results. |

Money put toward goals by Windfall is tracked as a separate **Goal reserve** asset and excluded from spendable savings. This preserves tracked wealth without allowing that cash to be allocated twice. It records the user's allocation; it does not transfer money at a bank.

## Verification

- Engine/API suite: **718 passed** against this backend; no Python application changes in this patch.
- Frontend regression suite: **26 passed**, including existing tests and new financial, storage, FX, balance-aging and ID-migration regressions.
- Plan browser suite: **37/37 passed**.
- Activity/Goals/Windfall/tools browser suite: **40/40 passed**. Together: **77/77 browser groups**.
- The layout matrix covers 13 routes with India, US, NRI and no-loan profiles on desktop and 390 px mobile: **104 page/viewport combinations**.
- Production build and TypeScript check passed. Lint passed with four existing warnings in font setup and DeductionsPanel; no new warnings.

The browser scripts are committed as `scripts/audit-plan.cjs` and `scripts/audit-latest.cjs`. They create isolated synthetic contexts and assert saved profiles, ledgers, contribution records, numerical amounts and visible outcomes. They support `BASE_URL`, `PLAYWRIGHT_MODULE`, `CHROME_PATH`, `AUDIT_OUTPUT` and `AUDIT_FILTER`. Install Playwright separately when running outside the bundled environment. For local walkthroughs build with `NEXT_PUBLIC_DISABLE_AUTH=true RIGHTDUE_ALLOW_DISABLED_AUTH=1` (the build refuses the first alone, `web/auth-guard.mjs`) and a local `NEXT_PUBLIC_API_BASE_URL`; never use the disabled-auth setting for a public deployment.

During baseline/replay work, selector ambiguity, an encoded label, and an initial responsive-hook timing issue caused harness failures. Those were corrected and replayed; they are not counted as application bugs.

## Practical limits

Tests use synthetic local profiles with the real API and production frontend. They do not establish live OTP delivery, persistence through a production database, or synchronization between two signed-in devices. Cross-tab mutation tests change the stored profile while a form is open. No real financial account or payment is touched. The walkthroughs are extensive regression coverage, not a proof that every possible future scenario is correct.
