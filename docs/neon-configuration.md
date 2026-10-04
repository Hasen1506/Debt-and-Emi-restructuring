# RightDue Neon configuration

Configured 4 October 2026. No database credentials belong in GitHub or frontend environment variables.

| Resource | Value |
| --- | --- |
| Neon project | `RightDue` (`morning-lab-65363773`) |
| Region | AWS Singapore (`aws-ap-southeast-1`) |
| PostgreSQL | 18 |
| Database | `rightdue` |
| Production branch | `production` (`br-patient-thunder-b3p2fmot`) |
| Development branch | `dev-neon-setup` (`br-jolly-mud-b3s1r2ze`) |
| Render workspace | My Workspace |
| Render API | `finoptima-api` (`srv-d830eit0lvsc73d7n4g0`) |
| Frontend | `https://finoptima-web.onrender.com` |

The API's server-side `DATABASE_URL` uses the production branch's direct endpoint with `sslmode=verify-full` and no `channel_binding` option. This is compatible with `api/db/connection.py` and asyncpg. Accounts, sessions, state and outcome reports share the same database. Preserve the app's existing email sign-in flow; Neon Auth and Data API are not needed.

The repository's SQLAlchemy metadata initialized the five tables on the development branch and then the empty production branch. Existing Render rows were copied to production and compared in full before cutover: one user, seven OTP-code rows, four session rows, one saved user-state row and zero outcome rows. Counts describe the migration snapshot, not a permanent expected total. The development branch contains schema only; it does not contain the migrated production account.

`scripts/rightdue_neon_migration.py` records the one-time migration wrapper. It refuses schema differences and a nonempty destination that differs from the source. It never overwrites source data, and verifies every copied row. The source SHARE locks prevent writes until the migration wrapper stops during the cleanup deployment. The script reads credentials from environment variables and logs counts only. It is an operational tool, not part of normal API startup.

Normal startup remains:

```sh
uvicorn api.main:app --host 0.0.0.0 --port $PORT
```

Keep connection secrets in Render's Environment settings. For local development, obtain the development branch URL and use a git-ignored `.env`. Run future schema changes on a development branch before production. Avoid the concurrency test suite on hosted databases: its tests recreate tables and explicitly require a disposable local test database.

The old Render `rightdue-db` database is retained as the pre-cutover recovery copy, with external database traffic blocked. It expires on 1 November 2026 unless upgraded. A rollback after new Neon writes requires copying those new writes back; merely changing DATABASE_URL would lose visibility of them. Production remains in Singapore while Render's API is in Oregon, so database requests cross regions. Consider a future co-located deployment if latency matters.
