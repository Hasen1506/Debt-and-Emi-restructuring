# Error tracking and uptime monitoring (grill #64)

Sprint G8, 12 Oct 2026. Both are **off until configured**; nothing is sent
anywhere by default.

## Error reports (Sentry)

Set `SENTRY_DSN` on the Render service (the "DSN" is the address Sentry gives
a project, like `https://<key>@o123.ingest.sentry.io/456`). Optional:
`SENTRY_ENVIRONMENT` (default `production`), `SENTRY_RELEASE`.

- API: `api/observability.py`, called from the unhandled-error handler in
  `api/main.py`. Web: `web/src/lib/error-report.ts`, called from Next.js
  `onRequestError` (`web/src/instrumentation.ts`). Server side only.
- Each report has the error type, a message cut to 300 characters with every
  digit replaced by `#`, the route pattern (no query string), the method, and
  (API) stack frames without local variables. Never the body, headers,
  cookies, address or account. Tests: `api/tests/test_g8_security_privacy.py`,
  `web/tests/g8-security-privacy.cjs`.
- Not the Sentry SDK on purpose: no new dependency, and no default data
  collection to switch off.
- Cost: Sentry's Developer plan is $0 for one user, 5k errors a month
  (https://sentry.io/pricing/, read 12 Oct 2026).

## Uptime (free monitor)

Watch two URLs every 5 minutes and email the founder on failure:

| URL | What it proves |
| --- | --- |
| `https://rightdue.app/api/health` | Cloudflare → Render → Next.js → FastAPI all answer; `"db":"enabled"` means Neon is reachable (add a keyword check for `"db":"enabled"`) |
| `https://rightdue.app/api/rates/feed-health` | the policy-rate feed is current |

Options (read 12 Oct 2026): UptimeRobot Free, $0, 50 monitors at a 5-minute
interval, keyword monitoring included (https://uptimerobot.com/pricing/), or
Sentry's uptime monitor (one on the free plan).

**Caveat:** a check every 5 minutes keeps the free Render service awake all
month (it spins down only after 15 idle minutes). One always-on service uses
about 744 of the workspace's 750 free instance hours a month
(https://render.com/docs/free), so it fits only while it is the only free
service; with a second free service, use a 20-minute interval or accept that
the monitor also measures cold starts.
