# The product surface, as it is (verified for sprint G10, 2026-10-12)

The grill (`rightdue-grill.md` #45, #47, #76) counted "nine tools" and a
"Restructure table with 8 columns". The founder said the app shows six tools
and that some critiques read an older design. Checked against the code at
`bff0c64`:

## Tabs (masthead, `components/ledger/LMasthead.tsx`)

Six since G10: **Home · Plan · Activity · Goals & Tools · Portfolio · Profile**.
Portfolio was Profile's "What you own" page (`/portfolio`); the founder kept it
as its own tab (cut-list decision 2). `/profile/assets` (the add form) lights
the Portfolio tab. Goals stay (#77: the app's aim is a finance super-app).

## Tools (`web/src/lib/tools.ts`): six, not nine

| Tool | Route | Who sees it |
|---|---|---|
| Spare cash | `/tools/windfall` | everyone |
| New debt check (incl. a big purchase) | `/tools/new-debt` | everyone |
| Sell to repay (a calculator, G10) | `/tools/liquidate` | everyone |
| Invest or prepay (a calculator) | `/tools/invest-vs-prepay` | everyone |
| Loan check | `/tools/loan-check` | India; public, no sign-in |
| NRI prepay | `/tools/nri-prepay` | a US resident with loans in India |

The three other folders under `app/tools/` are old addresses, not tools:
`cash-yield` → Spare cash, `recompute` → `/plan#what-if`, `purchase` →
`/tools/new-debt?mode=purchase` (and `/tools/right-time` → New debt check), all
in `next.config.mjs` or the folder's `page.tsx`. Most people see five tools
(Loan check is India-only and NRI prepay NRI-only).

## Things the grill described that no longer exist

- **The 8-column Restructure table** (#47: `# · KIND · FROM · TO · Δ RATE ·
  BREAKEVEN · SAVES / Y · STATUS`): no such header is in `web/src`. Cheaper-rate
  opportunities are cards on Home (`components/home/HomeRestructure.tsx`) and
  Plan (`components/plan/OpportunityAlternative.tsx`).
- **"26 YRS 6 MO saved vs minimums"** (#44, live-test #29): it was only on the
  landing page, with an unstated example. The landing now shows numbers the
  engine works out from a stated example (`scripts/landing_example.py`), with
  the honest baseline (same budget, smallest balance first) as the headline and
  "only what's due" as a labelled ceiling.
- **The holdings ranker** in Sell to repay (`PortfolioRanker.tsx`) is removed
  (G10, #50). The engine's `rank_liquidations` and
  `/api/portfolio/liquidation-rankings` remain but no screen calls them.

## Landing page by country (#1)

`/` for a signed-out visitor is `web/public/welcome.html`. It now has an India
and a USA version on one page (`data-c="IN" | "US"` blocks), a toggle in the
masthead, and opens on the visitor's country:

1. the visitor's own toggle pick (localStorage `rd_landing_country`);
2. `?country=IN|US` in the address;
3. the `rd_country` cookie the middleware sets from the CDN's country header
   (`CF-IPCountry`, `x-vercel-ip-country`, `x-country-code`) or, without one,
   the region in `Accept-Language` (`lib/landing-country.ts`);
4. the browser's language; India by default.

Render's free plan adds no country header, so today step 3 runs on
`Accept-Language` alone. If the domain is proxied through Cloudflare (orange
cloud), `CF-IPCountry` arrives and is used first, with no code change.

## Words

- "Restructuring" (#14) is gone from the copy except where the person asks a
  lender for changed terms. The app's title and the landing say "payoff plan".
- Every technical term has a plain-words line in `lib/glossary.ts`, shown on
  tap by `components/Term.tsx` and listed at `/glossary` (public). #43.
- Strategies (#78): Avalanche (cheapest path), Snowball (smallest first), Your
  rules (your own order), in `lib/strategy.ts` `STRATEGY_PLAIN` and the persona
  tags.
