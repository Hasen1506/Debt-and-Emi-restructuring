# Handoff: Finoptima — Ledger skin ("The Statement")

> A complete spec for recreating the **Ledger** visual direction inside an existing debt / EMI / restructuring app codebase, including guidance for screens that are **not** in the prototype yet (Hike modeling, Inflation, etc.).

---

## 0. About these files

Files in `references/` are **HTML design references** — React-in-browser prototypes that show the intended look, density, and copy voice. They are **not** production code to drop into your app.

Your job is to **recreate this visual language inside the existing codebase** using its established patterns (its router, its state layer, its number-formatting helpers, its existing screens). Treat the references as a style bible, not a code dump.

**Fidelity: HIGH (hi-fi).** Colors, typography, spacing, table treatments, ASCII rules, and copy voice are all final. Match pixel-for-pixel.

---

## 1. The aesthetic in one paragraph

**"A printed bank statement crossed with a terminal session."** IBM Plex Mono everywhere. No rounded corners. No gradients. No shadows. No emoji. ASCII rules (`─`, `┌──┐`, `└────┘`) as decorative dividers. Section headers prefixed with `$`. Navigation items wrapped in `[BRACKETS]`. Tabular numbers (`font-feature-settings: "tnum"`). Dense data tables with dashed dividers. The "highlighted" row in any table uses a soft yellow wash. The accent terracotta is used **only** on the loudest things — the single next action, the highest-APR debt, the active tab — never decoratively.

---

## 2. Design tokens

Copy these into your codebase's token file (Tailwind config / CSS variables / theme object — whatever it uses).

### Colors

| Token | Hex | Use |
|---|---|---|
| `bg` | `#fbfaf3` | Page background (warm off-white, "newsprint") |
| `paper` | `#ffffff` | Inset card / chart background |
| `ink` | `#0a0a0a` | Primary text, hard rules, KPI grid lines |
| `inkSoft` | `#2a2a26` | Body copy on paper |
| `muted` | `#5e5e58` | Labels, secondary metadata |
| `faint` | `#a8a8a3` | Dashed table-row dividers, inactive tab |
| `rule` | `#0a0a0a` | Hard top borders (2px solid ink) |
| `ruleSoft` | `#d8d6cd` | Slider track |
| `accent` | `#c96442` | Loudest-debt highlight, active nav underline, "this month action" eyebrow, primary CTA bar fill |
| `accentInk` | `#8b3a1f` | Reserved for hover/pressed accent states |
| `positive` | `#15803d` | Savings, "cleared" badges, debt-free deltas |
| `negative` | `#b91c1c` | Highest APR cell, interest-paid column, "+months" sensitivity |
| `highlight` | `#fff3a3` | Yellow row wash on the highlighted debt / event row |
| `highlightSoft` | `#fff8d3` | Same wash, used on hover-suggestions (reserve) |

### Typography

- **Family:** `'IBM Plex Mono', 'JetBrains Mono', ui-monospace, monospace` — full app, no exceptions.
- **Feature settings:** `font-feature-settings: "tnum"` on every numeric column.
- **Sizes (px, fixed — do not "responsive-scale" these):**
  - `9` — micro labels, dashed-row event tags
  - `10` — section eyebrows, KPI labels, footer caps
  - `11` — nav `[BRACKETS]`, table body, KPI sub-line
  - `12` — body copy, insight paragraph
  - `13` — onboarding field value
  - `15-17` — KPI value (mobile vs desktop)
  - `18-22` — onboarding step title, debt detail title
  - `20-26` — hero number / verdict line
- **Weights used:** 400, 500, 600, 700 only. Headlines are 700. Mono looks broken at light weights — never go below 400.
- **Letter-spacing:**
  - `0.18em` on caps section headers (e.g. `$ STATUS`, `$ PLAN`)
  - `0.14em` on footer caps + bracket nav
  - `0.12em` on KPI labels
  - `0.08em` on table column headers
  - `-0.01em` on large headlines (KPI values 17px+, hero numbers)
- **Line-height:** `1.55` body, `1.25–1.35` headlines, `1.7` insight prose.

### Spacing

Use a **4-px base** scale: `4, 6, 8, 10, 12, 14, 16, 18, 22, 28, 32`. No 24, no 20 — odd values are intentional (the references use 14, 18, 22 a lot to feel "set in lead", not on an 8-pt grid).

- Page padding desktop: `18px 32px 32px`
- Page padding mobile: `14px 18px 28px`
- Section gap (`flex column gap`): `22px`
- KPI cell padding: `10px 14px`
- Table cell padding: `10px 12px` (body), `6px 10px` (dense amortisation tables), `8px 12px` (headers)
- Card padding (hard 2px border): desktop `18px 22px`, mobile `14px 16px`

### Borders, rules, no radii

- **`border-radius: 0` everywhere.** No exceptions, ever.
- **Hard frame:** `2px solid #0a0a0a` (the "I am a statement block" border — used on action card, plan sensitivity, windfall verdict).
- **Section frame:** `1px solid #0a0a0a` (less loud — onboarding loan card, math block).
- **Hairline:** `1px dashed #a8a8a3` for table row dividers.
- **Top rule on tables:** `2px solid #0a0a0a` top + `1px solid #0a0a0a` bottom on the `<thead>`.
- **Masthead top:** `6px solid #0a0a0a` (the signature page-top slab).
- **KPI grid trick:** the grid lines between KPI cells are produced by `background: ink; padding: 1px; gap: 1px` on the wrapper, with `background: bg` on each cell. This gives crisp hairlines without per-cell borders.

### Shadows, gradients

- **None.** Zero shadows, zero gradients. If a thing needs to "lift", thicken its border to 2px and recolor to ink. If a thing needs depth, invert it (ink bg, bg text) — that's the only "elevated" treatment.

---

## 3. Primitives (the components you must build first)

These appear on every screen. Build them once, reuse everywhere. (Names mirror what's in `references/ledger-skin-home.jsx`.)

### `LRule`
A horizontal ASCII rule made by repeating `─`. Used directly under the masthead nav and as a section divider on the Notes screen.

```
─────────────────────────────────────────────  (× length, 11px, weight 700)
```
Props: `char` (default `─`), `length` (default 200), `color` (default ink).

### `LBracket` — the nav item
Inline element rendered as `[LABEL]` in 10px caps with 0.14em tracking. States:
- **default:** muted color, weight 500
- **active:** ink color, weight 700, **2px underline in accent** with 4px offset
- **accent:** accent color (used for `+ ADD DEBT`, `← BACK TO CALM`)

Always wrap the label in literal `[` and `]` glyphs — these are part of the design, not borders.

### `LShell`
The full-viewport screen container: column flex, mono font, `tnum` enabled, bg = `#fbfaf3`.

### `LMasthead` (header)
Sticky, non-scrolling. Layout top-to-bottom:
1. `6px solid ink` top slab.
2. Row 1 (baseline-aligned, justify-between): **FINOPTIMA / LEDGER** wordmark (14px, 700, 0.18em tracking) on the left; **THU, 14 MAY 2026 · 14:32 IST · STMT #1138** on the right (10px muted, 0.1em tracking). The `STMT #` token changes per screen — see "Stamps" below.
3. ASCII rule (300 `─`).
4. Nav row of `LBracket`s: **LEDGER · PLAN · DEBTS · TOOLS · NOTES · SETUP**, plus `[IN · ₹]` pinned right (locale toggle).
5. ASCII rule.

Mobile: same structure, smaller padding (`12px 18px 0`), nav `flex-wrap` with horizontal scroll.

### `LFooter`
Two `[BRACKET]` clusters justified to opposite ends:
- **Left:** `[FEELING OVERWHELMED?]` in accent (or `[← BACK TO CALM]` when on Overwhelmed view).
- **Right:** `[SIMPLE]` `[DETAILED]` toggle — current mode is active.

### `LSectionHeader`
`$ SECTION NAME` in 11px caps muted on the left, optional right slot for `[CSV]` `[PRINT]` `[+ ADD DEBT]` etc.

### `LKpi`
A row of KPI cells in a 1-px-ink grid. Each cell:
- 10px muted label (caps, 0.12em tracking)
- 17px / 700 value (15px on mobile) — color can be tone-coded (positive / negative / accent)
- 10px muted sub-line below

Desktop = `repeat(N, 1fr)` where N is cell count. Mobile = always `repeat(2, 1fr)`.

### `LDebtsTable`
- Top: `2px solid ink`; header bottom: `1px solid ink`.
- Row: `1px dashed faint` bottom. Highlighted row: `background: #fff3a3`.
- Columns: `# · LENDER · TYPE · RATE · EFFECTIVE · [POST-TAX] · OUTSTANDING · EMI · TENURE · NEXT`
- The `POST-TAX` column only renders when `showShield` is true (Plan / Debts screens).
- On the highlighted row, **EFFECTIVE** cell is `negative` red + 700; **NEXT** cell is `accent` + 700.
- Mobile: do not reflow. Set `min-width: 600px` on the table and let the parent scroll horizontally. **Density is the point.**
- Footer row: `2px solid ink` top, bold TOTAL with outstanding + EMI summed; rest blank.

### `LTrajectory`
SVG line chart on a `2px solid ink` framed white card:
- Gridlines at 0%, 25%, 50%, 75%, 100% (top/bottom solid, middle dashed 2/3 faint).
- Y labels `₹41L / ₹20L / ₹0` (9px muted, right-aligned at x=32).
- Two paths: **AVALANCHE** (2px solid ink), **MINIMUMS** (1px dashed muted).
- Last point of AVALANCHE: 8×8 accent square marker + label `AUG '27 · CLEAR` in accent 700.
- X labels at quarter intervals: `MAY 26 · NOV 26 · MAY 27 · NOV 27 · MAY 28`.

### `LField` (onboarding input)
- 9px caps muted label (0.14em tracking)
- A value bar: `border-bottom: 2px solid ink`, 13px / 600 value
- Optional 9px muted hint below

### Stamps (the `STMT #` token in the masthead)
Every screen carries a statement number on the masthead, like a real bank document:

| Screen | Stamp |
|---|---|
| Home (Simple / Detailed) | `STMT #1138` |
| Home (Overwhelmed) | `STMT #SOFT` |
| Plan | `STMT #1138-PLAN` |
| Debts | `STMT #1138-DEBTS` |
| Notes | `STMT #1138-NOTES` |
| Onboarding | `STMT #SETUP` |
| Tools index | `STMT #TOOLS` |
| Windfall tool | `STMT §8a-WINDFALL` |

When you add new sections, follow the pattern: `#1138-<SECTION>` for primary screens, `§<n><a-z>-<NAME>` for tools.

---

## 4. Screens (existing)

Each screen has both **Desktop** (1200 wide) and **Mobile** (390 wide) artboards. Mobile keeps tables wide and lets them scroll — it does not reflow them into cards.

### 4.1 Home — Simple × Calm (the daily statement)
The default landing. Sections, top to bottom, gap 22:

1. **STATUS** — 5-cell KPI row: `OUTSTANDING`, `DEBT-FREE` (positive tone), `EFFECTIVE APR`, `SURPLUS` (positive tone), `NEXT ACTION` (accent tone).
2. **`$ THIS MONTH · DO THIS`** card — 2px ink border. Accent eyebrow, big headline ("PAY ₹18,500 EXTRA → KOTAK CARD"), muted reasoning line, three `[BRACKET]` actions: `I PAID THIS` (active), `WHY?`, `SHOW MATH ↓`.
3. **OPEN POSITIONS · 4** — debts table, no post-tax column.
4. **TOOLS · 7** — 7-cell grid (mobile: 2-cell). Each cell: tiny accent `§<id>` tag, 11px bold tool name, 10px muted question.

### 4.2 Home — Detailed × Calm (full diagnostics)
Same skeleton, plus:
- **Confidence band** in section header (`★★★★☆ · CONF 80%`).
- KPI grid shows 5 cells with `P50 · P10→P90 band` for the clear date.
- **TRAJECTORY · 240MO HORIZON** SVG chart.
- Debts table includes the `POST-TAX` column.
- **SENSITIVITY · WHAT IF** — 4-cell grid: `Rate +1%`, `Surplus −10%`, `Job loss 3 mo`, `Lump sum ₹2L → HDFC`, each showing month delta + interest delta tone-coded.
- **`$ INSIGHT · 14 MAY`** card — 1px frame, single-line insight with inline `[show formula ↓]`.

### 4.3 Home — Overwhelmed (soft view)
A near-empty screen. Centered 520px-max card, 2px ink frame on white paper:
- ASCII corner brackets: `┌── SOFT VIEW · ONE STEP ──┐` top, `└────────────────────────┘` bottom.
- Quiet ladder of copy:
  1. 10px muted: `TAKE A BREATH. YOU'RE GOING TO BE OKAY.`
  2. 24px bold: `PAY ₹18,500 TO YOUR KOTAK CREDIT CARD.`
  3. 12px muted explanation paragraph.
  4. Full-width black button: `[ I'LL DO THIS ]` (ink bg, bg text, no radius, 14px padding, 13px 700 0.14em tracking).
  5. `OR · [SEE THE FULL STATEMENT]` centered below.
- Closing paragraph below the card: `TOTALS, TRAJECTORIES, AND THE OTHER DEBTS ARE HIDDEN ON PURPOSE.`
- Masthead stamp flips to `STMT #SOFT`. Footer left flips to `[← BACK TO CALM]`.

### 4.4 Plan
1. Header line: `$ PLAN · STRATEGY=AVALANCHE · HORIZON=240MO · MARGINAL=30% · CONF=80%` — this single CLI-style line replaces a heavy header.
2. KPI: `CLEAR DATE · TOTAL INTEREST · MONTHS SAVED · MONTHLY OUTLAY`.
3. **TRAJECTORY · TOTAL DEBT OVER TIME** + legend below (`▬ AVALANCHE`, `┄ MINIMUMS`).
4. **RESTRUCTURE · LAYER 1** table: `KIND · FROM · TO · Δ RATE · BREAKEVEN · SAVES/Y · STATUS`. `Δ RATE` cells in positive green with `−Xpp` format. Right-side header slot shows `SAVES ₹48,720/YR` in positive bold.
5. **AMORTISATION · NEXT 12 MO** — dense table, 9px headers. Per-debt columns + `EXTRA`, `INT PAID` (negative red), `PRIN` (positive green), `BALANCE` (bold), `EVENT`. Event-bearing rows get the yellow `highlight` wash. Event glyphs: `⊕` for "cleared", `⊙` for "review / reset". Right-side header slot: `[CSV] [PRINT] [↓ EXPAND ALL 240]`.
6. **SENSITIVITY · LIVE ENGINE** — 2px ink card containing three "command-line sliders":
   - Line 1: `$ SET SURPLUS_DELTA =` (muted left) ` +₹15,000/mo` (ink bold right).
   - Custom slider: 6px tall track in `ruleSoft`, filled portion in `ink`, thumb is a **12×12 accent square** at the fill position (not a circle — no roundness anywhere).
   - Outcome line: `→ DEBT-FREE −6 MO  → INTEREST −₹28,400` (tone-coded).

### 4.5 Debts
1. CLI summary line: `$ DEBTS · 4 OPEN · WEIGHTED EFFECTIVE APR 11.94%`.
2. 4-cell KPI: `TOTAL OUTSTANDING · WEIGHTED APR · TOTAL EMI · NEXT RESET (accent)`.
3. **OPEN POSITIONS · DETAILED** — full debts table with post-tax column.
4. **`$ HIGHLIGHTED · LOUDEST DEBT`** — 2px **accent** border (the only place the border itself goes accent). Big bold lender + product line, then a label/value/note 3-column micro-table:
   - `NOMINAL RATE · 36.00% · PUBLISHED APR`
   - `EFFECTIVE · 42.48% · + 1.5% MONTHLY FEE + 18% GST` (value cell in negative red)
   - `OUTSTANDING · ₹1,00,000 · 100% UTILISATION`
   - `MONTHLY INT · ₹3,540 · PURE FRICTION`
   - `VS NEXT · +₹2,420 · MORE THAN HDFC PL + SBI AUTO COMBINED`
   - Bottom action row: `[BALANCE TRANSFER →]` (active) · `[SHOW MATH]` · `[MARK PAID]`.

### 4.6 Notes (Insights)
Engine commentary, presented like newspaper columns:
1. Header line: `$ NOTES · ENGINE OUTPUT · 4 ENTRIES · LAST UPDATED THU, 14 MAY 2026`, followed by an `LRule` divider.
2. Each entry:
   - Metadata strip: `NO. 001  · APR 7, 2026  · RATES  ` (accent eyebrow) `#repo  #floating  #reset` (pinned right).
   - 20px / 700 title in **caps**, slight negative tracking.
   - 12px body, 1.7 line-height.
   - `[OPEN FULL NOTE →]` bracket below.
3. Entries separated by `1px dashed faint`.

### 4.7 Setup (Onboarding)
- CLI summary: `$ SETUP · STEP 3 OF 6 · NO ACCOUNT · NO UPLOAD`.
- **Step rail:** 6 equal cells in a 1-px-ink grid. Each cell shows `01 · COUNTRY`, etc. Current step: ink bg + bg text + 700. Past steps: bg + muted. Future steps: bg + faint.
- Step title block: accent eyebrow `$ STEP 3 · LOANS`, then 22px caps title `LIST EVERY ACTIVE LOAN`, muted description below.
- **Loan card** (one per loan, repeated): `1px ink border`, header `$ LOAN A · CREDIT_CARD`, then a 4-column field grid (2 on mobile) using `LField`. Field labels: `BANK · OUTSTANDING (₹) · NOMINAL RATE · RATE TYPE · TENURE / MO · SCHEDULED EMI · RESET CYCLE · TAX SHIELD`. For credit cards: tenure=0 with hint `REVOLVING`; EMI=0; no reset/shield. For home loans: include reset cycle + tax shield.
- `[+ ADD ANOTHER LOAN]` in accent.
- Footer row above the page-bottom border: `[← BACK]` left, `[ CONTINUE → SAVINGS ]` solid black button right.

### 4.8 Tools index
Header line `$ TOOLS · 7 · ONE QUESTION EACH`, then a single table:
- Columns: `§ · TOOL · QUESTION · WHAT IT DOES · (open link)`
- `§<tag>` column in accent bold.
- Each tool name in caps bold.
- Last column right-aligns `[OPEN →]` in accent.

### 4.9 Windfall tool (§8a)
The model for **every** tool screen. Use this exact pattern when building New-debt check, Liquidate, Cash-yield, Right-time, NRI prepay, and the new ones described below.

Sections top to bottom:
1. CLI header: `$ §8a · WINDFALL · ALLOCATE A LUMP-SUM INFLOW`.
2. Hero question: `GOT A BONUS? WHERE SHOULD IT GO?` — 26px / 700.
3. **`$ INPUT`** card (1px ink border). 3-column field grid using `LField`: `AMOUNT (₹) · FROM · WHEN RECEIVED`. Below the grid, muted hint: `ENGINE CONSIDERS: …`.
4. **`$ VERDICT`** card (2px ink border, the loudest block on the screen):
   - Accent eyebrow.
   - 26px verdict line: `ALLOCATE 100% → KOTAK CARD`.
   - Muted reasoning line: `42.48% EFFECTIVE APR > 4.76% LIQUID AFTER-TAX · GAP 37.72PP`.
   - **Allocation bar** — a single horizontal bar, 26px tall, 1px ink border. Each segment is flex-grown to its percentage, filled with accent (or ink for secondary slices), white centered label `100% · KOTAK CC · ₹1,00,000` in 11px 700. **Not a doughnut. Not a pie. A bar.**
   - 4-cell KPI underneath: `INTEREST AVOIDED · NEW DEBT-FREE · SCORE IMPACT · EF COVERAGE`.
   - Action row: solid black `[ APPLY & RECOMPUTE ]` button + `[TWEAK INPUTS]` + `[SAVE BRIEF]`.
5. **`$ THE MATH`** block (1px faint border, white paper bg): rendered as monospaced code, one assignment per line, muted on the right-hand explanation column:
   ```
   highest_eff_apr   = 42.48%   (KOTAK CC · POST-GST)
   liquid_after_tax  =  4.76%   (6.8% × (1 − 0.30))
   ef_shortfall      =  0       (EF AT 50% TARGET · NO PRIORITY)
   action            =  pay_highest_debt
   interest_avoided  =  100,000 × 0.4248 × (7/12) = ₹24,780
   score_delta_p10p90 = +18 ↔ +28  (CIBIL · 90D · UTIL 100→0)
   ```
   Right-hand parenthetical explanations are in muted, calculated value in positive green/700.

**Every new tool must end with a "THE MATH" block.** It is the trust contract of the app — the user must always be able to see the formula.

---

## 5. Extending to NEW sections (Hike modeling, Inflation, etc.)

Your codebase has features the prototype doesn't show. Build them by composing the primitives above. Below is the template + worked specs.

### Universal template for any new screen

```
LShell
├─ LMasthead    section="<your-key>" stmt="#1138-<NAME>"
├─ <main scroll region — flex column, gap 22>
│   ├─ CLI summary line:  $ <NAME> · <KEY=VALUE · KEY=VALUE …>
│   ├─ KPI row (3–5 cells)         ← always
│   ├─ One signature visual         ← chart, table, slider stack, or bar
│   ├─ "Restructure"-style action table (optional)
│   ├─ Detailed table or breakdown  ← always, with dashed dividers
│   ├─ Sensitivity sliders OR scenario KPIs
│   ├─ $ INSIGHT card  (1px frame, single takeaway sentence with inline bracket)
│   └─ $ THE MATH block              ← if there's a formula, show it
└─ LFooter
```

### 5.1 Hike modeling (`#1138-HIKE`)

**Purpose:** "If my income rises X% per year, when am I really debt-free?"

Add to the nav: `[HIKE]` between `[PLAN]` and `[DEBTS]`.

| Section | Content |
|---|---|
| CLI line | `$ HIKE · ANNUAL_RATE=8% · CADENCE=APR · APPLY_TO=SURPLUS · CONF=80%` |
| KPI (4) | `BASE CLEAR · AUG 2027` / `WITH HIKE · MAY 2027` (positive) / `MONTHS SHAVED · −3` (accent) / `INTEREST AVOIDED · ₹24,800` (positive) |
| Trajectory | Reuse `LTrajectory`, now with **3** paths: minimums (dashed muted), avalanche (solid ink), avalanche+hike (solid accent). Last-point markers labelled `AUG '27` and `MAY '27` |
| Hike schedule table | `YEAR · MONTH · BASE INCOME · % HIKE · NEW INCOME · Δ SURPLUS · CUMULATIVE`. 5 rows = 5 years. Apr-of-year rows get the yellow `highlight` wash. |
| Sensitivity (3 sliders) | `SET HIKE_RATE = 8%` (range 0–20%) · `SET HIKE_CADENCE = APR` (toggle Apr/Oct/Custom) · `SET ALLOC_TO_DEBT = 100%` (how much of the hike goes to debt vs lifestyle inflation). Each shows `→ DEBT-FREE Δ` and `→ INTEREST Δ`. |
| Insight | `$ INSIGHT — At 8%/yr, every rupee of hike retired against Kotak saves 42.48% vs investing it.` |
| Math block | ```next_year_income = income × (1 + hike)```<br/>```surplus_delta = (next_year_income − income) × alloc_to_debt```<br/>```months_saved ≈ Σ surplus_delta_t / weighted_emi_t``` |

### 5.2 Inflation (`#1138-INFL`)

**Purpose:** "What is my debt really costing in today's rupees?"

Add to nav: `[INFL]` between `[HIKE]` and `[DEBTS]`. (Or fold both under a `[REAL]` parent — your call.)

| Section | Content |
|---|---|
| CLI line | `$ INFL · CPI=5.4% · WPI=2.1% · YOUR_BASKET=6.1% · BASE=MAY 2026` |
| KPI (4) | `NOMINAL DEBT · ₹41.8L` / `REAL DEBT (TODAY ₹) · ₹41.8L` / `REAL DEBT AT CLEAR · ₹37.2L` (positive) / `REAL APR · 6.4%` (positive — your nominal weighted APR minus inflation) |
| Real-vs-nominal table | One row per debt: `LENDER · NOMINAL APR · INFLATION · REAL APR · INTEREST · REAL INTEREST`. Color: real-APR cell positive if real APR is below 0, ink otherwise. |
| Trajectory | Two paths: `NOMINAL ₹` (solid ink) and `REAL ₹ (Jun 26 basis)` (solid accent). Both should descend, accent should descend faster. |
| Sensitivity (2 sliders) | `SET CPI = 5.4%` (range 0–12%) · `SET YOUR_BASKET = 6.1%` (range 0–15%). Outcomes: `→ REAL APR Δ` and `→ REAL CLEAR-DATE Δ`. |
| Insight | `$ INSIGHT — At 5.4% CPI, your 8.5% home loan is really costing 3.1% in today's rupees. Sec 24 shield drops that to 1.9%.` |
| Math block | ```real_apr = ((1 + nominal_apr) / (1 + cpi)) − 1```<br/>```real_debt_today = nominal_outstanding × (1 + cpi)^(−months/12)```<br/>```real_clear_debt = nominal_outstanding × (1 + cpi)^(−clear_month/12)``` |

### 5.3 Pattern for ANY additional section you've added

Whatever the new section is — **Tax planning, Prepayment penalty, Joint loans, Floating-rate forecast, Step-up EMI, Bullet repayment** — assemble it from this checklist:

- [ ] Bracket nav entry: short caps label, max 6 chars (`HIKE`, `INFL`, `TAX`, `PREPAY`).
- [ ] Masthead stamp: `#1138-<NAME>`.
- [ ] CLI summary line with 2–4 `KEY=VALUE` parameters in caps.
- [ ] 3–5 KPI cells — at least one should be tone-coded (positive / accent).
- [ ] **Exactly one** "signature visual" — chart, sankey, bar, or table — never two competing visuals.
- [ ] One detailed table with dashed row dividers and at least one yellow-highlighted "important" row.
- [ ] If there's user input: a "sensitivity sliders" card (2px ink border) with the command-line `SET KEY = VALUE` pattern + 12×12 accent square thumbs on 6px tracks.
- [ ] If there's a formula: a `$ THE MATH` block, code-style, with right-aligned muted explanations.
- [ ] Stick to the 13-color palette. No new hues. If you reach for a color and it isn't in §2, you're off-system.

---

## 6. Interactions & behavior

- **Simple ↔ Detailed toggle** (footer right): swaps the home screen's contents. Persist the choice per device.
- **Overwhelmed mode** (footer left): replaces home content with the soft view. Persist; offer `[← BACK TO CALM]` to exit.
- **`I PAID THIS`** on the "this month" card: optimistically clears Kotak, fires recompute, redirects to Plan view with a flash highlight on the cleared row.
- **`[CSV]` / `[PRINT]`** buttons next to any table: real CSV download / browser print stylesheet that already looks correct because the design is monochrome.
- **Sliders**: live recompute on drag. Debounce 80ms. The "outcome" line under the slider updates with **tone color** transitioning (positive ↔ negative) — but not animated, just a hard color swap.
- **No animations longer than 100ms.** Everything is instant. This is a statement, not an app.
- **Hover states**: brackets get the accent underline + ink color. Tables: row gets a 1px accent left border (inserted as box-shadow inset, not a layout shift). Buttons: ink button on hover → accentInk bg.
- **Focus states**: 2px solid accent outline, offset 0. No blue browser default.

---

## 7. State & data shape

`references/app-content.js` is the canonical shape. The fields you'll likely need to add for the new sections:

```js
hike: {
  annualRate: 0.08,          // 8%
  cadence: 'APR',            // 'APR' | 'OCT' | 'CUSTOM'
  allocToDebt: 1.0,           // 100% of the raise goes to debt
  withHikeClearMonth: 'May 2027',
  monthsShaved: 3,
  interestAvoided: '₹24,800',
  schedule: [                 // 5 rows
    { year: 2026, month: 'Apr', baseIncome: 150000, hikePct: 0.08, newIncome: 162000, deltaSurplus: 12000, cumulative: 12000 },
    // …
  ],
},

inflation: {
  cpi: 0.054,
  wpi: 0.021,
  yourBasket: 0.061,
  base: 'May 2026',
  realDebtToday: '₹41,80,000',
  realDebtAtClear: '₹37,20,000',
  realApr: '6.4%',
  perDebt: [                  // for the real-vs-nominal table
    { bank: 'Kotak', nominalApr: 0.4248, inflation: 0.054, realApr: 0.349, interest: 31400, realInterest: 27800 },
    // …
  ],
},
```

Keep number formatting consistent: Indian-locale lakhs/crores (`toLocaleString('en-IN')`), `₹` prefix, `%` suffix, basis points as `XXpp` or `XXbps`.

---

## 8. Files in this bundle

- `references/App Insides - Ledger.html` — entry point. Loads the React prototype and arranges the artboards on a design canvas.
- `references/ledger-skin-home.jsx` — primitives (`LShell`, `LMasthead`, `LFooter`, `LKpi`, `LBracket`, `LRule`, `LDebtsTable`, `LTrajectory`) + the three Home variants.
- `references/ledger-skin-rest.jsx` — Plan, Debts, Notes, Onboarding, Tools index, Windfall tool screens.
- `references/app-content.js` — All copy, numbers, debt portfolio, opportunities, insights, tools, onboarding steps, trajectory dataset.
- `references/design-canvas.jsx` — Only used to lay out the artboards side-by-side. **Not part of the app**; don't port this.

To preview locally, open `App Insides - Ledger.html` in any browser. No build step required.

---

## 9. What to paste into Claude Code

Save this as your first prompt to Claude Code after attaching this folder:

> I'm rebuilding the visual layer of my debt / EMI restructuring app. Attached is `design_handoff_ledger_app/` — a complete spec for the "Ledger" design direction (an IBM Plex Mono, brutalist, printed-bank-statement aesthetic).
>
> Please:
>
> 1. **Read `README.md` end-to-end first.** Don't start editing until you've read §2 (design tokens), §3 (primitives), and §5 (extension patterns).
> 2. **Open `references/ledger-skin-home.jsx` and `references/ledger-skin-rest.jsx`** to see exactly how the primitives are composed. Treat these as the source of truth for spacing, borders, and color usage. They are JSX-in-browser — port them to my codebase's component conventions (look at `<existing component path>` for reference).
> 3. **Add the design tokens** from README §2 to my codebase's theme file (`<path>`). Use exact hex values; do not approximate.
> 4. **Build the primitives first** as reusable components: `LShell, LMasthead, LFooter, LBracket, LRule, LSectionHeader, LKpi, LDebtsTable, LTrajectory, LField`. Stop and show me these before continuing.
> 5. **Then port the existing screens** in order: Home (Simple), Home (Detailed), Home (Overwhelmed), Plan, Debts, Notes, Onboarding, Tools index, Windfall. Wire them to my existing data layer — don't use the mock data in `app-content.js`, only its **shape**.
> 6. **Then apply the design language to my newer sections** that are not in the prototype:
>    - **Hike modeling** — follow README §5.1 exactly.
>    - **Inflation** — follow README §5.2 exactly.
>    - **\[List your other new sections here\]** — follow the §5.3 pattern checklist.
>
> Important constraints:
>
> - `border-radius: 0` everywhere. No exceptions.
> - IBM Plex Mono only. No system fonts, no sans-serifs.
> - No shadows, no gradients, no emoji.
> - Tables stay tables on mobile — horizontal scroll, do not reflow to cards.
> - Use exactly the 13 colors in README §2. If you reach for a color outside that palette, stop and ask.
> - Every tool screen ends with a `$ THE MATH` block.

---

## 10. Out of scope (don't port)

- The design canvas / artboards wrapper (`design-canvas.jsx`) — that's a presentation harness for this handoff, not part of the app.
- The other two skins ("Default", "Editorial") in the parent project — Ledger is the chosen direction.
- The wireframes and persona files — superseded by this spec.
