"""Readers for the weekly market-data run, on excerpts of the real pages (9-10 Oct 2026)."""
import json
import shutil
from datetime import date
from decimal import Decimal as D
from pathlib import Path

from engine import market_data as md

PAGES = Path(__file__).parent / "fixtures" / "market"


def page(name: str) -> str:
    return (PAGES / name).read_text(encoding="utf-8")


def test_rbi_home_page_tbills_and_repo():
    bills = md.rbi_tbills(page("rbi_home.html"))
    assert bills == {"91": D("0.055747"), "182": D("0.060999"), "364": D("0.062869"), "as_of": date(2026, 10, 8)}
    assert md.rbi_repo(page("rbi_home.html")) == D("0.055")
    assert md.rbi_mpc_link(page("rbi_home.html")).endswith("BS_PressReleaseDisplay.aspx?prid=63742")


def test_rbi_mpc_cpi_projection_dated_by_the_meeting():
    got = md.rbi_cpi_projection(page("rbi_mpc.txt"))
    assert got == {"rate": D("0.052"), "year": "2026-27", "as_of": date(2026, 10, 7)}


def test_fixed_deposit_one_year_rates():
    # SBI's table lists existing then revised public rates; the revised one counts.
    assert md.sbi_fd_1y(page("sbi_fd.txt")) == D("0.0625")
    assert md.hdfc_fd_1y(page("hdfc_fd.txt")) == D("0.0625")


def test_us_treasury_and_fed_projection():
    assert md.treasury_1y(page("treasury.csv")) == {"rate": D("0.0447"), "as_of": date(2026, 10, 9)}
    assert md.fomc_sep_page(page("fomc_calendar.html")) == "fomcprojtabl20260916.htm"
    # Median PCE for the year after the projection's year (2.3% in 2027), not
    # the core row and not this year's 3.7%.
    got = md.fed_pce_median(page("fed_sep.txt"), date(2026, 9, 16))
    assert got == {"rate": D("0.023"), "year": 2027, "as_of": date(2026, 9, 16)}


def test_fred_pmms_latest_week():
    assert md.fred_latest(page("pmms.csv"), "pmms") == {"rate": D("0.074"), "as_of": date(2026, 10, 8)}


def test_a_redesigned_page_reads_as_nothing_not_a_wrong_number():
    assert md.rbi_tbills("<html>Market trends coming soon</html>") is None
    assert md.sbi_fd_1y("1 year to less than 2 years 2026 2027") is None
    # Out of band: a tenor or a year misread as a rate.
    assert md.hdfc_fd_1y("1 Year to < 15 months 45.00%") is None
    assert md.rbi_cpi_projection("CPI inflation is projected to be 52 per cent for 2026-27") is None
    assert md.treasury_1y("Date,1 Yr\n10/09/2026,N/A\n") is None


def test_escaped_tables_are_read_as_text():
    assert md.page_text("<td>&lt;td&gt;6.25%&lt;/td&gt;</td>") == " 6.25% "


def test_refresh_offline_keeps_the_committed_figures(tmp_path):
    """The committed market-data.json is what the saved pages say."""
    from scripts import refresh_market_data as refresh

    out = tmp_path / "market-data.json"
    shutil.copy(md.SNAPSHOT, out)
    before = json.loads(out.read_text())
    refresh.main(["--pages", str(PAGES), "--today", "2026-10-10", "--out", str(out),
                  "--report", str(tmp_path / "report.md")])
    after = json.loads(out.read_text())
    for key in ("gsec_in", "liquid_in", "treasury_us", "fd_in"):
        assert after["safe"][key]["rate"] == before["safe"][key]["rate"], key
    assert after["inflation"] == before["inflation"]
    assert after["us_mortgage_30y"]["rate"] == before["us_mortgage_30y"]["rate"]


def test_refresh_keeps_last_value_when_a_source_fails(tmp_path):
    from scripts import refresh_market_data as refresh

    data = json.loads(md.SNAPSHOT.read_text())
    before = json.loads(json.dumps(data))

    def broken(url: str) -> str:
        raise OSError("connection reset")

    changed, failed = refresh.refresh(data, broken, date(2026, 10, 10))
    data.pop("_rbi_repo", None)
    assert changed == []
    assert data == before
    assert len(failed) >= 5 and all("connection reset" in f or "not found" in f for f in failed)


def test_report_flags_old_by_hand_figures_and_drift(tmp_path):
    from scripts import refresh_market_data as refresh

    data = json.loads(md.SNAPSHOT.read_text())
    data["safe"]["hysa_us"]["as_of"] = "2026-06-01"
    data["us_mortgage_30y"]["rate"] = "0.0700"
    data["_rbi_repo"] = D("0.0575")
    todo = "\n".join(refresh.needs_a_person(data, ["FRED PMMS: timeout"], date(2026, 10, 10)))
    assert "hysa_us" in todo
    assert "Couldn't read **FRED PMMS: timeout**" in todo
    assert "repo rate is now 5.75%" in todo and "REPO_BASIS_IN" in todo
    assert "PMMS_BASIS_US" in todo


def test_committed_snapshot_is_complete_and_plausible():
    snap = json.loads(md.SNAPSHOT.read_text())
    for key in ("fd_in", "tax_free_bond_in", "gsec_in", "liquid_in", "hysa_us", "treasury_us"):
        entry = snap["safe"][key]
        assert D("0") < D(entry["rate"]) < D("0.15"), key
        assert entry["how"] in ("auto", "by_hand") and entry["url"].startswith("https://"), key
        date.fromisoformat(entry["as_of"] if len(entry["as_of"]) == 10 else entry["as_of"] + "-01")
    for country in ("IN", "US"):
        assert D("-0.02") < D(snap["inflation"][country]["rate"]) < D("0.15")
