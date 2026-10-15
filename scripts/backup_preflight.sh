#!/usr/bin/env bash
# Backup preflight (audit80 D14, round 2). Used by .github/workflows/db-backup.yml
# and by api/tests/test_a80_trust.py + api/tests/test_backups.py (no network).
#
#   bash scripts/backup_preflight.sh          # the nightly backup job
#   bash scripts/backup_preflight.sh drill    # the weekly restore drill
#
# WHY no backup was ever stored (full story: docs/BACKUPS.md §1): the first
# job's "Check configuration" step ran `exit 0` when the DATABASE_URL secret
# was empty, after setting run=false. Every later step was skipped, and a job
# whose steps are all success-or-skipped is GREEN; the "open an issue" step
# only runs on failure(), so nobody was told (run 38486711137, 14 Oct 2026).
# Round 1 made it red until six secrets existed, four of them for Cloudflare
# R2, which needs a card on file. Round 2: the default store is a PRIVATE
# GitHub repo (no card, no cost); R2 is an optional second copy.
#
# Backup job, required (else exit 1: red run + an issue):
#   DATABASE_URL       read-only Neon role URL
#   AGE_RECIPIENT      secret BACKUP_AGE_RECIPIENT, an age PUBLIC key (age1...)
#   BACKUP_REPO        owner/name of the private repo (repo variable; the
#                      workflow defaults it to Hasen1506/rightdue-backups)
#   BACKUP_REPO_TOKEN  fine-grained token for that repo, Contents read+write
# Optional second copy, all four or none (a partial set is an error):
#   S3_BUCKET S3_ENDPOINT AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY
# Drill, required: BACKUP_REPO, BACKUP_REPO_TOKEN, AGE_IDENTITY (secret
#   BACKUP_AGE_IDENTITY, the age PRIVATE key).
# Quiet skips, only on purpose (repo VARIABLES): BACKUP_DISABLED=1 (both),
#   BACKUP_DRILL_DISABLED=1 (drill only).
#
# Writes run=true|false and r2=true|false to $GITHUB_OUTPUT when set.
set -euo pipefail

mode="${1:-backup}"
out="${GITHUB_OUTPUT:-/dev/null}"
doc="docs/BACKUPS.md"

if [ "${BACKUP_DISABLED:-}" = "1" ]; then
  echo "::warning::Backups are switched OFF on purpose (repo variable BACKUP_DISABLED=1). Nothing done."
  { echo "run=false"; echo "r2=false"; } >> "$out"
  exit 0
fi
if [ "$mode" = "drill" ] && [ "${BACKUP_DRILL_DISABLED:-}" = "1" ]; then
  echo "::warning::The restore drill is switched OFF on purpose (repo variable BACKUP_DRILL_DISABLED=1). Restore by hand every 3 months ($doc §5)."
  { echo "run=false"; echo "r2=false"; } >> "$out"
  exit 0
fi

missing=()
[ -n "${BACKUP_REPO:-}" ]       || missing+=("BACKUP_REPO (repo variable, owner/name of the PRIVATE backup repo)")
[ -n "${BACKUP_REPO_TOKEN:-}" ] || missing+=("BACKUP_REPO_TOKEN (fine-grained token: that repo only, Contents read and write)")
if [ "$mode" = "drill" ]; then
  [ -n "${AGE_IDENTITY:-}" ]    || missing+=("BACKUP_AGE_IDENTITY (the age PRIVATE key, for the restore drill)")
else
  [ -n "${DATABASE_URL:-}" ]    || missing+=("DATABASE_URL (read-only Neon role URL)")
  [ -n "${AGE_RECIPIENT:-}" ]   || missing+=("BACKUP_AGE_RECIPIENT (age1... public key)")
fi

if [ "${#missing[@]}" -gt 0 ]; then
  echo "::error::No $( [ "$mode" = drill ] && echo 'restore drill' || echo 'backup' ) can run: missing ${missing[*]}. Setup: $doc §3. (Repo variable BACKUP_DISABLED=1 only if backups are off on purpose.)"
  for m in "${missing[@]}"; do echo "missing: $m"; done
  { echo "run=false"; echo "r2=false"; } >> "$out"
  exit 1
fi

case "$BACKUP_REPO" in
  */*) ;;
  *) echo "::error::BACKUP_REPO must be owner/name, e.g. Hasen1506/rightdue-backups."; exit 1 ;;
esac
if [ "$BACKUP_REPO" = "${GITHUB_REPOSITORY:-}" ]; then
  echo "::error::BACKUP_REPO is this (public) repository. Use a separate PRIVATE repo."; exit 1
fi

if [ "$mode" = "drill" ]; then
  case "$AGE_IDENTITY" in
    *AGE-SECRET-KEY-1*) ;;
    *) echo "::error::BACKUP_AGE_IDENTITY must be an age private key (AGE-SECRET-KEY-1...)."; exit 1 ;;
  esac
  echo "Restore drill configuration complete."
  { echo "run=true"; echo "r2=false"; } >> "$out"
  exit 0
fi

case "$AGE_RECIPIENT" in
  age1*) ;;
  *) echo "::error::BACKUP_AGE_RECIPIENT must be an age public key starting with age1 (never the private key)."; exit 1 ;;
esac
case "$DATABASE_URL" in
  postgres://*|postgresql://*) ;;
  *) echo "::error::DATABASE_URL must be a postgres:// or postgresql:// URL."; exit 1 ;;
esac
case "$DATABASE_URL" in
  *-pooler.*) echo "::warning::DATABASE_URL uses Neon's pooled endpoint (-pooler). Use the direct endpoint for pg_dump ($doc §3a)." ;;
esac

# Optional R2 / S3 second copy: all four or none.
s3=0
for v in S3_BUCKET S3_ENDPOINT AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY; do
  if [ -n "${!v:-}" ]; then s3=$((s3 + 1)); fi
done
if [ "$s3" -eq 4 ]; then
  r2=true
  echo "Optional second copy: R2/S3 bucket configured."
elif [ "$s3" -eq 0 ]; then
  r2=false
  echo "Optional second copy: none (no BACKUP_S3_* secrets). The private GitHub repo is the store."
else
  echo "::error::Only $s3 of the 4 BACKUP_S3_* secrets are set. Set all four (BACKUP_S3_BUCKET, BACKUP_S3_ENDPOINT, BACKUP_S3_ACCESS_KEY_ID, BACKUP_S3_SECRET_ACCESS_KEY) or none."
  echo "missing: some BACKUP_S3_* secrets"
  { echo "run=false"; echo "r2=false"; } >> "$out"
  exit 1
fi

echo "Backup configuration complete."
{ echo "run=true"; echo "r2=$r2"; } >> "$out"
