# Co-locating the app and the database (grill #52)

Recorded 12 Oct 2026 (sprint G8). **No change has been made**; these are the
steps, for when the founder decides. Hosting stays free.

## Today

| Part | Where | Source |
| --- | --- | --- |
| Database | Neon, AWS Asia Pacific (Singapore), `aws-ap-southeast-1` | docs/neon-configuration.md |
| App (Next.js + FastAPI, one service `rightdue`) | Render, Oregon (render.yaml sets no `region`, and Oregon is Render's default) | render.yaml, DEPLOY.md |

Every query crosses the Pacific (Oregon to Singapore and back), on top of the
free plan's cold start. Indian users' data is stored in Singapore, and served
from the USA.

## Facts that decide the plan (read 12 Oct 2026)

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

So the free co-located option is **Render Singapore + Neon Singapore** (Neon
stays where it is; only the app moves). Neither offers India.

## Steps (when approved)

1. In `render.yaml`, add `region: singapore` to the `rightdue` service, and
   rename the service (for example `rightdue-sg`): a Blueprint cannot move an
   existing service, so it must be a new one.
2. Sync the Blueprint. Render creates the new service in Singapore.
3. Copy the environment from `rightdue`: `DATABASE_URL` (same Neon URL),
   `RESEND_API_KEY`, `RESEND_FROM`, `OUTCOMES_IP_KEY`, `INTERNAL_API_TOKEN`,
   `WEB_ORIGIN` (with the new onrender.com host), `TRUSTED_PROXY_HOPS=3` (fallback only; on Render the API reads CF-Connecting-IP),
   `COOKIE_SECURE=1`, and any of the optional flags in DEPLOY.md.
4. Deploy, check `https://<new>.onrender.com/api/health` shows `"db": "enabled"`,
   sign in once on the onrender.com URL.
5. Move the custom domain `rightdue.app` from the old service to the new one
   (Render → Settings → Custom Domains), point the Cloudflare CNAME at the new
   onrender.com host (proxied), wait for the certificate.
6. Check rightdue.app, then delete the Oregon service. Both use the free
   instance hours while both run, so do steps 4–6 the same day.
7. Update `STORAGE.appServer` in `web/src/lib/privacy-facts.ts` and the
   privacy notice ("Render, Singapore region"), and docs/neon-configuration.md.

Sessions and saved plans live in Neon, so users stay signed in across the move
(the session cookie is for rightdue.app, unchanged).
