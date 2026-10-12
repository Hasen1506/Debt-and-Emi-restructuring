# Where people stop in setup: a privacy-safe way to find out (grill #16c)

The founder asked what "instrument each field's abandonment" means. It means
counting, for each field in setup, how many people reach it, how many fill it,
and how many leave the page while on it, so you learn which question loses
people (the grill's guess: "Months left" on a home loan).

Nothing is built yet: it needs a place to send the counts, and that is a
founder decision (below). This is the design, so it can be built in a day.

## What would be recorded

One event per field interaction, with **no values and nothing that identifies
the person**:

```json
{ "step": 2, "field": "loan.emi", "event": "focus" | "filled" | "left_empty" | "dont_know" | "abandon", "loan_kind": "home_loan", "country": "IN", "day": "2026-10-12" }
```

- No amounts, names, lenders, emails, account ids, IP addresses or cookies.
- `abandon` is sent with `navigator.sendBeacon` on `pagehide` for the field
  that had focus last.
- Counts only: the server adds one to a counter per (day, step, field, event,
  kind, country) and keeps no rows per visitor, so there is nothing personal to
  store, export or delete. Under the DPDP Act 2023 this is not personal data,
  because it can't identify anyone; the privacy notice (G8) should still say
  it is collected.

## What it answers

- Drop-off by field: `left_empty + abandon` ÷ `focus`.
- How often "I don't know" is used per field (G10 added it): if most people
  tap it on months left, ask for the start date instead.
- Whether showing the plan after one loan (G10) raises the share who reach the
  plan.

## How to build it (behind a flag, off by default)

1. `NEXT_PUBLIC_SETUP_FUNNEL=1` turns it on; off, the hook does nothing.
2. A `useFieldFunnel(step, field)` hook in `QuickSetup.tsx` fields: focus,
   blur (filled or empty), and the "I don't know" buttons.
3. `POST /api/funnel` (FastAPI) upserts the counter; rate-limited per IP in
   memory only, IP never stored.
4. A weekly query, or a Home panel for the founder.

Alternatives with no code of ours: Plausible or Umami custom events (both
cookie-free; Plausible is paid, Umami self-hosted is free). PostHog and Google
Analytics record far more than this needs.
