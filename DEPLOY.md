# Deploying RightDue to Render

RightDue runs as **one** Render web service, `rightdue` (`render.yaml`,
`Dockerfile`, `deploy/start.sh`). One container runs both halves:

```
browser ─▶ Cloudflare (rightdue.app) ─▶ Render ─▶ Next.js  0.0.0.0:$PORT
                                                    │ every /api/* path Next does not serve
                                                    ▼ (web/next.config.mjs rewrites.fallback)
                                                 FastAPI  127.0.0.1:8000 (uvicorn, 1 worker)
```

- On the free plan a visit now wakes one instance instead of two, and the API
  is already running by the time the page has loaded (the start script waits
  for FastAPI's `/api/health` before opening the public port).
- Next.js keeps its own `/api/session/*` and `/api/holdings/quote`; a
  `fallback` rewrite sends every other `/api/*` path, including
  `/api/health` (the Render health check), to FastAPI. The browser only talks
  to one origin, so `CORS_ORIGINS` and `NEXT_PUBLIC_API_BASE_URL` are not set.
  Server code reaches the API at `API_INTERNAL_URL` (default
  `http://127.0.0.1:8000`, `web/src/lib/api-base.ts`).
- If either process exits, the container exits and Render restarts it.
- Memory (512 MB on the free plan): measured locally about 155 MB idle after
  start (uvicorn ~97 MB, Next.js standalone ~58 MB) and about 190 MB after a
  few hundred page and API requests. `NODE_OPTIONS=--max-old-space-size=256`
  caps the Node heap.

### Client address and rate limits

`api/client_ip.py` reads `X-Forwarded-For` only as far back as
`TRUSTED_PROXY_HOPS`. Through Cloudflare (orange cloud) the chain ends
`…, <visitor>, <Cloudflare edge>` (Cloudflare writes the visitor, Render
appends the edge), so `TRUSTED_PROXY_HOPS=2`. The Next.js proxy (the rewrite
and the `/api/session` route) passes `X-Forwarded-For` through **unchanged**,
so it adds no hop. Set it to `1` if rightdue.app is ever DNS-only (grey cloud).
Requests sent straight to `*.onrender.com` bypass Cloudflare and could choose
their own rate-limit bucket; that was already true of the old deploy.

### Security and privacy settings (sprint G8)

All optional; the defaults are safe. Set them on the `rightdue` service.

| Variable | Default | What it does |
| --- | --- | --- |
| `OTP_GLOBAL_DAILY_CAP` | `90` | Sign-in codes sent per 24 h across **all** emails. Keep it under the email plan's quota (Resend Free: 100 a day, 3,000 a month, resend.com/pricing, 12 Oct 2026). When reached, sign-in shows "paused for today". |
| `AUTH_LOG_RETENTION_DAYS` | `365` | How long sign-in records (codes sent, ended sessions) are kept, then purged (docs/privacy-and-retention.md). |
| `RATE_LIMIT_STORE` | `db` | `db`: sign-in, account, admin and outcome routes also count against an hourly limit in Postgres, so a restart can't reset it. `memory`: in-memory buckets only. |
| `RATE_BUCKET_KEY` | `OUTCOMES_IP_KEY` | Key for the hash of client addresses in `rate_buckets`. |
| `TURNSTILE_SECRET_KEY` | unset (off) | Cloudflare Turnstile on code requests. Needs `NEXT_PUBLIC_TURNSTILE_SITE_KEY` too (below). |
| `NEXT_PUBLIC_TURNSTILE_SITE_KEY` | unset (off) | Build-time (Docker build arg): shows the Turnstile box on /login and allows `challenges.cloudflare.com` in the CSP. |
| `SENTRY_DSN` | unset (off) | Scrubbed server error reports from the API and the web server (docs/monitoring.md). |
| `RIGHTDUE_ALLOW_DISABLED_AUTH` | unset | Never on a public deploy. A production build or container start refuses `NEXT_PUBLIC_DISABLE_AUTH=true` unless this is `1` (web/auth-guard.mjs, deploy/start.sh). |

**Turnstile, step by step.** Cloudflare dashboard → Turnstile → Add widget:
hostname `rightdue.app` (and the onrender.com host if you sign in there),
mode "Managed". Copy the site key into `NEXT_PUBLIC_TURNSTILE_SITE_KEY` and the
secret key into `TURNSTILE_SECRET_KEY`, then **Clear build cache & deploy**
(the site key is compiled in). Turn it off by removing both.

**Pages now send a Content-Security-Policy** with `frame-ancestors 'none'`
(web/security-headers.mjs) in production builds; `next dev` does not, so
local preview tools still work. A new third-party script, frame or API
origin must be added there.

**Regions**: docs/region-colocation.md (no change made).

### Cutover from the old two services

Render cannot change an existing service's runtime (python/node → docker), so
`rightdue` is a new service. The old `finoptima-web` and `finoptima-api`
stay in `render.yaml` only as a commented record.

1. Merge this change. In Render, open the Blueprint (or **New → Blueprint**
   on this repo) and sync it: Render creates `rightdue`. Removing the old
   services from `render.yaml` does **not** delete them; they keep serving.
2. On `rightdue` → **Environment**, copy from `finoptima-api`:
   `DATABASE_URL`, `RESEND_API_KEY`, `RESEND_FROM` (and `OUTCOMES_IP_KEY` if
   you want today's per-address outcome counts kept). Set
   `NEXT_PUBLIC_DISABLE_AUTH=false` and
   `WEB_ORIGIN=https://rightdue.app,https://<rightdue service>.onrender.com`.
   Save, then **Manual Deploy → Clear build cache & deploy** (the
   `NEXT_PUBLIC_*` value is compiled in at build time).
3. Check `https://<rightdue>.onrender.com/api/health` says `"db": "enabled"`,
   then sign in on the onrender.com URL once.
4. Move the domain: remove `rightdue.app` (and `www` if used) from
   `finoptima-web` → **Settings → Custom Domains**, add it to `rightdue`.
   In Cloudflare DNS point the `rightdue.app` CNAME (and `www`) at
   `<rightdue>.onrender.com`, keep it proxied (orange) and SSL mode Full
   (strict). Wait for Render to verify the domain and issue its certificate.
5. Check https://rightdue.app loads, `/api/health` answers, sign-in works.
6. Delete `finoptima-web` and `finoptima-api` in the Render dashboard.

## The old two-service deploy (retired)

The sections below describe the previous `finoptima-web` + `finoptima-api`
deploy and are kept for reference until the cutover is done.

## First-time deploy

1. Push this repo to GitHub.
2. In the Render dashboard: **New → Blueprint** → connect your repo → select
   the branch with `render.yaml`.
3. Render detects two services and prompts for two environment variables.
   **Leave them blank for now** — click *Deploy*. Both services start, build,
   and get URLs like `https://finoptima-api-xxxx.onrender.com` and
   `https://finoptima-web-xxxx.onrender.com`.
4. After the URLs exist, go to each service's **Environment** tab and fill in:
   - `finoptima-api` → `CORS_ORIGINS` = the **web** service URL (full
     `https://...onrender.com`, no trailing slash). Comma-separate if you have
     more than one allowed origin.
   - `finoptima-web` → `NEXT_PUBLIC_API_BASE_URL` = the **api** service URL.
5. Trigger a redeploy on both services (or push any commit — Render redeploys
   automatically). Done — your frontend now hits your live backend.

## Plans / cost

`render.yaml` requests `plan: free` for both services. Free instances sleep
when idle, and the first request can take 50 seconds or more to wake them.
Paid instance plans can be selected in Render if always-on service is needed.

Speed: a free instance gets about a tenth of a CPU. Plan renders in about
50 ms of CPU on a laptop (plus five engine calls on the API, run in
parallel), which a tenth of a CPU stretches to a second or two, more on the
first visit after a restart. The `starter` plan on `finoptima-web` (and the
API) is the fix. On a paid API plan the web server can also reach the API
over Render's private network: set `API_BASE_URL` on `finoptima-web` to
`http://finoptima-api:<port>` (the API's internal address on its Connect
tab). Free services can't receive private-network traffic, so leave it unset
on the free plan.

## Updating

Any push to the tracked branch triggers a redeploy automatically. To roll
back, use **Manual Deploy** → pick a previous commit in the Render dashboard.

## Keeping the figures current

Nothing to run by hand week to week; three scheduled jobs keep the data
fresh, and each commit they make redeploys the app:

- **Live policy rates.** The API re-reads the RBI repo rate and the Fed funds
  range every 6 hours (`api/rates_feed.py`); `GET /api/rates/feed-health`
  says how old they are.
- **Market data** (`.github/workflows/market-data.yml`, Mondays). Re-reads
  T-bill and Treasury yields, the 1-year FD rate at SBI and HDFC Bank, the
  RBI and Fed inflation forecasts and the 30-year mortgage average, and
  commits `web/src/lib/market-data.json` when one changed. It also reads the
  bank pages behind the Tier-A rate cards. What a script can't settle (a
  bank page whose rates changed, a failed source, a by-hand figure past its
  age, the repo rate moving off what the cards were priced on) is listed in
  one open issue labelled **data-check**, closed when nothing is left.
- **Rate disclosures** (`.github/workflows/rate-disclosures.yml`, Mondays).
  Banks' published ranges of rates on last quarter's loans.

When the data-check issue asks for a rate card to be re-read: update
`engine/rate_cards.py`, run `python scripts/export_rate_cards.py`, then
`node scripts/watch-rate-pages.mjs --accept` in `web/`, and commit. The
workflows push to the default branch with the built-in token, so branch
protection on it must let GitHub Actions push.

## Notifications (payday email, deadline reminders) — off by default

Sprint G7. Nothing is sent and every `/api/notify/*` route answers 404 until
a flag is `true`. Details: `docs/retention/PAYDAY-EMAIL.md`.

| Variable | Where | What |
|---|---|---|
| `PAYDAY_EMAIL_ENABLED` | Render | `true` turns on the payday email and its "All paid / Some / Can't pay" links |
| `DEADLINE_REMINDERS_ENABLED` | Render | `true` turns on complaint / loan-closure reminder emails |
| `NOTIFY_SIGNING_KEY` | Render (secret) | 32+ random characters; signs the email links. `python -c "import secrets;print(secrets.token_urlsafe(48))"` |
| `NOTIFY_CRON_SECRET` | Render (secret) + GitHub secret | 16+ characters; the scheduler's bearer token for `POST /api/notify/run` |
| `PUBLIC_APP_URL` | Render + GitHub variable | e.g. `https://rightdue.app` (links in emails) |
| `RESEND_API_KEY`, `RESEND_FROM` | Render | already set for sign-in codes; `RESEND_FROM` must be on a verified domain |
| `PAYDAY_REPLY_INBOUND` | Render | optional: `true` also accepts a "done" reply |
| `NOTIFY_REPLY_TO` | Render | with inbound: e.g. `reply@in.rightdue.app` on a Resend receiving domain (MX record) |
| `RESEND_WEBHOOK_SECRET` | Render (secret) | with inbound: the `whsec_…` secret of the `email.received` webhook pointing at `https://<app>/api/notify/inbound` |
| `NOTIFY_ENABLED` | GitHub repository variable | `true` lets `.github/workflows/notify.yml` call the run endpoint daily at 09:00 IST |

Needs `DATABASE_URL` (the settings live in two tables, `notify_subscriptions`
and `notify_events`, created on first use). Without it the signed-in routes
answer 503. Account deletion must call `NotifyStore.forget(user_id)`.
`POST /api/closure-letter` (the loan-cleared letter) needs no flag, no key
and stores nothing.

## Custom domain

Each service has a *Custom Domains* tab. Point your DNS CNAME at the
`onrender.com` hostname, add the domain in Render, and Render provisions a
free Let's Encrypt cert. Then update `CORS_ORIGINS` and
`NEXT_PUBLIC_API_BASE_URL` to the custom hostnames.

## Local dev still works the same

```
# Terminal 1 — backend
pip install -r requirements.txt
uvicorn api.main:app --reload

# Terminal 2 — frontend
cd web && npm install && npm run dev
```

`CORS_ORIGINS` defaults to `http://localhost:3000` when unset, so the local
flow needs no env vars.
