#!/usr/bin/env bash
# Starts FastAPI (private, 127.0.0.1) and then Next.js (public, $PORT) in one
# container. If either process exits, the container exits, so Render restarts
# the whole service instead of leaving half of it running.
set -euo pipefail

API_HOST=127.0.0.1
API_PORT="${API_PORT:-8000}"
WEB_PORT="${PORT:-10000}"
APP_DIR="${APP_DIR:-/app}"
WEB_DIR="${WEB_DIR:-$APP_DIR/web-server}"

cd "$APP_DIR"

# One worker: the free plan has 512 MB and a fraction of a CPU, and the rate
# limiter keeps its buckets in process memory (one worker = one set).
# --forwarded-allow-ips is left at its default (127.0.0.1, i.e. Next.js);
# the client address for rate limits comes from api/client_ip.py, which reads
# X-Forwarded-For only as far back as TRUSTED_PROXY_HOPS.
python -m uvicorn api.main:app --host "$API_HOST" --port "$API_PORT" --workers 1 \
  --timeout-keep-alive 65 &
API_PID=$!

shutdown() {
  kill -TERM "$API_PID" ${WEB_PID:+"$WEB_PID"} 2>/dev/null || true
  wait || true
}
trap 'shutdown; exit 143' TERM INT

# Wait for FastAPI before opening the public port. Render holds the waking
# request until the port is bound, so the first page (and the server-side
# API calls it makes) never meets a half-started API.
for _ in $(seq 1 120); do
  if ! kill -0 "$API_PID" 2>/dev/null; then
    echo "start.sh: FastAPI exited during startup" >&2
    wait "$API_PID" || exit $?
    exit 1
  fi
  if python - "$API_HOST" "$API_PORT" <<'PY' 2>/dev/null
import sys, urllib.request
# No proxy: a host-level HTTP(S)_PROXY must not intercept a loopback call.
opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
opener.open(f"http://{sys.argv[1]}:{sys.argv[2]}/api/health", timeout=2).read()
PY
  then
    break
  fi
  sleep 0.5
done

cd "$WEB_DIR"
HOSTNAME=0.0.0.0 PORT="$WEB_PORT" node server.js &
WEB_PID=$!

# Whichever exits first takes the container down with it.
set +e
wait -n "$API_PID" "$WEB_PID"
status=$?
echo "start.sh: a process exited (status $status); stopping the service" >&2
shutdown
exit "$status"
