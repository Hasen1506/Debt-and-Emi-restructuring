#!/usr/bin/env bash
# UX50 E-01: prove the sign-in limit fires on a live deploy. Sends 7 code
# requests with an INVALID email, so no email is ever sent (422 until the
# limit, then 429). Burst is 5, so the 6th must be a 429.
set -euo pipefail
BASE="${1:-https://rightdue.app}"
codes=()
for i in $(seq 1 7); do
  codes+=("$(curl -s -o /dev/null -w '%{http_code}' -X POST \
    -H "Origin: $BASE" -H 'content-type: application/json' \
    -d '{"email":"x"}' "$BASE/api/session/auth/request-otp")")
done
echo "codes: ${codes[*]}"
[ "${codes[5]}" = "429" ] || { echo "FAIL: no 429 by the 6th request" >&2; exit 1; }
echo "OK: rate limit enforced"
