#!/usr/bin/env bash
# Backup preflight (audit80 D14). Used by .github/workflows/db-backup.yml and
# by api/tests/test_a80_backup.py (a dry run, no network).
#
# WHY the old job was green with no backup: its "Check configuration" step
# ran `exit 0` when the DATABASE_URL secret was empty, after setting
# run=false. Every later step was `if: run == 'true'`, so GitHub marked them
# SKIPPED, and a job whose steps are all success-or-skipped is a SUCCESS.
# The "open an issue" step only runs on failure(), so nobody was told. Run
# 38486711137 (14 Oct 2026) shows exactly that: Dump skipped, Upload skipped,
# conclusion success. The secrets were never added (RUNBOOK §2 was a TODO).
# Also: with DATABASE_URL set but no bucket/age key, the old job took the
# dump, checked it and threw it away, still green: a backup that is never
# kept is not a backup.
#
# Now: unless BACKUP_DISABLED=1 (a repo VARIABLE, set on purpose), every one
# of the six secrets must be present or this script exits 1, the job goes
# red and the failure step opens an issue naming what is missing.
#
# Writes run=true|false to $GITHUB_OUTPUT when that is set.
set -euo pipefail

out="${GITHUB_OUTPUT:-/dev/null}"

if [ "${BACKUP_DISABLED:-}" = "1" ]; then
  echo "::warning::Backups are switched OFF on purpose (repo variable BACKUP_DISABLED=1). No backup taken."
  echo "run=false" >> "$out"
  exit 0
fi

missing=()
[ -n "${DATABASE_URL:-}" ]          || missing+=("DATABASE_URL (read-only Neon role URL)")
[ -n "${AGE_RECIPIENT:-}" ]         || missing+=("BACKUP_AGE_RECIPIENT (age1... public key)")
[ -n "${S3_BUCKET:-}" ]             || missing+=("BACKUP_S3_BUCKET")
[ -n "${S3_ENDPOINT:-}" ]           || missing+=("BACKUP_S3_ENDPOINT (R2: https://<account>.r2.cloudflarestorage.com)")
[ -n "${AWS_ACCESS_KEY_ID:-}" ]     || missing+=("BACKUP_S3_ACCESS_KEY_ID")
[ -n "${AWS_SECRET_ACCESS_KEY:-}" ] || missing+=("BACKUP_S3_SECRET_ACCESS_KEY")

if [ "${#missing[@]}" -gt 0 ]; then
  echo "::error::No backup can be taken: missing GitHub Actions secrets: ${missing[*]}. See docs/RUNBOOK.md §2. (Set repo variable BACKUP_DISABLED=1 only if backups are off on purpose.)"
  for m in "${missing[@]}"; do echo "missing: $m"; done
  echo "run=false" >> "$out"
  exit 1
fi

case "$AGE_RECIPIENT" in
  age1*) ;;
  *) echo "::error::BACKUP_AGE_RECIPIENT must be an age public key starting with age1 (never the private key)."; exit 1 ;;
esac
case "$DATABASE_URL" in
  postgres://*|postgresql://*) ;;
  *) echo "::error::DATABASE_URL must be a postgres:// or postgresql:// URL."; exit 1 ;;
esac

echo "Backup configuration complete."
echo "run=true" >> "$out"
