# User-scenario harness

A browser walk of RightDue that checks labels, empty states and rare
figures, not only that two functions return the same number.

```bash
# API on :8100 (e2e/api_server.py) and the web app on :3100.
cd /workspace
E2E_DATABASE_URL=postgresql://rightdue_e2e:e2e-fixture-password@127.0.0.1:5432/rightdue_e2e \
  /tmp/rd-venv/bin/python e2e/api_server.py --port 8100

cd web
NEXT_PUBLIC_API_BASE_URL=http://127.0.0.1:8100 API_BASE_URL=http://127.0.0.1:8100 \
  API_INTERNAL_URL=http://127.0.0.1:8100 npx next dev -p 3100

# From the repo root, with Playwright installed under web/:
node e2e/user-scenarios/run.mjs
```

Results land in `e2e/user-scenarios/last-run.json` (gitignored) and a
copy under `/opt/cursor/artifacts/user-scenarios/`. `recompute.py` checks
EMI, remaining months and the HDFC card minimum with numpy-financial and
decimal arithmetic, against the figures the browser read off the screen.

`run.mjs` also writes `field-matrix.csv`: one row per input (label, screen,
type) and one column per field scenario. A `1` means that scenario changed
the field. The JSON report lists fields that were never filled, and fields
that were filled without a validation message, a value change, or a change
in the surrounding text.
