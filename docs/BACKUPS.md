# Database backups

RightDue's accounts and saved plans live in one Neon Postgres database. This
page says why no backup has ever been kept, what now takes one every night,
the one-time setup (about 20 minutes, no card, no paid service), and how to
restore.

Workflow: `.github/workflows/db-backup.yml`. Scripts: `scripts/backup_*.sh`,
`scripts/backup_manifest.py`, `scripts/restore_drill.sh`.
Tests: `api/tests/test_backups.py` (runs the real scripts against a local
Postgres) and the D14 tests in `api/tests/test_a80_trust.py`.

---

## 1. Why nothing was ever stored (plain language)

- **Neon Free keeps only about 6 hours of history.** Anything older than that
  is gone unless we keep our own copy. Until now we never did.
- **The first backup job looked green but did nothing.** Its first step
  checked for the database password. The password was never added, so the
  step said "nothing to do" and finished successfully. Every later step was
  skipped, and GitHub shows a run whose steps all succeeded or were skipped
  as a green tick. The step that opens an issue only runs when something
  *fails*, so nobody was told. (Run 38486711137, 14 Oct 2026: Dump skipped,
  Upload skipped, conclusion success.)
- **Round 1 made it honest, but it still could not work.** It turned the job
  red until six secrets existed, four of them for a Cloudflare R2 bucket.
  R2 needs a card on file, which we will not add, so it stayed red and still
  stored nothing.
- **Two more problems were waiting behind the secrets** (found in round 2):
  - Neon production runs **PostgreSQL 18** (docs/neon-configuration.md). The
    job dumped with a PostgreSQL **17** client, and `pg_dump` refuses to dump
    a newer server. It would have failed the first night.
  - The setup note said `GRANT pg_read_all_data TO backup;`. Neon does not
    let roles created with SQL be granted that role (Neon support answer:
    https://www.answeroverflow.com/m/1239635239802896466). Step 1 of the old
    setup would have failed.

**Now:** the default store is a **private GitHub repository** (free, no
card). R2 stays as an optional second copy, used only if its four secrets
exist. The client is PostgreSQL 18, and the read-only role uses plain
`GRANT SELECT` (tested, see §2).

## 2. What runs

**Every night, 02:10 IST** (`backup` job, about 1-2 minutes):

1. `scripts/backup_preflight.sh`: red (and an issue) if a required secret is
   missing. The only quiet skip is the repo variable `BACKUP_DISABLED=1`.
2. `scripts/backup_dump.sh`: `pg_dump` (custom format) through the read-only
   role; **restore test** into a throwaway PostgreSQL 18 service container
   on the runner; counts the rows of every table *in the restored copy*;
   fails if `users`, `user_state`, `sessions`, `consent_events` or
   `alembic_version` is missing or `users` is empty; then encrypts with
   **age** using only the public key.
3. `scripts/backup_push_github.sh`: refuses unless the target repo is
   private; puts the file in `dumps/`, applies retention, writes
   `MANIFEST.json` (size, sha256, alembic revision, row count per table), and
   **replaces the branch with one fresh orphan commit**, so the backup repo
   never accumulates history. Then it re-reads the remote and checks the
   file is there byte for byte.
4. `scripts/backup_push_r2.sh`: only if all four `BACKUP_S3_*` secrets exist.

**Every Monday, 04:40 IST** (`drill` job, about 1 minute):
`scripts/backup_drill.sh` downloads the newest stored file, checks its
sha256, decrypts it with the private key, restores it into a throwaway
PostgreSQL 18 service container and compares **every table's row count and
the alembic revision** with the manifest. It fails loudly (red + an issue
"Backup restore drill failed") on any difference, or when the newest copy is
more than 50 hours old (the nightly has stopped).

**Retention:** the newest copy of each of the last **14 days**, plus the
newest copy of each of the last **8 calendar weeks** (counted the way
restic's `--keep-daily 14 --keep-weekly 8` counts: the weeks the daily
copies already cover are among the 8). In steady state that is 19-20 files,
the oldest at most 55 days old. The privacy notice says "up to 56 days"
(`web/src/lib/privacy-facts.ts` `RETENTION.backupDays`).

**What is public:** this repository is public, so its Actions logs are too.
The scripts print no data and no row counts; counts are written only to the
private repo's `MANIFEST.json`.

**Cost:** nothing. GitHub Actions on standard GitHub-hosted runners is free
for public repositories ("GitHub Actions usage is free for self-hosted
runners and for public repositories that use standard GitHub-hosted
runners": https://docs.github.com/en/billing/concepts/product-billing/github-actions,
read 15 Oct 2026). Even if this repo went private, ~60 minutes a month fits
easily in the Free plan's 2,000. The backup repo runs no Actions.

**Size limits:** GitHub blocks files over 100 MiB and warns over 50 MiB, and
recommends repos under 1 GB
(https://docs.github.com/en/repositories/working-with-files/managing-large-files/about-large-files-on-github).
Today's database is tiny (kilobytes). The job warns above ~45 MB per file
and fails above ~95 MB; at that point move the main store to R2 (§6).

## 3. One-time setup (Vijay, or Hark with Vijay's go-ahead)

Do these in order. Nothing here costs money.

### 3a. A read-only database role on Neon

In the Neon console: project **RightDue** → branch **production** →
database **rightdue** → SQL Editor. First find who owns the tables:

```sql
SELECT DISTINCT tableowner FROM pg_tables WHERE schemaname = 'public';
```

Run the block below **as that owner role** (in the SQL Editor, pick that
role in the role menu), with `<OWNER>` replaced by it and `<PASSWORD>`
replaced by a long random password (make one with `openssl rand -hex 24`;
hex avoids characters that break URLs; Neon wants at least 60 bits of
entropy):

```sql
-- rightdue_backup: read-only role for the nightly pg_dump (docs/BACKUPS.md §3a)
CREATE ROLE rightdue_backup WITH LOGIN PASSWORD '<PASSWORD>';
GRANT CONNECT ON DATABASE rightdue TO rightdue_backup;
GRANT USAGE ON SCHEMA public TO rightdue_backup;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO rightdue_backup;
GRANT SELECT ON ALL SEQUENCES IN SCHEMA public TO rightdue_backup;
ALTER DEFAULT PRIVILEGES FOR ROLE <OWNER> IN SCHEMA public GRANT SELECT ON TABLES TO rightdue_backup;
ALTER DEFAULT PRIVILEGES FOR ROLE <OWNER> IN SCHEMA public GRANT SELECT ON SEQUENCES TO rightdue_backup;
ALTER ROLE rightdue_backup SET default_transaction_read_only = on;
```

- The sequence grants matter: `pg_dump` reads sequence values
  (`notify_events_id_seq` today). The `ALTER DEFAULT PRIVILEGES` lines make
  tables a future migration adds readable too; if one is ever missed, the
  nightly goes red with "permission denied", which is the alarm working.
- `api/tests/test_backups.py` runs exactly this block (read from this file)
  on a local PostgreSQL, dumps with the role, and checks it cannot write.

The secret `DATABASE_URL` is then:

```
postgresql://rightdue_backup:<PASSWORD>@<production DIRECT host>/rightdue?sslmode=require
```

Take the host from Neon → Connect, with **connection pooling off** (the host
must not contain `-pooler`; dumps go through the direct endpoint).

### 3b. An age key pair

age is a small, audited file-encryption tool (https://github.com/FiloSottile/age).
On **your own computer** (never on a server, never in this repo):

```
# install: Windows  winget install --id FiloSottile.age
#          macOS    brew install age
#          Linux    sudo apt install age
age-keygen -o rightdue-backup-key.txt
```

It prints `Public key: age1…`. That public key is the secret
`BACKUP_AGE_RECIPIENT`: anyone holding it can only *encrypt*.

`rightdue-backup-key.txt` is the **private key**. Without it no backup can
ever be read, so:

- keep it in your password manager (as a secure note: paste the whole file),
  **and** one offline copy (a USB stick, or printed and filed);
- **never** commit it to this repo or the backup repo, never email it, never
  paste it into chat;
- put **one** copy into the GitHub secret `BACKUP_AGE_IDENTITY` so the weekly
  drill can decrypt. GitHub secrets cannot be read back, are not given to
  pull requests from forks, and are masked in logs. The trade-off: someone
  who fully takes over the GitHub account could read both the backups and
  the key. If you would rather not accept that, skip this secret, set the
  repo variable `BACKUP_DRILL_DISABLED=1`, and run the drill by hand every
  3 months (§5). Backups still run either way.

Delete `rightdue-backup-key.txt` from the computer once it is in the
password manager.

### 3c. The private backup repository

GitHub → **New repository** (https://github.com/new): owner **Hasen1506**,
name **rightdue-backups**, **Private**, no README. (Or
`gh repo create Hasen1506/rightdue-backups --private`.) Another name works
too: then also set the repo **variable** `BACKUP_REPO` to `owner/name`.
The job refuses to push to a public repo.

### 3d. A token that can write only to that repo

GitHub → Settings → Developer settings → Personal access tokens →
**Fine-grained tokens** → Generate new token. This link fills in the name,
permission and a one-year expiry:
https://github.com/settings/personal-access-tokens/new?name=rightdue-backups-push&description=Nightly%20DB%20backup%20push%20(db-backup.yml)&contents=write&expires_in=366

- Resource owner: **Hasen1506**.
- Repository access: **Only select repositories** → **rightdue-backups**
  (only that one).
- Permissions → Repository → **Contents: Read and write** (Metadata: read
  is added automatically). Nothing else.
- Expiry: one year (or none). Put a calendar reminder a week before it
  expires; an expired token turns the nightly red with "Cannot read … with
  BACKUP_REPO_TOKEN".

The token is the secret `BACKUP_REPO_TOKEN`.

### 3e. Secrets in this repo

https://github.com/Hasen1506/Debt-and-Emi-restructuring/settings/secrets/actions
→ New repository secret:

| Secret | Value | Needed by |
| --- | --- | --- |
| `DATABASE_URL` | the read-only URL from 3a | backup |
| `BACKUP_AGE_RECIPIENT` | `age1…` public key from 3b | backup |
| `BACKUP_REPO_TOKEN` | fine-grained token from 3d | backup + drill |
| `BACKUP_AGE_IDENTITY` | the whole contents of `rightdue-backup-key.txt` | drill |

Optional, all four or none (second copy in R2; needs a card on Cloudflare):
`BACKUP_S3_BUCKET`, `BACKUP_S3_ENDPOINT`, `BACKUP_S3_ACCESS_KEY_ID`,
`BACKUP_S3_SECRET_ACCESS_KEY`.

Optional **variables** (Variables tab, not Secrets): `BACKUP_REPO` (if not
`Hasen1506/rightdue-backups`), `BACKUP_DISABLED=1` (backups off on
purpose), `BACKUP_DRILL_DISABLED=1` (no private key on GitHub),
`BACKUP_ALLOW_EMPTY=1` (only if production really has no users).

With the GitHub CLI instead: `gh secret set DATABASE_URL -R Hasen1506/Debt-and-Emi-restructuring`
(it prompts for the value), and
`gh secret set BACKUP_AGE_IDENTITY -R Hasen1506/Debt-and-Emi-restructuring < rightdue-backup-key.txt`.

### 3f. First run

Actions → **Database backup** → Run workflow → job **both**. Expect two
green jobs with every step run (not skipped), a file in
`rightdue-backups/dumps/`, and "Restore drill passed" in the drill's
summary. Then close any open "Database backup failed" issue.

## 4. Restore (a real incident)

**Lost something in the last ~6 hours?** Use Neon's own point-in-time
restore first (docs/RUNBOOK.md §2); it is newer than any nightly copy.

Otherwise, on your own computer (PostgreSQL 18 client tools and age
installed):

1. **Get the file.** `git clone --depth 1 https://github.com/Hasen1506/rightdue-backups`
   (or download one file from the repo's web page). `MANIFEST.json` lists
   every file with its sha256; newest first.
2. **Check and decrypt.**
   ```
   sha256sum dumps/rightdue-<stamp>.dump.age      # must equal MANIFEST.json
   age -d -i rightdue-backup-key.txt -o rightdue.dump dumps/rightdue-<stamp>.dump.age
   ```
3. **Restore into a new Neon branch first, never straight over production.**
   Neon → Branches → New branch (e.g. `restore-2026-10-20`), copy its
   direct connection URL (owner role), then:
   ```
   pg_restore --clean --if-exists --no-owner --no-privileges \
     --dbname "$TARGET_DATABASE_URL" rightdue.dump
   ```
   `scripts/restore_drill.sh` does steps 1-3 and the checks in one go: it
   refuses the production host, asks you to type the database name, and
   compares every table's row count with the manifest.
4. **Check** the app against that branch (point a local run, or a staging
   service, at it).
5. **Switch:** point Render's `DATABASE_URL` at the restored branch (Neon
   connection string, owner role) and redeploy; or, during a quiet hour,
   restore over production the same way. Anything written after the
   backup's time is not in it; say so to affected users.
6. **Delete** `rightdue.dump` and the decrypted copy when done.

## 5. Restore drill

- **Automatic:** the `drill` job every Monday (§2). Red + an issue if it
  fails. Run it any time: Actions → Database backup → Run workflow → drill.
- **By hand** (if `BACKUP_DRILL_DISABLED=1`, or every 3 months anyway as a
  check of your own key copy): `bash scripts/restore_drill.sh` with the
  variables in its header; target the `dev-neon-setup` branch. Record the
  date in docs/RUNBOOK.md §2 ("Last restore drill").

## 6. Optional: Cloudflare R2 as a second copy

Only if a card on Cloudflare becomes acceptable. Create a private bucket
with a 14-day lifecycle rule and an API token limited to it, then set all
four `BACKUP_S3_*` secrets (§3e). The nightly then also uploads to
`nightly/` in the bucket and checks the size. Three of four set is an error,
so a half-finished setup can't pass silently. If the database ever grows
past ~45 MB compressed, make R2 the main store instead of the GitHub repo.

## 7. Limits worth knowing

- A force-pushed branch drops old commits from the repo, but GitHub may keep
  unreachable objects until its own garbage collection runs. The files are
  encrypted either way.
- Scheduled workflows in a public repo are switched off after 60 days with
  no repository activity
  (https://docs.github.com/en/actions/how-tos/manage-workflow-runs/disable-and-enable-workflows).
  Pushes to this repo count; the backup repo's pushes do not. If the repo
  goes quiet for two months, re-enable the workflow in the Actions tab.
- The age binary in CI is pinned: v1.2.1 linux-amd64, sha256
  `7df45a6c…79d50` (workflow env `AGE_SHA256`), computed from the release
  download on 15 Oct 2026; GitHub's release page lists no digest for it.
