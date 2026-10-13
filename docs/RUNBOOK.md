# RightDue operations runbook

Written for UX50 critique E (launch readiness, 13 Oct 2026). Short on purpose:
what to do when something breaks, and the settings only the founder can change.

## 1. Deploys and rollback

- Every merge to `main` deploys `rightdue` on Render (Docker, `render.yaml`).
  Alembic migrations run at container start (`api/db/database.py init_db()`).
- **Recommended (founder, Render dashboard):** Settings → Build & Deploy →
  Auto-Deploy → **"After CI checks pass"**, so a red `main` never goes live (E-18a).
  Also GitHub → Settings → Branches → protect `main`, require the `CI` checks
  (the data-PR auto-merge workflows then need the checks to pass too).

### Rolling back code
1. Render → `rightdue` → Events → pick the last good deploy → **Rollback**.
2. Then `git revert -m 1 <merge sha>` on a branch, PR, merge, so `main` matches
   what is live (otherwise the next merge re-deploys the bad change).

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
- `.github/workflows/db-backup.yml` runs nightly at 02:10 IST: `pg_dump
  --format=custom` (Postgres 17 client), checked with `pg_restore --list`,
  encrypted with `age`, uploaded to a **private** bucket. It never uploads to this
  public repo's artifacts. It skips green when `DATABASE_URL` is not set and
  opens an issue when it fails.
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
     `BACKUP_S3_SECRET_ACCESS_KEY`. Run the workflow once by hand.
- **Restore (test once on the `dev-neon-setup` branch first):**
  ```
  aws s3 cp s3://<bucket>/nightly/rightdue-<stamp>.dump.age . [--endpoint-url …]
  age -d -i rightdue-backup.key -o rightdue.dump rightdue-<stamp>.dump.age
  pg_restore --clean --if-exists --no-owner --dbname "$TARGET_DATABASE_URL" rightdue.dump
  ```
  Restore into a new Neon branch, check it, then point `DATABASE_URL` at it (or
  restore over production during a quiet hour). Delete the plaintext dump after.
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
  deliberate test error after setting it.
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
(must be unset or `on` in production). Turn on Turnstile before a public post:
`TURNSTILE_SECRET_KEY` + `NEXT_PUBLIC_TURNSTILE_SITE_KEY` (build arg).

## 6. Hosting plan (E-04, founder decision)

Today: Render Free in **Oregon**, Neon in **Singapore**: every query crosses the
Pacific (~170–200 ms), the instance sleeps after 15 min (30–60 s cold start), and
all free services in the workspace share 750 instance-hours a month.
Recommendation before a public launch: Render Starter in **Singapore** next to
Neon (`docs/region-colocation.md`), delete the old `finoptima-web` /
`finoptima-api` services, and update the privacy notice's "App server" line in
the same PR. For a private soft launch, staying free is acceptable.

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

## 8. Planned, not built yet

- **Funnel counts (E-05).** Design in `docs/SETUP-FUNNEL.md`. Smallest build with
  no paid service: `POST /api/funnel {event}` (8 allow-listed events:
  `landing_view`, `setup_start`, `setup_step_done_{1,2,3}`, `plan_shown`,
  `signin_code_sent`, `signin_done`, `loancheck_result`) that upserts a
  `funnel_counts(day, event, count)` row (one Alembic migration, no visitor rows,
  no IP stored, rate-limited by the existing middleware), sent with
  `navigator.sendBeacon`; a weekly Action posts the counts to an issue. Add a line
  to the privacy notice. Alternative: Cloudflare Web Analytics (free, cookieless)
  needs its host in CSP `script-src`/`connect-src` and the notice.
- **Profile out of script-readable storage (E-09b, decision #10 Option B).** Today
  the profile lives in readable `rightdue_*` cookies and localStorage so pages can
  render it on the server for guests. Moving it is not contained (server-sync,
  user-store, every server page's `loadProfileServer`), so: (1) for signed-in users
  read the profile from `/api/user/state` on the server and stop mirroring it into
  readable cookies; (2) for guests keep it in localStorage only and render
  client-side, or an HttpOnly cookie holding an encrypted blob; (3) drop
  `'unsafe-inline'` with a nonce CSP from `middleware.ts` (makes every page
  dynamic; measure memory on the 512 MB plan first). Do it before the public launch.
  Shipped now: `script-src-attr 'none'` (inline handler attributes never run).
- **Failure alerts on scheduled workflows (E-03c):** `db-backup.yml` opens an issue
  on failure; add the same `if: failure()` step to `market-data`, `policy-rates`,
  `rate-disclosures` and `notify`.
