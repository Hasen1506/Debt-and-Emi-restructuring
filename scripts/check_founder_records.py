#!/usr/bin/env python3
"""Fail when a GitHub workflow has no entry in docs/FOUNDER-RECORDS.md (c).

Round 2 (15 Oct 2026): the founder keeps one list of everything that runs
on a schedule or on every push ("Always running"). A new workflow that
nobody wrote down is a job that can stop without anyone noticing, so CI
(job `health`) runs this and goes red until the entry exists.

An entry = the file's repo path, e.g. `.github/workflows/notify.yml`,
somewhere inside section "## (c)" (up to the next "## " heading).
Also checks the entry says what happens if it stops ("If it stops").

    python3 scripts/check_founder_records.py            # exit 1 + list on a gap
    python3 scripts/check_founder_records.py --root DIR # another checkout (tests)
"""
from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

RECORDS = Path("docs/FOUNDER-RECORDS.md")
WORKFLOWS = Path(".github/workflows")


def section_c(text: str) -> str:
    m = re.search(r"^## \(c\)[^\n]*\n(.*?)(?=^## |\Z)", text, flags=re.M | re.S)
    return m.group(1) if m else ""


def entry(section: str, rel: str) -> str:
    """The text of `rel`'s entry: from its heading to the next ### heading."""
    m = re.search(rf"^### `{re.escape(rel)}`[^\n]*\n(.*?)(?=^### |\Z)", section, flags=re.M | re.S)
    return m.group(1) if m else ""


def problems(root: Path) -> list[str]:
    records = root / RECORDS
    if not records.exists():
        return [f"{RECORDS} is missing"]
    sec = section_c(records.read_text(encoding="utf-8"))
    if not sec:
        return [f"{RECORDS} has no '## (c)' section"]
    out: list[str] = []
    files = sorted(p for p in (root / WORKFLOWS).glob("*") if p.suffix in (".yml", ".yaml"))
    for f in files:
        rel = f"{WORKFLOWS.as_posix()}/{f.name}"
        body = entry(sec, rel)
        if not body:
            out.append(f"{rel}: no entry in {RECORDS} section (c). Add a '### `{rel}` — <name>' entry "
                       "with Schedule, Does, Needs and If it stops.")
        elif "If it stops" not in body:
            out.append(f"{rel}: its entry doesn't say what happens 'If it stops'.")
    return out


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--root", type=Path, default=Path(__file__).resolve().parent.parent)
    args = ap.parse_args(argv)
    bad = problems(args.root)
    for b in bad:
        print(f"FOUNDER-RECORDS: {b}", file=sys.stderr)
    if not bad:
        n = len(list((args.root / WORKFLOWS).glob("*.y*ml")))
        print(f"FOUNDER-RECORDS: all {n} workflows have an 'Always running' entry.")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
