"""Grill #17/#56: reading a user-downloaded credit report (CIBIL, Experian,
CRIF High Mark, Equifax), password-aware, every field with its source line.

Fixtures in fixtures/credit_report/ are SYNTHETIC (scripts/make_credit_report_fixtures.py).
"""
import json
from datetime import date
from pathlib import Path

import pytest

from engine import credit_report as cr

F = Path(__file__).parent / "fixtures" / "credit_report"
TODAY = date(2026, 10, 12)
PASSWORDS = json.loads((F / "passwords.json").read_text(encoding="utf-8"))


def _read(name):
    return cr.to_dict(cr.read_credit_report((F / f"{name}.synthetic.txt").read_text(encoding="utf-8"), as_of=TODAY))


def _text(name):
    return (F / f"{name}.synthetic.txt").read_text(encoding="utf-8")


@pytest.mark.parametrize("name,bureau,score,open_loans", [
    ("cibil", "cibil", "742", 3),
    ("experian", "experian", "781", 2),
    ("crif", "crif", "705", 2),
    ("equifax", "equifax", "688", 1),
])
def test_each_bureau_is_recognised_with_score_and_accounts(name, bureau, score, open_loans):
    d = _read(name)
    assert d["bureau"] == bureau
    assert d["score"]["value"] == score
    assert d["open_loans"] == open_loans


@pytest.mark.parametrize("name", ["cibil", "experian", "crif", "equifax"])
def test_every_value_carries_a_line_of_the_report(name):
    text = cr.redact(_text(name))  # sources are lines of the report, with account numbers masked
    for a in _read(name)["accounts"]:
        for key, f in a["fields"].items():
            assert f["source"] in text, (name, key, f["source"])


def test_cibil_home_loan_is_read_field_by_field():
    home = _read("cibil")["accounts"][0]
    assert home["loan_type"] == "home_loan"
    assert home["loan"] == {
        "loan_type": "home_loan", "lender": "SAMPLE HOUSING FINANCE", "outstanding": "3812450",
        "emi": "39500", "nominal_rate": "0.0865", "tenure_months": "240", "sanctioned_amount": "4500000",
        "credit_limit": None, "opened": "2021-03-15", "account_last4": "3456",
        "missing": ["rate_type", "prepayment_fee"],
    }
    assert any("joint" in f.lower() for f in home["flags"])


def test_closed_accounts_and_enquiries_are_not_proposed_as_loans():
    d = _read("cibil")
    lenders = [a["fields"]["lender"]["value"] for a in d["accounts"]]
    assert "OLD AUTO FINANCE" in lenders
    old = d["accounts"][lenders.index("OLD AUTO FINANCE")]
    assert old["is_open"] is False and old["loan"] is None
    assert not any("ANOTHER BANK" in x for x in lenders)  # an enquiry is not a debt


def test_forgotten_small_debts_are_found():
    cibil = _read("cibil")
    consumer = [a for a in cibil["accounts"] if a["fields"]["lender"]["value"].startswith("QUICKPAY")][0]
    assert consumer["loan"]["loan_type"] == "personal_loan" and consumer["loan"]["emi"] == "3500"
    assert "consumer-durable" in consumer["fields"]["account_type"]["note"]
    bnpl = [a for a in _read("equifax")["accounts"] if a["loan_type"] == "bnpl"][0]
    assert bnpl["loan"]["outstanding"] == "6000"


def test_guarantor_written_off_settled_and_overdue_are_said_plainly():
    exp = _read("experian")
    g = [a for a in exp["accounts"] if a["is_guarantor"]][0]
    assert g["loan"] is None and "guarantor" in g["flags"][0]
    crif = _read("crif")["accounts"][1]
    assert any("written off" in f for f in crif["flags"]) and any("6300" in f for f in crif["flags"])
    eq = _read("equifax")["accounts"][0]
    assert eq["loan"] is None  # a business loan isn't a type RightDue plans
    assert any("settled" in f for f in eq["flags"])


def test_no_personal_details_and_masked_account_numbers():
    for name in ("cibil", "experian", "crif", "equifax"):
        blob = json.dumps(_read(name))
        for secret in ("AAAAA0000A", "BBBBB1111B", "01-01-1990", "02/02/1992", "HL0000123456", "TEST PERSON"):
            assert secret not in blob, (name, secret)
    acc = _read("cibil")["accounts"][0]["fields"]["account_number"]
    assert acc["value"] == "XXXX3456"


def test_stale_lender_reporting_is_flagged():
    edu = [a for a in _read("experian")["accounts"] if a["loan_type"] == "education_loan"][0]
    assert not any("four months" in f for f in edu["flags"])  # 31 Aug → 12 Oct is under 4 months
    d = cr.to_dict(cr.read_credit_report(_text("experian"), as_of=date(2027, 3, 1)))
    assert any("three months old" in w for w in d["warnings"])


def test_unknown_document_and_empty_text():
    with pytest.raises(cr.CreditReportReadError):
        cr.read_credit_report("hello")
    with pytest.raises(cr.CreditReportReadError) as e:
        cr.read_credit_report("This is a letter about something else entirely, with no accounts in it at all.")
    assert e.value.kind == "no_accounts"


def test_password_protected_pdf():
    data = (F / "cibil_locked.synthetic.pdf").read_bytes()
    with pytest.raises(cr.CreditReportReadError) as e:
        cr.pdf_text(data)
    assert e.value.kind == "needs_password" and "never kept" in str(e.value)
    with pytest.raises(cr.CreditReportReadError) as e:
        cr.pdf_text(data, "wrong")
    assert e.value.kind == "wrong_password"
    text = cr.pdf_text(data, PASSWORDS["cibil_locked"])
    assert cr.to_dict(cr.read_credit_report(text, as_of=TODAY))["open_loans"] == 3


# Property: on any text, the reader either reads accounts or raises its own
# plain error, and never echoes a PAN or a full account number.
from hypothesis import given, settings, strategies as st  # noqa: E402

_LINE = st.one_of(
    st.text(max_size=60),
    st.sampled_from([
        "MEMBER NAME: X BANK ACCOUNT TYPE: PERSONAL LOAN", "ACCOUNT NUMBER: PL123456789 OWNERSHIP: INDIVIDUAL",
        "CURRENT BALANCE: 1,00,000 EMI: 5,000", "PAN: ABCDE1234F", "CLOSED: 01-01-2020", "Status: Settled",
        "Lender: Y | Type: Gold Loan | Acct No: GL99887766", "ENQUIRIES", "Interest Rate: 99",
    ]),
)


@settings(max_examples=150, deadline=None)
@given(st.lists(_LINE, max_size=30))
def test_never_crashes_and_never_leaks(lines):
    text = "\n".join(lines)
    try:
        d = cr.to_dict(cr.read_credit_report(text, as_of=TODAY))
    except cr.CreditReportReadError:
        return
    blob = json.dumps(d)
    assert "ABCDE1234F" not in blob
    assert "PL123456789" not in blob and "GL99887766" not in blob
    for a in d["accounts"]:
        if a["loan"] and a["loan"]["nominal_rate"]:
            assert 0 <= float(a["loan"]["nominal_rate"]) <= 0.6
