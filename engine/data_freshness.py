"""The data-freshness registry (grill #35, sprint G4).

One file, engine/data_freshness.json, lists every dated figure the app
quotes with its source, the day it was last checked, and how often it must
be re-checked. `entries()` returns them all, including every entry of
web/src/lib/market-data.json (so the weekly market figures aren't listed
twice), with each `as_of` resolved to a date. `stale(today)` lists the ones
past their cadence. engine/tests/test_data_freshness.py runs it on every CI
run, so a figure nobody refreshed fails the build with a message saying
what it is and where to re-read it.
"""
from __future__ import annotations

import importlib
import json
import re
from dataclasses import dataclass, field
from datetime import date, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
REGISTRY = Path(__file__).with_name("data_freshness.json")


@dataclass
class Entry:
    id: str
    what: str
    source: str
    url: str
    as_of: date | None
    cadence_days: int
    how: str
    value: str | None = None
    used_in: list[str] = field(default_factory=list)
    code_ref: dict | None = None

    def due(self, grace_days: int) -> date | None:
        return None if self.as_of is None else self.as_of + timedelta(days=self.cadence_days + grace_days)


def _parse_date(v) -> date | None:
    if isinstance(v, date):
        return v
    m = re.match(r"(\d{4}-\d{2}-\d{2})", str(v or ""))
    return date.fromisoformat(m.group(1)) if m else None


def _py_attr(ref: str):
    mod, attr = ref.split(":")
    return getattr(importlib.import_module(mod), attr)


def load() -> dict:
    return json.loads(REGISTRY.read_text(encoding="utf-8"))


def entries() -> list[Entry]:
    reg = load()
    out: list[Entry] = []
    for e in reg["entries"]:
        if "as_of" in e:
            as_of = _parse_date(e["as_of"])
        elif "as_of_py" in e:
            as_of = _parse_date(_py_attr(e["as_of_py"]))
        else:
            data = json.loads((ROOT / e["file"]).read_text(encoding="utf-8"))
            as_of = _parse_date(data.get(e["as_of_key"]))
        out.append(Entry(
            id=e["id"], what=e["what"], source=e["source"], url=e["url"], as_of=as_of,
            cadence_days=int(e["cadence_days"]), how=e["how"], value=e.get("value"),
            used_in=e.get("used_in", []), code_ref=e.get("code_ref"),
        ))
    out.extend(_market_entries(reg))
    return out


def _market_entries(reg: dict) -> list[Entry]:
    md = json.loads((ROOT / reg["market_data_file"]).read_text(encoding="utf-8"))
    cad = reg.get("market_data_cadence_days", {})
    found: list[tuple[str, dict]] = []

    def walk(o, path):
        if isinstance(o, dict):
            if "as_of" in o and "rate" in o:
                found.append((path, o))
                return
            for k, v in o.items():
                walk(v, f"{path}.{k}" if path else k)
    walk(md, "")
    out = []
    for path, o in found:
        if o.get("how") == "by_hand" and o.get("max_age_days"):
            days = int(o["max_age_days"])
        else:
            days = int(cad.get(path, cad.get("_default_auto", 21)))
        out.append(Entry(
            id=f"market_data:{path}", what=o.get("source") or f"{o.get('who', '')} {o.get('what', '')}".strip(),
            source=o.get("source") or o.get("who", ""), url=o.get("url", ""),
            as_of=_parse_date(o.get("as_of")), cadence_days=days, how=o.get("how", "auto"),
            value=o.get("rate"), used_in=[reg["market_data_file"]],
        ))
    return out


def stale(today: date, grace_days: int | None = None) -> list[Entry]:
    g = load()["grace_days"] if grace_days is None else grace_days
    return [e for e in entries() if e.as_of is None or e.due(g) < today]


def code_value(e: Entry) -> str | None:
    """The value the code actually uses for `e`, or None when there is no
    code reference (or the module isn't on this branch yet)."""
    ref = e.code_ref
    if not ref:
        return None
    if "py" in ref:
        try:
            return str(_py_attr(ref["py"]))
        except (ImportError, AttributeError):
            if ref.get("skip_if_missing"):
                return None
            raise
    src = (ROOT / ref["ts"]).read_text(encoding="utf-8")
    m = re.search(ref["pattern"], src, re.S)
    if not m:
        raise AssertionError(f"{e.id}: pattern {ref['pattern']!r} not found in {ref['ts']}")
    return m.group(1)
