#!/usr/bin/env bash
# Restore by hand (docs/BACKUPS.md §4, §5). Run on YOUR machine: it needs the
# age PRIVATE key. Restores the newest (or a named) backup into a Neon
# branch you choose, then checks every table's row count against the
# backup's MANIFEST.json entry.
#
#   export AGE_KEY_FILE=~/secure/rightdue-backup-key.txt
#   export TARGET_DATABASE_URL='postgresql://...dev-neon-setup or a new restore branch...'
#   export PRODUCTION_DATABASE_HOST=ep-....ap-southeast-1.aws.neon.tech   # refused as a target
#   bash scripts/restore_drill.sh                                  # newest
#   bash scripts/restore_drill.sh rightdue-2026-10-15T2040Z.dump.age
#
# Source (default: the private GitHub repo, read with your own git login):
#   BACKUP_REPO=Hasen1506/rightdue-backups   (default)
#   BACKUP_DIR=path/to/a/clone               use an existing clone instead
#   BACKUP_SOURCE=r2 + S3_BUCKET S3_ENDPOINT AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY
#                                            the optional R2 copy (no row check)
# It asks you to type the target database's name before it replaces it.
# Needs: git, age, python3, pg_restore/psql 18 (same major as Neon or newer).
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=scripts/backup_common.sh
. "$here/backup_common.sh"

for v in AGE_KEY_FILE TARGET_DATABASE_URL; do
  [ -n "${!v:-}" ] || die "restore_drill: set $v (see the header of this file)."
done
host=$(printf '%s' "$TARGET_DATABASE_URL" | sed -E 's#^[a-z]+://[^@]*@([^/:?]+).*#\1#')
if [ -n "${PRODUCTION_DATABASE_HOST:-}" ] && [ "$host" = "$PRODUCTION_DATABASE_HOST" ]; then
  die "restore_drill: TARGET_DATABASE_URL points at production ($host). Use a new Neon branch or dev-neon-setup."
fi
[ -n "${PRODUCTION_DATABASE_HOST:-}" ] || echo "Note: PRODUCTION_DATABASE_HOST is not set, so production is not refused automatically." >&2
dbname=$(printf '%s' "$TARGET_DATABASE_URL" | sed -E 's#^.*/([^/?]+)(\?.*)?$#\1#')
if [ "${RESTORE_DRILL_YES:-}" != "$dbname" ]; then
  read -r -p "Restore over database '$dbname' on $host? Everything in it is replaced. Type its name to go on: " answer
  [ "$answer" = "$dbname" ] || die "restore_drill: not confirmed; nothing done."
fi

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
umask 077
want="${1:-}"
expected=""

if [ "${BACKUP_SOURCE:-github}" = "r2" ]; then
  for v in S3_BUCKET S3_ENDPOINT AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY; do
    [ -n "${!v:-}" ] || die "restore_drill: set $v for BACKUP_SOURCE=r2."
  done
  key="nightly/$want"
  [ -n "$want" ] || key=$(aws --endpoint-url "$S3_ENDPOINT" s3 ls "s3://$S3_BUCKET/nightly/" | sort | tail -1 | awk '{print "nightly/"$4}')
  [ "$key" != "nightly/" ] || die "No backups in s3://$S3_BUCKET/nightly/."
  aws --endpoint-url "$S3_ENDPOINT" s3 cp "s3://$S3_BUCKET/$key" "$work/b.dump.age" --only-show-errors
  name=$(basename "$key")
else
  src="${BACKUP_DIR:-}"
  if [ -z "$src" ]; then
    git clone -q --depth 1 "https://github.com/${BACKUP_REPO:-Hasen1506/rightdue-backups}.git" "$work/repo"
    src="$work/repo"
  fi
  if [ -n "$want" ]; then
    entry=$(python3 -c 'import json,sys; m=json.load(open(sys.argv[1])); print(json.dumps(next(b for b in m["backups"] if b["file"]==sys.argv[2])))' "$src/MANIFEST.json" "$want") \
      || die "$want is not in MANIFEST.json."
  else
    entry=$(python3 "$here/backup_manifest.py" latest "$src/MANIFEST.json" "$src/dumps")
  fi
  name=$(python3 -c 'import json,sys; print(json.loads(sys.argv[1])["file"])' "$entry")
  sha=$(python3 -c 'import json,sys; print(json.loads(sys.argv[1])["sha256"])' "$entry")
  expected=$(python3 -c 'import json,sys; print(json.dumps(json.loads(sys.argv[1])["counts"]))' "$entry")
  cp "$src/dumps/$name" "$work/b.dump.age"
  [ "$(sha256sum "$work/b.dump.age" | cut -d' ' -f1)" = "$sha" ] || die "$name does not match its sha256 in MANIFEST.json."
fi

age -d -i "$AGE_KEY_FILE" -o "$work/b.dump" "$work/b.dump.age"
pg_restore --clean --if-exists --no-owner --no-privileges --dbname "$TARGET_DATABASE_URL" "$work/b.dump" || \
  echo "pg_restore reported errors (often harmless role/extension notes); the checks below decide." >&2
actual=$(db_counts_json "$TARGET_DATABASE_URL")
check_key_tables "$actual"
if [ -n "$expected" ]; then
  python3 "$here/backup_manifest.py" compare "$expected" "$actual"
fi
echo "Restored $name into $dbname on $host."
echo "If this was a drill: record today's date under 'Last restore drill' in docs/RUNBOOK.md §2."
