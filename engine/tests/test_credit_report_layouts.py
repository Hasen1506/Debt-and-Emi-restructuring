"""UX50 D-01: the credit-report reader handles the layouts bureau PDFs use, not
only "Label: value" lines, and never crashes on any text: it returns accounts
or a CreditReportReadError with a precise kind.

Fixtures in fixtures/credit_report/layouts/ are SYNTHETIC
(scripts/make_credit_report_layout_fixtures.py). cibil_tabular_live is the
synthetic PDF that failed live in the UX50 critique (ux50/D/samples).
"""
import json
import re
from pathlib import Path

import pytest
from hypothesis import HealthCheck, given, settings
from hypothesis import strategies as st

from engine import credit_report as cr
from engine.pdf_text import read_pdf_text

L = Path(__file__).parent / "fixtures" / "credit_report" / "layouts"
EXPECTED = json.loads((L / "expected.json").read_text(encoding="utf-8"))


def _loans(text):
    d = cr.to_dict(cr.read_credit_report(text))
    return d, [a["loan"] for a in d["accounts"] if a["loan"]]


def _check(loans):
    assert len(loans) == len(EXPECTED)
    for got, want in zip(loans, EXPECTED):
        for k, v in want.items():
            assert got[k] == v, (k, got, want)


@pytest.mark.parametrize("name,bureau", [
    ("cibil_table", "cibil"), ("experian_pipes", "experian"),
    ("equifax_stacked", "equifax"), ("crif_columns", "crif"),
])
def test_each_layout_reads_the_same_accounts(name, bureau):
    d, loans = _loans((L / f"{name}.synthetic.txt").read_text(encoding="utf-8"))
    assert d["bureau"] == bureau
    _check(loans)
    closed = [a for a in d["accounts"] if a["fields"]["lender"]["value"] == "OLD AUTO FINANCE"]
    assert closed and closed[0]["is_open"] is False and closed[0]["loan"] is None
    assert not any("ANOTHER BANK" in a["fields"]["lender"]["value"] for a in d["accounts"])  # enquiry


@pytest.mark.parametrize("name", ["cibil_table", "experian_table"])
@pytest.mark.parametrize("layout", [True, False])
def test_table_pdfs_read_in_both_extraction_modes(name, layout):
    text = read_pdf_text((L / f"{name}.synthetic.pdf").read_bytes(), None, layout=layout)
    _check(_loans(text)[1])


def test_the_pdf_that_failed_live_now_reads():
    text = read_pdf_text((L / "cibil_tabular_live.synthetic.pdf").read_bytes(), None)
    d, loans = _loans(text)
    assert [x["lender"] for x in loans] == ["SAMPLE HFC", "DEMO BANK"]
    assert loans[0]["outstanding"] == "3812450" and loans[0]["emi"] == "39500"
    card = loans[1]
    assert card["loan_type"] == "credit_card" and card["missing"] == ["nominal_rate"]  # D-07
    assert any("₹3,500 is shown overdue" in f for f in d["accounts"][1]["flags"])  # D-16


def test_table_sources_are_the_report_rows_with_numbers_masked():
    text = (L / "cibil_table.synthetic.txt").read_text(encoding="utf-8")
    d, _ = _loans(text)
    for a in d["accounts"]:
        for f in a["fields"].values():
            assert f["source"].split(" ")[0] in text  # a row of the report
            assert "HL00123456" not in f["source"] and "CD99887766" not in f["source"]
    assert any("XXXX3456" in f["source"] for f in d["accounts"][0]["fields"].values())


def test_no_accounts_message_is_honest():
    with pytest.raises(cr.CreditReportReadError) as e:
        cr.read_credit_report("TransUnion CIBIL report\nCIBIL SCORE: 742\nThis summary lists nothing else at all.")
    assert e.value.kind == "no_accounts"
    assert "on our side" in str(e.value) and "summary page" not in str(e.value)  # D-02


def test_inr_grouping():
    from decimal import Decimal as D
    assert cr.inr(D("3500")) == "₹3,500"
    assert cr.inr(D("3812450")) == "₹38,12,450"
    assert cr.inr(D("999")) == "₹999"
    assert cr.inr(D("100000.50")) == "₹1,00,000.50"


# ---------------------------------------------------------------- properties
LENDERS = st.from_regex(r"[A-Z]{3,10}( [A-Z]{2,8}){0,2}", fullmatch=True).filter(
    lambda s: not cr._norm_label(s) and not cr._SECTION_END.match(s))
TYPES = st.sampled_from(["Personal Loan", "Housing Loan", "Credit Card", "Auto Loan", "Education Loan", "Gold Loan"])
AMOUNTS = st.integers(min_value=1, max_value=9_99_99_999)
ACCOUNT = st.tuples(LENDERS, TYPES, AMOUNTS, st.integers(min_value=0, max_value=2_00_000))


def _indian(n: int) -> str:
    return cr.inr(cr.D(n))[1:]


def _render(accounts, layout):
    head = ["Lender", "Account Type", "Current Balance", "EMI Amount"]
    rows = [[a, t, _indian(b), _indian(e) if e else "-"] for a, t, b, e in accounts]
    if layout == "colon":
        return "\n".join(" | ".join(f"{h}: {v}" for h, v in zip(head, r)) for r in rows)
    if layout == "table":
        w = [max(len(x) for x in col) + 3 for col in zip(head, *rows)]
        return "\n".join("".join(c.ljust(x) for c, x in zip(r, w)).rstrip() for r in [head, *rows])
    if layout == "pipes":
        return "\n".join("| " + " | ".join(r) + " |" for r in [head, *rows])
    if layout == "columns":
        return "\n".join(head + [c for r in rows for c in r])
    return "\n".join(x for r in rows for h, v in zip(head, r) for x in (h, v))  # stacked pairs


@settings(max_examples=150, deadline=None, suppress_health_check=[HealthCheck.too_slow])
@given(st.lists(ACCOUNT, min_size=1, max_size=6), st.sampled_from(["colon", "table", "pipes", "columns", "pairs"]))
def test_property_every_layout_round_trips(accounts, layout):
    text = "TransUnion CIBIL Consumer Credit Report\nReport Date 05-10-2026\n" + _render(accounts, layout)
    d = cr.to_dict(cr.read_credit_report(text))
    got = [(a["fields"]["lender"]["value"], a["fields"]["balance"]["value"]) for a in d["accounts"]]
    assert got == [(a, str(b)) for a, _, b, _ in accounts]


@settings(max_examples=300, deadline=None)
@given(st.text(max_size=3000))
def test_property_any_text_returns_accounts_or_a_precise_reason(text):
    try:
        d = cr.to_dict(cr.read_credit_report(text))
        assert d["accounts"]
    except cr.CreditReportReadError as e:
        assert e.kind in {"empty", "no_accounts", "too_big"} and str(e)


LINES = st.lists(st.one_of(
    st.sampled_from([h for hs in cr.LABELS.values() for h in hs]).map(str.title),
    st.sampled_from(["Lender  Account Type  Current Balance", "| Lender | EMI | Balance |", "Enquiries", "Closed", "-", "0"]),
    st.from_regex(r"[A-Za-z0-9 ,.:|/-]{0,40}", fullmatch=True),
), max_size=80)


@settings(max_examples=300, deadline=None)
@given(LINES)
def test_property_label_soup_never_crashes(lines):
    try:
        cr.to_dict(cr.read_credit_report("CIBIL\n" + "\n".join(lines) + "\n" + "x" * 40))
    except cr.CreditReportReadError as e:
        assert e.kind in {"empty", "no_accounts", "too_big"}
