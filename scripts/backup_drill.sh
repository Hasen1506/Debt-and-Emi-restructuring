#!/usr/bin/env bash
# Weekly restore drill (docs/BACKUPS.md §5): prove the newest STORED backup
# can be decrypted and restored, and that it is complete and recent.
#
#   BACKUP_REPO / BACKUP_REPO_TOKEN   the private backup repo (read is enough)
#   AGE_IDENTITY                      the age PRIVATE key text (AGE-SECRET-KEY-1...)
#     or AGE_IDENTITY_FILE            a file holding it
#   RESTORE_URL                       THROWAWAY local Postgres (18 in CI); it is wiped
#   DRILL_MAX_AGE_HOURS               newest backup must be younger (default 50)
#   BACKUP_REPO_URL                   tests only: a local bare repo
#
# Fails loudly (::error::, exit 1) when: the repo has no backups, the newest
# is too old, its sha256 differs from MANIFEST.json, it does not decrypt, a
# key table is missing, or ANY table's row count differs from the count taken
# when the backup was made. Prints no counts (public logs).
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=scripts/backup_common.sh
. "$here/backup_common.sh"
[ -n "${RESTORE_URL:-}" ] || die "backup_drill: RESTORE_URL is not set."
url=$(backup_repo_url)
branch="${BACKUP_BRANCH:-main}"

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
umask 077
if [ -n "${AGE_IDENTITY:-}" ]; then
  printf '%s\n' "$AGE_IDENTITY" > "$work/identity"
  AGE_IDENTITY_FILE="$work/identity"
fi
[ -s "${AGE_IDENTITY_FILE:-}" ] || die "No age private key (BACKUP_AGE_IDENTITY secret) for the drill."
grep -q '^AGE-SECRET-KEY-1' "$AGE_IDENTITY_FILE" || die "BACKUP_AGE_IDENTITY is not an age private key (AGE-SECRET-KEY-1...)."

cd "$work"
git init -q repo && cd repo
git remote add origin "$url"
backup_git fetch -q --depth 1 origin "$branch" || die "Cannot read the backup repo's $branch branch (missing repo, empty repo, or token without access)."
git read-tree -u --reset FETCH_HEAD
[ -f MANIFEST.json ] || die "The backup repo has no MANIFEST.json: no backup has been stored yet."

entry=$(python3 "$here/backup_manifest.py" latest MANIFEST.json dumps)
read -r name sha stamp < <(python3 -c 'import json,sys; e=json.loads(sys.argv[1]); print(e["file"], e["sha256"], e["stamp"])' "$entry")
expected=$(python3 -c 'import json,sys; print(json.dumps(json.loads(sys.argv[1])["counts"]))' "$entry")

# Recent enough? A drill that happily restores a month-old file would hide
# a backup job that silently stopped.
age_h=$(python3 - "$stamp" <<'PY'
import datetime as dt, sys
s = dt.datetime.strptime(sys.argv[1], "%Y-%m-%dT%H%MZ").replace(tzinfo=dt.timezone.utc)
print(int((dt.datetime.now(dt.timezone.utc) - s).total_seconds() // 3600))
PY
)
max="${DRILL_MAX_AGE_HOURS:-50}"
[ "$age_h" -le "$max" ] || die "The newest backup ($name) is $age_h hours old (limit $max). The nightly backup has stopped storing copies."

got=$(sha256sum "dumps/$name" | cut -d' ' -f1)
[ "$got" = "$sha" ] || die "$name does not match its sha256 in MANIFEST.json (corrupted or replaced)."

age -d -i "$AGE_IDENTITY_FILE" -o "$work/restore.dump" "dumps/$name" || die "$name does not decrypt with BACKUP_AGE_IDENTITY (wrong key pair?)."
rm -f "$AGE_IDENTITY_FILE"

reset_throwaway_db "$RESTORE_URL"
restore_into "$work/restore.dump" "$RESTORE_URL"
rm -f "$work/restore.dump"
actual=$(db_counts_json "$RESTORE_URL")
check_key_tables "$actual"
python3 "$here/backup_manifest.py" compare "$expected" "$actual"
echo "Restore drill passed: $name ($age_h h old) decrypted, restored and matched its manifest."
