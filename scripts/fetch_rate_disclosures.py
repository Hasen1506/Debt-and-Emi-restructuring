"""Fetch banks' published loan-rate disclosures and commit them as dated JSON.

    python scripts/fetch_rate_disclosures.py              # fetch live, write if anything changed
    python scripts/fetch_rate_disclosures.py --pages DIR  # read saved pages instead (offline)

Each lender's page (engine/rate_disclosures.SOURCES) is fetched and read by
its own parser. What can be read goes into
api/data/rate_disclosures/<YYYY-MM-DD>.json and web/src/lib/rate-disclosures.json
(the copy the web app ships), with each lender's source URL and the time it
was fetched. A lender whose page can't be fetched or read is listed under
"missing" with the reason and no numbers; the app simply doesn't show it.
Nothing is ever filled in by hand or carried over as a guess: a lender that
fails today is missing today, even if an older file had it.

A new dated file is written only when the figures changed since the newest
one, so the weekly run (.github/workflows/rate-disclosures.yml) commits
once a quarter or so. Exit code 1 when no lender at all could be read.
"""
from __future__ import annotations

import argparse
import gzip
import json
import re
import sys
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Callable, Optional

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from engine import rate_disclosures as rd  # noqa: E402

DATA_DIR = ROOT / "api" / "data" / "rate_disclosures"
WEB_COPY = ROOT / "web" / "src" / "lib" / "rate-disclosures.json"
UA = ("Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36 "
      "RightDue-rate-disclosures/1.0 (+https://github.com/Hasen1506/Debt-and-Emi-restructuring)")
TIMEOUT = 30
MAX_BYTES = 8_000_000

Fetch = Callable[[str], str]


def fetch_live(url: str) -> str:
    req = urllib.request.Request(url, headers={
        "User-Agent": UA, "Accept": "text/html,application/xhtml+xml", "Accept-Language": "en-IN,en;q=0.9"})
    with urllib.request.urlopen(req, timeout=TIMEOUT) as resp:  # noqa: S310 (fixed https URLs)
        body = resp.read(MAX_BYTES + 1)
    if len(body) > MAX_BYTES:
        raise ValueError("page larger than 8 MB")
    return body.decode("utf-8", errors="replace")


def fetch_saved(pages: Path, names: dict[str, str]) -> Fetch:
    """Read saved pages (gzipped or plain) by URL, for tests and offline runs."""
    def get(url: str) -> str:
        name = names.get(url)
        if name is None:
            raise FileNotFoundError(f"no saved page for {url}")
        p = pages / name
        return gzip.decompress(p.read_bytes()).decode("utf-8") if p.suffix == ".gz" else p.read_text("utf-8")
    return get


def _latest_link(index_html: str, pattern: str, base: str) -> Optional[str]:
    """The newest quarter's page linked from an index page."""
    links = set(re.findall(pattern, index_html, re.I))
    best, best_key = None, None
    for link in links:
        per = rd.period(link)
        if per is None:
            continue
        if best_key is None or per[0] > best_key:
            best, best_key = link, per[0]
    if best is None:
        return None
    if best.startswith("/"):
        m = re.match(r"(https://[^/]+)", base)
        best = (m.group(1) if m else "") + best
    return best


def _utc(t: datetime) -> str:
    """'2026-10-08T04:31:07Z', built from the fields (no locale or patched strftime)."""
    return f"{t.year:04d}-{t.month:02d}-{t.day:02d}T{t.hour:02d}:{t.minute:02d}:{t.second:02d}Z"


def collect(fetch: Fetch, now: datetime) -> dict:
    lenders, missing = [], []
    for src in rd.SOURCES:
        url = src.url
        fetched_at = _utc(now)
        try:
            if src.index_url and src.index_link:
                found = _latest_link(fetch(src.index_url), src.index_link, src.index_url)
                if found:
                    url = found
            page = fetch(url)
        except Exception as exc:  # noqa: BLE001 — any fetch failure means "missing today"
            missing.append({"lender_id": src.lender_id, "name": src.name, "source_url": url,
                            "reason": f"could not fetch: {type(exc).__name__}"})
            continue
        parsed = rd.parse(src, page, url)
        if not parsed.rows:
            missing.append({"lender_id": src.lender_id, "name": src.name, "source_url": url,
                            "reason": "; ".join(r["reason"] for r in parsed.rejected) or "nothing readable"})
            continue
        lenders.append({
            "lender_id": src.lender_id, "name": src.name, "source_url": url, "fetched_at": fetched_at,
            "rows": [rd.row_dict(r) for r in parsed.rows],
            "rejected": parsed.rejected,
        })
    return {
        "about": ("Interest rates banks charged on loans contracted in the past quarter, read from each bank's "
                  "own website, as RBI requires (" + rd.RULE + "). Rates are fractions (0.1089 = 10.89%). "
                  "Written by scripts/fetch_rate_disclosures.py; never edited by hand."),
        "rule": rd.RULE, "rule_url": rd.RULE_URL,
        "as_of": f"{now.year:04d}-{now.month:02d}-{now.day:02d}",
        "lenders": lenders,
        "missing": missing,
    }


def _figures(doc: dict) -> list:
    return [(x["lender_id"], x["source_url"], x["rows"]) for x in doc.get("lenders", [])]


def newest(data_dir: Path) -> Optional[Path]:
    files = sorted(p for p in data_dir.glob("*.json") if re.fullmatch(r"\d{4}-\d{2}-\d{2}\.json", p.name))
    return files[-1] if files else None


def write(doc: dict, data_dir: Path = DATA_DIR, web_copy: Path = WEB_COPY) -> Optional[Path]:
    """Write the dated file (and the web copy) when the figures changed."""
    data_dir.mkdir(parents=True, exist_ok=True)
    last = newest(data_dir)
    if last is not None and _figures(json.loads(last.read_text("utf-8"))) == _figures(doc):
        return None
    path = data_dir / f"{doc['as_of']}.json"
    text = json.dumps(doc, indent=2, ensure_ascii=False) + "\n"
    path.write_text(text, "utf-8")
    web_copy.write_text(text, "utf-8")
    return path


def main(argv: Optional[list[str]] = None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--pages", type=Path, help="read saved pages from this folder (pages.json maps URL to file)")
    args = ap.parse_args(argv)
    if args.pages:
        fetch = fetch_saved(args.pages, json.loads((args.pages / "pages.json").read_text("utf-8")))
    else:
        fetch = fetch_live
    doc = collect(fetch, datetime.now(timezone.utc))
    for x in doc["lenders"]:
        print(f"ok      {x['name']:<22} {len(x['rows'])} rows  {x['source_url']}")
    for x in doc["missing"]:
        print(f"missing {x['name']:<22} {x['reason']}  {x['source_url']}")
    if not doc["lenders"]:
        print("No lender could be read; nothing written.")
        return 1
    path = write(doc)
    print(f"wrote {path.relative_to(ROOT)}" if path else "no change since the newest file; nothing written")
    return 0


if __name__ == "__main__":
    sys.exit(main())
