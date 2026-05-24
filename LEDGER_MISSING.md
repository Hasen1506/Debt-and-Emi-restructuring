# Ledger skin — what the new design **doesn't** cover yet

> The new "Ledger / The Statement" design (commit `3c83382` — README +
> `ledger-skin-home.jsx` + `ledger-skin-rest.jsx`) is a snapshot from
> ~7 days ago. Several features shipped since then are **not** in the
> spec. This file tracks every one of those — separated into
> **A. surfaces** (whole screens / pages the spec doesn't cover) and
> **B. sub-features** (cards, banners, toggles inside screens the spec
> *does* cover, which were rewritten to match the prototype and so
> currently render without these extras).
>
> Nothing here is broken. The data + logic for every item below still
> lives in `web/src/` — only the **visual surface** was dropped while
> recreating the prototype 1:1. The intent is to walk this list and
> decide, per item: (a) re-introduce inside the new ledger primitives,
> (b) defer to v2, or (c) drop entirely.

---

## A. Whole surfaces with no prototype treatment

These routes exist in the codebase but the new design has no spec for
them. They currently render with the **existing** non-ledger structure
on top of the updated ledger CSS tokens — so the type + palette are
right, but the layout is not statement-style.

| Route | Component(s) | What it does | Notes for v2 |
|---|---|---|---|
| `/goals` | [GoalsClient.tsx](web/src/app/goals/GoalsClient.tsx), `lib/goals.ts`, `lib/goal-slip.ts` | Goal list + add/edit + achievability badges + earliest-feasible suggestion. | Treat as a §-tool style screen: `$ GOALS · {n} ACTIVE` CLI line, KPI strip (`ACTIVE · FUNDED · BEHIND`), one dashed table with `[OPEN]` per goal. |
| `/portfolio` | [LedgerPortfolio.tsx](web/src/components/portfolio/LedgerPortfolio.tsx), [HoldingsTracker.tsx](web/src/components/portfolio/HoldingsTracker.tsx) | Holdings list + liquidation rankings, P&L. | `$ HOLDINGS · {n} POSITIONS`, debt-table-style layout with cost-basis / current / Δ columns; TEY (tax-equivalent yield) column when applicable. |
| `/decisions` | [DecisionLogControls.tsx](web/src/components/DecisionLogControls.tsx), `lib/decision-log.ts` | Decision-log entries from tool runs. | Notes-style entry list (same shape as `/insights`), one decision per dashed-divider block, with the original `$ THE MATH` block re-rendered per entry. |
| `/onboarding` + `/onboarding/assets` | [page.tsx (3.6k lines)](web/src/app/onboarding/page.tsx) | Multi-step wizard. | Replace step header with the prototype's **step rail** (6 cells, 1px ink grid). Wrap every input in `LField`. Use `LCardSoft` for each loan card with `$ LOAN A · CREDIT_CARD` header. Footer `[← BACK] · [ CONTINUE → SAVINGS ]` (`LButton`). |

---

## B. Sub-features dropped during the screen rewrites

### B.1 LedgerPlan — dropped from `/plan`

The new `/plan` recreates **only** the prototype's six sections (CLI
header · KPI strip · trajectory · restructure · amortisation ·
sensitivity sliders). Everything below was rendered by the previous
LedgerPlan and is currently absent:

| Sub-feature | Source | Why it matters | Re-introduce as |
|---|---|---|---|
| `NextActionCard` | [components/plan/NextActionCard.tsx](web/src/components/plan/NextActionCard.tsx) | Top-of-page recommendation (EF top-up / goal behind / on-track). | A dedicated `LCardHard` between the CLI header and the KPI strip — accent eyebrow, headline, reason, two `LBracket` CTAs. |
| `BudgetMonthCard` | [components/plan/BudgetMonthCard.tsx](web/src/components/plan/BudgetMonthCard.tsx) | Month's planned envelope + actuals variance. | KPI cell in the strip ("BUDGET · {month}") **or** a small `LCardSoft` to the right of the KPI grid. |
| `LifecycleArrivalPrompts` | [components/lifecycle/LifecycleArrivalPrompts.tsx](web/src/components/lifecycle/LifecycleArrivalPrompts.tsx) | Inline confirm/postpone for arrived lifecycle events. | Yellow-highlighted row at the top of the amortisation table. |
| `CentralBankHint` | [components/plan/CentralBankHint.tsx](web/src/components/plan/CentralBankHint.tsx) | RBI / Fed last move + next decision date for floating-rate users. | Statement-style strip above the trajectory: `$ CENTRAL · RBI HELD 5.25% · NEXT 7 JUN`. |
| **Modeling toggles** (strategy / plan-start / hike / tax-reinvest / inflation / EF split / FX drift) | components/StrategySwitcher etc. | Lets the user re-cast the projection. | One collapsible block: `$ MODELING · STRATEGY + TOGGLES`. Each toggle as a CLI line `SET HIKE_RATE = 8%` with the `LSlider` style track + 12×12 accent thumb. |
| `AssumptionBadges` | [components/plan/AssumptionBadges.tsx](web/src/components/plan/AssumptionBadges.tsx) | Inline badges above the trajectory ("hike on", "min-EMI", etc.). | Mono caps strip directly under the section header. |
| `SurplusWaterfall` | [components/plan/SurplusWaterfall.tsx](web/src/components/plan/SurplusWaterfall.tsx) | "Where each rupee of surplus goes" stacked bar. | Allocation-bar primitive from prototype §4.9 (windfall) — single 26px horizontal bar with flex-grown segments. |
| `InvestVsPrepayCard` | [components/plan/InvestVsPrepayCard.tsx](web/src/components/plan/InvestVsPrepayCard.tsx) | Plain safe-vehicle decision card. | `$ INVEST VS PREPAY` block with the `LMathBlock` primitive. |
| Opportunity sub-bits | `OpportunityAlternative`, `RelationshipBadge`, `RateAsOfBadge`, `EligibilityCaveat`, `UpdateTermsButton` | Per-opportunity richness (alternate bank suggestion, caveats, terms editor). | Expand each restructure row inline (`[EXPAND →]`) into a dashed sub-block with these elements as `LField`-styled chips. |
| `ActivityImpactBanner` | [components/plan/ActivityImpactBanner.tsx](web/src/components/plan/ActivityImpactBanner.tsx) | Banner when missed/partial entries shifted the projection. | Top-of-page strip in `L_T.highlight` background with summary line. |
| `BracketTransitionAlert` | [components/plan/BracketTransitionAlert.tsx](web/src/components/plan/BracketTransitionAlert.tsx) | Slab-crossing alert for IN users with hike-on. | Same banner pattern as ActivityImpact — accent border, three-line copy. |
| `AdvanceTaxPanel` | [components/plan/AdvanceTaxPanel.tsx](web/src/components/plan/AdvanceTaxPanel.tsx) | Quarterly advance-tax schedule for SE / above-threshold users. | Dedicated section: `$ ADVANCE TAX · {country} · {schedule.length} DUE`, debt-table-style. |
| `TaxBreakdown` | [components/plan/TaxBreakdown.tsx](web/src/components/plan/TaxBreakdown.tsx) | Per-loan deduction projection. | `$ TAX · DEDUCTIONS BY LOAN` dashed table. |
| `KeyClearanceDates` + `DebtFreeRedirectPrompt` | [components/plan/KeyClearanceDates.tsx](web/src/components/plan/KeyClearanceDates.tsx) | Per-loan milestones + congrats prompt. | Dashed-row dates list directly under the trajectory legend. |
| `RecentActivitySummary` | [components/plan/RecentActivitySummary.tsx](web/src/components/plan/RecentActivitySummary.tsx) | "Last 3 entries you logged" recap. | Insertion above the amortisation block; mono table, dashed rows. |
| `WhatIfPanel` | [components/WhatIfPanel.tsx](web/src/components/WhatIfPanel.tsx) | Free-form scenario sandbox. | Currently approximated by `SensitivityCard`. Promote to a separate `$ WHAT IF · TRY A SCENARIO` block using the full slider component (with goal-slip side panel from `lib/goal-slip.ts`). |
| Full monthly grid | [LedgerScheduleTable.tsx](web/src/components/plan/LedgerScheduleTable.tsx) | 240-row amortisation with per-loan columns. | Now reduced to "next 12 mo" in the rebuilt screen. The collapsible `[↓ EXPAND ALL]` bracket should open this component. |

### B.2 LedgerDebts — dropped from `/debts`

| Sub-feature | Source | Re-introduce as |
|---|---|---|
| Per-loan **EffectiveAprBreakdown** | [components/EffectiveAprBreakdown.tsx](web/src/components/EffectiveAprBreakdown.tsx) | Expandable rows (`[BREAKDOWN]`) under each debt-table entry, showing `nominal → +fees → −shield → effective` as an LMathBlock. |
| `LifecycleEventsPanel` | [components/lifecycle/LifecycleEventsPanel.tsx](web/src/components/lifecycle/LifecycleEventsPanel.tsx) | Section after the highlighted card: `$ LIFECYCLE · {n} EVENTS`. |
| `StaleCardNudge` | [components/debts/StaleCardNudge.tsx](web/src/components/debts/StaleCardNudge.tsx) | Yellow `L_T.highlight` strip above the table when a card hasn't been reconciled in N days. |
| `CashManagementSection` | [components/debts/CashManagementSection.tsx](web/src/components/debts/CashManagementSection.tsx) | New section below the highlighted card; statement-style KPI strip + "where idle cash sits" table. |
| `TodayCard` | [components/debts/TodayCard.tsx](web/src/components/debts/TodayCard.tsx) | The "$ THIS MONTH · DO THIS" hard-bordered card from the prototype's Home, but on /debts it carries the per-loan action of the day. |

### B.3 LedgerInsights — dropped from `/insights`

| Sub-feature | Source | Re-introduce as |
|---|---|---|
| `AdvanceTaxLedger` | [components/insights/AdvanceTaxLedger.tsx](web/src/components/insights/AdvanceTaxLedger.tsx) | New entry-type in the Notes feed (eyebrow `TAX`, body = next instalment + penalty estimate). |
| `InsightsSummaryStrip` | [components/insights/InsightsSummaryStrip.tsx](web/src/components/insights/InsightsSummaryStrip.tsx) | KPI strip above the entries: `LOGGED · {n}` / `IMPACT · ±{∆mo}` / `LAST · {date}`. |
| `InsightsPerLoanTrajectorySection` | [components/insights/PerLoanTrajectorySection.tsx](web/src/components/insights/PerLoanTrajectorySection.tsx) | Below the activity ledger: one `LTrajectory` per loan in a vertical stack. |

### B.4 LedgerHome — dropped from `/`

The prototype's Home is clean: STATUS / ACTION / OPEN POSITIONS / TOOLS. The
previous LedgerHome had a more elaborate "LedgerLetter" card with
sidebar marginalia:

| Sub-feature | Source | Re-introduce as |
|---|---|---|
| `LedgerLetter` (headline + 3-stat row + marginalia sidebar) | the previous `LedgerHome.tsx` (now replaced) | Optional `DETAILED` mode addition — render between the trajectory section and the insight card. The headline becomes the loudest-debt note; the marginalia stays as side-column "ALSO WORTH KNOWING". |

### B.5 LedgerKpiGrid (`components/themed/LedgerKpiGrid.tsx`)

Replaced wholesale by the new `LKpi` primitive (same 1px-ink-grid trick,
same tone-coding). The old file is now an orphan — safe to delete once
the editorial + existing themes that import it are confirmed not to.

---

## C. Prototype contracts the new code intentionally simplified

These are spots where I knowingly bent the prototype's letter — not
because the spec was wrong, but because our data layer doesn't yet
support the literal contract. Each one's a small follow-up.

| Spec contract | Current code | Gap | Fix |
|---|---|---|---|
| Debts table `POST-TAX` column | Renders the same value as `EFFECTIVE`. | Our `computeBreakdown()` already folds the shield into `effective`. The prototype's POST-TAX is the post-shield figure when EFFECTIVE is pre-shield. | Split the breakdown so `effective` is pre-shield and a new `postTax` field carries the after-shield rate. Touches `lib/effective-apr.ts` + `lib/derived.ts`. |
| Debts page `NEXT RESET · 47 D` | Shows `RESET CYCLE · {months} MO`. | We store `rate_reset_frequency_months`, not the next dated reset event. | Derive the next-reset *date* from `user.lifecycle_events` (filter `kind=floating_rate_reset` + earliest `effectiveDate > today`). |
| Sensitivity sliders → live engine | Local sliders with linear outcome approximations. | A real `[POST] /api/simulate` on every drag would be expensive; we cache and bound it. | Either (a) compute deltas in JS using a simplified amortisation walk, or (b) debounce a real engine call and show a "RECOMPUTING…" hint. |
| Masthead `STMT #1138` numbering | Static across users. | Spec uses #1138 as the user's statement number — implying it should be per-user and incrementing. | Pick a deterministic per-user number (e.g. `crc32(profile.user.id) mod 9999`) so it feels personal without server state. |
| Restructure `BREAKEVEN` column | Shows `—`. | Engine returns `payback_months` for refis but not all opportunity kinds. | Default `BREAKEVEN = payback_months` when present, else compute from `(fee_to_recover / monthly_saving)`. |

---

## D. Items where we kept the *behaviour* but the *look* still needs work

These are now using the right palette + typography (because they read
the `[data-theme='ledger']` CSS tokens) but their **structure** is still
the pre-spec card layout, not statement-style:

- `/onboarding` (3.6k-line wizard)
- `/onboarding/assets`
- `/decisions`
- `/goals`
- `/portfolio`
- Every individual `/tools/<id>` body (the `tool.tsx` per tool)
- All the toggle/slider sidecar components (`StrategySwitcher`,
  `EfSplitSlider`, `HikeToggle`, `InflationToggle`, `TaxReinvestToggle`,
  `FxDriftToggle`, `PlanStartPicker`)

Each of these needs a pass to swap card frames for `LCardSoft` /
`LCardHard`, replace inputs with `LField`, replace tabs with
`LBracket`, and add a `$ CLI` header line at the top.

---

## E. Out of scope (explicit in the spec, do not port)

From README §10:
- The design canvas / artboard wrapper (`design.jsx`) — presentation
  harness for the handoff, not part of the app.
- The other two skins ("Default", "Editorial") in the parent project —
  Ledger is the chosen direction. **However**, we currently keep
  `existing` + `editorial` registered in `lib/theme.ts` because the
  theme switcher lets users toggle. Decide whether to retire them.
- Wireframes / persona files — superseded by the spec.

---

## F. Triage suggestion

If you want to walk this list with me, the order I'd recommend:

1. **C.1 (POST-TAX column split)** + **C.2 (next-reset date)** — small
   data-layer fixes, unblock visible prototype fidelity.
2. **A.1–A.4** — the four whole surfaces (`/goals`, `/portfolio`,
   `/decisions`, `/onboarding`). These are the surfaces users hit most.
3. **B.1 high-impact items** — NextActionCard, BudgetMonthCard,
   LifecycleArrivalPrompts on /plan (those carry the most engine signal).
4. **D** — onboarding wizard structural pass.
5. **B.1 long tail** — modeling toggles, AssumptionBadges, etc.
6. **B.2 / B.3** — per-surface tail items.

Each of those can be one PR — no dependencies between A/B/D.
