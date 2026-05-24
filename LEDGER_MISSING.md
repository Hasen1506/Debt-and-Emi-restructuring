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
| `/onboarding` + `/onboarding/assets` | [page.tsx (3.6k lines)](web/src/app/onboarding/page.tsx) | Multi-step wizard. | Six explicit steps per §4.7 — see **G.2** for the full spec. Replace step header with the prototype's **step rail** (6 cells, 1px ink grid, current/past/future colour states). Wrap every input in `LField`. Use `LCardSoft` for each loan card with `$ LOAN A · CREDIT_CARD` header. Footer `[← BACK] · [ CONTINUE → SAVINGS ]` (`LButton`) — the Continue label always names the next step. |

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
| Full monthly grid | [LedgerScheduleTable.tsx](web/src/components/plan/LedgerScheduleTable.tsx) | 240-row amortisation with per-loan columns. | Now reduced to "next 12 mo" in the rebuilt screen. Default behaviour per §4.7 is **collapsed-with-events** — see **G.1** for the full collapse/expand spec and required column set. |

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

## G. Late-arriving spec clarifications (2026-05-24)

Additions from the spec-author after the initial rebuild landed. Each
one refines a section already touched in A or B — recorded here so the
clarifications don't get lost in the table cross-refs.

### G.1 §4.4 Amortisation — collapse behaviour + column set

Affects: **B.1 — Full monthly grid** row.

- **Default state: COLLAPSED.** Only event-bearing rows render, each
  with a yellow (`L_T.highlight`) wash. Events that qualify a row:
  *debt cleared* · *rate reset* · *annual review* · *windfall
  applied*.
- Toggle bracket flips label + glyph: `[↓ EXPAND ALL 240]` ↔
  `[↑ COLLAPSE]`. Expanded view reveals every month; event rows keep
  the yellow wash so milestones still pop in the noise.
- **Column set (laid out as a real `<table>`, not a flex grid):**
  `MO · DATE · KOTAK · HDFC PL · SBI · HDFC HL · EXTRA · INT PAID ·
  PRIN · BALANCE · EVENT`
  - per-loan columns are dynamic (one column per active loan)
  - `EXTRA` cell in `L_T.accent`
  - `INT PAID` cell in `L_T.negative`
  - `PRIN` cell in `L_T.positive`
  - `BALANCE` cell in `font-weight: 700`
  - `EVENT` cell carries an inline glyph: `⊕` rate reset · `⊙` annual
    review · `★` debt cleared / windfall applied

**Status (2026-05-24)**: shipped in [LedgerPlan.tsx](web/src/components/plan/LedgerPlan.tsx)
— real `<table>`, default-collapsed event rows, expand toggle flips
`[↓ EXPAND ALL N]` ↔ `[↑ COLLAPSE]`, `EXTRA` column in accent, sticky
header on expand, `★ DEBT CLEARED` from `trajectory.balancesByLoanIndex`
and `⊙ ANNUAL REVIEW` every 12th month.

**Remaining gap**: `⊕ RATE RESET` (floating-rate revisions) and
`⊙ SALARY RESET` glyphs still depend on threading
`readLifecycleClient()` results into PlanData. Cleanest path is to
plumb `lifecycleEvents: LifecycleEvent[]` through the plan loader →
PlanData → AmortisationSection so both glyphs render alongside the
existing two. Same applies to a `★ WINDFALL APPLIED` glyph once a
per-month windfall log lands (currently `ActivityImpact` is an
aggregate, not month-stamped).

### G.2 §4.7 Setup — full six-step spec

Affects: **A — `/onboarding`** row.

Six explicit steps, in order:

1. **COUNTRY** — country + currency selection.
2. **INCOME** — gross, post-tax, marginal slab, employment kind.
3. **LOANS** — N loan cards (each `LCardSoft`). Conditional reveal:
   when `rate_type = FLOATING` the card grows a `RESET CYCLE` row;
   the field is hidden otherwise.
4. **SAVINGS** — savings + EF size + investable surplus.
5. **CREDIT** — credit cards + revolving balances. Conditional reveal:
   when country supports a tax shield (e.g. IN home loan / US
   mortgage), the relevant `TAX SHIELD` field appears here.
6. **REVIEW** — treat as a **Debts-screen summary + save card**: same
   `OPEN POSITIONS` table layout from /debts (read-only), KPI strip
   above, ink-bordered save card with `[← EDIT]` and
   `[ SAVE PROFILE → ]` actions.

**Step rail colour states** (explicit, all 6 cells visible across
steps):
- *current* — accent fill + ink text (the active cell)
- *past* — ink fill + paper text (completed)
- *future* — paper fill + muted text + 1px ink border (not reached)

**Continue button** always names the next step: `[ CONTINUE → SAVINGS ]`,
`[ CONTINUE → CREDIT ]`, …, last step is `[ SAVE PROFILE → ]`. The
Back button is always `[← BACK]` (no destination name).

Where it lives today: [page.tsx (3.6k lines)](web/src/app/onboarding/page.tsx).

**Status (2026-05-24)**:
- ✅ Six-cell step rail (`LedgerStepRail`) with tri-state colours
  (current = accent fill, past = ink fill, future = paper fill +
  border). The optional step-0 "You" welcome screen still renders
  without the rail so the visible spine sticks to the six-step
  contract.
- ✅ Continue button now names the next step: `[ CONTINUE → SAVINGS ]`,
  `[ CONTINUE → CREDIT SCORE ]`, …, last step `[ SAVE PROFILE → ]`.
- ✅ Back button is the bare `[← BACK]` per spec.
- ⏳ **Conditional reveals**: needs an audit pass — `rate_type =
  FLOATING` → `RESET CYCLE` field is implemented inside the loan
  card, but the wrapper isn't styled per spec yet. The country-aware
  `TAX SHIELD` reveal on step 5 (Credit) is auto-derived from home
  loan + marginal rate; the spec implies it should be a visible
  surface, not just an implicit calc.
- ⏳ **Step 6 (Review)** still renders the legacy "review card"
  pattern. Spec calls for the **Debts-screen summary + save card**
  (read-only `OPEN POSITIONS` table, KPI strip above, ink-bordered
  save card with `[← EDIT]` and `[ SAVE PROFILE → ]` actions).
- ⏳ **Field wrapping**: every input still uses the legacy `Field` /
  `Select` primitives from `ToolPrimitives`. Spec wants `LField`
  everywhere with consistent ASCII labels.

### G.3 §4.9 Tool-screen pattern — generalised skeleton

Affects: **D — every `/tools/<id>` body** + the existing **§8a
Windfall** tool (which becomes the *example*, not the *template*).

Every tool ships the same three blocks, in this order:

1. **CLI header** — `$ <TOOL_TAG> · <TOOL_NAME> · <DATE>`.
2. **Hero question** — single 20–24px caps line, the exact question
   the tool answers (e.g. *"DOES THE RATE HIKE BREAK YOUR PLAN?"*,
   *"WHAT DOES 6% INFLATION DO TO YOUR HORIZON?"*).
3. **`$ INPUT` card** — 1px ink border. Holds the user-tunable
   knobs. **Always includes a date field** (`AS OF · {today}` by
   default) so every run is timestamped for the decision log.
4. **`$ VERDICT` card** — 2px ink border (heavier than INPUT), accent
   eyebrow, choice of:
   - an **allocation bar** (horizontal stacked segments, flex-grown),
     OR
   - a **signature visual** specific to the tool (mini trajectory,
     break-even line chart, etc.)
   Followed by a 4-cell KPI strip and an action row of `LBracket`
   CTAs.
5. **`$ THE MATH` block** — `LMathBlock` primitive, **mandatory**.
   *"If a tool has no formula, the tool does not ship."* Renders the
   step-by-step derivation that produced the verdict.

The **Windfall** worked example in the prototype is the reference
implementation — promoted in the spec to §4.9.1, demoted from "the
spec" to "an instance of the spec". Every other tool body in
`/tools/<id>` must follow the same skeleton.

Where it lives today: the dashed-table index at
[LedgerToolsIndex.tsx](web/src/components/ledger/LedgerToolsIndex.tsx)
lists all nine tools.

**Status (2026-05-24)**:
- ✅ Shared skeleton primitives shipped:
  [LToolShell.tsx](web/src/components/ledger/LToolShell.tsx) exports
  `LToolHeader`, `LToolInput`, `LToolVerdict`, `LToolMath`,
  `LAllocationBar`, and the `LToolShell` wrapper.
- ✅ All 9 `/tools/<id>/page.tsx` wrappers now render through
  [LToolPageHeader](web/src/components/ledger/LToolPageHeader.tsx),
  which pulls `tag` / `name` / `question` from `lib/tools.ts` and
  draws the §4.9 CLI line + hero question consistently. No tool
  ships with the legacy `<h1>` + `<p class="muted">` pair anymore.
- ✅ **§4.9.1 worked example** — [Windfall](web/src/app/tools/windfall/tool.tsx)
  is fully ported: 1px-ink `$ INPUT` (with `AS OF · {today}`), 2px-ink
  `$ VERDICT` (accent eyebrow + allocation bar + 4-cell KPI + `LBracket`
  action row), mandatory `$ THE MATH` block listing amount → route →
  lender rate → interest avoided → principal cut → expected return.
- ⏳ **The eight other tool bodies are not yet ported**. They keep
  using `Card` / `Stat` / `VerdictHeader` / legacy `Field` from
  `ToolPrimitives` inside their body — so the page chrome is
  on-spec but the body content isn't. Each needs the same chrome
  swap Windfall got:
  - `new-debt` — INPUT: amount + tenure + rate type. VERDICT:
    DTI verdict + signature visual (mini DTI gauge). MATH: EMI
    formula → DTI ratio → cushion left.
  - `liquidate` — INPUT: asset to sell + holding period. VERDICT:
    NET vs INTEREST AVOIDED. MATH: gross → tax → costs → net,
    side-by-side with prepay interest avoided.
  - `recompute` — INPUT: lump amount + loan picker. VERDICT:
    months saved + new debt-free month. MATH: pre → post
    trajectory delta.
  - `cash-yield` — INPUT: idle balance + product picker. VERDICT:
    annual uplift + best alt. MATH: current yield → alt yield
    × balance → tax → uplift.
  - `right-time` — INPUT: amount + bank picker. VERDICT: wait vs
    lock with confidence. MATH: current median → consensus delta
    × tenure → break-even.
  - `nri-prepay` — INPUT: loan + savings + FX direction. VERDICT:
    prepay vs hold with FX drift. MATH: nominal rate → tax shield
    → FX cost → effective vs after-tax savings yield.
  - `purchase` — INPUT: price + down + tenure. VERDICT: TCO +
    three levers. MATH: principal → interest → tax shield → TCO.
  - `invest-vs-prepay` — INPUT: expected return + σ + horizon.
    VERDICT: expected vs −1σ. MATH: μ → after-tax → σ → downside
    comparison vs loan rate.

  Each port should be roughly the same shape as Windfall: keep the
  engine call + side-effects, only swap `Card`/`Stat`/`VerdictHeader`
  → `LToolInput` / `LToolVerdict` / `LToolMath`, and add the MATH
  block with the actual derivation rows.

---

## F. Triage suggestion

If you want to walk this list with me, the order I'd recommend:

1. **C.1 (POST-TAX column split)** + **C.2 (next-reset date)** — small
   data-layer fixes, unblock visible prototype fidelity.
2. **G.1 (amortisation collapse + columns)** — purely structural on a
   screen we already rebuilt; biggest visual upgrade per hour.
3. **A.1–A.4 + G.2** — the four whole surfaces (`/goals`, `/portfolio`,
   `/decisions`, `/onboarding`). Onboarding ships against the full
   §4.7 six-step rail. These are the surfaces users hit most.
4. **G.3 + D** — generalised tool skeleton, then port every
   `/tools/<id>` body onto it. Once §4.9 is locked down, the long
   tail of tools rebuilds quickly.
5. **B.1 high-impact items** — NextActionCard, BudgetMonthCard,
   LifecycleArrivalPrompts on /plan (those carry the most engine signal).
6. **B.1 long tail** — modeling toggles, AssumptionBadges, etc.
7. **B.2 / B.3** — per-surface tail items.

Each of those can be one PR — no dependencies between A/B/D/G.
