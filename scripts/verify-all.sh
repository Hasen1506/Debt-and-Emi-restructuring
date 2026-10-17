#!/usr/bin/env bash
# Run every suite exactly as .github/workflows/ci.yml does, locally.
# Mirrors the jobs: python, property, differential, web, e2e (chromium),
# and optionally e2e-browsers (firefox + webkit).
#
#   scripts/verify-all.sh                 # everything except cross-browser
#   scripts/verify-all.sh --browsers      # also Firefox + WebKit
#   scripts/verify-all.sh --only python,web
#
# Needs: python 3.12 with requirements-dev.txt, node 24, a Postgres you can
# point at. Env (defaults in brackets):
#   RIGHTDUE_TEST_DATABASE_URL  python job DB   [unset: DB tests skip as on a laptop]
#   E2E_DATABASE_URL            e2e DB          [required for e2e]
#   E2E_API_PORT / E2E_WEB_PORT ports           [8100 / 3100, as CI]
#   PW_CHROMIUM_PATH            system chromium [Playwright's own]
#   SCRATCH                     logs dir        [./.verify-all]
# Exit code is non-zero if any job failed; a summary table is printed.
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
export HYPOTHESIS_PROFILE=ci PYTHONHASHSEED=0 NEXT_TELEMETRY_DISABLED=1
export E2E_FROZEN_NOW="${E2E_FROZEN_NOW:-2026-10-07T10:00:00+05:30}"
export E2E_PYTHON="${E2E_PYTHON:-python}"
API_PORT="${E2E_API_PORT:-8100}"; WEB_PORT="${E2E_WEB_PORT:-3100}"
export E2E_API_PORT="$API_PORT" E2E_WEB_PORT="$WEB_PORT"
SCRATCH="${SCRATCH:-$ROOT/.verify-all}"; mkdir -p "$SCRATCH"
ONLY=""; BROWSERS=0
while [ $# -gt 0 ]; do
  case "$1" in
    --browsers) BROWSERS=1 ;;
    --only) ONLY="$2"; shift ;;
    *) echo "unknown arg $1"; exit 2 ;;
  esac; shift
done
want() { [ -z "$ONLY" ] || [[ ",$ONLY," == *",$1,"* ]]; }
declare -a RESULTS=()
run() { # name, command...
  local name="$1"; shift
  echo "::: $name"; local t0=$SECONDS
  if "$@" >"$SCRATCH/$name.log" 2>&1; then RESULTS+=("PASS  $name ($((SECONDS-t0))s)")
  else RESULTS+=("FAIL  $name ($((SECONDS-t0))s)  log: $SCRATCH/$name.log"); fi
}

want python && run python python -m pytest engine/tests api/tests -q --durations=5 \
  --ignore-glob='*/test_property_*' --ignore-glob='*/test_differential_*'
want property && run property python -m pytest engine/tests/test_property_invariants.py \
  api/tests/test_property_api.py -q --durations=20 --hypothesis-show-statistics
want differential && run differential python -m pytest engine/tests/test_differential_reference.py \
  engine/tests/test_differential_pre_pr29.py -q --durations=20

if want web || want e2e; then
  [ -d web/node_modules ] || (cd web && npm ci) >"$SCRATCH/npm-ci.log" 2>&1
fi
if want web; then
  run web-typecheck bash -c 'cd web && npm run typecheck'
  run web-lint bash -c 'cd web && npm run lint'
  run web-test bash -c 'cd web && npm test'
  run web-build bash -c 'cd web && npm run build'
fi
if want e2e; then
  if [ -z "${E2E_DATABASE_URL:-}" ]; then RESULTS+=("SKIP  e2e (E2E_DATABASE_URL not set)")
  else
    # CI builds once against the local API; the web job's build is not reused.
    run e2e-build bash -c "cd web && NEXT_PUBLIC_API_BASE_URL=http://127.0.0.1:$API_PORT API_BASE_URL=http://127.0.0.1:$API_PORT npm run build"
    run e2e-chromium bash -c 'cd web && CI=1 npx playwright test --project=chromium'
    [ "$BROWSERS" = 1 ] && run e2e-browsers bash -c 'cd web && CI=1 npx playwright test --project=firefox --project=webkit'
  fi
fi
echo; echo "== verify-all summary"; printf '%s\n' "${RESULTS[@]}"
! printf '%s\n' "${RESULTS[@]}" | grep -q '^FAIL'
