#!/usr/bin/env bash
# OPTIONAL second copy in a Cloudflare R2 / S3 bucket (docs/BACKUPS.md §6).
# Runs only when all four BACKUP_S3_* secrets exist (backup_preflight.sh
# sets r2=true). Retention there is the bucket's own lifecycle rule.
#
#   S3_BUCKET S3_ENDPOINT AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=scripts/backup_common.sh
. "$here/backup_common.sh"
file="${1:?usage: backup_push_r2.sh FILE.dump.age}"
export AWS_DEFAULT_REGION="${AWS_DEFAULT_REGION:-auto}"
key="nightly/$(basename "$file")"
aws --endpoint-url "$S3_ENDPOINT" s3 cp "$file" "s3://$S3_BUCKET/$key" --only-show-errors
size=$(aws --endpoint-url "$S3_ENDPOINT" s3api head-object --bucket "$S3_BUCKET" --key "$key" --query ContentLength --output text)
[ "${size:-0}" = "$(stat -c %s "$file")" ] || die "R2 copy of $key is ${size:-missing} bytes, expected $(stat -c %s "$file")."
note "Second copy stored in the bucket: $key."
