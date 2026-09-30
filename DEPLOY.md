# Deploying RightDue to Render

This repo is configured for a two-service Render deploy via `render.yaml`
(a Render "Blueprint"). One service runs FastAPI, the other runs Next.js,
and they talk to each other over the public internet.

The existing Blueprint services retain the infrastructure names `finoptima-web`
and `finoptima-api`. The public app, favicon and email branding use RightDue.
Retaining service names and storage keys preserves existing URLs and saved profiles.

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

## Updating

Any push to the tracked branch triggers a redeploy automatically. To roll
back, use **Manual Deploy** → pick a previous commit in the Render dashboard.

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
