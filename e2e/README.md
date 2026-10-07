# Golden E2E

Real user journeys (Playwright, `web/e2e/*.spec.ts`) against the real API and
the production build of the web app, with every outside dependency stubbed:

| Dependency | Stub (`e2e/api_server.py`) |
|---|---|
| Sign-in email | Never sent; every code is `424242` |
| FX rate | 1 USD = 83.25 INR, as of 2026-10-01 |
| Outbound network | API: httpx to any non-localhost host raises. Browser: requests to non-localhost hosts are aborted (`web/e2e/fixtures.ts`) |
| Clock | Browser and Next.js server start at 7 Oct 2026, 10:00 IST (`E2E_FROZEN_NOW`, `web/e2e/freeze-time.cjs`) |
| Storage | `E2E_DATABASE_URL`, an empty Postgres database; tables are dropped at start |

## Run locally

```bash
# An empty Postgres database, e.g.
createdb rightdue_e2e
export E2E_DATABASE_URL=postgresql://USER:PASS@127.0.0.1:5432/rightdue_e2e
export E2E_PYTHON=python          # the interpreter with requirements-dev.txt

cd web
npm ci && npx playwright install chromium
NEXT_PUBLIC_API_BASE_URL=http://127.0.0.1:8100 API_BASE_URL=http://127.0.0.1:8100 npm run build
npx playwright test                       # starts the API on :8100 and the web app on :3100
npx playwright test --update-snapshots    # after an intended plan change; review the diff
```

The golden files are in `web/e2e/__golden__/`: the `/api/simulate` summary and
the month-by-month plan table for each journey. A changed number there is a
changed plan; update it only when the change is intended (and listed in
`docs/testing/DIFFERENCES.md` if it comes from the engine).

If you run behind an HTTP proxy, set `NO_PROXY=127.0.0.1,localhost` so
Playwright's server checks reach the local servers.
