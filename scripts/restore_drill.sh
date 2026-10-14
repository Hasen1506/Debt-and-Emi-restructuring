#!/usr/bin/env bash
# Restore drill (audit80 D14 step 4). Run on YOUR machine, not in CI: it
# needs the age PRIVATE key, which must never go near GitHub.
#
#   export S3_BUCKET=rightdue-backups
#   export S3_ENDPOINT=https://<account id>.r2.cloudflarestorage.com
#   export AWS_ACCESS_KEY_ID=... AWS_SECRET_ACCESS_KEY=...   # a READ key for the bucket
#   export AGE_KEY_FILE=~/secure/rightdue-backup.key
#   export TARGET_DATABASE_URL='postgresql://...dev-neon-setup branch...'
#   bash scripts/restore_drill.sh            # newest nightly
#   bash scripts/restore_drill.sh nightly/rightdue-2026-10-15T2040Z.dump.age
#
# It refuses a target whose host matches PRODUCTION_DATABASE_HOST (set it to
# the production Neon host) and asks you to type the target's database name.
# Afterwards record the date in docs/RUNBOOK.md §2 ("Last restore drill").
# Needs: aws CLI v2, age, pg_restore/psql 17.
set -euo pipefail

for v in S3_BUCKET S3_ENDPOINT AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY AGE_KEY_FILE TARGET_DATABASE_URL; do
  [ -n "${!v:-}" ] || { echo "restore_drill: set $v (see the header of this file)." >&2; exit 1; }
done
host=$(printf '%s' "$TARGET_DATABASE_URL" | sed -E 's#^[a-z]+://[^@]*@([^/:?]+).*#\1#')
if [ -n "${PRODUCTION_DATABASE_HOST:-}" ] && [ "$host" = "$PRODUCTION_DATABASE_HOST" ]; then
  echo "restore_drill: TARGET_DATABASE_URL points at production ($host). Use the dev-neon-setup branch." >&2
  exit 1
fi
dbname=$(printf '%s' "$TARGET_DATABASE_URL" | sed -E 's#^.*/([^/?]+)(\?.*)?$#\1#')
read -r -p "Restore over database '$dbname' on $host? Everything in it is replaced. Type its name to go on: " answer
[ "$answer" = "$dbname" ] || { echo "restore_drill: not confirmed; nothing done." >&2; exit 1; }

key="${1:-}"
if [ -z "$key" ]; then
  key=$(aws --endpoint-url "$S3_ENDPOINT" s3 ls "s3://$S3_BUCKET/nightly/" | sort | tail -1 | awk '{print "nightly/"$4}')
fi
[ -n "$key" ] && [ "$key" != "nightly/" ] || { echo "restore_drill: no backups in s3://$S3_BUCKET/nightly/." >&2; exit 1; }

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
umask 077
aws --endpoint-url "$S3_ENDPOINT" s3 cp "s3://$S3_BUCKET/$key" "$work/b.dump.age" --only-show-errors
age -d -i "$AGE_KEY_FILE" -o "$work/b.dump" "$work/b.dump.age"
pg_restore --clean --if-exists --no-owner --no-privileges --dbname "$TARGET_DATABASE_URL" "$work/b.dump" || true
echo "Restored $key into $dbname:"
psql "$TARGET_DATABASE_URL" -tAc "SELECT 'alembic ' || version_num FROM alembic_version"
psql "$TARGET_DATABASE_URL" -tAc "SELECT count(*) || ' users' FROM users"
psql "$TARGET_DATABASE_URL" -tAc "SELECT count(*) || ' saved plans' FROM user_state"
echo "Now record today's date under 'Last restore drill' in docs/RUNBOOK.md §2."
