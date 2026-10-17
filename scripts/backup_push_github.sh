#!/usr/bin/env bash
# Store one encrypted backup in the PRIVATE backup repo (docs/BACKUPS.md).
#
#   bash scripts/backup_push_github.sh WORK_DIR/rightdue-<stamp>.dump.age WORK_DIR/entry.json
#
#   BACKUP_REPO        owner/name, e.g. Hasen1506/rightdue-backups (private)
#   BACKUP_REPO_TOKEN  fine-grained token: that repo only, Contents read+write
#   BACKUP_BRANCH      default main
#   BACKUP_REPO_URL    tests only: a local bare repo instead of github.com
#
# Each run REPLACES the branch with one fresh orphan commit holding only the
# files retention keeps (14 daily + 8 weekly) and MANIFEST.json, so the
# repo's history never accumulates old dumps. It refuses to push to a public
# repo, uses --force-with-lease so two runs can't clobber each other, and
# re-reads the remote afterwards to prove the file landed byte for byte.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=scripts/backup_common.sh
. "$here/backup_common.sh"

file="${1:?usage: backup_push_github.sh FILE.dump.age ENTRY.json}"
entry="${2:?usage: backup_push_github.sh FILE.dump.age ENTRY.json}"
[ -s "$file" ] || die "No encrypted backup at $file."
branch="${BACKUP_BRANCH:-main}"
url=$(backup_repo_url)
name=$(basename "$file")

# Never push a database dump (even encrypted) to a public repository.
if [ -z "${BACKUP_REPO_URL:-}" ]; then
  vis=$(curl -fsS -H "Authorization: Bearer $BACKUP_REPO_TOKEN" -H "Accept: application/vnd.github+json" \
        "https://api.github.com/repos/$BACKUP_REPO" | python3 -c 'import json,sys; print("private" if json.load(sys.stdin).get("private") else "public")') \
    || die "Cannot read $BACKUP_REPO with BACKUP_REPO_TOKEN (wrong name, repo not created, or the token does not include it)."
  [ "$vis" = "private" ] || die "$BACKUP_REPO is PUBLIC. Make it private before any backup goes there."
fi

repo=$(mktemp -d)
trap 'rm -rf "$repo"' EXIT
cd "$repo"
git init -q -b "$branch"
git config user.name "rightdue-backup-bot"
git config user.email "backup-bot@users.noreply.github.com"
git remote add origin "$url"

old=$(backup_git ls-remote --heads origin "$branch" | cut -f1)
if [ -n "$old" ]; then
  backup_git fetch -q --depth 1 origin "$branch"
  git read-tree -u --reset FETCH_HEAD   # last run's kept files, no history
fi
mkdir -p dumps
cp "$file" "dumps/$name"

python3 "$here/backup_manifest.py" apply MANIFEST.json dumps "$entry"
cat > README.md <<EOF
# RightDue database backups (private)

Encrypted with age; the private key is NOT on GitHub except as the
BACKUP_AGE_IDENTITY secret used by the weekly restore drill.
Written by .github/workflows/db-backup.yml in Hasen1506/Debt-and-Emi-restructuring.
How to restore: docs/BACKUPS.md in that repo.

This branch is replaced by one fresh commit on every run, keeping the last
${BACKUP_KEEP_DAILY:-14} daily and ${BACKUP_KEEP_WEEKLY:-8} weekly copies. MANIFEST.json lists each file's
sha256 and the row counts the restore drill checks against.
EOF
git add -A
git commit -q -m "Backup $name"
new=$(git rev-parse HEAD)
# The lease: replace exactly the tip we read (or create the branch).
backup_git push -q --force-with-lease="$branch:$old" origin "HEAD:refs/heads/$branch"

# Prove it: the remote tip is our commit and holds this exact blob.
tip=$(backup_git ls-remote --heads origin "$branch" | cut -f1)
[ "$tip" = "$new" ] || die "Push did not land: remote $branch is ${tip:-missing}, expected $new."
want=$(git hash-object "dumps/$name")
rm -rf "$repo/check" && mkdir "$repo/check" && cd "$repo/check"
git init -q && git remote add origin "$url"
backup_git fetch -q --depth 1 origin "$branch"
got=$(git rev-parse "FETCH_HEAD:dumps/$name" 2>/dev/null || true)
[ "$got" = "$want" ] || die "The backup repo does not hold $name after the push."
kept=$(git ls-tree --name-only FETCH_HEAD dumps/ | wc -l)
note "Stored $name in the private backup repo ($kept backup(s) kept, one commit, no history)."
