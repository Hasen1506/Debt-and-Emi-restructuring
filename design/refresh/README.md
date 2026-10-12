# Handoff: FinOptima visual refresh

A targeted UI refresh for [`Hasen1506/Debt-and-Emi-restructuring`](https://github.com/Hasen1506/Debt-and-Emi-restructuring) (the `web/` Next.js app). Keeps the engine, API, and routing intact; restyles screens surface-by-surface using **three coexisting aesthetics** rather than one monolithic redesign.

---

## ⚠️ Confirm this assumption before starting

The owner said: *"I like A and D and existing design too — I want to keep it."*

My interpretation, **which the implementer should confirm with the owner first**:

> The existing design stays as the **foundation** (fonts, tokens, card patterns). Direction A's editorial voice gets layered onto **read-oriented surfaces** (Home, Insights). Direction D's brutalist-mono treatment gets layered onto **data-dense surfaces** (Plan, Debts). Forms and tools (Onboarding, all `/tools/*`) keep the existing pattern unchanged because forms are where the current design is strongest.

If the owner instead wants a **theme switcher** (user picks A, D, or existing as a global mode), the work is significantly larger and the surface-by-surface assignments below become irrelevant — re-scope before building.

---

## What's in this folder

| File | What it is | How to use it |
|---|---|---|
| `README.md` | This spec — the source of truth | Implement from this; the HTML files are just visual references |
| `references/existing-ui-preview.html` | Static render of the **current** Next.js app, every route, drawn from the actual source | Open in a browser to see today's UI |
| `references/redesigns.html` | Pan/zoom design canvas with **all four explored directions** (A, B, C, D) side by side | Open to see what A and D look like — and what we're *not* doing (B, C) |
| `references/direction-a.jsx` | Component source for Direction A artboards (editorial) | Read for layout structure, copy, spacing rhythm |
| `references/direction-d.jsx` | Component source for Direction D artboards (ledger) | Read for table structure, mono treatment, ASCII rules |
| `references/design-canvas.jsx` | The canvas wrapper component (not part of the design — just lets references.html render) | Ignore for implementation |

**Critical: these HTML/JSX files are *design references only*.** They are not production-ready code to copy verbatim. Recreate them in the target codebase using its existing patterns:

- React 18 / Next.js 14 App Router (server components where the existing files are server components)
- TypeScript
- CSS variables on `:root` (no Tailwind, no CSS-in-JS — match `web/src/styles/globals.css`)
- Visx for charts (already a dependency — `@visx/responsive`, `@visx/scale`, `@visx/shape`, `@visx/axis`, `@visx/grid`, `@visx/curve`)
- Existing components in `web/src/components/` reused where possible (`Card`, `ActionTile`, `Stat`, `Field`, etc.)

---

## Fidelity

**High-fidelity.** Final colors, typography, spacing, and copy are all specified below. Pixel-perfect reproduction expected for the parts marked "redesign"; existing surfaces should stay byte-identical (do not "improve while you're in there").

---

## The three-aesthetic system

| Aesthetic | Tone | When to use | Visual signals |
|---|---|---|---|
| **Existing** (the baseline) | Calm utility | Forms, configurations, tool flows | Warm beige `#f0eee9`, terracotta accent, rounded 14px cards, Inter + JetBrains Mono, density: medium |
| **Editorial** (from Direction A) | Advisor speaking to you | One-decision pages — Home, Insights, education | Cream paper `#f4ede2`, **Spectral serif** headlines, marginalia in right column, generous whitespace, no cards — paragraphs and rules |
| **Ledger** (from Direction D) | Printed bank statement | Data-dense pages — Plan, Debts, full schedule | Paper `#fbfaf3`, **IBM Plex Mono everywhere**, no rounded corners, ASCII rules (`─`, `┤`, `└`), highlight rows for events, dense tables |

All three share the same **brand accent `#c96442`** (terracotta) and the same `--positive`/`--negative` semantic colors, so a user switching between surfaces still feels they're in one product. The change is *typographic and structural* — not a color palette swap.

### Surface assignments

| Route | Today's aesthetic | New aesthetic | Why |
|---|---|---|---|
| `/` (Home) | Existing | **Editorial** | One decision per month; talks *to* the user, not at them |
| `/insights` | Existing | **Editorial** | Already prose; serif + marginalia layout amplifies it |
| `/plan` | Existing | **Ledger** | Trajectory chart + restructure opportunities + amortisation table — pure data |
| `/debts` | Existing | **Ledger** | Three rows of facts wants a real table, not three cards |
| `/onboarding` | Existing | **Existing (no change)** | Forms work; don't fix what isn't broken |
| `/tools` (index) | Existing | **Existing (no change)** | Tile grid is fine |
| `/tools/*` (each tool) | Existing | **Existing (no change)** | Form-then-verdict pattern is solid; keep it |

The top nav (`AppShell` in `web/src/app/layout.tsx`) and overall page chrome stays as-is. Only the **content area** of each redesigned route changes.

---

## Design tokens (additions, not replacements)

Add to `web/src/styles/globals.css`. **Keep every existing token.** These are additive.

```css
:root {
  /* ────── EDITORIAL surface (Direction A) ────── */
  --editorial-bg:        #f4ede2;
  --editorial-paper:     #fbf7ed;
  --editorial-ink:       #1a1612;
  --editorial-rule:      #d4c8b3;
  --editorial-muted:     #7a6b58;
  --editorial-accent:    #8b3a1f;   /* deeper terracotta for serif emphasis */
  --editorial-marginalia:#a5947c;

  /* ────── LEDGER surface (Direction D) ────── */
  --ledger-bg:           #fbfaf3;
  --ledger-paper:        #ffffff;
  --ledger-ink:          #0a0a0a;
  --ledger-faint:        #a8a8a3;
  --ledger-muted:        #5e5e58;
  --ledger-highlight:    #fff3a3;   /* for "event happened" row backgrounds */

  /* ────── FONTS (add to existing Inter + JetBrains Mono) ────── */
  --font-serif:  'Spectral', Georgia, 'Times New Roman', serif;
  --font-ledger: 'IBM Plex Mono', 'JetBrains Mono', ui-monospace, monospace;
}
```

Then extend `web/src/app/layout.tsx` to load the new Google Font weights:

```tsx
<link
  rel="stylesheet"
  href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600&family=Spectral:ital,wght@0,300;0,400;0,500;0,600;0,700;1,400&family=IBM+Plex+Mono:wght@400;500;600;700&display=swap"
/>
```

And mirror the same additions in `web/src/styles/tokens.ts` so chart code can reach them programmatically:

```ts
export const tokens = {
  // ...existing color/font/radius/space/shadow blocks unchanged...
  editorial: {
    bg: '#f4ede2', paper: '#fbf7ed', ink: '#1a1612', rule: '#d4c8b3',
    muted: '#7a6b58', accent: '#8b3a1f', marginalia: '#a5947c',
  },
  ledger: {
    bg: '#fbfaf3', paper: '#ffffff', ink: '#0a0a0a',
    faint: '#a8a8a3', muted: '#5e5e58', highlight: '#fff3a3',
  },
} as const;
```

Add utility classes alongside the existing ones in `globals.css`:

```css
/* Editorial surface utilities */
.surface-editorial { background: var(--editorial-bg); color: var(--editorial-ink); font-family: var(--font-serif); }
.serif-h1   { font-family: var(--font-serif); font-weight: 400; font-size: 56px; line-height: 1.05; letter-spacing: -0.02em; }
.serif-h2   { font-family: var(--font-serif); font-weight: 400; font-size: 48px; line-height: 1.1;  letter-spacing: -0.02em; }
.serif-lead { font-family: var(--font-serif); font-size: 18px; line-height: 1.65; }
.serif-em   { font-style: italic; color: var(--editorial-accent); }
.eyebrow    { font-family: var(--font-sans); font-size: 11px; letter-spacing: 0.15em; text-transform: uppercase; color: var(--editorial-marginalia); }
.rule-thin  { border-top: 1px solid var(--editorial-rule); }

/* Ledger surface utilities */
.surface-ledger { background: var(--ledger-bg); color: var(--ledger-ink); font-family: var(--font-ledger); font-size: 12px; line-height: 1.55; }
.ledger-h1     { font-family: var(--font-ledger); font-size: 14px; font-weight: 700; letter-spacing: 0.18em; text-transform: uppercase; }
.ledger-label  { font-family: var(--font-ledger); font-size: 10px; color: var(--ledger-muted); letter-spacing: 0.18em; text-transform: uppercase; }
.ledger-num    { font-family: var(--font-ledger); font-weight: 700; font-feature-settings: 'tnum'; }
.ledger-table  { width: 100%; border-collapse: collapse; font-family: var(--font-ledger); font-size: 12px; }
.ledger-table th { padding: 8px 12px; text-align: left; font-weight: 700; font-size: 10px; letter-spacing: 0.08em; color: var(--ledger-muted); border-top: 2px solid var(--ledger-ink); border-bottom: 1px solid var(--ledger-ink); }
.ledger-table td { padding: 10px 12px; border-bottom: 1px dashed var(--ledger-faint); }
.ledger-table tr.event td { background: var(--ledger-highlight); }
.ledger-table td.num, .ledger-table th.num { text-align: right; font-feature-settings: 'tnum'; }
.ascii { font-family: var(--font-ledger); font-size: 11px; line-height: 1.35; white-space: pre; margin: 0; }
```

---

## New components to add to `web/src/components/`

### `Letter.tsx` (editorial surface wrapper)

Drop-in article wrapper for `/` and `/insights`. Two-column grid: 1fr article + 240px marginalia column.

```tsx
// web/src/components/Letter.tsx
import type { ReactNode } from 'react';

export function Letter({
  eyebrow, title, children, marginalia,
}: {
  eyebrow: string;
  title: ReactNode;
  children: ReactNode;
  marginalia?: ReactNode;
}) {
  return (
    <div className="surface-editorial" style={{ padding: '48px 64px 64px', margin: '0 32px', display: 'grid', gridTemplateColumns: '1fr 240px', gap: 48 }}>
      <article style={{ maxWidth: 640 }}>
        <div className="eyebrow" style={{ marginBottom: 12 }}>{eyebrow}</div>
        <h1 className="serif-h1" style={{ margin: 0 }}>{title}</h1>
        {children}
      </article>
      {marginalia && (
        <aside style={{ fontFamily: 'var(--font-sans)', fontSize: 11, color: 'var(--editorial-marginalia)', lineHeight: 1.6, paddingTop: 36 }}>
          {marginalia}
        </aside>
      )}
    </div>
  );
}

export function LetterMasthead({ section, day }: { section: 'home' | 'plan' | 'insights'; day: string }) {
  /* Volume/date masthead — see references/direction-a.jsx AMasthead for spec */
}

export function DecisionStrip({ items }: { items: Array<{ value: string; label: string; tone?: 'positive' | 'neutral' }> }) {
  /* The "decision in numbers" 3-stat block — see references/direction-a.jsx, the bordered grid section */
}
```

Use `Spectral` for headline/lead text, fall back to system serif. `<em>` inside `<h1 className="serif-h1">` should be italic + `var(--editorial-accent)` color.

### `LedgerStatement.tsx` (data-dense surface wrapper)

```tsx
// web/src/components/LedgerStatement.tsx
import type { ReactNode } from 'react';

export function LedgerStatement({ section, children }: { section: string; children: ReactNode }) {
  return (
    <div className="surface-ledger" style={{ padding: '18px 32px 32px', display: 'flex', flexDirection: 'column', gap: 22 }}>
      <LedgerHeader section={section} />
      {children}
    </div>
  );
}

export function LedgerHeader({ section }: { section: string }) {
  /* Top masthead with FINOPTIMA/LEDGER + stmt date + section tabs [LEDGER] [PLAN] [DEBTS] etc.
     Underlined active tab. See references/direction-d.jsx DHeader. */
}

export function LedgerKpiGrid({ items }: {
  items: Array<{ label: string; value: string; sub?: string; tone?: 'positive' | 'negative' | 'accent' | 'neutral' }>;
}) {
  /* 5-up (Home) or 4-up (Plan) KPI grid with 1px black grout between cells.
     See references/direction-d.jsx → first <section> in DHome. */
}

export function LedgerTable<T>({
  columns, rows, eventKey, rightActions,
}: {
  columns: Array<{ key: keyof T; header: string; align?: 'left' | 'right'; render?: (row: T) => ReactNode }>;
  rows: T[];
  eventKey?: keyof T;          // when truthy, the row gets .event class (yellow highlight)
  rightActions?: ReactNode;    // CSV / Print etc. links in section header
}) {
  /* Use .ledger-table classes. Right-align all numeric columns. */
}

export function AsciiTrajectory({ src }: { src: string }) {
  // Render src in a <pre className="ascii">. The chart is hand-authored ASCII —
  // we DON'T generate it from data. Build it once for Plan and once for Home (mini).
  return <pre className="ascii">{src}</pre>;
}
```

---

## Per-screen implementation specs

### 1. `/` — Home (existing → Editorial)

**Source file:** `web/src/app/page.tsx`
**Reference:** `references/direction-a.jsx` → `AHome`
**Type:** Server Component (keep)

**Replace the entire body** of `HomePage()` with a `<Letter>`-wrapped article. The "tools grid" (currently 6 ActionTiles) is **removed from Home** — Home now talks about *one* decision. The tools live at `/tools` only.

Structure:

1. **Masthead** (replaces top of page): wordmark + "Vol. III · Thursday, 14 May 2026" + nav links across the top *within the article column*. (Note: this is *in addition* to the existing global TopBar in `layout.tsx` — or, if too much chrome, hide the masthead inside Letter and let the global TopBar do the job. Decide visually; reference shows masthead.)

2. **Eyebrow:** `THIS WEEK'S LETTER` (11px, 0.15em letter-spacing, uppercase, `var(--editorial-marginalia)` color)

3. **Headline:** 56px Spectral, weight 400, line-height 1.05. Two lines:
   ```
   <h1>Hasen — pay the card,<br/><em className="serif-em">then breathe.</em></h1>
   ```
   The "then breathe" half is italic, in `var(--editorial-accent)` (`#8b3a1f`).

4. **Body paragraphs:** Two 18px Spectral paragraphs with `line-height: 1.65`. Numbers in `<strong>`. Use the real values from the user's profile:
   - effective APR of highest card (call `engine.formulas.effective_rate_after_gst()`)
   - monthly interest at current balance
   - one-month suggested extra pay
   - 12-month interest saved if cleared

5. **Decision strip** (3 stats in a row, rule-bordered top + bottom): `<DecisionStrip items={[...]} />`. Values are 28px Spectral 500 weight, labels are 11px Inter `var(--editorial-muted)`.

6. **Closing italic line:** 16px Spectral italic, muted color: *"If a bonus, refund, or windfall arrives this month, write back — we'll decide together where it should go."*

7. **Three text links** (not buttons): "Show me the math →", "What if I disagree?", "See alternatives". Underlined, no button chrome. The first link goes to `/plan`, second/third are placeholders for now (no route).

8. **Marginalia column** (right, 240px wide): 3 dated notes pulled from `/api/insights` or hardcoded for v1. Each note: small bold date heading, 12px Inter body, left-border `1px solid var(--editorial-rule)`.

**Data source:** The current page is static (no API calls). New page should still be a Server Component but `await loadProfileServer()` (existing helper in `lib/user-store.ts`) and the highest-rate-loan computation from `engine.ordering` to derive the headline numbers. Fall back to demo profile if no live profile — same pattern as `/plan/page.tsx`.

**Mobile:** Stack to single column at `< 880px`. Marginalia drops below article.

---

### 2. `/insights` — Insights (existing → Editorial)

**Source file:** `web/src/app/insights/page.tsx`
**Reference:** Same Letter component as Home

Convert the two Card-based items into a single editorial column. Each "insight" becomes a dated article block:

```
[Date eyebrow: APR 7, 2026]
RBI held repo at 5.25%
[Spectral body paragraph]
```

Sectioned by `<hr className="rule-thin" />`. No marginalia column needed (or use it for "Sources" / "Last updated").

---

### 3. `/plan` — Plan (existing → Ledger)

**Source file:** `web/src/app/plan/page.tsx`
**Reference:** `references/direction-d.jsx` → `DPlan`
**Type:** Server Component (keep)

This is the largest rewrite. **Keep all data loading** (`loadPlan()` — don't touch). Replace the JSX body.

Structure:

1. **Eyebrow:** `$ PLAN · STRATEGY = AVALANCHE · HORIZON = 240MO · MARGINAL RATE = 30%`

2. **`<LedgerKpiGrid>` (4-up):**
   - CLEAR DATE — `monthIndexToLabel(plan.debtFreeMonth)`
   - TOTAL INTEREST — `formatINR(plan.totalInterest)`, sub: `VS ${formatINR(plan.baselineInterest)} BASE`
   - MONTHS SAVED — `plan.monthsSaved`, accent color
   - MONTHLY OUTLAY — sum of `scheduled_emi` across all loans + current month's extra alloc

3. **Trajectory chart** — keep `DebtTrajectoryChart` (Visx). Wrap in a 2px black border. Adjust the chart's `tokens.chart.text` reference to use `var(--ledger-ink)` and its grid to `var(--ledger-faint)` only on this page.

   *Alternative:* Use the existing chart but visually quiet it (thinner strokes, no fill) to match the ledger feel. The Plan page in `references/direction-d.jsx` uses an **ASCII chart** for novelty — for production, keep the real Visx chart. The ASCII version belongs on a print-export view if you build one.

4. **Schedule table** — new, full amortisation, `<LedgerTable>`. Columns:
   - MO | DATE | ICICI | SBI | HDFC | EXTRA | INT PAID | PRIN PAID | BALANCE | EVENT
   - Right-align everything except MO and DATE.
   - "EVENT" column highlights rows where a loan clears (`✓ ICICI CLEARED`) or annual review hits (`⟳ ANN. REVIEW`). Use `eventKey="event"` to apply `.event` highlight class.
   - Initially render first 12 rows; below the table, "[▾ EXPAND]" toggles to show all 240 months (client component for this part — or pagination).
   - Header row right side: `[CSV] [PRINT] [▾ EXPAND]` action links.
   - **Data:** add a new API endpoint `/api/schedule` that returns the full amortisation. Or compute client-side from existing `/api/simulate` trajectory + per-loan rates. Talk to the engine team — `engine.simulation` likely already produces this.

5. **Restructure opportunities** — already exists in current Plan as cards. Convert to a `<LedgerTable>` with columns: KIND | FROM | TO | Δ RATE | BREAKEVEN | SAVES/Y | STATUS. Keep the borderLeft accent on the **section** as a 2px solid black instead of the current 3px positive green.

6. **Sensitivity / what-if** — keep the existing `WhatIfPanel` logic intact (the debounced engine calls), but restyle:
   - Wrap in `border: 2px solid var(--ledger-ink)`
   - Slider rows become table rows with `$ SET SURPLUS_DELTA =` command-line-style labels
   - See `references/direction-d.jsx` → `$ SENSITIVITY` section for the layout
   - The `<SliderRow>` component in `WhatIfPanel.tsx` already does the debounce → engine pattern. Don't rewrite the logic, only the markup.

**Do not change:** Any `api.*` calls. The `mergeTrajectories()` helper. The fallback-to-mock behaviour. The `dynamic = 'force-dynamic'` export.

---

### 4. `/debts` — Debts (existing → Ledger)

**Source file:** `web/src/app/debts/page.tsx`

Replace the three `<Card>` elements with a single `<LedgerTable>`:

| # | LENDER | TYPE | RATE | EFFECTIVE | OUTSTANDING | EMI | TENURE | NEXT |
|---|---|---|---|---|---|---|---|---|
| 01 | ICICI | CARD | 36.00% | **42.48%** | ₹1,00,000 | — | — | PAY ₹18,500 |
| 02 | SBI | PERS LOAN | 13.00% | 13.00% | ₹80,000 | ₹2,400 | 36 mo | AUTO |
| 03 | HDFC | HOME · FLT | 8.50% | 8.50% | ₹40,00,000 | ₹35,200 | 240 mo | AUTO · RESET 47d |

Highest-effective-rate row gets `.event` highlight (yellow background). Effective-rate column is `var(--negative)` colored when ≥ 25% APR.

Below the table, a TOTAL row with `border-top: 2px solid var(--ledger-ink)` summing OUTSTANDING and EMI.

**`+ Add a debt` button** stays — restyle as a bordered text-link: `[ + ADD DEBT ]` in the section header right-aligned (not a primary button).

**Data:** Use `loadProfileServer()` to get loans. Compute `effective` rate via `engine.formulas.effective_rate_after_gst(nominal, loan_type, country)` server-side. Compute "NEXT" copy from the engine's recommended next-action (this likely needs a tiny helper in `lib/` that calls `engine.decisions.next_action(user)`).

---

### 5. `/onboarding`, `/tools`, `/tools/*` — no visual changes

Leave these files alone. The Field/Select/SubmitBar primitives, the 6-step wizard, the form-then-verdict pattern — all stay.

The **only** allowed change here is fixing the bug at `web/src/app/onboarding/page.tsx:289` where `background: 'var(--accent-soft)'` references an undefined token. Replace with `background: 'transparent'` (the variable was never defined; it falls through to default).

---

## Asset & font notes

- **Spectral** and **IBM Plex Mono** are open-source Google Fonts. Add to the existing Google Fonts `<link>` in `layout.tsx` (see snippet above). No licensing concerns.
- No new images or icons. The ledger surface deliberately has no icons.
- The ASCII trajectory characters used in references (`┤`, `─`, `└`, `▲`, `■`, `▼`) are all standard Unicode box-drawing / block-element characters. They will render in any monospace font.

---

## State management

No new client state is introduced by this refresh. Existing client state stays:
- `WhatIfPanel`'s slider state and debounced fetch
- `OnboardingPage`'s 6-step form state
- Each tool's form + result state

**If** you add the "[▾ EXPAND]" full-schedule toggle on `/plan`, that's the one new piece of client state — boolean, useState, in a new `<ScheduleTable>` client component.

---

## Interaction & behavior changes

| Surface | Interaction | Spec |
|---|---|---|
| Home | "Show me the math →" link | Routes to `/plan` |
| Home | "What if I disagree?" / "See alternatives" links | Stub for v1 (no route); add `cursor: not-allowed; opacity: 0.6` tooltip "coming soon" |
| Debts table | Click a row | Routes to a new `/debts/[id]` detail page (out of scope for this refresh — link disabled for v1, `cursor: default`) |
| Plan schedule | `[CSV]` action | Generate CSV client-side from the schedule data and trigger download |
| Plan schedule | `[▾ EXPAND]` toggle | Reveals all 240 rows. Use a `<details>` element or `useState` toggle — keep it boring |
| Plan schedule | `[PRINT]` action | `window.print()` — verify `@media print` CSS reads the ledger surface cleanly (test before shipping) |

No animations. No hover state changes beyond a subtle `text-decoration: underline` on links that are already underlined.

---

## ✋ Do not touch

Boundaries that must stay intact:

1. **`engine/`** — every Python file. Pure calculation, fully tested, the source of truth.
2. **`api/`** — every FastAPI route, every Pydantic schema. The web frontend is one of N possible clients.
3. **`web/src/lib/api.ts`** — the API contract types and the `api` client object. Changes here ripple.
4. **`web/src/lib/user-store.ts`** — cookie/storage shape for the demo user. Changes here invalidate users' saved profiles.
5. The list of routes / `dynamic = 'force-dynamic'` exports. The redesign is JSX inside each page, not a re-architecture.
6. The TypeScript types. If you find a field is missing, add it via the schema layer, don't paper over with `any`.

---

## Suggested implementation order

Do this top-down — each step is testable on its own:

1. **Tokens & fonts** (`globals.css`, `tokens.ts`, `layout.tsx` font link). Verify the existing app still renders identically. Diff: 3 files, additive.
2. **`Letter` and `LedgerStatement` component skeletons** with utility classes. Build them empty + stand up Storybook entries if there's one (probably not — there's no Storybook in the repo currently).
3. **`/debts`** rewrite (smallest scope, biggest visual delta, easy to roll back if owner wants tweaks).
4. **`/insights`** rewrite (small, no logic).
5. **`/`** rewrite (medium — need to wire in real numbers from `loadProfileServer`).
6. **`/plan`** rewrite (largest — table, restyled chart, restyled what-if). Build behind a feature flag or branch for the first PR.
7. **Smoke test** every untouched route — `/onboarding`, `/tools`, `/tools/*` — to confirm nothing regressed.

Land each as its own PR. Ship to staging between PRs 3 and 6 to get owner feedback before the Plan rewrite (the biggest one).

---

## Open questions for the owner

Send these before starting the build:

1. **The core assumption** — surface-by-surface aesthetic assignment (Home/Insights editorial, Plan/Debts ledger, rest unchanged). Confirm or correct?
2. **Home masthead** — keep the existing global TopBar **and** the Editorial masthead, just one of them? My instinct: keep global TopBar, drop the in-article masthead. But check.
3. **Schedule table** — do we want full amortisation (240 rows expandable) on `/plan`, or just the next 12 months always? Affects whether we need an `/api/schedule` endpoint.
4. **Mobile** — is mobile a priority for this refresh, or desktop-first for now? The editorial 2-column layout needs explicit stacking rules; the ledger tables need horizontal scroll on phones.
5. **The "alternatives" link on Home** — do we have a route in mind for "see other approaches" or is that a future story?
6. **Print styles** — does anyone print this stuff? The ledger aesthetic lends itself to a great printout but it's work.

---

## Files in this folder

```
design_handoff_finoptima_refresh/
├── README.md                          ← this file
└── references/
    ├── existing-ui-preview.html       ← current Next.js UI, all 13 routes, faithfully rendered
    ├── redesigns.html                 ← design canvas with all 4 explored directions
    ├── design-canvas.jsx              ← canvas wrapper (not part of the design)
    ├── direction-a.jsx                ← Direction A (Editorial) component source
    └── direction-d.jsx                ← Direction D (Ledger) component source
```

To preview the references locally, open `references/redesigns.html` in a browser — it loads React + Babel + the four direction files from a CDN. Internet connection required.

The source codebase that this refresh modifies lives at: <https://github.com/Hasen1506/and-Emi-restructuring>. Implement against the `web/` folder.
