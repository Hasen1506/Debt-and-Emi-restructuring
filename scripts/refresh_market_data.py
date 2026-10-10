"""Re-read the market figures the app quotes and say what needs a person.

    python scripts/refresh_market_data.py                      # fetch live, write if anything changed
    python scripts/refresh_market_data.py --pages DIR          # read saved pages instead (offline)
    python scripts/refresh_market_data.py --report report.md   # also write what needs checking by hand

Reads (engine/market_data.py has the readers and the sources):

- RBI home page: 91- and 364-day T-bill cut-offs (liquid fund, T-bill) and
  the repo rate.
- RBI's latest MPC resolution: the CPI projection (India inflation).
- US Treasury: the 1-year yield.
- The Fed's latest Summary of Economic Projections: median PCE inflation.
- SBI and HDFC Bank: the 1-year fixed-deposit rate.
- FRED MORTGAGE30US: the 30-year mortgage average.

and updates web/src/lib/market-data.json (the API reads the same file).
A source that can't be fetched or read keeps its last value; nothing is
guessed. The file is written only when a figure changed.

The report lists what a script can't settle: a source that failed, a
"by_hand" figure older than its max_age_days, a Tier-A rate card not
re-read in 120 days, and live rates that moved away from what the cards
were priced on (engine/rate_cards.py *_BASIS_*). The weekly workflow
(.github/workflows/market-data.yml) posts it as an issue.
"""
from __future__ import annotations

import argparse
import json
import sys
import urllib.request
from datetime import date, datetime, timedelta
from decimal import Decimal
from pathlib import Path
from typing import Callable, Optional

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from engine import market_data as md  # noqa: E402
from engine import policy_rates, rate_cards  # noqa: E402
from engine.models import Country  # noqa: E402

UA = ("Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36 "
      "RightDue-market-data/1.0 (+https://github.com/Hasen1506/Debt-and-Emi-restructuring)")
TIMEOUT = 60
MAX_BYTES = 5_000_000
CARD_MAX_AGE = timedelta(days=120)
PMMS_DRIFT = Decimal("0.0025")


def http_get(url: str) -> str:
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=TIMEOUT) as resp:  # noqa: S310 - fixed https URLs
        body = resp.read(MAX_BYTES + 1)
    if len(body) > MAX_BYTES:
        raise ValueError("reply too large")
    return body.decode("utf-8", errors="replace")


def saved_pages(folder: Path) -> Callable[[str], str]:
    """Offline: map each URL to a file in `folder` by a short name."""
    names = {
        md.RBI_HOME: "rbi_home.html", md.FOMC_CALENDAR: "fomc_calendar.html",
        md.SBI_FD: "sbi_fd.txt", md.HDFC_FD: "hdfc_fd.txt", md.FRED_PMMS: "pmms.csv",
    }

    def get(url: str) -> str:
        if url in names:
            name = names[url]
        elif "BS_PressReleaseDisplay" in url:
            name = "rbi_mpc.txt"
        elif "daily-treasury-rates" in url:
            name = "treasury.csv"
        elif "fomcprojtabl" in url:
            name = "fed_sep.txt"
        else:
            raise FileNotFoundError(url)
        return (folder / name).read_text(encoding="utf-8")

    return get


def _r4(v: Decimal) -> str:
    return str(v.quantize(Decimal("0.0001")))


def _r3(v: Decimal) -> str:
    return str(v.quantize(Decimal("0.001")))


def _pct_text(v: Decimal) -> str:
    return f"{(v * 100).quantize(Decimal('0.01'))}%"


def refresh(data: dict, get: Callable[[str], str], today: date) -> tuple[list[str], list[str]]:
    """Update `data` in place. Returns (what changed, what failed)."""
    changed: list[str] = []
    failed: list[str] = []

    def put(entry: dict, label: str, **fields) -> None:
        before = {k: entry.get(k) for k in fields}
        entry.update(fields)
        if before["rate"] != fields["rate"]:
            changed.append(f"{label}: {before['rate']} → {fields['rate']}")

    def attempt(label: str, fn: Callable[[], None]) -> None:
        try:
            fn()
        except Exception as e:  # noqa: BLE001 - every failure is reported, none is fatal
            failed.append(f"{label}: {type(e).__name__}: {e}"[:300])

    safe = data["safe"]
    rbi_page: dict[str, str] = {}

    def rbi() -> None:
        page = get(md.RBI_HOME)
        rbi_page["home"] = page
        bills = md.rbi_tbills(page)
        if not bills:
            raise ValueError("T-bill cut-offs not found on the RBI home page")
        day = bills["as_of"].isoformat()
        put(safe["gsec_in"], "364-day T-bill", rate=_r4(bills["364"]), as_of=day)
        put(safe["liquid_in"], "91-day T-bill (liquid fund)", rate=_r4(bills["91"]), as_of=day)

    def cpi_in() -> None:
        home = rbi_page.get("home") or get(md.RBI_HOME)
        link = md.rbi_mpc_link(home)
        if not link:
            raise ValueError("no MPC resolution linked from the RBI home page")
        got = md.rbi_cpi_projection(get(link))
        if not got or not got["as_of"]:
            raise ValueError("CPI projection not found in the MPC resolution")
        year = got["year"].replace("-", "–")
        put(data["inflation"]["IN"], "India inflation forecast", rate=_r3(got["rate"]),
            what=f"forecast for {year}", as_of=got["as_of"].isoformat(), url=link)

    def treasury() -> None:
        got = md.treasury_1y(get(md.TREASURY_CSV.format(year=today.year)))
        if not got and today.month == 1:
            got = md.treasury_1y(get(md.TREASURY_CSV.format(year=today.year - 1)))
        if not got:
            raise ValueError("no 1-year yield in the Treasury CSV")
        put(safe["treasury_us"], "US 1-year Treasury", rate=_r4(got["rate"]), as_of=got["as_of"].isoformat())

    def pce_us() -> None:
        page = md.fomc_sep_page(get(md.FOMC_CALENDAR))
        if not page:
            raise ValueError("no projection table linked from the FOMC calendar")
        sep_date = datetime.strptime(page[len("fomcprojtabl"):len("fomcprojtabl") + 8], "%Y%m%d").date()
        url = md.FOMC_SEP.format(page=page)
        got = md.fed_pce_median(get(url), sep_date)
        if not got:
            raise ValueError("median PCE inflation not found in the projection table")
        put(data["inflation"]["US"], "US inflation forecast", rate=_r3(got["rate"]),
            what=f"median forecast for {got['year']} (PCE prices)", as_of=sep_date.isoformat(), url=url)

    def fd() -> None:
        quotes = []
        for name, url, reader in (("SBI", md.SBI_FD, md.sbi_fd_1y), ("HDFC Bank", md.HDFC_FD, md.hdfc_fd_1y)):
            try:
                v = reader(get(url))
            except Exception as e:  # noqa: BLE001
                failed.append(f"{name} FD page: {type(e).__name__}: {e}"[:300])
                continue
            if v is None:
                failed.append(f"{name} FD page: 1-year rate not found")
            else:
                quotes.append((name, v))
        if not quotes:
            return
        mean = sum(v for _, v in quotes) / len(quotes)
        names = " and ".join(f"{n} ({_pct_text(v).replace('.00%', '%')})" for n, v in quotes)
        put(safe["fd_in"], "1-year FD", rate=_r4(mean), as_of=today.isoformat(),
            source=f"1-yr FD rate at {names}")

    def pmms() -> None:
        got = md.fred_latest(get(md.FRED_PMMS), "pmms")
        if not got:
            raise ValueError("no value in the FRED MORTGAGE30US CSV")
        put(data["us_mortgage_30y"], "US 30-year mortgage average", rate=_r4(got["rate"]),
            as_of=got["as_of"].isoformat())

    for label, fn in (("RBI home page", rbi), ("RBI MPC resolution", cpi_in), ("US Treasury yields", treasury),
                      ("Fed projections", pce_us), ("Fixed deposits", fd), ("FRED PMMS", pmms)):
        attempt(label, fn)
    data["_rbi_repo"] = md.rbi_repo(rbi_page["home"]) if "home" in rbi_page else None
    return changed, failed


def _as_of_date(s: str) -> date:
    return date.fromisoformat(s if len(s) == 10 else s + "-01")


def needs_a_person(data: dict, failed: list[str], today: date) -> list[str]:
    """What the weekly issue lists."""
    out = [f"Couldn't read **{f}**. The last value stays in use." for f in failed]
    for key, entry in data["safe"].items():
        if entry.get("how") == "by_hand":
            age = (today - _as_of_date(entry["as_of"])).days
            if age > entry.get("max_age_days", 60):
                out.append(f"`{key}` ({entry['source']}) was last checked {entry['as_of']}, {age} days ago: "
                           f"re-check it at {entry['url']} and update web/src/lib/market-data.json.")
    stale = [c.name for c in rate_cards.INDIA_TIER_A + rate_cards.USA_TIER_A
             if (today - _as_of_date(c.last_verified[:10])).days > CARD_MAX_AGE.days]
    if stale:
        out.append(f"Tier-A rate cards not re-read in {CARD_MAX_AGE.days} days: {', '.join(stale)} "
                   "(engine/rate_cards.py).")
    repo = data.get("_rbi_repo")
    table_repo = policy_rates.history(Country.IN)[-1][1]
    if repo is not None and repo != table_repo:
        out.append(f"RBI's repo rate is now {_pct_text(repo)}; engine/policy_rates.py ends at "
                   f"{_pct_text(table_repo)}. Add the decision there (the live feed covers it until then).")
    if repo is not None and repo != rate_cards.REPO_BASIS_IN:
        out.append(f"Indian rate cards were priced on a {_pct_text(rate_cards.REPO_BASIS_IN)} repo rate; it is now "
                   f"{_pct_text(repo)}. Re-read the Tier-A home-loan pages and set REPO_BASIS_IN.")
    fed = policy_rates.history(Country.US)[-1][1]
    if fed != rate_cards.FED_UPPER_BASIS_US:
        out.append(f"US rate cards were priced with Fed funds at {_pct_text(rate_cards.FED_UPPER_BASIS_US)}; the "
                   f"verified table now ends at {_pct_text(fed)}. Re-read the US cards and set FED_UPPER_BASIS_US.")
    pmms = Decimal(data["us_mortgage_30y"]["rate"])
    if abs(pmms - rate_cards.PMMS_BASIS_US) > PMMS_DRIFT:
        out.append(f"The US 30-year mortgage average is {_pct_text(pmms)}; the US mortgage cards were priced at "
                   f"{_pct_text(rate_cards.PMMS_BASIS_US)}. Re-read the lenders' rate pages and set PMMS_BASIS_US.")
    return out


def main(argv: Optional[list[str]] = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--pages", type=Path, help="read saved pages from this folder instead of the web")
    ap.add_argument("--report", type=Path, help="write what needs a person to this Markdown file")
    ap.add_argument("--today", type=date.fromisoformat, default=date.today())
    ap.add_argument("--out", type=Path, default=md.SNAPSHOT)
    args = ap.parse_args(argv)

    raw = args.out.read_text(encoding="utf-8")
    data = json.loads(raw)
    changed, failed = refresh(data, saved_pages(args.pages) if args.pages else http_get, args.today)
    todo = needs_a_person(data, failed, args.today)
    data.pop("_rbi_repo", None)
    if json.loads(raw) != data:
        data["updated"] = args.today.isoformat()
        args.out.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    for line in changed:
        print("changed:", line)
    for line in failed:
        print("failed:", line)
    if args.report:
        args.report.write_text("".join(f"- [ ] {line}\n" for line in todo), encoding="utf-8")
    elif todo:
        print("\n".join(todo))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
