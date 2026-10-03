# PostgreSQL hosting with a Render API

The Next.js frontend and FastAPI API can stay on Render while PostgreSQL
is hosted elsewhere. `DATABASE_URL` belongs to the **API** service's secret
environment settings. It must not be a `NEXT_PUBLIC_` setting.

The database stores accounts, sessions, sign-in code hashes, per-account
financial state and shared outcome reports. Browser cookies and localStorage
are caches; they are not a substitute for preserving the database. Creating
empty tables on a new provider does not move existing accounts or history.

Render Free PostgreSQL expires after 30 days. Neon Free currently advertises
no time limit, with 1 GB PostgreSQL storage, 100 CU-hours and 5 GB outbound
transfer per project per month. Compute sleeps after five idle minutes and
can be suspended if monthly quotas are exhausted; that does not delete
stored rows. Verify the current allowances at https://neon.com/pricing and
https://neon.com/docs/introduction/plans before selecting a plan.

## Asyncpg and TLS

The API uses SQLAlchemy with asyncpg. Both `postgres://` and `postgresql://`
URLs are normalized to `postgresql+asyncpg://`. For external databases, use
`sslmode=verify-full` (or `ssl=verify-full`). The loader supplies a TLS context
using system certificate authorities and hostname verification. An optional
`sslrootcert` selects an explicit CA file. `sslmode=require` is also accepted
with full certificate and hostname verification.

Neon's general-purpose copied URL may include `channel_binding=require`,
which asyncpg does not support. The loader rejects that requirement rather
than silently dropping it. Configure an asyncpg connection URL **without**
the channel-binding option and with verified TLS. If required channel binding
is a deployment requirement, choose a driver that supports it before switching.
Do not disable TLS verification to make a connection succeed.

Start with a direct PostgreSQL endpoint unless a pooled endpoint has been
tested with this driver. The existing connection pool checks idle connections
before reuse, which helps when a provider's compute wakes from sleep.

## Migration

1. Create a free destination near the API's region. Check storage and
   compute limits before restoring.
2. Export all application tables from the old database and restore them to
   the destination. Arrange a consistent final copy while coordinating
   writes. Preserve a backup. Free Render services have no shell/SSH access;
   use an authorized export client with narrowly scoped database access.
3. Compare schema, table counts and account-state contents before changing
   the API. Keep the old database through verification.
4. Set the API's `DATABASE_URL` to the destination's compatible TLS URL and
   redeploy. If `OUTCOMES_DATABASE_URL` is separately set, migrate its data
   and update it too; otherwise outcomes reuse the main database.
5. Verify email sign-in, saves, reload, a fresh browser, logout/re-login and
   shared outcomes. Keep a rollback plan that accounts for writes after
   switching, and keep independent backups.

Changing hosting providers does not require replacing the app's sign-in
flow or changing frontend URLs.
