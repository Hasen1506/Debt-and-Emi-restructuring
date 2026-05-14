# Design references — handoff archive

The original handoff zip contained the following files, captured from the
design canvas tool that produced four directions side-by-side.

Files in this folder are reference-only — they exist to inform the React
component structure for the production rebuild against `web/`. Do NOT
import or wire them into the Next.js app.

| File | Purpose | Status |
|---|---|---|
| `direction-a.jsx` | Editorial / "The Quiet Advisor" — cream paper, Spectral serif, marginalia column | ✅ saved in full |
| `direction-d.jsx` | Ledger / brutalist — IBM Plex Mono, ASCII rules, dense tables | ✅ saved (key components; full source in handoff zip) |
| `direction-b.jsx` | Glass Cockpit (dark Bloomberg-style) — not chosen | not saved here; in handoff zip |
| `direction-c.jsx` | Co-pilot (chat-first) — not chosen | not saved here; in handoff zip |
| `design-canvas.jsx` | The pan/zoom Figma-canvas wrapper — `redesigns.html` only | not saved here; README says ignore |
| `existing-ui-preview.html` | Static render of current Next.js app, all 13 routes | not saved here; we can read live source instead |
| `preview-screens-core.jsx` | Reproduces Home/Debts/Plan/Insights/Onboarding from current source | not saved here |
| `preview-screens-tools.jsx` | Reproduces /tools/* form-and-verdict pages | not saved here |
| `preview-app.jsx` | Hash-router that mounts the right screen | not saved here |
| `redesigns.html` | Page hosting the design canvas | not saved here |
| `redesigns-mount.jsx` | Arranges all 4 directions × 2 screens on the canvas | not saved here |

## Decisions captured from the design conversation

1. **Theme model — confirmed in conversation 2026-05-14**: User wants a
   **global theme switcher**, NOT surface-by-surface assignment. User picks
   `existing` / `editorial` / `ledger` as a global mode; every page
   re-renders in that mode. The surface-by-surface plan in the original
   README is therefore obsolete.

2. **Direction shortlist**: A (editorial) and D (ledger), plus the
   existing baseline. B (Bloomberg) and C (chat) are out.

3. **Information density**: User said current design has "13 sections
   always open" — they want progressive disclosure of advanced/edge-case
   tools, with main flows surfaced first.

4. **Bank input UX bug**: bank-name fields currently open numeric
   keyboards on mobile because the `Field` primitive hard-codes
   `inputMode="decimal"`. Bank entry should be a text input + typeahead
   against the known bank list in `engine/rate_cards.py`.
