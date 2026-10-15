# RightDue operations runbook

Written for UX50 critique E (launch readiness, 13 Oct 2026); updated 14 Oct
2026 for audit 80+ Section D (D13-D26). Short on purpose:
what to do when something breaks, and the settings only the founder can change.

**Every scheduled job, workflow, external cron and env flag the app relies on,
and what happens if each one stops, is listed in
[docs/FOUNDER-RECORDS.md](FOUNDER-RECORDS.md) section (c) "Always running"**
(CI fails if a workflow has no entry). Sign-offs and approved defaults are in
sections (a) and (b) of the same file.

## 1. Deploys and rollback

- Every merge to `main` deploys `rightdue` on Render (Docker, `render.yaml`).
  Alembic migrations run at container start (`api/db/database.py init_db()`).
- **Schema drift guard (D26):** in production (`RENDER` set) the app refuses
  to start when the database schema doesn't match the models after
  migrations, and the deploy log names what is missing. Emergency escape:
  `ALLOW_SCHEMA_DRIFT=1` on the service (remove it as soon as fixed).
- Data bots (market data, policy rates, rate disclosures) open a PR and use
  `gh pr merge --auto --squash`: they merge only after CI passes, and never
  push straight to `main` (D17).
- **Recommended (founder, Render dashboard):** Settings → Build & Deploy →
  Auto-Deploy → **"After CI checks pass"**, so a red `main` never goes live (E-18a).
  Also GitHub → Settings → Branches → protect `main`, require the `CI` checks
  (the data-PR auto-merge workflows then need the checks to pass too).

### Rolling back code
**On the Free plan Render can roll back only to the two most recent previous
deploys** (https://render.com/docs/free, "Rollbacks (only to the two most
recent previous deploys)", read 14 Oct 2026). With several merges a day the
last good build is often out of reach, so the **main path is git**:
1. `git revert -m 1 <merge sha>` (or `git revert <sha>` for a squash merge) on
   a branch, open a PR, let CI pass, merge. Render deploys the reverted code.
   This always works, whatever the plan.
2. Faster, only if the last good deploy is one of the two most recent: Render →
   `rightdue` → Events → that deploy → **Rollback**, then still do step 1 so
   `main` matches what is live (otherwise the next merge re-deploys the bad
   change).

### Rolling back a schema change
Render's rollback restores old code, **not** the old schema. Before rolling back a
deploy that ran a migration:
1. If the old code can run on the new schema (expand/contract: new columns
   nullable, nothing dropped), just roll back code. Write migrations this way.
2. Otherwise, if the migration has a tested `downgrade()`: from a trusted machine
   with the production `DATABASE_URL`, `alembic downgrade -1`, then roll back code.
3. Otherwise restore data (section 2).

## 2. Backups and restore (E-02)

- Neon Free: instant restore of about the last **6 hours** (or 1 GB of changes),
  no scheduled backups. Neon Launch (~$15/month) gives up to 7 days.
- **Status 14 Oct 2026: no backup has ever been taken.** The old job went
  green with every step skipped because the secrets were never added (audit
  80+ D14; run 38486711137: Dump skipped, Upload skipped, conclusion
  success). Why, in detail: the header of `scripts/backup_preflight.sh`.
- `.github/workflows/db-backup.yml` runs nightly at 02:10 IST: preflight
  (`scripts/backup_preflight.sh`), `pg_dump --format=custom` (Postgres 17
  client), `pg_restore --list`, then a **restore test** into a throwaway
  Postgres 17 container (checks the core tables came back), then `age`
  encryption and upload to a **private** bucket. It never uploads to this
  public repo's artifacts.
- **It fails red** (and opens or updates a "Database backup failed" issue)
  when any of the six secrets is missing, unless the repo **variable**
  `BACKUP_DISABLED=1` says backups are off on purpose. Until the founder adds
  the secrets, expect a red nightly run: that is the alarm working.
- **To switch it on (founder):**
  1. Neon: create a read-only role (`CREATE ROLE backup LOGIN PASSWORD '…'; GRANT
     pg_read_all_data TO backup;`) on the `production` branch.
  2. `age-keygen -o rightdue-backup.key` on your own machine. Keep the key file
     offline (password manager); the public key (`age1…`) is the recipient.
  3. A private Cloudflare R2 (free tier: 10 GB) or S3 bucket with a 14-day
     lifecycle rule, and an access key that can only write to it.
  4. GitHub → Settings → Secrets → Actions: `DATABASE_URL` (the read-only role's
     URL), `BACKUP_AGE_RECIPIENT`, `BACKUP_S3_BUCKET`, `BACKUP_S3_ENDPOINT` (R2:
     `https://<account>.r2.cloudflarestorage.com`), `BACKUP_S3_ACCESS_KEY_ID`,
     `BACKUP_S3_SECRET_ACCESS_KEY`. Run the workflow once by hand (Actions →
     Database backup → Run workflow) and check it is green with every step
     run, not skipped.
- **Restore (test once on the `dev-neon-setup` branch first):**
  ```
  aws s3 cp s3://<bucket>/nightly/rightdue-<stamp>.dump.age . [--endpoint-url …]
  age -d -i rightdue-backup.key -o rightdue.dump rightdue-<stamp>.dump.age
  pg_restore --clean --if-exists --no-owner --dbname "$TARGET_DATABASE_URL" rightdue.dump
  ```
  Restore into a new Neon branch, check it, then point `DATABASE_URL` at it (or
  restore over production during a quiet hour). Delete the plaintext dump after.
- **Restore drill (D14 step 4, founder, after the first good nightly):** on
  your own machine, `bash scripts/restore_drill.sh` with the variables in its
  header (a READ key for the bucket, the age private key file, and
  `TARGET_DATABASE_URL` = the `dev-neon-setup` branch; set
  `PRODUCTION_DATABASE_HOST` so it refuses production). It downloads the
  newest nightly, decrypts, restores, prints row counts, and asks you to type
  the database name first. Then record the date here.
- **Last restore drill:** never (as of 14 Oct 2026). Repeat every 3 months.
- The old Render `rightdue-db` recovery copy expires on 1 Nov 2026.

## 3. Staging (E-18b, recommendation)

- Cheapest: a second Render service from the same repo on a `staging` branch,
  `DATABASE_URL` → the Neon `dev-neon-setup` branch, `NEXT_PUBLIC_DISABLE_AUTH=false`.
  On the free plan it shares the workspace's 750 instance-hours (see section 6);
  keep it suspended when not in use. With a paid plan, Render preview
  environments per PR are the better option.

## 4. Monitoring and alerts (E-03)

- **Sentry:** set `SENTRY_DSN` on the Render service (runtime env, no rebuild
  needed). It turns on server error reports (API + Next.js) **and** browser error
  reports: the browser posts to our own `/api/client-error`, which masks digits
  and forwards to Sentry, so the CSP needs no change. Without `SENTRY_DSN` both
  are no-ops. Optional: `SENTRY_ENVIRONMENT`, `SENTRY_RELEASE`. Check with a
  deliberate test error after setting it. `/api/health` reports
  `"sentry": "on"|"off"` (never the DSN), so anyone can confirm it (D19).
  **Record here:** Sentry on since ____; test error seen on ____.
- **Scheduled-job failures (D18):** `market-data`, `policy-rates` and
  `rate-disclosures` open or update an issue when they fail
  (`.github/actions/failure-issue`); `db-backup` has its own failure-issue step.
  `notify.yml` opens a "Notification job failed" issue too. Watch the repo's issues.
- **Security gate (D22):** `.github/workflows/security.yml` runs `npm audit
  --omit=dev --audit-level=high`, `pip-audit -r requirements.txt` and gitleaks.
  Founder: GitHub → Settings → Code security → turn on secret scanning and
  push protection (free on public repos).
- **Sign-in circuit (D13):** the global daily cap (`OTP_GLOBAL_DAILY_CAP`, 60)
  now counts only codes for **new** sign-ups; existing accounts have their own
  cap of `OTP_ACCOUNT_DAILY_CAP` (5) a day per address, and one network can
  start at most `OTP_NEW_PER_NETWORK_DAILY` (5) new sign-ups a day. A warning
  is logged (and reaches Sentry when on) at 50% of the global cap.
- **Uptime:** UptimeRobot (free) keyword monitor on
  `https://rightdue.app/api/health` for `"db":"enabled"` and on `/api/healthz`.
  On the free Render plan use a **20-minute** interval or none: a 5-minute ping
  keeps the instance awake ~744 h/month and can drain the 750-hour workspace pool.
- **Rate-limit smoke check** (E-01) after each deploy:
  `scripts/smoke-rate-limit.sh https://rightdue.app` (invalid email, sends nothing;
  expects a 429 by the 6th request).

## 5. Client address and rate limits (E-01)

See DEPLOY.md, "Client address and rate limits". In short: on Render the API keys
limits on `CF-Connecting-IP` (written by Render's own Cloudflare edge). Env:
`CLIENT_IP_HEADER` (default `cf-connecting-ip` when `RENDER` is set; `none` to
disable), `TRUSTED_PROXY_HOPS` fallback (`3` for Render's chain), `RATE_LIMITS`
(must be unset or `on` in production). **Turn on Turnstile before a public
post (D13):** Cloudflare → Turnstile → Add widget (`rightdue.app`, Managed);
in Render set `NEXT_PUBLIC_TURNSTILE_SITE_KEY` (build-time: **Clear build
cache & deploy**) and `TURNSTILE_SECRET_KEY`. Both are declared in
`render.yaml` with `sync: false`. Check: /login shows the widget and the live
CSP lists `https://challenges.cloudflare.com` in `script-src` and `frame-src`.
`OTP_HASH_KEY` (D25, optional): a long random value keys the stored code
HMAC; without it `INTERNAL_API_TOKEN` is used.

## 6. Hosting plan (E-04, founder decision)

Today: Render Free in **Oregon**, Neon in **Singapore**: every query crosses the
Pacific (~170–200 ms), the instance sleeps after 15 min (30–60 s cold start), and
all free services in the workspace share 750 instance-hours a month.
Region is fixed per service at creation; moving means a new service
(`docs/region-colocation.md`, D9). **Co-location doesn't need the paid plan**:
Render Free in **Singapore** next to Neon (confirm Free is offered there in the
dashboard first). Starter ($7/month, always on) is the separate choice that
also removes sleeping, the robots.txt "disallow all" while asleep (D20) and the
two-deploy rollback limit. Delete the old `finoptima-web` / `finoptima-api`
services, and update the privacy notice's "App server" line in the same PR.

**Search engines while asleep (D20).** While a Free service is spun down,
Render answers `/robots.txt` itself with `User-agent: * / Disallow: /`, without
reaching the app (https://render.com/docs/free, read 14 Oct 2026). Mitigation
in code: the landing Worker (`deploy/cloudflare/landing-worker.mjs`) now also
answers `/robots.txt` and `/sitemap.xml` at the edge, from the same lists as
`web/src/app/robots.ts` and `sitemap.ts` (a web test keeps them equal), and
never wakes Render for them. It needs `rightdue.app` in our own Cloudflare zone
(§8 step 1) and `npx wrangler deploy --config deploy/cloudflare/wrangler.toml`
(DEPLOY.md, "Instant landing page"). Then check Google Search Console's
robots.txt report after a week. Without the zone, the only fixes are a paid
plan or keeping the service awake (a ping every <15 min uses ~744 of the 750
monthly hours, so nothing else in the workspace could run).

## 7. Email DNS (E-17, founder, name.com)

- `_dmarc` TXT: `v=DMARC1; p=none; rua=mailto:dmarc@rightdue.app; adkim=s; aspf=r; pct=100`
  (create the `dmarc@` forward first); move to `p=quarantine` after 2–4 clean weeks.
- Apex SPF: drop `a` (Render's shared 216.24.57.1 never sends our mail). If you send
  as `vijeya@rightdue.app` through name.com, use `v=spf1 include:<name.com's SPF
  include> ~all`; if nothing sends from the apex, `v=spf1 -all`. Resend uses
  `send.rightdue.app`, which has its own SPF.
- CAA: `0 issue "letsencrypt.org"` plus the CA on Render's current certificate
  (check the issuer first) and `0 issue "pki.goog"` if Render uses Google Trust Services.
- Send one sign-in code to Gmail and Outlook; "Show original" must show DKIM=pass,
  DMARC=pass, aligned.
- Create `privacy@rightdue.app` and `support@rightdue.app` forwards; the grievance
  contact in `web/src/lib/privacy-facts.ts` is still the founder's own mailbox (E-10).
- After HSTS has been live a few weeks without problems, submit rightdue.app at
  https://hstspreload.org (the header already carries `preload`).

## 8. Edge caching of build files (R11-2, founder action)

What the live site sends today (checked 2026-10-14 with `curl -sI`):

- `/_next/static/chunks/*.js`: `cache-control: public, max-age=31536000, immutable`
  (Next.js's default for hashed build files; `next.config.mjs` and
  `security-headers.mjs` don't override it), but `cf-cache-status: DYNAMIC` and
  `x-render-origin-server: Render`: every chunk request goes to the Render instance.
- Pages (`/`): `cache-control: public, max-age=0`, `cf-cache-status: DYNAMIC` (correct:
  pages carry per-user data and must not be edge-cached).

Why it matters: the Cloudflare in front of the site is **Render's own edge**, not a
zone in our account (`rightdue.app` NS are name.com; apex A `216.24.57.1`, `www` CNAME
`rightdue.onrender.com`). A short Render/edge blip answers `502` with no
`x-render-origin-server` header; on a shared chunk during a client navigation that is
a `ChunkLoadError` (the app reloads once to recover, R10-3), on `auth/me` it briefly
shows the signed-out state (the browser now retries that GET once, R11-2).

Recommended (founder decides; nothing has been changed):

1. **Put the domain behind our own Cloudflare zone** (free plan): add `rightdue.app`
   to the Cloudflare account, copy every record from name.com first (apex A
   `216.24.57.1`, `www` CNAME `rightdue.onrender.com`, the Resend/`send` records, MX,
   SPF/DKIM/DMARC, CAA from section 7), then switch the nameservers at name.com.
   Proxy (orange cloud) only the apex and `www`; leave the mail records DNS-only.
   SSL/TLS mode **Full (strict)** (Render serves a valid certificate). Check the
   Render dashboard still shows the custom domains as verified afterwards.
2. **Cache Rule** (Caching → Cache Rules → Create rule):
   - When: `URI Path` *starts with* `/_next/static/` (hostname `rightdue.app` or
     `www.rightdue.app`).
   - Then: **Eligible for cache**; Edge TTL **Use cache-control header if present**
     (respects `max-age=31536000, immutable`); Browser TTL **Respect origin**.
   - Do **not** cache `/`, `/api/*`, `/_next/data/*`, or any `?_rsc=` request; the
     default (no rule) already bypasses them for HTML and JSON.
   - Verify: `curl -sI https://rightdue.app/_next/static/chunks/<any>.js` twice; the
     second answer should show `cf-cache-status: HIT`.
3. Optional, same zone: Cache Rule for `/fonts/*` and `/favicon*`/`/icon*` with
   Edge TTL 1 day.
4. Without step 1 there is no rule to set: Render web services have no CDN cache
   for responses (only Render static sites do). In that case rely on the client
   retries and the one-time chunk reload, and if 502s recur ask Render support with
   the `rndr-id`/`cf-ray` and time (e.g. 2026-10-14 08:35 and 09:15 IST).

## 9. Planned, not built yet

- **Funnel counts (E-05).** Design in `docs/SETUP-FUNNEL.md`. Smallest build with
  no paid service: `POST /api/funnel {event}` (8 allow-listed events:
  `landing_view`, `setup_start`, `setup_step_done_{1,2,3}`, `plan_shown`,
  `signin_code_sent`, `signin_done`, `loancheck_result`) that upserts a
  `funnel_counts(day, event, count)` row (one Alembic migration, no visitor rows,
  no IP stored, rate-limited by the existing middleware), sent with
  `navigator.sendBeacon`; a weekly Action posts the counts to an issue. Add a line
  to the privacy notice. Alternative: Cloudflare Web Analytics (free, cookieless)
  needs its host in CSP `script-src`/`connect-src` and the notice.
- **Profile out of script-readable storage (E-09b, decision #10 Option B; audit
  80+ D16).** Shipped 14 Oct 2026 (safe part): account copies of the profile
  and mirrored slices are written with a 30-day lifetime (the sign-in) instead of
  365 days (`web/src/lib/readable-cookie-age.ts`), and wiped when the session
  ends (D21). Individual stores that write their own cookie (strategy, ef-split,
  debt-budget, …) still use a year. Not shipped, and still needed before a
  public post: Today
  the profile lives in readable `rightdue_*` cookies and localStorage so pages can
  render it on the server for guests. Moving it is not contained (server-sync,
  user-store, every server page's `loadProfileServer`), so: (1) for signed-in users
  read the profile from `/api/user/state` on the server and stop mirroring it into
  readable cookies; (2) for guests keep it in localStorage only and render
  client-side, or an HttpOnly cookie holding an encrypted blob; (3) drop
  `'unsafe-inline'` with a nonce CSP from `middleware.ts` (makes every page
  dynamic; measure memory on the 512 MB plan first). Do it before the public launch.
  Shipped now: `script-src-attr 'none'` (inline handler attributes never run).
- **Failure alerts on scheduled workflows (E-03c):** done for market-data,
  policy-rates, rate-disclosures and db-backup (D18, §4); `notify.yml` still to add.
