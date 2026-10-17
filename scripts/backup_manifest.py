#!/usr/bin/env python3
"""Retention and MANIFEST.json for the private backup repo (docs/BACKUPS.md).

The backup repo holds dumps/rightdue-<YYYY-MM-DDTHHMMZ>.dump.age plus a
MANIFEST.json describing each file (size, sha256, alembic revision, row
count per table). Row counts live ONLY there (a private repo), never in the
public Actions log.

Retention (keep_names): the newest file of each of the last DAILY distinct
UTC dates, plus the newest file of each of the last WEEKLY ISO weeks. The
union is kept (so the weeks the dailies cover count among the 8, as in
restic's --keep-daily/--keep-weekly); everything else is deleted. With
14 + 8 that is 19-20 files and the oldest is at most 55 days old
(privacy-facts.ts RETENTION.backupDays = 56).

Commands (python3 scripts/backup_manifest.py ...):
  keep [--daily N] [--weekly N] NAME...      print the names to keep
  apply MANIFEST DUMPS_DIR ENTRY_JSON [--daily N] [--weekly N]
                                             add ENTRY, delete files outside
                                             retention, rewrite MANIFEST
  latest MANIFEST [DUMPS_DIR]                print the newest entry (JSON)
  compare EXPECTED_COUNTS_JSON ACTUAL_COUNTS_JSON
                                             exit 1 unless every table count
                                             and the alembic revision match
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import re
import sys
from pathlib import Path

NAME_RE = re.compile(r"^rightdue-(\d{4}-\d{2}-\d{2})T(\d{2})(\d{2})Z\.dump\.age$")
DAILY, WEEKLY = 14, 8


def stamp_of(name: str) -> dt.datetime:
    m = NAME_RE.match(name)
    if not m:
        raise ValueError(f"not a backup file name: {name!r}")
    d = dt.date.fromisoformat(m.group(1))
    return dt.datetime(d.year, d.month, d.day, int(m.group(2)), int(m.group(3)), tzinfo=dt.timezone.utc)


def keep_names(names: list[str], daily: int = DAILY, weekly: int = WEEKLY) -> list[str]:
    """Names to keep, newest first. Unrecognised names are kept (never
    delete something we did not write)."""
    ours = sorted((n for n in names if NAME_RE.match(n)), key=stamp_of, reverse=True)
    keep: set[str] = {n for n in names if not NAME_RE.match(n)}
    seen_days: list[dt.date] = []
    seen_weeks: list[tuple[int, int]] = []
    for n in ours:  # newest first, so the first file seen for a day/week is its newest
        s = stamp_of(n)
        day = s.date()
        week = tuple(s.isocalendar())[:2]
        if day not in seen_days:
            seen_days.append(day)
            if len(seen_days) <= daily:
                keep.add(n)
        if week not in seen_weeks:
            seen_weeks.append(week)
            if len(seen_weeks) <= weekly:
                keep.add(n)
    return sorted(keep, key=lambda n: (stamp_of(n) if NAME_RE.match(n) else dt.datetime.min.replace(tzinfo=dt.timezone.utc)), reverse=True)


def load_manifest(path: Path) -> dict:
    if path.exists():
        m = json.loads(path.read_text())
        if m.get("format") != 1 or not isinstance(m.get("backups"), list):
            raise SystemExit(f"::error::{path} is not a format-1 backup manifest.")
        return m
    return {"format": 1, "backups": []}


def apply(manifest_path: Path, dumps: Path, entry: dict, daily: int, weekly: int) -> dict:
    if not (dumps / entry["file"]).is_file():
        raise SystemExit(f"::error::{entry['file']} is not in {dumps}.")
    m = load_manifest(manifest_path)
    by_file = {b["file"]: b for b in m["backups"]}
    by_file[entry["file"]] = entry
    present = sorted(p.name for p in dumps.iterdir() if p.is_file())
    keep = set(keep_names(present, daily, weekly))
    if entry["file"] not in keep:  # cannot happen (newest file), but never drop tonight's
        raise SystemExit("::error::retention would delete the backup just taken.")
    removed = [n for n in present if n not in keep]
    for n in removed:
        (dumps / n).unlink()
    m["backups"] = sorted((by_file[n] for n in keep if n in by_file), key=lambda b: b["file"], reverse=True)
    # Files on disk without a manifest entry (should not happen) are listed so
    # a human notices; the drill only trusts manifest entries.
    m["unlisted"] = sorted(n for n in keep if n not in by_file)
    m["retention"] = {"daily": daily, "weekly": weekly}
    manifest_path.write_text(json.dumps(m, indent=2, sort_keys=True) + "\n")
    return {"kept": len(keep), "removed": removed}


def latest(manifest_path: Path, dumps: Path | None) -> dict:
    m = load_manifest(manifest_path)
    entries = [b for b in m["backups"] if NAME_RE.match(b.get("file", ""))]
    if dumps is not None:
        entries = [b for b in entries if (dumps / b["file"]).is_file()]
    if not entries:
        raise SystemExit("::error::The backup repo has no backups listed in MANIFEST.json.")
    return max(entries, key=lambda b: stamp_of(b["file"]))


def compare(expected: dict, actual: dict) -> list[str]:
    """Problems, naming tables but never their counts (public logs)."""
    problems = []
    if expected.get("_alembic") != actual.get("_alembic"):
        problems.append("alembic revision differs")
    et, at = expected.get("tables") or {}, actual.get("tables") or {}
    if not et:
        problems.append("the manifest has no table counts")
    missing = sorted(set(et) - set(at))
    if missing:
        problems.append("tables missing after restore: " + ", ".join(missing))
    differ = sorted(t for t in et if t in at and int(et[t]) != int(at[t]))
    if differ:
        problems.append("row counts differ in: " + ", ".join(differ))
    extra = sorted(set(at) - set(et))
    if extra:
        problems.append("unexpected tables after restore: " + ", ".join(extra))
    return problems


def main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    k = sub.add_parser("keep"); k.add_argument("names", nargs="*")
    a = sub.add_parser("apply"); a.add_argument("manifest"); a.add_argument("dumps"); a.add_argument("entry")
    for p in (k, a):
        p.add_argument("--daily", type=int, default=int(os.environ.get("BACKUP_KEEP_DAILY", DAILY)))
        p.add_argument("--weekly", type=int, default=int(os.environ.get("BACKUP_KEEP_WEEKLY", WEEKLY)))
    lt = sub.add_parser("latest"); lt.add_argument("manifest"); lt.add_argument("dumps", nargs="?")
    c = sub.add_parser("compare"); c.add_argument("expected"); c.add_argument("actual")
    ns = ap.parse_args(argv)

    if ns.cmd == "keep":
        print("\n".join(keep_names(ns.names, ns.daily, ns.weekly)))
    elif ns.cmd == "apply":
        entry = json.loads(Path(ns.entry).read_text())
        r = apply(Path(ns.manifest), Path(ns.dumps), entry, ns.daily, ns.weekly)
        print(f"Retention: keeping {r['kept']} file(s), removed {len(r['removed'])}: {' '.join(r['removed']) or '-'}", file=sys.stderr)
    elif ns.cmd == "latest":
        print(json.dumps(latest(Path(ns.manifest), Path(ns.dumps) if ns.dumps else None)))
    elif ns.cmd == "compare":
        problems = compare(json.loads(ns.expected), json.loads(ns.actual))
        if problems:
            print("::error::Restore drill: the restored copy does not match the backup's manifest: " + "; ".join(problems), file=sys.stderr)
            return 1
        print("Restored copy matches the manifest: alembic revision and every table's row count.", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
