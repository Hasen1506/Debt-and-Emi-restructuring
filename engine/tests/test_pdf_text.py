"""Grill #18/#60: PDF text is read in a child process with a timeout, a page
cap before extraction, and an in-memory-only password."""
import json
from pathlib import Path

import pytest

from engine import kfs
from engine.pdf_text import MAX_PDF_BYTES, PdfTextError, read_pdf_text

K = Path(__file__).parent / "fixtures" / "kfs"
C = Path(__file__).parent / "fixtures" / "credit_report"
PASSWORDS = json.loads((C / "passwords.json").read_text(encoding="utf-8"))


def test_limits_apply_before_parsing():
    with pytest.raises(PdfTextError) as e:
        read_pdf_text(b"%PDF" + b"0" * MAX_PDF_BYTES)
    assert e.value.kind == "too_big"
    with pytest.raises(PdfTextError) as e:
        read_pdf_text(b"hello")
    assert e.value.kind == "not_pdf"


def test_a_slow_parse_is_cut_off():
    data = (K / "personal_fixed.synthetic.pdf").read_bytes()
    with pytest.raises(PdfTextError) as e:
        read_pdf_text(data, timeout=0.001)
    assert e.value.kind == "timeout"


def test_page_cap_reads_only_the_first_pages():
    data = (K / "personal_fixed.synthetic.pdf").read_bytes()
    with pytest.raises(PdfTextError) as e:
        read_pdf_text(data, max_pages=0)  # nothing read → looks like no text
    assert e.value.kind == "scan"


def test_kfs_password_pdf_opens_with_its_password_only():
    data = (K / "personal_fixed_locked.synthetic.pdf").read_bytes()
    with pytest.raises(kfs.KfsReadError) as e:
        kfs.pdf_text(data)
    assert e.value.kind == "needs_password"
    with pytest.raises(kfs.KfsReadError) as e:
        kfs.pdf_text(data, "nope")
    assert e.value.kind == "wrong_password"
    text = kfs.pdf_text(data, PASSWORDS["kfs_personal_fixed_locked"])
    assert kfs.read_kfs(text).fields["emi"].value == "11505"


def test_crash_in_child_is_one_plain_answer():
    with pytest.raises(PdfTextError) as e:
        read_pdf_text(b"%PDF-1.4\nnot really a pdf")
    assert e.value.kind == "unreadable"
