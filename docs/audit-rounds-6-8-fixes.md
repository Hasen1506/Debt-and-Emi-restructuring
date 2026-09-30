# Audit rounds 6–8: fixes and verification

Date: 30 September 2026. Repository: `Hasen1506/Debt-and-Emi-restructuring`.
Base: `1522d752dc23a3374604aa0b5fd7392236186865` (main, prior audit fixes merged).
Branch: `codex/audit-6-8-fixes`.

## Original findings: all 21 addressed

### Round 6

| Finding | Correction | Regression evidence |
| --- | --- | --- |
| Confirming two rate resets overwrites the first | Every mutation reads the latest stored profile and event history; stable IDs resolve the target. | Two confirmations in one browser visit preserve 8% and 9% on separate loans. |
| Gross-only salary confirmation leaves take-home unchanged | Confirmation and forecast use the same income-tax estimate; explicit take-home overrides remain supported, including zero. Marginal tax rate refreshes alongside income. | ₹12 lakh gross updates take-home to ₹1 lakh under the modeled Indian new regime; Home updates its surplus. |
| Planned property purchase never reaches the forecast | API and engine accept a loan draft, reserve its position, and activate it at the effective month in both scenario and baseline. | Property arrives in month 3/4, including after all existing debt clears; all three payoff strategies tested. |
| Undoing property removes the wrong indexed loan | New snapshots record a stable loan ID. Legacy snapshots use a unique matching draft and reject ambiguous matches. | Undo after removing/reordering earlier loans; legacy balance/rate edits covered. |
| Recap extra payment changes cash but not debt | Recap records additional principal against an explicit loan in Activity and updates its forecast digest with the cash change. | ₹29,000 paid against a ₹9,000 EMI records ₹20,000 extra; Home starts from ₹80,000. |
| Recap credits locked FD by default | Default is checking, then an eligible liquid account; user can choose the account. Locked deposits are excluded. | Salary Checking becomes ₹11,000 while the ₹1 lakh FD stays unchanged. |
| Opening partial month replays a full month's income | Recaps start with the first complete month after an opening balance entered partway through a month. Current and previously confirmed months are excluded. | 27 August opening produces no August recap; 1 August opening does. |

### Round 7

| Finding | Correction | Regression evidence |
| --- | --- | --- |
| No-cost EMI uses a guessed revolving-card APR | Require the actual quoted monthly installment and compare those repayments with the cash price. | ₹10,000 / six installments of ₹1,666.67 yields approximately zero APR. |
| Higher sticker price does not change cost | Financed sticker price and quoted payment must agree; old results disappear on edits. APR and total real cost use actual repayments. | ₹12,000 sticker / ₹2,000 installments versus ₹10,000 cash increases the cost; underfunded quotes are rejected. |
| Existing down-payment savings are ignored | Explicit available-savings input funds the down payment first; only the remainder must be saved by the target month. | ₹10 lakh savings cover the ₹4 lakh down payment on a ₹20 lakh home. |
| Impossible purchase terms are called feasible | Validate price, date, down-payment percentage, positive tenure, rates and savings before showing a verdict. | 150% down, zero tenure, negative rates, invalid date and infinite price rejected; fully funded cash purchase allowed. |
| Fractional holding periods inflate Monte Carlo return | Aggregate log returns over the exact period, with drift proportional to time and volatility proportional to its square root. | Zero volatility at 12% and 1.5 years gives 10.5% after tax; multiple fractional and long horizons tested. |
| Losses receive an assumed immediate tax benefit | Apply flat tax only to positive investment gains. | −20% return remains −20%, matching the deterministic calculation. |
| Real and nominal beat-loan probabilities duplicate | Display one beat-loan probability and a distinct probability of preserving purchasing power; retain real percentiles. | A positive nominal edge with 40% inflation can show 100% beat-loan and 0% purchasing-power preservation. |

### Round 8

| Finding | Correction | Regression evidence |
| --- | --- | --- |
| New Debt saves new principal with old checked EMI | Bind results to checked inputs and profile; hide the action on any change. Revalidate current affordability and loan bounds when saving. | Changing ₹1 lakh to ₹10 lakh removes Add; a fresh check saves the correct larger EMI. |
| Right Time adds unaffordable principal under old verdict | Apply the same input/profile binding and final affordability check. | Changing ₹1 lakh to ₹1 crore removes Add and leaves the profile untouched. |
| Spare Cash can duplicate a logged movement | Disable the completed action, guard the handler, and persist a recommendation transaction ID. | A ₹3,000 EF / ₹7,000 debt split creates one transfer, one EF credit and one Activity entry. |
| Investment logging leaves no record | Create a portfolio holding and a cash transfer audit record before reporting success. | ₹10,000 Liquid Fund holding persists in the profile. |
| Spending existing savings leaves savings untouched | Require an external-versus-existing source; debit the selected liquid account or legacy aggregate savings. | ₹50,000 account becomes ₹40,000 after the ₹10,000 allocation. |
| Home and Plan disagree after payment | Display and advice snapshots apply Activity to the saved baseline once; Home's next move uses the same adjusted plan. | Home and Debts show ₹93,000 after a ₹7,000 principal payment; Plan uses that same balance. |
| Partial sale can exceed quantity owned | Validate finite positive quantity/price and quantity sold ≤ owned before requesting a verdict. Editing inputs invalidates the result. | Selling 200 of 100 sq.ft is rejected; empty/zero input does not crash. |

## Adjacent bugs found and fixed

1. **Stacked confirmations:** removing an older salary/rate event could restore an obsolete value. Undo now rebases the next snapshot; a sequence number handles same-millisecond confirmations.
2. **Removed event targets:** confirming a reset for a deleted loan could throw an uncaught browser exception. It now shows an actionable error and preserves neighboring loans.
3. **Lifecycle storage:** large plain JSON cookies could silently fail. History is compressed, size checked and read back. Confirmation rolls back its event history if the profile save fails.
4. **Cash transaction failures:** quota or blocked-cookie errors could leave a successful-looking partial ledger update. Financial writes are prepared before commit, and local ledgers roll back on failure.
5. **Legacy savings migration:** adding an account for unused external cash could discard the old aggregate balance. The new account preserves the old savings plus the unused cash.
6. **Foreign-currency windfalls:** cash was compared directly with a loan denominated in another currency. Recommendations, fees and caps are now calculated in residence currency; Activity principal converts back to the loan currency. Missing FX is rejected.
7. **Live advice balances:** tools and the Debts, Goals and Portfolio display shells could continue using opening balances after logged payments. They now use the Activity-adjusted snapshot; profile mutations retain the stored baseline.
8. **Card balance anchors:** later extra payments were ignored once a statement balance override existed. Entries now sort by payment date, and only entries after the newest anchor modify it.
9. **Server sync races:** simultaneous profile and ledger saves could overwrite other slices; failed reads could replace unknown server state with an empty object. Saves now run sequentially and require a successful read before merging.
10. **Signed-in navigation:** server pages could fetch an older profile while local sync was pending. The valid local profile cookie is the immediate display source; login hydration still brings remote profiles onto new devices.
11. **Credit-score clearing:** clearing a score left the old cookie. Both local saves and hydration now clear it explicitly.
12. **Saved no-cost offers:** a zero-interest installment could be treated as a revolving card and blocked as incomplete. Offers are tracked separately as installment loans using their quoted EMI, with explicit explanatory copy. Quotes implying a rate above the profile model's 100% annual limit are rejected rather than silently clipped.
13. **Stale completed actions:** sale and spare-cash logging now reject changed profile/payment snapshots; loan Add also invalidates if balances change without changing EMI room.
14. **Future loan timing:** the engine could stop during a debt-free gap, or age a loan's lock-in before arrival. It now continues to the arrival and starts loan timing then. A future loan is not marked cleared in month 1 or offered as a current lump-sum payment target.
15. **Future funding gaps:** a planned unaffordable loan could leave a reassuring payoff date. Home and Plan now suppress reliable clearance promises and show the first unfunded month; the displayed schedule is explicitly conditional on funding minimums.
16. **Purchase funding defaults:** locked FDs are excluded from default available savings; missing foreign-loan FX blocks affordability advice. A 99% down-payment lever uses the actual percentage.
17. **Forecast allocation snapshot:** first-month surplus allocation now uses the simulated surplus, including month-1 salary and property events.
18. **Date conversion:** lifecycle month offsets compare ISO calendar components, avoiding UTC parsing shifts around month boundaries; overdue postponement moves forward from today.
19. **Debt-free management:** the empty Debts screen hid cash recaps and life event planning. Both remain available after loans are cleared or before a first loan exists. Home also shows a separate planned-loan forecast when today's debt is zero.

## Verification

- Full engine/API suite: **713 passed** (695 existing tests plus 18 new cases).
- Frontend regression suite: **14 passed**. Groups include fractional Monte Carlo periods, purchasing savings and invalid terms, allocation conservation, recap timing, stable IDs, stacked undo, card anchors, blocked-cookie rollback, oversized history, credit-score clearing, and serialized sync.
- TypeScript, lint and production build: passed. Existing warnings remain in the font layout, onboarding, Activity and deductions code; no new warnings in changed logic.
- Browser gate: **28/28 walkthroughs passed** using `scripts/audit-browser.cjs`. It checks profile cookies, local ledgers, visible results and browser exceptions in independent Chrome contexts, including a 390-pixel mobile viewport. This final run used the production build with all fixes included.
- `npm test` is now part of the web CI gate. Python regression cases run through the existing engine/API gate.

### Reproduce

```sh
python -m pytest engine/tests api/tests -q
cd web
npm ci
npm test
npm run typecheck
npm run lint
npm run build
```

For browser replay, run the API and production frontend locally, install Playwright in the test environment, and run `node scripts/audit-browser.cjs`. Configure `BASE_URL`, `PLAYWRIGHT_MODULE`, `CHROME_PATH`, and `AUDIT_OUTPUT` as needed. `AUDIT_FILTER` selects a named scenario; `AUDIT_SCREENSHOT` saves the mobile view.

## Practical limits

The browser preview uses authentication-disabled trial mode and no database. Engine/API tests exercise the existing auth/persistence suite; sync queue and failure behavior are regression tested with controlled responses. Real email delivery and two physical signed-in devices were not exercised. This work is a code change and local preview, not a production deployment.

Gross-only salary estimates include modeled income tax, not PF, payroll tax, insurance or individual withholding. The form offers an explicit take-home override. Monte Carlo retains the tool's disclosed flat annualized tax approximation.

Recap records additional principal with an explicit target; payments already logged in Activity should be excluded from its additional-payment figure. Historical bad loans or duplicate entries created before these fixes require correction in Setup/Activity; the app cannot infer whether a recorded payment actually occurred.
