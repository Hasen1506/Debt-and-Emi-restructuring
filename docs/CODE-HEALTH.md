# Code health: size, state, twins, tests, CI cost

Audit 80 E14–E23 (W9, 14 Oct 2026). One page a founder can read before a
review: what the repo's lines are, the budgets CI enforces, where app state
lives, which TypeScript files duplicate the engine, which tests are due to
retire, how cold starts are measured, and what is left of the old name.

## 1. What the lines were (E14)

On 14 Oct 2026, after the W9 cleanup, tracked lines by kind (newline count,
same as `wc -l`) were:

| Kind | Files | Lines |
|---|---:|---:|
| Production: web/src | 351 | 65,023 |
| Production: engine | 48 | 17,720 |
| Production: api | 55 | 8,935 |
| Generated test fixtures (`engine/tests/fixtures/*_cases.json`) | 18 | 40,688 |
| Python tests | 114 | 17,970 |
| Web node tests | 70 | 8,953 |
| Playwright E2E | 36 | 3,250 |
| npm lockfile | 1 | 5,603 |
| JSON data snapshots in the source tree | 11 | 5,294 |
| Scripts | 24 | 3,131 |
| Docs (current) | 30 | 3,107 |
| Everything else (config, CI, static pages, fixtures) | ~106 | ~5,100 |
| **Total** | **864** | **184,798** (was 198,261) |

The production total (91,678) includes about 14.8k comment lines and 7k blank
lines, so the real code is about 70k lines. The 40k fixture lines are
machine-written expected answers; they are marked `linguist-generated` in
`.gitattributes` so GitHub's language bar ignores them. Removed planning notes,
round logs, audit scripts and mock-ups are listed in [ARCHIVE.md](ARCHIVE.md).

## 2. Budgets CI enforces (E12, E16, E17, E21)

The line-count gate (per-file caps and `prod_lines_baseline`) was removed on 19 Oct 2026. It was blocking useful code. CI no longer runs it. The first-load JavaScript budget below is a performance guard and stays.

| Check | Where | Rule | Re-baseline |
|---|---|---|---|
| Route JS | `web/scripts/route-size-budget.mjs` after `next build` (job `web`) | First-load JS per route may grow 10 kB over its baseline; nothing over 300 kB. Today: `/profile` 247.8 kB, `/plan` 245.4 kB, `/` 210.6 kB. | `node scripts/route-size-budget.mjs --write`, say why. |
| Dead code | `web/scripts/unused-exports.cjs` (job `web`) | No new export used nowhere, no new never-imported file. 2 known exports and 1 orphan (`HomeDebtFreeRange.tsx`) allowed, shrink-only. | Remove the line from `unused-exports.allow.json` when fixed. |
| Number formatting | `web/tests/formatter-guard.cjs` (`npm test`) | Raw `toFixed` / `toLocaleString` / `Intl.NumberFormat` per UI file may only go down (234 in 48 files today). New components start at zero. | `UPDATE_FORMATTER_BASELINE=1 node --test tests/formatter-guard.cjs` after removing some. |
| API contract | `api/tests/test_property_schema_roundtrip.py` (job `property`) | Plan responses read back through their schema unchanged; every JSON route declares a response model except 4 listed in `UNTYPED` (shrink-only). | Give the route a model, delete its line. |
| Engine month laws | `engine/tests/test_property_guards.py` (job `property`) | Every month: money conserved, payment = interest + principal, loans add up to the month's total, debt-free month exact (gap debt included), no NaN or negatives. | — |

### Guards waiting for a first green run
`web/e2e/guards.spec.ts` (320/390 px overflow with every panel open, and no
console error on any route) is written but has never run: it needs the
Postgres-backed E2E stack. It is skipped unless `E2E_GUARDS=1`. Run it once
(`E2E_GUARDS=1 npx playwright test e2e/guards.spec.ts --project=chromium`),
fix what it finds, then add `E2E_GUARDS: "1"` to the `e2e` job's env.

### Known engine finding pinned by a strict xfail
`test_debt_free_month_is_not_late_by_sub_paisa_dust`: a rounded EMI can leave
about ₹0.001 owed, which keeps the loan open one more month, so the debt-free
month is shown a month late (₹5,760 at 0.15% over 12 months at ₹480.39 reports
month 13). Fix in `engine/simulation.py` (clear balances under half a paisa);
the xfail then fails and must be removed.

## 3. CI minutes (E21)

GitHub Actions minutes are short until 1 Nov 2026, so `.github/workflows/ci.yml`:

- A small `changes` job decides what runs. **Docs-only** changes (Markdown,
  `docs/`, `LICENSE`) skip every heavy job. `DEPLOY.md` and `docs/RUNBOOK.md`
  count as code because web tests read them. **Web-only** changes skip the
  three Python jobs (unit, property, differential). Skipped jobs report
  success, so required checks never hang.
- **Firefox + WebKit** (the most expensive job, ~2× chromium) run only on
  push to `main`, or on a PR carrying the `cross-browser` label. Add the
  label to a PR that touches layout, forms or dates. Adding the label starts
  that job alone; other labels start nothing.
- **Concurrency**: a new push cancels the branch's older run. Label events
  have their own group so they never cancel a code run. `main` is never
  cancelled.
- Every job keeps its `timeout-minutes`.

## 4. Where app state lives (E20)

Four stores today. Every new field needs a decision about which store and a
migration in each, and that seam is where two-device bugs live.

| Store | What is in it | Code |
|---|---|---|
| **Cookies (JS-readable, 1 year)** | `rightdue_user` (compressed profile, ~1.5 KB), `rightdue_score`, `rightdue_marginal`, `rightdue_activity_deltas`, `rightdue_lifecycle`, `rightdue_advance_tax`, `rightdue_strategy`, `rightdue_payoff_rules`, `rightdue_inflation_modeling`, `rightdue_inflation_rate`, `rightdue_hike_modeling`, `rightdue_tax_reinvest`, `rightdue_fx_drift`, `rightdue_ef_split`, `rightdue_debt_budget`, `rightdue_ledger_tone`, plus `*_digest` cookies that tell the server-rendered page a localStorage slice changed | `user-store.ts`, `profile-cookie.ts`, `activity-cookie.ts`, `advance-tax-cookie.ts`, one small module per setting (`strategy.ts`, `fx-drift.ts`, …), `persist-client-slices.ts`; read by `middleware.ts` |
| **Cookie (HttpOnly)** | `rightdue_session` (sign-in, 30 days) | `api/auth/session.py` |
| **localStorage** | `rightdue_activity`, `rightdue_commitments`, `rightdue_decision_log`, `rightdue_decisions`, `rightdue_cash_events`, `rightdue_tax_sleeve`, `rightdue_goals`, `rightdue_goal_contributions`, `rightdue_monthly_spend`, `rightdue_balances_entered`, `rightdue_debt_free_marks`, `rightdue_stale_snooze_until`, `rightdue_upi_checks`, `rightdue_account_id`, `rightdue_device_id`, sync bookkeeping (`rightdue_pending_sync_*`, `rightdue_state_version_*`, `rightdue_sync_conflict_*`) | one module per slice in `web/src/lib/`; `server-sync.ts` |
| **sessionStorage** | `rightdue_setup_draft`, `rightdue_trail`, `rightdue_debtfree_prompt_dismissed`, `rightdue_chunk_reload_at` | `setup-draft.ts`, `nav-trail.ts`, `client-error.ts` |
| **Server (Postgres JSONB, signed in)** | every slice in `SLICE_TARGETS` (`server-sync.ts`) plus the profile, merged per user under a lock | `api/routes/user_state.py`, `server-sync.ts` (dual-write: local first, then PATCH) |

**Proposal (not done; needs a founder yes, touches every store):** one typed
client store module with a versioned schema (`v` field, parsed by the
boundary parsers, E19), localStorage only. Signed in: the server is the
source of truth and the only cookie is the HttpOnly session. The server-rendered
pages that read profile cookies today would read the server copy (signed in) or
render client-side (guest). Order: (1) add `v` to `rightdue_user`; (2) move the
setting cookies into one localStorage record; (3) drop the `*_digest` cookies;
(4) make `rightdue_user` HttpOnly-free by removing it once SSR stops needing it.

## 5. TypeScript twins of the engine (E18)

Files that re-implement an engine rule in TypeScript, and what keeps them honest:

| TS file | Lines | Python source | Golden/differential test |
|---|---:|---|---|
| `lib/us-loans.ts` | 329 | `engine/us_loans.py`, `engine/tax/usa.py` | `tests/us-market.cjs` ← `us_loan_cases.json` |
| `lib/goal-line.ts` | 252 | `engine/goals.py` | `tests/g4-mirror-golden.cjs` ← `mirror_cases.json` |
| `lib/marginal-cost.ts` | 249 | `engine/marginal_cost.py`, `engine/tax/gst.py` | `tests/roadmap-j-marginal.cjs` ← `marginal_cost_cases.json` |
| `lib/min-payment.ts` | 198 | `engine/minimum_payments.py` | `tests/g4-mirror-golden.cjs` |
| `components/RateRangeHint.tsx` | 177 | `engine/restructuring_scan._COLLATERAL_BACKED` (+ `lib/rate-cards`, exported from `engine/rate_cards.py`) | none for the secured-product list |
| `lib/true-apr.ts` | 106 | `engine/true_apr.py` | `tests/roadmap-c-apr.cjs` ← `true_apr_cases.json` |
| `lib/payoff-rules.ts` | 105 | `engine/ordering.py` | `tests/roadmap-e-rules.cjs` ← `payoff_rules_cases.json` |
| `lib/prepayment-fee.ts` | 98 | `engine/prepayment_fee.py` | `tests/g1-cards-fees.cjs` ← `prepayment_fee_lender_cases.json` |
| `lib/strategy.ts` | 87 | `engine/ordering.Strategy` | names only (no maths) |
| `lib/asset-returns.ts` | 72 | `engine/country_data.py` | `tests/roadmap-d-values.cjs` (defaults only) |

**Policy proposal (founder decision):**
1. The API is the single source for any number a user reads as a result
   (dates, totals, interest, fees, tax). TypeScript may compute only
   *instant field hints* while typing, and must label them as estimates.
2. Every twin keeps a header line `TWIN-OF: engine/<file>.py` and a golden
   test fed by a fixture exported from Python (`scripts/export_*_cases.py`).
   `goal-line.ts` (goals screen) and `us-loans.ts` (US results) are the two
   that show results today; move them behind the API first.
3. CI check (small, to add with the policy): a PR that changes a
   `TWIN-OF` file without its Python pair, or the Python file without its
   twin or fixture, fails with a message naming the pair.

## 6. Retiring round-named tests (E17)

79 test files (11,620 lines) are named after the round or PR that added them
(`r6-fixes` … `r13-fixes`, `live-retest-*`, `ux50-*`, `pr21/23-*`,
`audit-*`, `g1`–`g10`, `l1`–`l4`, `roadmap-a`…`k`). The audit counted 26 that
assert on source text, which passes even when a component is not rendered.
Plan, in three buckets:

| Bucket | Files | Action |
|---|---|---|
| **Keep, rename by subject** (differential or behaviour tests that are the only cover for a rule) | `g4-mirror-golden`, `roadmap-c-apr`, `roadmap-e-rules`, `roadmap-j-marginal`, `g1-cards-fees`, `g2-india-tax`, `us-market` (web); `test_differential_pre_pr29`, `test_g1_cards_fees`, `test_g4_projection`, `test_g7_retention`, `test_g8_security_privacy`, `test_g7_notify`, `test_loan_check_sprint_g5` (Python) | Rename to the subject (`twin-goal-line`, `true-apr`, `security-privacy`, …). No content change. |
| **Retire once the generic guards are green** (instances of a class the guards now cover: overflow, console errors, number format, API shape, month laws) | web: `r6-fixes`, `r6b-fixes`, `r7-fixes`, `r8-fixes`, `r9-fixes`, `r10-fixes`, `r11-fixes`, `r12-fixes`, `r13-fixes`, `live-retest-2/3/4`, `live-retest-fixes`, `pr10-plan-regressions`, `pr21-audit-fixes`, `pr23-audit-fixes`, `audit-2026-10-07`, `audit-regressions`, `ux50-f1…f5`; e2e: `r6-touch-targets`, `r6b`/`r7`/`r12`/`r13-fixes`, `live-retest-*`, `live-test-findings`, `ci-flakes-2`, `ux50-*` | For each file: delete assertions that only grep source text; move any behaviour assertion that no guard covers into the subject file; delete the file. One PR per round so a reviewer can follow. |
| **Fold into subject suites** | `l1-persistence`, `l2-plan-logic`, `l3-ux-flows`, `l4-distress-triage`, `g6-data-import`, `g7-retention-pay`, `g8-security-privacy`, `g9-landing-worker`, `g10-product-surface`, `loan-check-g5`, `roadmap-a/b/d/f/g/h/i/k`, Python `test_audit_*`, `test_r7_event_loop`, `test_r8_assumptions`, `test_roadmap_i_tools`, `test_asset_types_g10` | Merge into the suite for that feature (persistence, plan, setup, loan check, tax, …). |

Order: (1) get `guards.spec.ts` green and switched on; (2) retire bucket 2
round by round; (3) renames and folds. Rule from then on: a fix's test goes in
the subject's suite and guards the class; a file named after a round or PR is
rejected in review.

## 7. Render cold start, measured (E23)

The app runs on Render Free (one container, sleeps after 15 idle minutes).
The first visitor after a sleep waits for the container to start; nothing
records how long. Measurement design that costs no GitHub minutes, using
**cron-job.org** (free; waits up to 30 s per request; keeps the last 50 runs
with their duration; can email on failure. Source: https://cron-job.org/en/faq/,
read 14 Oct 2026):

| Job | URL | Schedule (IST) | What it tells us |
|---|---|---|---|
| `rightdue cold probe` | `https://rightdue.app/` (GET) | daily 04:30 | Time to first page after the night's idle. **A timeout (> 30 s) is itself the finding**: a cold start longer than cron-job.org will wait. |
| `rightdue warm baseline` | `https://rightdue.app/` (GET) | daily 04:33 | The same page warm, for comparison. |

Rules: never schedule it more often than every 20 minutes (that would keep the
instance awake and hide the thing being measured, and burn Render free hours).
Read the history weekly; the median of the cold job is the number for the
landing-page decision (Cloudflare cache rule for `/` and `/_next/static/*`, or
`welcome.html` on Cloudflare Pages, or Render `starter`).

One warm sample taken by W9 on 14 Oct 2026 23:14 IST with curl: `/api/health`
TTFB 0.29 s, `/` TTFB 1.49 s, `/api/health` again 0.09 s (the instance was
warm from other traffic, so this is not a cold number).

**Founder action:** create the two jobs in cron-job.org (or ask Hark to), and
turn on its failure email for the cold probe only if you want a nightly
"slow wake" alert.

## 8. Old name `finoptima` (E22)

What is left, and when each can go:

| Where | What | Can be removed |
|---|---|---|
| `web/src/lib/storage-migration.ts` (`LEGACY_PREFIX = 'finoptima_'`, `LEGACY_SESSION_COOKIE`), called from `server-sync.ts` on every page | Moves a browser's `finoptima_*` cookies and localStorage keys to `rightdue_*` once. Added 12 Oct 2026 (sprint L1). | Founder date. localStorage never expires, so a guest who last visited before 12 Oct keeps old keys until they return. Proposal: **12 Apr 2027** (6 months); after it, such a guest starts fresh. |
| `web/src/lib/account.ts` `LOCAL_PREFIXES` | Sign-out / delete clears both prefixes. | Same date as above. |
| `web/src/middleware.ts` (comment + fallback), `api/auth/session.py` `LEGACY_SESSION_COOKIE_NAME`, `deploy/cloudflare/landing-worker.mjs` `SESSION_COOKIES` | Accepts the old `finoptima_session` cookie. Sessions last 30 days from sign-in and do not slide (`SESSION_TTL`, `session_expiry()`), so every old cookie is dead 30 days after the rename release reached production: **12 Nov 2026** if that was 12 Oct 2026 (founder to confirm the deploy date). | **30 days after the rename deploy** (proposal: 1 Dec 2026, one PR across the three files and their tests). |
| `render.yaml` comments, `DEPLOY.md` "previous services" section, `docs/RUNBOOK.md`, `docs/neon-configuration.md`, `docs/render-storage-readiness.md` | Cut-over notes for the old `finoptima-web` / `finoptima-api` services. | When the founder confirms the old Render services are deleted. |
| Tests: `api/tests/test_auth_sessions_sql.py`, `web/e2e/account-persistence.spec.ts`, `web/tests/l1-persistence.cjs`, `g8-security-privacy.cjs`, `g9-landing-worker.cjs`, `audit-2026-10-07.cjs` | Assert the migrations above. | With the code they test. |
| `docs/privacy-and-retention.md` | Says sign-out clears `finoptima_*` too. | With the migration code. |

## 9. API boundary parsers (E19)

See `web/src/lib/boundary.ts` if present (typed runtime checks for the main
API responses). Status is in the W9 report.
