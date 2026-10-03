# Production hardening verification — 3 October 2026

This change was tested from main commit `621b414`. It does not configure a
hosted database or certify the currently deployed services.

## Confirmed bugs fixed

- Replacement OTPs invalidate every older challenge. Concurrent first requests
  cannot create duplicate users, concurrent verification cannot consume a code
  twice, and failed email delivery leaves no usable challenge. Email sending runs
  outside the API event loop. A database-backed per-email limit allows five code
  requests per ten minutes, independent of client IP and server worker.
- New sessions store a SHA-256 digest instead of a usable bearer token. A digest
  cannot itself authenticate. Existing plaintext sessions remain valid until
  their normal expiry (at most 30 days); no schema migration is required. Logout
  continues to revoke only the current browser session.
- Private account GET responses use `Cache-Control: no-store`. The frontend
  account proxy enforces the API's 256 KiB limit before buffering or forwarding
  a body, including requests without Content-Length.
- An account switched in another tab cannot receive the previous account's
  delayed hydration response, even before the storage event is delivered.
- Outcome submission limits now hold across independent workers. PostgreSQL
  uses a transaction advisory lock per hashed client; SQLite starts a write
  transaction before counting. Both the per-bank and daily budgets are enforced.
- Home's current-month cash flow excludes EMIs whose first payment month has
  not arrived. Recurring commitments remain available to other planning tools.
  A payment short by less than fifty cents no longer incorrectly counts as paid.
- Stock quotes reject invalid prices/currencies and time out after eight seconds;
  provider exceptions return a generic error rather than internal details.

## Dependency and deployment changes

Next.js is upgraded to 15.5.27, with its asynchronous cookie/route parameter
APIs adopted. PostCSS is pinned to 8.5.28. FastAPI is upgraded to 0.142.2
and python-dotenv to 1.2.4. The development requirements include the new
Starlette test client's httpx2 dependency.

Render uses Node 24, Python 3.12.14 and `npm ci`; CI tests Node 24 and Python
3.12. CI now runs the PostgreSQL concurrency regressions against a disposable
PostgreSQL 17 service. Its published credentials are synthetic test fixtures.
Hosted secrets and the deployment's authentication setting remain dashboard
configuration.

## Verification

- 808 engine/API tests passed, including four real PostgreSQL concurrency tests.
- 118 frontend tests passed; TypeScript checking and the production build passed.
- A clean `npm ci` succeeded. In the authentication-enabled build, anonymous
  Home requests redirected to login, login rendered, and a cross-origin account
  write was rejected.
- 30 Chromium checks passed: 18 payment/audit checks, nine earlier plan checks
  and three account/draft checks. The scripts wait for streamed results before
  asserting their original amounts and saved state.
- Python dependency auditing and `npm audit --omit=dev` reported no known
  vulnerabilities. Full npm auditing still reports five high-severity entries
  through the development-only Next ESLint plugin's braces/fast-glob chain
  (GHSA-vfj7-8cjw-p6xm). The suggested downgrade is not applied to the runtime.

To exercise PostgreSQL locally, provision an empty, disposable database named
`rightdue_test` on localhost, then run:

```sh
pip install -r requirements-dev.txt
RIGHTDUE_TEST_DATABASE_URL='postgresql://TEST_USER:TEST_PASSWORD@127.0.0.1:TEST_PORT/rightdue_test' \
  python -m pytest engine/tests api/tests -q
cd web
npm ci
npm run typecheck
npm run lint
npm test
NEXT_PUBLIC_DISABLE_AUTH=false npm run build
```

**The PostgreSQL tests recreate tables.** They refuse non-local hosts and any
database name other than `rightdue_test`; never point them at application data.
Without the test URL, those four tests skip. Browser scripts require a separate
local trial build and API with feeds off and matching synthetic internal API
tokens; see the scripts and existing audit documentation for their fixtures.

## Remaining deployment verification

No Neon connector or injected DATABASE_URL was available in this environment.
The database checks used local PostgreSQL rather than a hosted Neon instance.
Real Resend delivery and deployed two-device persistence still need validation
against the deployment after its database/email settings are confirmed. The
local production build uses authentication enabled; a successful build does
not establish that the hosted dashboard has the same setting.
