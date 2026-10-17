"""When the policy-rates workflow runs: weekly, plus each RBI MPC decision day.

GitHub cron cannot read a file, so the decision-day lines in
.github/workflows/policy-rates.yml are generated from
api/data/central_bank_calendar.json by this script, and
api/tests/test_data_workflows.py fails when the two drift apart (audit 80+
A19: the public /rbi-decision page should show a decision the day it is made,
not up to a week later).

A cron line has no year, so "30 6 4 12 *" would also fire on 4 Dec next year.
The workflow's first job asks this script whether today really is a
scheduled decision day (`gate`); when it is not, the fetch job is skipped and
costs no runner minutes.

Times: the RBI Governor's statement is at 10:00 IST on the last day of the
meeting (RBI MPC press releases, e.g.
https://www.rbi.org.in/Scripts/BS_PressReleaseDisplay.aspx?prid=63742).
The decision-day run is at 06:30 UTC = 12:00 IST, after the statement and the
resolution are on rbi.org.in. Scheduled runs can start late under load; a
late start only moves the check later the same day.

    python scripts/policy_rate_schedule.py crons          # print the lines
    python scripts/policy_rate_schedule.py write          # rewrite the workflow block
    python scripts/policy_rate_schedule.py gate --event schedule --schedule "30 6 4 12 *"
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
from datetime import date, datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CALENDAR = ROOT / "api" / "data" / "central_bank_calendar.json"
WORKFLOW = ROOT / ".github" / "workflows" / "policy-rates.yml"

WEEKLY = "0 3 * * 1"          # Mondays 03:00 UTC (08:30 IST)
MPC_UTC = (6, 30)             # 12:00 IST on the decision day
BEGIN = "    # BEGIN generated MPC decision days (scripts/policy_rate_schedule.py write)"
END = "    # END generated MPC decision days"


def mpc_days(calendar: dict) -> list[date]:
    """Scheduled (not yet held) RBI MPC decision days, in order."""
    return sorted(date.fromisoformat(m["date"]) for m in calendar["meetings"]["IN"]
                  if m.get("status") == "scheduled")


def cron_for(day: date) -> str:
    h, m = MPC_UTC
    return f"{m} {h} {day.day} {day.month} *"


def crons(calendar: dict) -> list[str]:
    return [cron_for(d) for d in mpc_days(calendar)]


def should_run(event: str, schedule: str | None, today: date, calendar: dict) -> tuple[bool, str]:
    """Whether this trigger should fetch. Manual runs and the weekly line always do;
    a decision-day line only on a scheduled decision day of this year."""
    if event != "schedule":
        return True, f"{event} run"
    if not schedule or schedule.strip() == WEEKLY:
        return True, "weekly check"
    days = [d for d in mpc_days(calendar) if cron_for(d) == schedule.strip()]
    if today in days:
        return True, f"RBI MPC decision day {today}"
    # The meeting may already be marked "held" by the time the run starts.
    held = [date.fromisoformat(m["date"]) for m in calendar["meetings"]["IN"]]
    if today in held and cron_for(today) == schedule.strip():
        return True, f"RBI MPC decision day {today}"
    return False, f"{schedule!r} matched no MPC decision on {today} (a cron line has no year)"


def render_block(calendar: dict) -> str:
    lines = [BEGIN]
    for d, c in zip(mpc_days(calendar), crons(calendar)):
        lines.append(f'    - cron: "{c}"   # RBI MPC decision {d:%d %b %Y}, 12:00 IST')
    lines.append(END)
    return "\n".join(lines)


def write(calendar: dict, path: Path = WORKFLOW) -> bool:
    text = path.read_text()
    pat = re.compile(re.escape(BEGIN) + r".*?" + re.escape(END), re.S)
    if not pat.search(text):
        raise SystemExit(f"{path}: generated block markers not found")
    new = pat.sub(lambda _: render_block(calendar), text)
    if new != text:
        path.write_text(new)
    return new != text


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("cmd", choices=["crons", "write", "gate"])
    ap.add_argument("--event", default=os.environ.get("GITHUB_EVENT_NAME", "workflow_dispatch"))
    ap.add_argument("--schedule", default="")
    ap.add_argument("--today", help="YYYY-MM-DD (UTC); default today")
    ap.add_argument("--calendar", type=Path, default=CALENDAR)
    args = ap.parse_args(argv)
    cal = json.loads(args.calendar.read_text())
    if args.cmd == "crons":
        print("\n".join(crons(cal)))
        return 0
    if args.cmd == "write":
        print("updated" if write(cal) else "unchanged")
        return 0
    today = date.fromisoformat(args.today) if args.today else datetime.now(timezone.utc).date()
    run, why = should_run(args.event, args.schedule, today, cal)
    print(f"run={'true' if run else 'false'} ({why})")
    out = os.environ.get("GITHUB_OUTPUT")
    if out:
        with open(out, "a") as f:
            f.write(f"run={'true' if run else 'false'}\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
