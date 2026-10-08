"""Roadmap PR G: banks' own disclosures of what they lent at last quarter.

The pages in fixtures/rate_disclosures/ are the banks' real pages, saved on
2026-10-08 (trimmed), so this runs offline. The committed data file is
checked too: every figure in it must come out of a parser, from a bank's own
page, with its source and quarter.
"""
import json
import re
from datetime import date, datetime, timezone
from decimal import Decimal as D
from pathlib import Path

import pytest

from engine import rate_disclosures as rd
from engine import rate_cards
from engine.models import Country, LoanType

ROOT = Path(__file__).resolve().parents[2]
PAGES = Path(__file__).parent / "fixtures" / "rate_disclosures"
NAMES = json.loads((PAGES / "pages.json").read_text(encoding="utf-8"))

import sys  # noqa: E402
sys.path.insert(0, str(ROOT))
from scripts import fetch_rate_disclosures as fetcher  # noqa: E402

SAVED = fetcher.fetch_saved(PAGES, NAMES)
Q1 = (date(2026, 4, 1), date(2026, 6, 30))

# What each bank's page said on 2026-10-08 (Apr-Jun 2026), read by hand from the page.
EXPECT = {
    "IN_SBI": [("SBI Personal Loan scheme", "personal_loan", None, None, "0.1154")],
    "IN_HDFC": [("Personal Loan", "personal_loan", "0.0997", "0.2406", "0.1089")],
    "IN_ICICI_PL": [("Personal Loan", "personal_loan", "0.0999", "0.165", "0.1145")],
    "IN_ICICI_CAR": [("New Car Loan", "auto_loan", "0.079", "0.112", "0.0887"),
                     ("Used Car Loan", None, "0.0975", "0.169", "0.129")],
    "IN_AXIS": [("Personal Loan", "personal_loan", "0.0875", "0.2155", "0.1307")],
}


def _parsed(src: rd.Source):
    url = src.url
    if src.index_url:
        url = fetcher._latest_link(SAVED(src.index_url), src.index_link, src.index_url) or url
    return rd.parse(src, SAVED(url), url), url


def _d(x):
    return None if x is None else D(x)


@pytest.mark.parametrize("src", rd.SOURCES, ids=lambda s: s.lender_id)
def test_each_lender_page_is_read(src):
    parsed, _ = _parsed(src)
    assert parsed.rows, parsed.rejected
    for r in parsed.rows:
        assert (r.period_start, r.period_end) == Q1, (src.lender_id, r.label)
    if src.lender_id in EXPECT:
        got = [(r.label, r.category, r.min, r.max, r.mean) for r in parsed.rows]
        want = [(lab, cat, _d(lo), _d(hi), _d(mean)) for lab, cat, lo, hi, mean in EXPECT[src.lender_id]]
        assert got == want


def test_hdfc_apr_and_not_the_stale_faq():
    parsed, _ = _parsed(next(s for s in rd.SOURCES if s.lender_id == "IN_HDFC"))
    r = parsed.rows[0]
    assert (r.apr_min, r.apr_max, r.apr_mean) == (D("0.0999"), D("0.3394"), D("0.1118"))
    # The same page's FAQ still quotes Jan-Mar 2025 (10.40-24.16%, average 11.47%); it is not used.
    assert r.mean != D("0.1147")


def test_kotak_tables_and_a_row_that_does_not_add_up():
    parsed, _ = _parsed(next(s for s in rd.SOURCES if s.lender_id == "IN_KOTAK"))
    by = {r.label: r for r in parsed.rows}
    pl = by["Personal Loan"]
    assert (pl.category, pl.min, pl.max, pl.mean) == ("personal_loan", D("0.0975"), D("0.3"), D("0.2189"))
    assert by["Housing Loan & Affordable Housing Loan"].category == "home_loan"
    assert by["GLN (Gold Loan)"].category == "gold_loan"
    # The page prints Business Loan as 9.97 / 20.97 / mean 30.95: the mean is outside its own
    # range, so the row is dropped with the reason, not "corrected".
    assert "Business Loan" not in by
    assert any(x["label"] == "Business Loan" and "outside the range" in x["reason"] for x in parsed.rejected)


def test_idfc_finds_the_newest_quarter_from_its_index():
    src = next(s for s in rd.SOURCES if s.lender_id == "IN_IDFC")
    parsed, url = _parsed(src)
    assert url.endswith("for-the-quarter-q1-fy-26-27")
    by = {r.label: r for r in parsed.rows}
    pl = by["Personal Loan"]
    assert (pl.min, pl.max, pl.mean, pl.mean_kind) == (D("0.0999"), D("0.24"), D("0.1258"), "weighted average")
    assert by["New Car Loans"].category == "auto_loan" and by["Used Car Loans"].category is None


def test_a_changed_page_means_the_lender_is_left_out():
    for src in rd.SOURCES:
        parsed = rd.parse(src, "<html><body><p>We have redesigned our website.</p></body></html>", src.url)
        assert parsed.rows == [] and parsed.rejected and "not readable" in parsed.rejected[0]["reason"]


def test_the_fetcher_records_source_and_time_and_never_carries_a_guess(tmp_path):
    def flaky(url):
        if "axis" in url:
            raise TimeoutError("timed out")
        return SAVED(url)
    doc = fetcher.collect(flaky, datetime(2026, 10, 8, 4, 0, tzinfo=timezone.utc))
    names = {x["lender_id"] for x in doc["lenders"]}
    assert "IN_AXIS" not in names and {"IN_SBI", "IN_HDFC", "IN_KOTAK", "IN_IDFC"} <= names
    miss = next(x for x in doc["missing"] if x["lender_id"] == "IN_AXIS")
    assert "TimeoutError" in miss["reason"] and "rows" not in miss
    for x in doc["lenders"]:
        assert x["source_url"].startswith("https://") and x["fetched_at"] == "2026-10-08T04:00:00Z"
    # Written once; the same figures again write nothing.
    data, web = tmp_path / "data", tmp_path / "web.json"
    first = fetcher.write(doc, data, web)
    assert first is not None and first.name == "2026-10-08.json" and web.read_text() == first.read_text()
    doc2 = fetcher.collect(flaky, datetime(2026, 10, 15, 4, 0, tzinfo=timezone.utc))
    assert fetcher.write(doc2, data, web) is None


def test_quarters_from_the_banks_own_words():
    assert rd.period("Apr 2026 to Jun 2026") == Q1
    assert rd.period("April 2026 to June 2026") == Q1
    assert rd.period("Apr'26 - Jun'26") == Q1
    assert rd.period("quarter ended June 30th, 2026") == Q1
    assert rd.period("Quarter ended on June-2026") == Q1
    assert rd.period("Q1 FY 2026-27") == Q1
    assert rd.period("...-for-the-quarter-q1-fy-26-27") == Q1
    assert rd.period("Q4 FY 2025-26") == (date(2026, 1, 1), date(2026, 3, 31))
    assert rd.period("Apr 2026 to Aug 2026") is None       # not a quarter
    assert rd.period_label(*Q1) == "Apr-Jun 2026 (Q1 FY 2026-27)"


def test_the_committed_data_comes_from_the_parsers():
    files = sorted((ROOT / "api" / "data" / "rate_disclosures").glob("*.json"))
    assert files, "no dated disclosures file"
    latest = json.loads(files[-1].read_text(encoding="utf-8"))
    web = json.loads((ROOT / "web" / "src" / "lib" / "rate-disclosures.json").read_text(encoding="utf-8"))
    assert web == latest, "the web copy must be the newest dated file"
    assert re.fullmatch(r"\d{4}-\d{2}-\d{2}", latest["as_of"]) and files[-1].stem == latest["as_of"]
    known = {s.lender_id: s for s in rd.SOURCES}
    for x in latest["lenders"]:
        assert x["lender_id"] in known and x["source_url"].startswith("https://")
        assert re.fullmatch(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z", x["fetched_at"])
        for row in x["rows"]:
            assert row["mean"] is not None and row["period_label"]
            lo, hi, mean = _d(row["min"]), _d(row["max"]), D(row["mean"])
            assert rd.LOW <= mean <= rd.HIGH
            if lo is not None:
                assert lo <= mean <= hi


def test_no_unsourced_bank_prepayment_fees_in_rate_cards():
    # The per-bank "industry norm" fees (2-5%) are gone: no bank has its own terms.
    for card in rate_cards._country_cards(Country.IN) + rate_cards._country_cards(Country.US):
        for f in ("home_loan_terms", "personal_loan_terms", "auto_loan_terms", "education_loan_terms"):
            assert getattr(card, f) is None, (card.name, f)
    for lt in (LoanType.HOME, LoanType.PERSONAL, LoanType.AUTO):
        t = rate_cards.lookup_loan_terms("", Country.IN, lt, rate_type="fixed")
        assert t.prepayment_penalty_pct is None and t.prepay_lock_in_months is None, lt
    src = Path(rate_cards.__file__).read_text(encoding="utf-8")
    assert 'norm(D("0.02")' not in src and 'norm(D("0.03")' not in src and 'norm(D("0.05")' not in src
