# RightDue · Debt & EMI Restructuring App (Ledger skin · V2) — rev 3

> **One-line:** A monospace, ledger-style personal-finance app that helps an individual
> see their debts, the cost of each debt **after fees + GST + tax-shield**, and lets the
> engine choose where every rupee of monthly surplus should go.

---

## 1 · About this bundle

The files in `references/` are **design references**, not production code.
They are React components running in a single inline-Babel HTML file
(`App Insides - Ledger.html`) inside a `<DesignCanvas>` shell so multiple
artboards can sit side-by-side.

Your job is to **recreate these screens in the target codebase's framework**
(React + Tailwind, Next.js, Vue, SwiftUI, Flutter — whatever the repo uses).
If no codebase exists yet, **React + TypeScript + Tailwind** is the safest match
for the design's density and monospace aesthetic.

The HTML is structured around plain functional components (`LHomeV2`,
`LPlanV2`, `LGoalsScreen`, `LActivityScreen`, etc.) — these map 1-to-1 to the
screens you'll build.

---

## 2 · Fidelity

**High-fidelity** for layout, typography, copy, table columns, and information
architecture. Pixel-perfect recreation is the goal.

The data is currently mock data hard-coded in `app-content.js` and `ledger-skin-v2.jsx`
(the `V2` object). Wire it to your real engine.

---

## 3 · Visual system — design tokens

Defined at the top of `ledger-skin-home.jsx` (`L_T` object) and reused throughout.

| Token              | Value      | Use                                                |
|--------------------|------------|----------------------------------------------------|
| `bg`               | `#fbfaf3`  | Page background — warm off-white "paper"           |
| `paper`            | `#ffffff`  | Inner card / table surfaces                        |
| `ink`              | `#0a0a0a`  | Primary text, table borders, strong type           |
| `inkSoft`          | `#2a2a26`  | Secondary text                                     |
| `muted`            | `#807d72`  | Tertiary text, labels, hints                       |
| `faint`            | `#d8d6cd`  | Dashed rules between table rows                    |
| `ruleSoft`         | `#ece9dd`  | Slider tracks, very-faint dividers                 |
| `accent`           | `#c96442`  | Brand orange — links, key actions, milestone marks |
| `accentInk`        | `#8b3a1f`  | Hover/active state of `accent`                     |
| `positive`         | `#15803d`  | Savings, paid full, post-tax improvements          |
| `negative`         | `#b91c1c`  | Bleed APRs, overdue, partial-pay shortfalls        |
| `highlight`        | `#fff3a3`  | **NO LONGER USED ON HOME ROWS** — was the "yellow tinge" the user vetoed. Still used in the Plan trajectory fill at 55% opacity, and the schedule-amended banner |
| `highlightSoft`    | `#fff8d3`  | **Removed from all home/goal rows** — kept only for one engine-note callout |

**Typography**
- Body / numbers: `IBM Plex Mono`, fallback `JetBrains Mono`, then `ui-monospace, monospace`
- Sizes: 9px (axis labels, micro-eyebrows), 10px (section meta), 11px (body / table cells), 12-13px (KPI subtitles), 16-32px (KPI values), 17-26px (page hero copy)
- Letter spacing: `0.06em–0.18em` on uppercased labels; `-0.01em` on large numbers
- Numerals: `font-variant-numeric: tabular-nums` everywhere financial figures appear

**Density**
- Tables, not cards. Rows separated by `1px dashed faint` rules.
- 2px solid `ink` rule at table top and table footer.
- Padding inside table cells: `10–12px vertical`, `12px horizontal`.

**Accent strip pattern (new in this version)**
- Replacing the old yellow `highlight` background rows.
- Use a `border-left: 3px solid <tone>` on the `<tr>` to flag a row as "highest
  APR" (negative tone) or "engine pick" (accent tone). Rest of the row stays
  on the page background. This is calmer and reads better at small sizes.

---

## 4 · Screens

The app has **8 primary screens** (was 9 — `/debts` was deleted; its content was
ported to `/home`, `/notes`, and `/portfolio` per the most recent revision).

### 4.1 Home — `LHomeV2` (`ledger-skin-v2.jsx`)

The daily-statement view. Always opens here.

**Sections, top to bottom:**

1. **Masthead** — `LMastheadV2` — `STMT #1138-HOME` · tab switcher (Home, Plan, Notes, Goals & Tools, Activity, Portfolio, [Tax — business only], Setup, Windfall).
2. **Context bar** — repeated from setup: regime, plan-start, marginal rate.
3. **Cash-flow trio** — three boxes, equal styling (no yellow surplus highlight):
   - `SALARY · TAKE HOME` (₹1,80,000 example)
   - `EXPENSES · MAY` (₹75,000)
   - `SURPLUS · NET` (₹1,05,000) — `positive` color, same size as the other two
4. **Status KPI grid** — 4 KPIs: Consumer Debt Free, All Debt + Goals Done,
   Effective APR, Confidence. **No orphan "PAY ₹X" cell.**
5. **Assumptions strip** — six editable inline chips:
   `HIKE = +8% / Y · STARTS APR 27`, `NEVER MISS MIN EMI`, `TAX SHIELD REINVESTED`,
   **`EF · 30% OF SURPLUS · TARGET 6 MO TAKE-HOME`** *(was "50/50 liquid/FD" — fixed)*,
   `INFLATION +6% / Y`, `FX DRIFT OFF · NRI ONLY`. Click any chip to edit.
6. **Pay This Month register** — table of every payment the engine schedules
   this month. **Now compact** (`WHY` + `STATUS` columns folded inline under the
   target name to fit mobile). Per row:
   - `MARK PAID FULLY` (was `MARK PAID`)
   - `PARTIAL / OTHER` (was `PARTIAL`)
   - On click, the row gets the matching tag and the amount strikes through.
   - Action `LOG IN ACTIVITY →` was removed from each row (the per-row action is
     the mark-paid affordance; the section header already exposes a
     `[+ LOG NEW ENTRY]` flow).
7. **Allocation shape bar** — `LAllocationBar` — single horizontal bar showing
   the relative size of each scheduled payment in (6).
8. **Restructure · Layer 1** — table of refinance / balance-transfer
   opportunities. **Rewritten as a sortable table** with explanations inline
   on expand (was a marquee block).
   - Columns: `# · KIND · FROM · TO · Δ RATE · BREAKEVEN · SAVES / Y · STATUS`
   - Click `[ OPEN ROW ]` to expand: explainer prose + alt-lender + rate-as-of
     + eligibility + actions (`OPEN APPLICATION`, `SEE ALT`, `NEGOTIATE SCRIPT ↓`)
   - The first row carries a `border-left: 3px solid accent` (not yellow bg).
9. **Stale Card nudge** *(ported in from the deleted /debts tab)* — one-line
   warning above Open Positions when a credit card hasn't been reconciled in
   N days. Actions: `RECONCILE NOW` · `DISMISS 7D`.
10. **Open Positions** — the debts ledger. Same expandable behaviour as the
    deleted /debts tab: click any row → inline `EFFECTIVE APR BREAKDOWN`
    showing nominal → fees → GST → tax-shield → effective. `[EDIT ENTRY]`
    and `[WHY THIS APR?]` are in the row header.
11. **Tools mini-grid** — small grid pointing to other tools (windfall etc).

**Notes**
- The "Where cash sits" section is **NOT** on this page — it lives on `/portfolio`.

### 4.2 Plan — `LPlanV2` (`ledger-skin-v2.jsx`)

**Trimmed:** Modelling toggles, Next Action card, and Restructure section were
all removed.

1. **Schedule Amended banner** — yellow `highlight` bg, points at /activity.
2. **CLI header + Assumption chips** + **KPI grid** (Debt-Free, Interest Saved,
   Months Saved, Monthly Outlay).
   - `MONTHLY OUTLAY` subtitle now reads `"EMI + EXTRA (SURPLUS REDIRECTED TO HIGHEST APR)"` — clarifies what "extra" means.
3. **Trajectory chart** — `LTrajectoryV2` — **rebuilt**. Was a simple line; now:
   - 18 monthly samples, smooth path
   - Filled area under the avalanche path at 55% opacity
   - Dashed comparator: "Min-payment-only baseline"
   - Three milestone markers (Kotak Clear, HDFC PL Clear, Consumer Debt-Free)
   - Labelled y-axis (`₹0L–₹40L`) and x-axis (`MAY 26 → OCT 27`)
   - Legend below: solid line · dashed line · milestone square
4. **Amortisation table** — uniform `highlight` row tint (no orange creep from
   one row).
   - **Floating-rate alert** for the HDFC HL reset is **below the table** now
     (was inside the table — looked cluttered).
   - **Central-bank repo callout** is right beneath the floating-rate alert —
     this is its proper home, not the amortisation row.
5. **Recent Activity strip** — last 3 events, link to /activity.
6. **What-If sandbox** — 4 plain-English sliders, each shows live impact on
   debt-free date + interest. `[APPLY → ACTIVITY]` per row.

### 4.3 Notes — `LInsightsV2` (`ledger-skin-v2-screens.jsx`)

The engine's commentary.

1. **Summary strip** — 4 KPIs.
2. **Insight cards** — variable-length list, each card optionally renders a
   `LMathBlock` for worked-example claims.
3. **Lifecycle Events** *(ported from the deleted /debts tab; was per-loan
   trajectory charts here, which looked bad)* — table of out-of-band events
   that will move the plan: floating resets, slab crossings, LTV thresholds.
   Each row: `DATE · LOAN · KIND · WHAT · STATUS · EDIT`.

### 4.4 Goals & Tools — `LGoalsScreen` (`ledger-skin-v2-screens.jsx`)

**Tools was merged into Goals** per the latest request.

1. **Goals KPI strip** — Active, Funded, Behind, Priority Goal.
2. **Goal Ledger table** — per row: `OPEN · EDIT · CANCEL` (or `ARCHIVE` if
   funded).
   - `OPEN` → goal detail (history, ETA sensitivity, draw-down plan).
   - `EDIT` → change target / ETA / monthly / priority; logs to /activity.
   - `CANCEL` → marks cancelled; contributions stop; saved amount stays;
     routed to engine next month.
   - The priority row gets `border-left: 3px solid accent` (no yellow bg).
3. **New Goal · Input Spec** — 8-card grid documenting what to capture when
   the user creates a goal: Label, Target, When-by, Why/Worthiness, Starting
   Position, Priority, Park-Where, Fail Mode. **This answers the user's
   question "what should the input form ask?"**
4. **Worked Example** — the exact scenario the user asked about:
   - Goal target ₹15,00,000 · monthly surplus ₹50,000 · two debts ₹1L (Kotak CC 42.48%) + ₹5L (PL 14.2%)
   - Shows engine allocation month 1: ₹35K → Kotak · ₹10K → PL min EMI · ₹5K → goal
   - Phased outcome over 3 windows (Mo 1–3, 4–28, 29+)
   - `LMathBlock` with the engine math
5. **Allocation Sandbox** — kept, reframed as "optional override of the engine"
   for users who want to play. Engine still warns when the override costs >0.5 mo
   of debt-free date.
6. **Tools index** — table of 7 one-question tools: Windfall, New-debt-check,
   Liquidate, Recompute, Cash-yield, Right-time, NRI-prepay. Each row has
   `[ OPEN → ]`.

### 4.5 Activity — `LActivityScreen` (`ledger-skin-v2-screens.jsx`)

The central registration hub. Every payment, rate update, expense change,
income change, lifecycle event logs here.

1. **Month jump-strip** — clickable bracketed chips per month (`JUN 26 · 4`,
   `MAY 26 · 4`, `APR 26 · 3`). Click to **collapse** that month — keeps the
   current month tight as the ledger grows.
2. **Per-month sections** — collapsible header, then table.
   - **Due column is now prominent** (DD big · MON small uppercase tracking,
     year stripped because the section header conveys it).
   - Pending rows have a calm `highlightSoft` tint and 0.85 opacity.
   - Per row: `EDIT` · `UNDO` (or `LOG NOW` if pending).
3. **Log New Entry modal** — pinned open in the demo. Six-type radio:
   `PAYMENT · PARTIAL · RATE UPDATE · EXPENSE CHANGE · INCOME CHANGE · LIFECYCLE`.

### 4.6 Tax — `LTaxScreen` (business-only, `ledger-skin-v2-screens.jsx`)

1. KPI strip · Next Due, Estimated Liability, Paid YTD, Penalty Risk.
2. **Advance Tax · 4 instalments** table.
3. **Deductions by Loan** table.

### 4.7 Portfolio — `LPortfolioScreen` (`ledger-skin-v2-screens.jsx`)

1. Holdings KPIs.
2. Holdings table with after-tax yield and liquidation order.
3. **Cash · where it sits, what it earns** *(ported in from the deleted /debts
   tab)* — with the "idle threshold" definition explicitly stated above the
   table. The row of the worst-yield bank gets a `negative` accent.

### 4.8 Windfall — `LWindfallV2` (`ledger-skin-v2-screens.jsx`)

**Rebuilt around per-target sliders** (rev 3) — the single split slider, the
split presets, and the worked-example narrative are all gone.

1. **`01 · INPUT`** panel (amount, source, when-received, decision-log stamp).
2. **`02 · ALLOCATE THE WINDFALL`** — one slider per target, in two groups:
   - **DEBTS · HIGHEST APR FIRST** — listed in avalanche order (Kotak CC 42.48%
     → HDFC PL 14.50% → SBI Auto 9.25% → HDFC HL 8.50%). Each debt slider's
     bottom-right corner shows its impact badge: **`▸ DEBT-FREE +N MO`**
     (months pulled forward, scaled to the amount on that slider).
   - **GOALS** — one slider per active goal. Bottom-right badge reads
     **`▸ +N% PROGRESS · NOW X%`** (percentage-points added to that goal, plus
     the resulting total progress).
3. **Mode toggle** — `ENGINE PICK · OPTIMAL` vs `MANUAL UPDATE`:
   - **ENGINE PICK** sets every slider to the correct optimal math (avalanche:
     pour the whole pool into the highest effective-APR debt first, in order).
     Sliders are read-only in this mode.
   - **MANUAL UPDATE** unlocks every slider. The pool is hard-capped at
     ₹1,00,000 — each slider stops at whatever is left (debt sliders also cap at
     their own balance). A pool meter shows `ASSIGNED · LEFT`.
   - `RESET TO ENGINE PICK` restores the optimal split.
4. **RESULTING SPLIT** — combined `LAllocationBar` across all targets + any
   unallocated remainder.
5. **Impact KPIs** — interest avoided, debt-free shift, to-goals, unallocated.
6. **`LMathBlock`** — the math "as it is" (total, strategy, per-debt lines,
   to-goals, interest avoided, unallocated). This replaced the worked example.

> **Engine-mode note:** the optimal math currently routes the entire ₹1L into
> Kotak CC (the only consumer debt whose effective APR beats every goal's
> implied return), so the other sliders read ₹0 until the user switches to
> MANUAL UPDATE. That is correct avalanche behaviour, not a bug.

**Mock data** for this screen lives at the top of `ledger-skin-v2-screens.jsx`
(`WF_TOTAL`, `WF_debts`, `WF_aprNum`) — wire it to your engine. `WF_engineAlloc`
is the computed optimal allocation; replace it with your solver's output.

---

## 5 · Shared components

Used across multiple screens; recreate as primitives in your component library.

| Component                | File                       | Purpose |
|--------------------------|----------------------------|---------|
| `LShell`                 | ledger-skin-home.jsx       | Outer page shell with header strip + body padding |
| `LMastheadV2`            | ledger-skin-v2.jsx         | Top tab strip + statement id + sign-in |
| `LSectionHeader`         | ledger-skin-home.jsx       | `$ TITLE` left, action brackets right |
| `LKpi`                   | ledger-skin-home.jsx       | Responsive KPI grid · 2/4 cols, each with label / value / sublabel / tone |
| `LBracket`               | ledger-skin-home.jsx       | `[ACTION]` styled button-link; `active` and `accent` variants |
| `LField`                 | ledger-skin-home.jsx       | Input-display field with label + value + hint |
| `LRule`                  | ledger-skin-home.jsx       | Horizontal rule |
| `LExpandPanel`           | ledger-skin-v2.jsx         | The accordion body that appears below an expanded table row |
| `LAllocationBar`         | ledger-skin-v2.jsx         | Horizontal stacked bar with inline segment labels |
| `LMathBlock`             | ledger-skin-v2.jsx         | Right-aligned `lhs = rhs (note)` math derivation list |
| `LProgressBar`           | ledger-skin-v2.jsx         | Block-character progress bar (★★★★☆) |
| `LGoalSlider`            | ledger-skin-v2.jsx         | Multi-goal sandbox slider (proportional compress) |
| `LOpenPositionsExpandable`| ledger-skin-v2.jsx        | The debts ledger w/ row-expand to APR breakdown |
| `LTrajectoryV2`          | ledger-skin-v2.jsx         | Plan trajectory chart |

---

## 6 · State

- Mock data lives in `ledger-skin-v2.jsx` (the `V2` object) and the original
  `app-content.js` (`window.APP`). Replace with calls to your engine.
- Local UI state in each screen is plain `useState`:
  - `paidRows` — which Pay-This-Month rows the user has marked
  - `marqueeOpen` — which restructure row is expanded
  - `openPosExpanded` — which Open Positions row is expanded
  - `collapsed` (Activity) — which months are collapsed
  - `mode` (Windfall) — `'engine'` | `'manual'`
  - `manual` (Windfall) — array of per-target rupee amounts (manual overrides)

---

## 7 · What changed in this revision

- ✂ `/debts` tab deleted.
  - Stale-card nudge → `/home` above Open Positions.
  - Lifecycle Events → `/notes`.
  - Cash Management → `/portfolio`.
  - Open Positions (with inline EFFECTIVE APR BREAKDOWN expand) → `/home`.
- ✂ `/tools` tab deleted; merged into Goals as **Goals & Tools**.
- ✂ Modelling, Next-Action, and Restructure removed from `/plan`.
- ✂ Per-loan trajectory charts removed from `/notes` (replaced with Lifecycle).
- ✂ "Where cash sits" removed from `/debts` (now lives in `/portfolio`).
- ✏ Pay-This-Month: `WHY` + `STATUS` columns collapsed inline under the target
  name; row actions reduced to `MARK PAID FULLY` + `PARTIAL / OTHER`.
- ✏ Yellow `highlight` removed from cash-flow boxes (surplus no longer tinted),
  Open Positions highest-APR row, and Restructure top row — replaced with a
  thin left-border accent strip.
- ✏ EF assumption fixed: `EF · 30% OF SURPLUS · TARGET 6 MO TAKE-HOME` (was
  "50/50 liquid/FD" which was wrong).
- ✏ Monthly Outlay subtitle now clarifies "extra" = surplus redirected to
  highest APR.
- ✏ Restructure marquee → table with inline explanations on expand.
- ✏ Trajectory chart rebuilt with area fill + milestone markers + clear
  baseline + axis labels.
- ✏ Amortisation: uniform highlight tint; floating-rate alert + RBI
  context moved below the table.
- ✏ Activity: prominent due-date column (DD big, MON small); month jump-strip
  + collapsible month sections to scale as ledger grows.
- ✏ Goals: per-row `OPEN · EDIT · CANCEL`; new 8-card Input Spec block;
  worked example (₹15L goal + ₹50K surplus + ₹1L+₹5L debts).
- ✏ Windfall rebuilt around a single 0–100% split slider with
  `ENGINE PICK ↔ GOALS` semantics + presets including `₹50K / ₹50K`.

**Rev 3**
- ✏ Windfall rebuilt **again** — per-target sliders (one per debt, debts in
  highest-APR/avalanche order, then one per goal). Each slider carries its own
  bottom-corner impact badge (`DEBT-FREE +N MO` for debts, `+N% PROGRESS` for
  goals). Split slider, split presets, and the worked-example narrative removed;
  the screen now shows just the sliders + `LMathBlock` ("the math as it is").
  `ENGINE PICK · OPTIMAL` sets the optimal avalanche split; `MANUAL UPDATE` is
  the secondary edit mode (pool capped at ₹1L).
- ✏ `LSectionHeader` (`ledger-skin-home.jsx`) restyled so headings differentiate
  — `$ TITLE` is now bold/ink/uppercase with a 2px bottom rule (was muted, 600
  weight, no rule). Windfall additionally uses numbered `01 / 02` block headers.

---

## 8 · How to render the bundle yourself

Open `references/App Insides - Ledger.html` in a browser. It loads React +
Babel + JetBrains Mono / IBM Plex Mono from CDN, then mounts a
`<DesignCanvas>` with three sections:
1. **Ledger · V2** — current target. 8 artboards (Home, Plan, Notes,
   Goals & Tools, Activity, Tax, Portfolio, Windfall).
2. **Ledger skin · Desktop (original)** — kept for diff/comparison.
3. **Ledger skin · Mobile (original)** — mobile reference.

Use the V2 section as the source of truth.

---

## 9 · Asset / brand notes

No logos, no third-party brand assets. The aesthetic is **monospace + paper +
ink** with a single orange accent. Use the existing brand system in the target
codebase if there is one — only the type, the density, and the table-first
information architecture need to carry over.

---

## 10 · Files in this bundle (`references/`)

| File                          | What it is |
|-------------------------------|------------|
| `App Insides - Ledger.html`   | Top-level page; mounts the DesignCanvas with all artboards |
| `ledger-skin-home.jsx`        | `L_T` tokens · `L_mono` font stack · `LShell` / `LMasthead` / `LSectionHeader` / `LKpi` / `LBracket` / `LField` / `LRule` / original `LHomeSimple` + `LHomeOverwhelmed` |
| `ledger-skin-v2.jsx`          | **The V2 layer** — V2 mock data, `LMastheadV2`, `LAllocationBar`, `LMathBlock`, `LProgressBar`, `LGoalSlider`, `LExpandPanel`, `LOpenPositionsExpandable`, `LHomeV2`, `LPlanV2`, `LTrajectoryV2` |
| `ledger-skin-v2-screens.jsx`  | Remaining V2 screens: `LDebtsV2` (kept in source but unused — safe to ignore), `LInsightsV2`, `LGoalsScreen` (Goals & Tools), `LTaxScreen`, `LPortfolioScreen`, `LWindfallV2`, `LActivityScreen` |
| `ledger-skin-rest.jsx`        | Original (pre-V2) screens — Plan, Debts, Insights, Onboarding, Tools, Windfall — kept for diff reference |
| `app-content.js`              | Original mock data (`window.APP`) — tools list, sample windfall data, etc. |
| `design-canvas.jsx`           | Canvas shell that lays artboards out side-by-side. Not part of the product — only used in this design preview. Do NOT recreate. |
