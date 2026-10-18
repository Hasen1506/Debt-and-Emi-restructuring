#!/usr/bin/env bash
# Take one backup: pg_dump -> restore test -> age-encrypt (docs/BACKUPS.md).
#
#   DATABASE_URL   read-only role on the production database (source)
#   RESTORE_URL    a THROWAWAY local Postgres 18 (CI: the job's service
#                  container). It is wiped. Never production.
#   AGE_RECIPIENT  age public key (age1...). The private key is not needed.
#   WORK_DIR       where to write (default: a new temp dir)
#   STAMP          optional, YYYY-MM-DDTHHMMZ (default: now, UTC)
#
# Writes WORK_DIR/rightdue-<STAMP>.dump.age and WORK_DIR/entry.json (the
# manifest entry: size, sha256, alembic revision, row counts per table) and
# prints the .age path. The plaintext dump is deleted before it exits.
# Fails (exit 1, ::error::) when the dump is empty, does not restore, or the
# key tables are missing.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=scripts/backup_common.sh
. "$here/backup_common.sh"

for v in DATABASE_URL RESTORE_URL AGE_RECIPIENT; do
  [ -n "${!v:-}" ] || die "backup_dump: $v is not set."
done
case "$AGE_RECIPIENT" in age1*) ;; *) die "AGE_RECIPIENT must be an age public key (age1...)." ;; esac

WORK_DIR="${WORK_DIR:-$(mktemp -d)}"
mkdir -p "$WORK_DIR"
umask 077
stamp="${STAMP:-$(date -u +%Y-%m-%dT%H%MZ)}"
name="rightdue-$stamp.dump.age"
plain="$WORK_DIR/rightdue.dump"
trap 'rm -f "$plain"' EXIT

# 1. Dump (custom format: compressed, restorable table by table).
pg_dump --format=custom --no-owner --no-privileges --file="$plain" "$DATABASE_URL"
tables=$(pg_restore --list "$plain" | grep -c ' TABLE DATA ' || true)
[ "$tables" -gt 0 ] || die "The dump has no table data."
note "Dump OK: $(stat -c %s "$plain") bytes, $tables tables with data."

# 2. Restore test into the throwaway database, then count what came back.
#    The counts are of the dump itself (not of the live database a moment
#    later), so the weekly drill can demand an exact match.
reset_throwaway_db "$RESTORE_URL"
restore_into "$plain" "$RESTORE_URL"
counts=$(db_counts_json "$RESTORE_URL")
check_key_tables "$counts"

# 3. Encrypt. Only the public key is here; nobody with this runner can
#    decrypt the result.
age -r "$AGE_RECIPIENT" -o "$WORK_DIR/$name" "$plain"
rm -f "$plain"
head -c 21 "$WORK_DIR/$name" | grep -q '^age-encryption.org/v1' || die "Encryption produced no age file."
size=$(stat -c %s "$WORK_DIR/$name")
# GitHub refuses files over 100 MiB; warn well before that.
[ "$size" -lt 95000000 ] || die "Encrypted dump is $size bytes, too close to GitHub's 100 MiB file limit. Move storage to R2 (docs/BACKUPS.md)."
[ "$size" -lt 45000000 ] || echo "::warning::Encrypted dump is $size bytes; GitHub warns above 50 MiB and blocks 100 MiB (docs/BACKUPS.md)."
sha=$(sha256sum "$WORK_DIR/$name" | cut -d' ' -f1)
pgv=$(pg_dump --version | sed 's/^pg_dump (PostgreSQL) //')

python3 - "$WORK_DIR/entry.json" "$name" "$stamp" "$size" "$sha" "$pgv" "$counts" "${GITHUB_RUN_ID:-local}" <<'PY'
import json, sys
path, name, stamp, size, sha, pgv, counts, run = sys.argv[1:]
json.dump({"file": name, "stamp": stamp, "bytes": int(size), "sha256": sha,
           "pg_dump": pgv, "counts": json.loads(counts), "run_id": run},
          open(path, "w"), indent=2, sort_keys=True)
PY
note "Encrypted: $name ($size bytes)."
printf '%s\n' "$WORK_DIR/$name"
