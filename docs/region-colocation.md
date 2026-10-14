# Co-locating the app and the database (grill #52)

Recorded 12 Oct 2026 (sprint G8), re-checked 14 Oct 2026 for audit 80+ D9.
**No change has been made**; these are the steps, for when the founder
decides. Co-location does **not** need the paid plan.

## Today

| Part | Where | Source |
| --- | --- | --- |
| Database | Neon, AWS Asia Pacific (Singapore), `aws-ap-southeast-1` | docs/neon-configuration.md |
| App (Next.js + FastAPI, one service `rightdue`) | Render, Oregon (render.yaml sets no `region`, and Oregon is Render's default) | render.yaml, DEPLOY.md |

Every query crosses the Pacific (Oregon to Singapore and back), on top of the
free plan's cold start. Indian users' data is stored in Singapore, and served
from the USA.

## Facts that decide the plan (read 12 Oct 2026, re-read 14 Oct 2026)

- Render regions: Oregon, Ohio, Virginia, Frankfurt, Singapore. "Render
  doesn't currently support changing the region for an existing service":
  create a new service in the region and move the settings
  (https://render.com/docs/regions).
- Neon AWS regions include Singapore (`aws-ap-southeast-1`); there is no
  Mumbai region. A project's region is fixed at creation
  (https://neon.com/docs/introduction/regions).
- Render Free: 750 free instance hours per workspace per month; a free web
  service spins down after 15 minutes without traffic and takes about a
  minute to wake (https://render.com/docs/free). One service running all month
  is about 744 hours, inside the 750 as long as it is the only free service.

- Region is fixed **per service, at creation**: "Render doesn't currently
  support changing the region for an existing service or database. Instead,
  create a new service or database in the desired region, then migrate your
  configuration and data" (https://render.com/docs/regions, 14 Oct 2026).
  Each region is a separate private network; that does not matter here
  (Neon is reached over the public internet with TLS either way).
- In `render.yaml` the field is `region:` on the service (values `oregon`,
  `ohio`, `virginia`, `frankfurt`, `singapore`); omitted means Oregon.
- Free plan in Singapore: Render's /docs/free page lists no region limit
  (re-read 14 Oct 2026). **[unverified]**: confirm in the dashboard's
  "New Web Service" flow that Free is offered with Singapore selected
  before deleting anything.
- Cost (https://render.com/pricing, read 14 Oct 2026): Free $0/month (512 MB,
  sleeps after 15 min, robots.txt "disallow all" while asleep, rollback to
  the two most recent deploys only); Starter $7/month (512 MB, 0.5 CPU,
  always on); Standard $25/month (2 GB, 1 CPU). The pricing page shows one
  price per plan with no regional surcharge. Moving region alone costs $0.
- Latency today: Oregon to Singapore and back is about 170-200 ms per query
  (RUNBOOK §6). After the move the app and Neon share AWS ap-southeast-1
  (typically single-digit ms; not measured here).

So the free co-located option is **Render Singapore + Neon Singapore** (Neon
stays where it is; only the app moves). Neither offers India. RBI's Digital
Lending data-localisation rule applies only to lending (RightDue has ruled
that out), so Singapore is a latency and disclosure choice, not a legal one.

## Steps (when approved)

0. Check (dashboard, New → Web Service) that the Free plan can be picked in
   Singapore. If not, the choice is Starter ($7/month) in Singapore or staying
   in Oregon.
1. In `render.yaml`, add `region: singapore` to the `rightdue` service, and
   rename the service (for example `rightdue-sg`): a Blueprint cannot move an
   existing service, so it must be a new one. Keep `plan: free`.
2. Sync the Blueprint. Render creates the new service in Singapore.
3. Copy the environment from `rightdue`: `DATABASE_URL` (same Neon URL),
   `RESEND_API_KEY`, `RESEND_FROM`, `OUTCOMES_IP_KEY`, `INTERNAL_API_TOKEN`,
   `WEB_ORIGIN` (with the new onrender.com host), `TRUSTED_PROXY_HOPS=3` (fallback only; on Render the API reads CF-Connecting-IP),
   `COOKIE_SECURE=1`, and any of the optional flags in DEPLOY.md, including
   the audit 80+ ones if set: `NEXT_PUBLIC_TURNSTILE_SITE_KEY` (build-time),
   `TURNSTILE_SECRET_KEY`, `OTP_HASH_KEY` (copy it, or codes in flight stop
   working), `SENTRY_DSN`. Copy `OUTCOMES_IP_KEY` and `INTERNAL_API_TOKEN`
   rather than generating new ones (new values reset today's per-address
   counts; with no `OTP_HASH_KEY`, a new `INTERNAL_API_TOKEN` voids codes
   sent in the last 10 minutes).
4. Deploy, check `https://<new>.onrender.com/api/health` shows `"db": "enabled"`,
   sign in once on the onrender.com URL.
5. Move the custom domain `rightdue.app` from the old service to the new one
   (Render → Settings → Custom Domains), point the Cloudflare CNAME at the new
   onrender.com host (proxied), wait for the certificate. Today the domain's
   DNS is at name.com (apex A `216.24.57.1`, `www` CNAME
   `rightdue.onrender.com`, RUNBOOK §8): change the `www` CNAME to the new
   onrender.com host; the apex A record is Render's shared address and stays.
6. Check rightdue.app, then delete the Oregon service. Both use the free
   instance hours while both run, so do steps 4–6 the same day.
7. Update `STORAGE.appServer` in `web/src/lib/privacy-facts.ts` (today
   "Render, Oregon (USA) region") to "Render, Singapore region", the
   privacy notice wording that says data is served from the USA, RUNBOOK §6
   and docs/neon-configuration.md, in one PR. Bump `NOTICE_VERSION` in
   `web/src/lib/privacy-facts.ts` and `api/privacy_facts.py` together only if
   counsel says the change is material (a move closer to India is not a new
   purpose); a bump asks every account to agree again (D2).
8. Watch the first day: `/api/health`, Sentry (if on), and one sign-in from a
   phone. If you want a way back, **suspend** the Oregon service in step 6
   instead of deleting it (Render → Settings → Suspend; it then does not run),
   and delete it a few days later. Rollback is then: resume it and move the
   custom domain back.

Sessions and saved plans live in Neon, so users stay signed in across the move
(the session cookie is for rightdue.app, unchanged).
