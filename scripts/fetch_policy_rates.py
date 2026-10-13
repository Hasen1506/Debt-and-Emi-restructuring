"""Weekly: re-read the RBI repo rate and the Fed funds target, and update
api/data/policy_rates_live.json only when something worth recording changed.

Run by .github/workflows/policy-rates.yml (grill #61). The readers and
their safety checks are the app's own (api/rates_feed.py): a fetch must
agree with the verified table in engine/policy_rates.py and every new
decision must be plausible, or it is refused and the old value is kept.

The file is rewritten only when a rate or decision changed, on the first
check after a scheduled meeting, or after a 30-day heartbeat
(rates_feed.should_commit), so most weeks make no commit and no redeploy.

Exit status: 0 when every source was read, 1 when one failed (the good
ones are still written), so the workflow run goes red and GitHub emails
the owner. A Markdown summary goes to --summary (GITHUB_STEP_SUMMARY in CI).

    python scripts/fetch_policy_rates.py [--store PATH] [--summary FILE] [--force]
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from api import rates_feed  # noqa: E402
from api.rates_feed import RatesFeed, should_commit  # noqa: E402


def run(store: Path, get=rates_feed.http_get, now=rates_feed._now, force: bool = False) -> tuple[int, str, bool]:
    """(exit status, Markdown summary, wrote?)."""
    feed = RatesFeed(store, get=get, now=now)
    feed.load()
    try:
        old = json.loads(store.read_text())
    except (OSError, ValueError):
        old = {}
    feed.refresh(save=False)
    new = feed.stored(committed=True)
    today = feed.now().date()
    write, why = should_commit(old, new, today)
    if force and not write:
        write, why = True, "forced"
    if write:
        store.parent.mkdir(parents=True, exist_ok=True)
        store.write_text(json.dumps(new, indent=2) + "\n")

    lines = [f"### Policy rates, {today}", ""]
    failed = False
    for s in feed.sources.values():
        if s.error:
            failed = True
            lines.append(f"- **{s.label}: FAILED** ({s.error}). Last good value kept: "
                         f"{s.current if s.current is not None else 'none'} as of {s.as_of}.")
        else:
            lines.append(f"- {s.label}: {s.current:.2%} as of {s.as_of}"
                         + (f"; decisions after the verified table: {len(s.changes)}" if s.changes else ""))
    lines += ["", f"File {'updated' if write else 'unchanged'}: {why}."]
    return (1 if failed else 0), "\n".join(lines) + "\n", write


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--store", type=Path, default=rates_feed._DEFAULT_STORE)
    ap.add_argument("--summary", type=Path)
    ap.add_argument("--force", action="store_true", help="write even if nothing changed")
    args = ap.parse_args()
    status, summary, _ = run(args.store, force=args.force)
    print(summary)
    if args.summary:
        with args.summary.open("a") as f:
            f.write(summary)
    return status


if __name__ == "__main__":
    sys.exit(main())
