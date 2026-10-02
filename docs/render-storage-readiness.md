# Render storage readiness

The existing frontend and API automatically deployed merged main commit
`caea388a67af6dec33b40ee4d018ca0218e25241`. The live URLs are
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
- Keep NEXT_PUBLIC_DISABLE_AUTH=true for the current browser-only trial until
  database and email delivery are verified. Set false and rebuild to enable accounts.
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
