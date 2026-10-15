# Founder records

One permanent home for what only the founder (Vijay) can sign off, the
defaults he has approved, and every job the app relies on to keep running.
Started 15 Oct 2026 (round 2). Update a row in place when its status changes;
never delete a row, mark it done with the date.

Linked from [README.md](../README.md) and [docs/RUNBOOK.md](RUNBOOK.md).
Two tests keep it honest:

- `scripts/check_founder_records.py` (run in CI, job `health`) fails when a
  file in `.github/workflows/` has no entry in section (c).
- `web/tests/r2-web-records.cjs` fails when a text marked "Draft — pending
  legal review" in the app (`web/src/lib/legal-review.ts`) has no row in
  section (a), or a row here says "Signed off" while the app still shows the
  marker (or the other way round).

Statuses: **Pending counsel** (a lawyer must read it; the app shows it with a
draft marker), **Verify** (a fact to check against a primary source),
**Approved** (decided; date given), **Signed off** (counsel read it; date given).

---

## (a) Needs your sign-off / verify

| # | Item | Review id (app marker) | Status | Owner | Date | Notes |
|---|---|---|---|---|---|---|
| A1 | **Can't pay letters**: India + US hardship request (Can't pay, signed in and public) | `letter-hardship` | Pending counsel | Vijay | 15 Oct 2026 | Decision 15 Oct: /cant-pay ships public, but **every letter must be signed off** by counsel. Until then each letter shows "Draft — pending legal review" (it never blocks use). |
| A2 | **Can't pay letters**: India recovery-agent complaint | `letter-recovery-agent` | Pending counsel | Vijay | 15 Oct 2026 | Cites the RBI recovery-agent rules shown on the page (TRIAGE_RULES.recovery, recovery_2027). |
| A3 | **Privacy notice changes** (15 Oct 2026): payday / deadline / rate-move emails, counts-only funnel, consent records in detail, the new contact addresses | `privacy-notice-2026-10-15` | Pending counsel | Vijay | 15 Oct 2026 | Shown on /privacy with the draft marker. `NOTICE_VERSION` deliberately **not** bumped yet: after sign-off, bump it in `web/src/lib/privacy-facts.ts` **and** `api/privacy_facts.py` (every signed-in user then agrees once). Must be signed off **before** turning emails or the funnel on (docs/RETENTION-ON.md step 3). |
| A4 | **Terms changes** (15 Oct 2026): emails clause, contacts | `terms-2026-10-15` | Pending counsel | Vijay | 15 Oct 2026 | Same version rule as A3 (`TERMS_VERSION`). |
| A5 | **Rate-reset letter** (Loan Check A11: EMI or tenure changed without the choice; cites RBI's 18 Aug 2023 circular on reset of floating rates) | `letter-rate-reset` | Pending counsel | Vijay | 15 Oct 2026 | Draft marker on Loan Check step 04. |
| A6 | **US letters**: hardship request with the debt-collector rules (12 CFR 1006.6, Regulation F), FCBA billing-error notice (12 CFR 1026.13), RESPA notice of error (12 CFR 1024.35) | `letter-us` | Pending counsel | Vijay | 15 Oct 2026 | New page /cant-pay/us-letters (round 2). The hardship letter itself is A1's text in US words. |
| A7 | **Chennai forum clause + US$15 liability cap for US users** (terms) | `terms-2026-10-15` | Pending counsel | Vijay | 15 Oct 2026 | Does "courts at Chennai" and a US$15 cap hold against a US consumer? Draft marker on that clause of /terms. |
| A8 | **SEBI exposure**: the prepay / keep / split card (A4/D1, framed on the user's own assumed return, no product named) and Sell to repay before any paid tier | — | Pending counsel | Vijay | 15 Oct 2026 | Investment-adviser rules; a company/LLP doesn't remove the exposure. No app marker (not a letter). |
| A9 | **NOC / closure-fee wording**: docs and letters say an NOC is "normally free", not "illegal" | — | Pending counsel | Vijay | 15 Oct 2026 | No RBI line found that expressly bans an NOC fee. |
| A10 | **ICICI credit card ₹100 minimum-due floor** | — | Verify | Vijay | 15 Oct 2026 | Applied in the engine but not in the MITC text read. Confirm from a real ICICI statement, or drop it. Kotak/Yes/IndusInd/RBL/AmEx and all US issuers are still unsourced estimates. |
| A11 | **US student loans: conservative default** (an unmarked US student loan gets no extra payments, since it may be federal and forgivable; user can mark it private/federal in Setup) | — | **Approved** | Vijay | 15 Oct 2026 | Approved as built. US golden journey: debt-free moves from month 86 to 124 for an unmarked loan. |
| A12 | **"No lender pays us. Sometimes the best advice is don't switch."** (welcome.html hero; terms say no lender money) | — | **Approved** | Vijay | 15 Oct 2026 | A public promise: no referral fees, commissions or paid placement, ever. Any future revenue idea must keep it. |

---

## (b) Standing decisions (safe defaults, approved)

All approved by Vijay on 15 Oct 2026 unless a different date is given.
Detail and history: work/reports/founder-decisions.md (b), docs/founder-answers-a80.md.

| # | Decision | Where it lives |
|---|---|---|
| B1 | **Tenure first** on a rate rise (the Indian default): home loans may extend up to 360 months from today; other loans have no ceiling unless the lender's limit is typed. Recommendation: keep the EMI and prepay when affordable. | engine (C1) |
| B2 | **Gap credit limit of 3 months of take-home** when the user gives none, labelled as an assumption, and now **editable** by the user. | engine gap_debt / Plan |
| B3 | **Cheapest auto-pick threshold**: a payoff-order difference only "matters" beyond max(₹500 / $10, 0.5% of plan interest) or a different debt-free month; below that Cheapest is auto-picked and marked chosen (changeable on Plan). A gap under ₹100 / $1 counts as rounding. | engine ordering, A2 |
| B4 | **Navigation and fonts**: core tabs Home / Plan / Activity / Profile; More = Money / Tools / Help; body text IBM Plex Sans 16px, mono for figures; payoff words Cheapest · Smallest · Mine. | web/src/lib/app-nav.ts, W7 |
| B5 | **No prediction-market odds** (India's Promotion and Regulation of Online Gaming Act 2025): /rbi-decision shows fixed +0 / +0.25 / +0.50 scenarios labelled "not a forecast". | /rbi-decision |
| B6 | **Sell to repay stays a calculator**; the ranker stays off (`LIQUIDATION_RANKER` unset). | /tools/liquidate |
| B7 | **NRI tools gated**: shown only to people who said they live in the US with loans in India; a residency move is a profile event. | web/src/lib/tools.ts |
| B8 | **/cant-pay is public but robots-disallowed** (not indexed). Its US letters page /cant-pay/us-letters inherits both. | web/src/middleware.ts, web/src/app/robots.ts |
| B9 | **Stay on Resend Free** (no $20/month Pro): one shared email budget, 95/day and 3,000/month, sign-in codes first, reminders roll over in a fair order. Free is enough until roughly 300 people share one payday or ~1,000 monthly active users with emails on (math in docs/RETENTION-ON.md). | api/notify/budget.py |
| B10 | **Draft letters ship with a marker, not a gate**: "Draft — pending legal review" on every letter and on the privacy/terms changes until counsel signs off (section a). | web/src/lib/legal-review.ts |
| B11 | **Public contact addresses** are role aliases only: support@, privacy@ (grievance contact), security@rightdue.app. No personal address on any public page. | web/src/lib/privacy-facts.ts, security.txt, SECURITY.md |

---

## (c) Always running

Every scheduled job, workflow, external cron and switch the app relies on.
**Each file in `.github/workflows/` must have an entry here** (CI fails
otherwise: `scripts/check_founder_records.py`). Times are IST unless marked.

### `.github/workflows/ci.yml` — CI
- **Schedule:** every push to `main`, every pull request, by hand. Not scheduled.
- **Does:** change detection, repo health/size checks (incl. this file's check), engine + API pytest, Hypothesis property run, differential tests, web typecheck/lint/unit tests/build, Playwright Chromium; Firefox/WebKit on push to main or with the `cross-browser` label.
- **Needs:** nothing secret. The `cross-browser` label must exist (Issues → Labels).
- **If it stops:** broken code can merge, and Render (if Auto-Deploy is "After CI checks pass") stops deploying.

### `.github/workflows/security.yml` — Security
- **Schedule:** every PR and push to `main`; Mondays 07:45 (`15 2 * * 1` UTC).
- **Does:** `npm audit --omit=dev --audit-level=high`, `pip-audit`, gitleaks on the diff.
- **Needs:** nothing secret.
- **If it stops:** a known-vulnerable dependency or a committed secret goes unnoticed.

### `.github/workflows/notify.yml` — Notifications (payday email, deadline reminders, rate-move email)
- **Schedule:** daily 09:00 (`30 3 * * *` UTC); GitHub may start it late.
- **Does:** one `POST /api/notify/run`: sends what is due within the shared email budget; the rest rolls to the next day.
- **Needs:** repo variable `NOTIFY_ENABLED=true`, variable `PUBLIC_APP_URL`, secret `NOTIFY_CRON_SECRET` (same as Render). Server flags in docs/RETENTION-ON.md.
- **If it stops:** no payday emails or reminders go out (unless the cron-job.org backup below runs). Opens a "Notification job failed" issue when a run fails.

### `.github/workflows/db-backup.yml` — Database backup
- **Schedule:** nightly 02:10 (`40 20 * * *` UTC).
- **Does:** `pg_dump`, a test restore into a throwaway Postgres, `age` encryption, upload to a private bucket.
- **Needs:** secrets `DATABASE_URL` (read-only role), `BACKUP_AGE_RECIPIENT`, `BACKUP_S3_BUCKET`, `BACKUP_S3_ENDPOINT`, `BACKUP_S3_ACCESS_KEY_ID`, `BACKUP_S3_SECRET_ACCESS_KEY`. Variable `BACKUP_DISABLED=1` only to switch it off on purpose.
- **If it stops:** only Neon's ~6 hours of history remain. **Red by design until the secrets exist.** Opens a "Database backup failed" issue.

### `.github/workflows/policy-rates.yml` — Policy rates
- **Schedule:** Mondays 08:30 (`0 3 * * 1` UTC) plus 12:00 on each RBI MPC decision day (generated lines).
- **Does:** re-reads the RBI repo rate and the Fed funds target; proposes `api/data/policy_rates_live.json` as a PR that auto-merges on green.
- **Needs:** repo variable `DATA_PR_MODE` (default `merge`). When the MPC calendar changes: `python scripts/policy_rate_schedule.py write`.
- **If it stops:** the RBI decision page and rate-move emails use stale rates. Opens an issue on failure.

### `.github/workflows/rate-disclosures.yml` — Rate disclosures
- **Schedule:** Mondays 09:00 (`30 3 * * 1` UTC).
- **Does:** reads each bank's published loan-rate disclosure; PR with a dated JSON when figures change.
- **Needs:** variable `DATA_PR_MODE`.
- **If it stops:** Loan Check compares against old bank figures. Opens an issue on failure.

### `.github/workflows/market-data.yml` — Market data
- **Schedule:** Mondays 09:30 (`0 4 * * 1` UTC).
- **Does:** refreshes safe yields, inflation forecasts, the US 30-year mortgage average; watches Tier-A rate-card pages and keeps one "data-check" issue.
- **Needs:** variable `DATA_PR_MODE`.
- **If it stops:** quoted market figures go stale. Opens an issue on failure.

### `.github/workflows/fuzz.yml` — Long fuzz
- **Schedule:** Mondays 03:17 UTC (08:47 IST).
- **Does:** all 20,000 generated loans and every hostile value in every POST field (~3 min).
- **Needs:** nothing.
- **If it stops:** a crash on unusual input is caught later, if at all.

### `.github/dependabot.yml` — Dependabot
- **Schedule:** weekly, Mondays (npm, pip, GitHub Actions).
- **Does:** dependency update PRs, minor/patch grouped.
- **If it stops:** security releases (Next.js middleware is the auth gate) arrive late.

### Outside GitHub
| Job | Schedule | Does | Needs | If it stops |
|---|---|---|---|---|
| cron-job.org **notify** (backup to notify.yml) | daily 09:00 Asia/Kolkata | `POST https://rightdue.app/api/notify/run` with `Authorization: Bearer <NOTIFY_CRON_SECRET>`; wakes the free instance; the run lock prevents double sends | the cron secret | emails rely on GitHub's (sometimes late) schedule. **Verify** it exists once emails are on. |
| cron-job.org **warm-up** ×2 | 04:30 and 04:33 | `GET https://rightdue.app/` so the first morning visitor doesn't wait for a cold start | nothing | first visit of the day is slow. Never more often than every 20 min (Render's 750 free hours). **Verify** created. |
| UptimeRobot keyword monitor | every 20 min | `/api/health` contains `"db":"enabled"`; `/api/healthz` | free account | outages go unnoticed. **Verify** created. |
| Render health check | continuous | `/api/healthz` (Next.js); a dead API exits the container | `healthCheckPath` in render.yaml | Render can't restart a broken instance. |
| Cloudflare landing Worker (`deploy/cloudflare`) | on request (no cron) | serves `/`, `/welcome.html`, `robots.txt`, `sitemap.xml` at the edge | our own Cloudflare zone + `wrangler deploy` | not deployed yet; Render serves them (a sleeping instance can make crawlers see an error). |

### Inside the app (no scheduler; runs on start or on requests)
| Job | When | Does | If it stops |
|---|---|---|---|
| Alembic migrations + schema-drift guard | every container start | upgrades the schema; refuses to start in production if tables are missing (`ALLOW_SCHEMA_DRIFT=1` = emergency override) | a deploy can run on a mismatched schema |
| Sign-in record purge | start, then at most every 6 hours on sign-in requests (`api/auth/retention.py`) | deletes codes, sessions, consent/access records past their retention (365 days) | records are kept longer than the privacy notice says |
| Rate-limit counter purge | on requests (`api/rate_buckets.py`) | drops counters a day after their window | the table grows |
| Rates file load | container start (`api/rates_feed.py`, `RATES_FEED`) | reads the committed policy-rates file (no network) | the verified hand-checked table is used |
| Shared email budget | every notify run and every sign-in code | counts codes + notifications against 95/day and 3,000/month (`RESEND_*` env) | see api/notify/budget.py; codes are never blocked by it |

### Environment flags the app relies on
The full list, in plain words, is in **docs/RETENTION-ON.md → "Render
environment variables, in plain words"** (one `rightdue` service). The ones
that change behaviour when missing: `DATABASE_URL`, `RESEND_API_KEY`,
`RESEND_FROM`, `WEB_ORIGIN`, the three email flags + `NOTIFY_SIGNING_KEY` /
`NOTIFY_CRON_SECRET` / `PUBLIC_APP_URL`, `RESEND_DAILY_LIMIT` /
`RESEND_MONTHLY_LIMIT` / `RESEND_CODE_RESERVE`, `FUNNEL_ENABLED` +
`NEXT_PUBLIC_FUNNEL` (build), `NEXT_PUBLIC_TURNSTILE_SITE_KEY` (build) +
`TURNSTILE_SECRET_KEY`, `SENTRY_DSN`, `GOOGLE_SIGNIN` + its three OAuth values.
