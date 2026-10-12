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

Nothing to run by hand week to week. Three scheduled GitHub Actions re-read
the official sources at the pace each one really changes. The figures are
**correct and dated** (grill #15): each carries its source and the day it
was last checked.

| Job | When | What | Commits when |
|---|---|---|---|
| **Policy rates** (`policy-rates.yml`, `scripts/fetch_policy_rates.py`) | Mondays 03:00 UTC + "Run workflow" | RBI repo rate (rbi.org.in), Fed funds target (FRED) → `api/data/policy_rates_live.json` | a new decision, the first check after a scheduled MPC/FOMC meeting, or a 30-day heartbeat |
| **Rate disclosures** (`rate-disclosures.yml`) | Mondays 03:30 UTC | Banks' published ranges of rates on last quarter's loans | the figures changed |
| **Market data** (`market-data.yml`) | Mondays 04:00 UTC | T-bill/Treasury yields, 1-yr FD at SBI/HDFC, RBI/Fed inflation forecasts, 30-yr mortgage average → `web/src/lib/market-data.json`; checks the bank pages behind the Tier-A rate cards | a figure changed |

- **Why weekly for policy rates (grill #61):** they change only at
  scheduled meetings (RBI MPC 6 a year, FOMC 8). The API used to re-read
  them every 6 hours in a background thread, in a container that sleeps
  after 15 minutes and loses its disk on every restart. Now the API only
  reads the committed file at start. A weekly check lags a decision by at
  most ~5 days; press **Actions → Policy rates → Run workflow** the day
  after a meeting to record it at once.
- **Feed health:** `GET /api/rates/feed-health` answers **503** when a
  scheduled meeting passed more than 7 days ago with no check after it, or
  the last good check is over 45 days old. A free uptime monitor pointed
  at it (alert on any non-200) catches a stopped job.
- **A source that can't be read** turns that week's run red (GitHub emails
  the repo owner). The last good values stay in use.
- **Admin meeting outcomes** (`POST /api/admin/rate-update`, header
  `X-Admin-Token` = `ADMIN_RATE_UPDATE_TOKEN`) are stored in Postgres
  (`rate_meeting_outcomes`, created on first use), so a redeploy no longer
  loses them. Without `DATABASE_URL` the endpoint answers 503 instead of
  writing to the container's disk.

### Data bots open a PR (grill #65)

Every data job runs **only its data tests**, then hands its changed files to
`.github/actions/data-pr`. That action:

1. pushes them to a fixed branch `data/<job>` and opens (or updates) a PR
   labelled `data-bot`;
2. squash-merges it straight away. The data tests already passed in the job.
   A PR opened with the built-in `GITHUB_TOKEN` doesn't start the paid CI:
   GitHub holds those runs as "approval required"
   (https://docs.github.com/en/actions/concepts/security/github_token).
   So a data change costs about a minute of runner time, not a full CI run.

Settings that change this (none are set by this repo):

- **Settings → Actions → General → Workflow permissions → "Allow GitHub
  Actions to create and approve pull requests"** must be ticked for the
  bots to open PRs. Until it is, they fall back to pushing straight to the
  default branch, as before, and say so in the run summary.
- Repo variable **`DATA_PR_MODE=review`** leaves each data PR open for a
  person to merge.
- If branch protection on `main` requires CI checks, a data PR can't
  merge until someone approves its held CI run. Either leave the data paths
  out of required checks or use `review` mode.

Render redeploys on each merge to `main`. Data merges now happen only when a
figure changed (policy rates at most about monthly), so far fewer redeploys.

When the data-check issue asks for a rate card to be re-read: update
`engine/rate_cards.py`, run `python scripts/export_rate_cards.py`, then
`node scripts/watch-rate-pages.mjs --accept` in `web/`, and commit.

## Instant landing page (grill #49), not turned on

Render's free instance sleeps after 15 minutes idle and takes about a minute
to wake (https://render.com/docs/free). `deploy/cloudflare/landing-worker.mjs`
is a free-plan Cloudflare Worker that runs **only** on `rightdue.app/` and
`rightdue.app/welcome.html`:

- signed-out visitors get `welcome.html` from Cloudflare's edge cache at
  once, and the Worker pings `/api/health` in the background so Render is
  waking while they read;
- a cached copy older than an hour is refreshed in the background, so a
  deploy shows within about an hour of traffic; copies are kept up to 7 days;
- signed-in visitors (a `rightdue_session` or `finoptima_session` cookie),
  any query string (e.g. `?country=`), and every other path go straight to
  the app;
- the cache is kept per country bucket (IN / US / other) for the
  country-aware landing.

Workers Free allows 100,000 requests a day
(https://developers.cloudflare.com/workers/platform/pricing/). Only these two
routes count against it. To turn it on (a Cloudflare account change, so it's
the owner's call):

1. `npx wrangler login`, then `npx wrangler deploy --config deploy/cloudflare/wrangler.toml`.
   The routes are in `wrangler.toml`, and DNS must stay proxied (orange cloud).
2. Visit https://rightdue.app/ signed out twice. The second response should
   have the header `X-RightDue-Edge: hit`.
3. To push a new landing page at once: Cloudflare → Caching → Purge
   Everything (or wait up to an hour of traffic).

To turn it off, delete the Worker's routes in the Cloudflare dashboard.

## Free hosting options (grill #62), research only

No hosting setting has been changed. The comparison (Render, Koyeb, Fly.io,
Railway, Oracle Always Free, Cloud Run, Vercel Hobby, Cloudflare), with
sources as of 12 Oct 2026, is in the sprint answers (G9 #62). In short:
nothing is free, always-on and able to run both halves without a catch.
Oracle Always Free never sleeps but needs a card and self-managed servers,
and idle VMs can be reclaimed. The cheapest always-on paid step is about
$4–7 a month in Singapore, next to Neon.

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
