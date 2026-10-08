"""Roadmap PR G: reading a Key Facts Statement (or sanction letter).

Fixtures in fixtures/kfs/ are SYNTHETIC documents laid out with the field
labels of the RBI KFS template (Annex A of RBI/2024-25/18, 15 Apr 2024),
written by scripts/make_kfs_fixtures.py. annex_b is RBI's own worked example
(Annex B: ₹20,000 at 15% for 24 months, EMI ₹970, ₹400 of charges, APR 17.07%).
"""
import json
import re
from datetime import date
from decimal import Decimal as D
from pathlib import Path

import pytest

from engine import kfs
from engine.formulas import remaining_balance

F = Path(__file__).parent / "fixtures" / "kfs"
EXPECTED = json.loads((F / "expected.json").read_text(encoding="utf-8"))
TODAY = date(2026, 10, 8)
BANNER = "SYNTHETIC SAMPLE - not a real loan document"


def _read(name: str, as_of: date = TODAY) -> kfs.KfsResult:
    return kfs.read_kfs((F / f"{name}.synthetic.txt").read_text(encoding="utf-8"), as_of=as_of)


def _same(got, want) -> bool:
    if got is None:
        return False
    try:
        return D(got) == D(want)
    except Exception:  # noqa: BLE001
        return got == want


@pytest.mark.parametrize("name", sorted(EXPECTED))
def test_every_field_is_read_with_its_source_line(name):
    res = _read(name)
    for key, want in EXPECTED[name].items():
        f = res.fields.get(key)
        assert f is not None, f"{name}: {key} not read"
        assert _same(f.value, want), f"{name}: {key} = {f.value}, want {want}"
        # The source is a line of the document, for "from your KFS: <line>".
        assert f.source and f.source in (F / f"{name}.synthetic.txt").read_text(encoding="utf-8"), (name, key)


def test_rbi_annex_b_example_checks_out():
    res = _read("annex_b")
    checks = {c.kind: c for c in res.checks}
    assert checks["emi"].ok and D(checks["emi"].computed) == D("969.73")
    assert checks["apr"].ok
    assert D(checks["apr"].computed).quantize(D("0.0001")) == D("0.1707")
    assert "checks out" in checks["apr"].message


def test_a_mismatch_is_said_in_plain_words():
    res = _read("mismatch")
    checks = {c.kind: c for c in res.checks}
    emi, apr = checks["emi"], checks["apr"]
    assert not emi.ok and D(emi.computed) == D("9964.29")
    assert "doesn't match" in emi.message and "₹10,500" in emi.message and "₹9,964" in emi.message
    assert not apr.ok and D(apr.stated) == D("0.155")
    # Stated APR above what the listed fees explain: undisclosed charges, said plainly.
    assert "higher than" in apr.message and "charges the KFS doesn't list" in apr.message
    assert "consent" in apr.message


def test_floating_rate_benchmark_plus_spread():
    res = _read("home_floating")
    spread = next(c for c in res.checks if c.kind == "spread")
    assert spread.ok
    bad = (F / "home_floating.synthetic.txt").read_text(encoding="utf-8").replace(
        "RBI Repo Rate 5.25 2.75 8.00", "RBI Repo Rate 5.25 2.75 8.25")
    res2 = kfs.read_kfs(bad, as_of=TODAY)
    spread2 = next(c for c in res2.checks if c.kind == "spread")
    assert not spread2.ok and "not the 8.25% stated" in spread2.message
    assert any("8.25%" in w and "8%" in w for w in res2.warnings)


def test_the_loan_the_form_would_fill_in():
    res = _read("personal_fixed")
    loan = res.loan
    assert loan["bank"] == "Sample Bank Limited"
    assert loan["loan_type"] == "personal_loan" and loan["rate_type"] == "fixed"
    assert D(loan["nominal_rate"]) == D("0.135")
    # The KFS prepayment charge fills the fee (and so overrides PR K's default).
    assert D(loan["prepayment_penalty_pct"]) == D("0.04")
    # ₹10,000 over 5 years: 0.4% a year, worked out and said so.
    assert D(loan["processing_fee_amortised"]) == D("0.004")
    assert "spread over 60 months" in res.derived["processing_fee_amortised"]
    # First EMI on 5 Nov 2026 is still ahead: the whole amount is owed, EMIs start in November.
    assert D(loan["outstanding"]) == D("500000") and loan["first_emi_month"] == "2026-11"
    # A floating-rate home loan with "Nil" foreclosure charges gets 0.
    assert D(_read("home_floating").loan["prepayment_penalty_pct"]) == 0


def test_an_older_loan_gets_todays_balance_from_its_schedule():
    res = _read("sanction_letter")
    loan = res.loan
    # First EMI 5 Apr 2023; by 8 Oct 2026, 43 EMIs have fallen due.
    assert loan["tenure_months_remaining"] == "17"
    want = remaining_balance(D("800000"), D("0.0925"), 60, 43)
    assert D(loan["outstanding"]) == want.quantize(D("0.01"))
    assert "43 EMIs" in res.derived["outstanding"] and "latest statement" in res.derived["outstanding"]
    assert not res.is_kfs and any("Key Facts Statement" in w for w in res.warnings)


def test_the_pdf_reads_the_same_as_the_text():
    text = kfs.pdf_text((F / "personal_fixed.synthetic.pdf").read_bytes())
    assert BANNER in text
    res = kfs.read_kfs(text, as_of=TODAY)
    for key, want in EXPECTED["personal_fixed"].items():
        assert _same(res.fields[key].value, want), key
    assert all(c.ok for c in res.checks)


def test_unreadable_documents_get_a_plain_answer():
    with pytest.raises(kfs.KfsReadError, match="scan"):
        kfs.pdf_text((F / "scanned.synthetic.pdf").read_bytes())
    with pytest.raises(kfs.KfsReadError, match="not a PDF"):
        kfs.pdf_text(b"hello, not a pdf")
    with pytest.raises(kfs.KfsReadError, match="too little text"):
        kfs.read_kfs("Loan", as_of=TODAY)
    with pytest.raises(kfs.KfsReadError, match="No loan terms"):
        kfs.read_kfs("Dear customer,\nThank you for banking with us.\nRegards", as_of=TODAY)


def test_fixtures_are_labelled_synthetic():
    for p in F.glob("*.synthetic.txt"):
        assert p.read_text(encoding="utf-8").startswith(BANNER), p.name


def test_parsing_is_local():
    """No outside service or AI model: the parser imports nothing that talks to a network."""
    src = Path(kfs.__file__).read_text(encoding="utf-8")
    for mod in ("urllib", "requests", "httpx", "socket", "openai", "anthropic", "google"):
        assert not re.search(rf"^\s*(?:import|from)\s+{mod}\b", src, re.M), mod
