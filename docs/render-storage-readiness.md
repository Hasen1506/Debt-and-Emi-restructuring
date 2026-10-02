# Render storage readiness

The existing frontend and API automatically deployed merged main commit
`e5bbd0f001619ec05ca323a46cee049f969d5b30` (PRs 16–17). The live URLs are
https://finoptima-web.onrender.com and https://finoptima-api.onrender.com.
Infrastructure names are retained to preserve URLs; the app brand is RightDue.

Before this follow-up there was no Render Postgres instance. The app ran in
trial mode: cookies/localStorage persisted data only in the browser. Resend
is an email provider, not the app's database.

## Fixes before enabling accounts

- Fixed-path same-origin auth/state proxy keeps the HttpOnly session on the
  frontend host. It verifies write origins, rejects unknown paths/methods,
  preserves authentication errors and rate limits, and never forwards the
  internal rate-limit bypass token or unrelated financial cookies.
- Postgres DATABASE_URL values supplied by Render are normalized for asyncpg.
- Goals, goal contributions, monthly spending, decisions and EF split now
  hydrate on fresh devices. Their plan digests are rebuilt before login navigation.
- First sign-in migrates all saved slices. Switching known accounts or signing
  out clears the previous account's local cache. Login next URLs stay local.
- Slice updates use PATCH with a per-user SQL lock, including first-row creation,
  so different devices changing different slices cannot replace unrelated data.
  Two concurrent edits to the same slice still use the latest save.
- Missing email configuration returns an error instead of claiming email delivery
  or printing live OTP codes. Local stdout delivery requires OTP_DEV_MODE=true.

## Configuration

- API: DATABASE_URL (internal Postgres URL), COOKIE_SECURE=1,
  COOKIE_SAMESITE=lax, RESEND_API_KEY; optionally RESEND_FROM for a verified domain.
- Web: WEB_ORIGIN=https://finoptima-web.onrender.com.
- DATABASE_URL and a dedicated sending-only RESEND_API_KEY are saved on Render.
  Production health confirms db=enabled and outcomes_storage=database.
- NEXT_PUBLIC_DISABLE_AUTH=false and WEB_ORIGIN are configured on the frontend.
  The account proxy changes in this PR must deploy before browser login is verified.
- Never enable OTP_DEV_MODE on Render.

The new free rightdue-db instance expires on 1 November 2026. Free Render
Postgres has no managed backups and is intended for testing. Upgrade/export
before expiry for permanent storage. Resend's test sender is restricted to the
account owner's email; a verified sender domain is needed for other users.

## Verification boundaries

Frontend tests cover host routing, cookies, origin/path/method rejection,
upstream errors, all newly restored slices/digests, first-login migration and
account cache isolation. Backend tests cover fail-closed email delivery and
real SQL state round-trips using independent sessions with controlled identities.
Local SQL tests use SQLite with a test-only JSONB compilation adapter; they
do not prove PostgreSQL locking or real OTP delivery.

Live OTP, database persistence after logout, and two signed-in browser sessions
must be verified on Render after database/email wiring. They are not established
by these local tests or by a successful deployment.

## Latest additions review (PRs 16–17)

- 756 backend/engine tests and 46 frontend tests pass after integration.
- Actual Render checks return India/US market odds, Frankfurter INR/USD and
  open-er-api USD/AED quotes. Provider checks are saved outside the repo in
  outputs/rightdue-live-rates-review.json, with no account secrets.
- Fixed malformed market response handling and cached meetings surviving their day.
- Asset edits preserve stock quantities/tickers/quote/FX metadata and stay on the
  form when browser storage rejects a save.
- Strategy comparisons retain feasible orders when another order runs short.
- NRI loan switching clears a missing tenure and resets untagged loans to the
  residence currency; profile refreshes retain the selected loan.
- Borrowing timing identifies the independence assumption when combining meetings,
  warns that rates can rise while waiting, and labels stale market snapshots.
- Queued saves are bound to the originating account; boot hydration does not
  overwrite an intervening local save and refreshes server-rendered calculations.
- Strategy pips now have 24px targets; the signed-in masthead can wrap on phones.
- Blueprint updates preserve the explicitly configured auth mode and secret values.

Exchange rates saved in Profile remain explicit plan assumptions. The NRI tool
fetches a current quote independently; a live quote does not silently overwrite
the user's stored plan assumptions. Concurrent edits of the same state slice still
use last-save-wins.

## Live-account follow-up

- Real OTP delivery to the owner Gmail, sign-in, trial-profile migration and a
  reload with the synthetic INR 200,000 card balance were verified on Render.
- Session-change events refresh the header immediately after sign-in. Failed
  sign-out leaves the account and cache intact and displays an error.
- Failed slice writes are retained in an account-specific localStorage queue,
  retried on reload/reconnection or with Retry save, and flushed before logout
  or server hydration. Storage quota failure keeps an in-memory retry and warns
  the user to keep the tab open; it cannot promise recovery after closing it.
- Browser state requests send an expected account ID. GET, PUT and PATCH reject
  a mismatched session identity, preventing a cookie/account-switch race.
- Hydration also checks for edits made during deferred digest imports.
- Restructuring cards explicitly identify current-balance estimates; paying a
  card off sooner reduces the advertised balance-transfer saving.
- Local tests exercise retry after module reload, interrupted saves, new edits
  during an in-flight save, quota failure, account isolation, auth-change events
  and unsuccessful logout. These are not a substitute for live persistence tests.
