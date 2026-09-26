"""India complaint letters: grievance, Internal Ombudsman follow-up, RBI Ombudsman."""
from datetime import date
from decimal import Decimal

import pytest

from engine.complaint_deadlines import Reply, india_timeline
from engine.complaints_in import (
    ACCOUNT, BANK_NAME, NAME, Borrower, NothingToClaim, grievance_letter,
    io_followup_letter, ombudsman_complaint, stray_you,
)
from engine.loan_check import Benchmark, LoanCheckInput, check_loan

D = Decimal
TODAY = date(2026, 9, 26)


def _inp(**kw) -> LoanCheckInput:
    base = dict(
        loan_start=date(2022, 1, 1), start_rate=D("0.0690"), current_rate=D("0.0890"),
        outstanding=D("4000000"), tenure_months_remaining=200, as_of=TODAY,
        benchmark=Benchmark.REPO, lender="HDFC Bank",
    )
    base.update(kw)
    return LoanCheckInput(**base)


def _letter(**kw):
    inp = _inp(**kw)
    return inp, check_loan(inp), grievance_letter(inp, check_loan(inp), sent_on=TODAY)


# ── grievance letter ────────────────────────────────────────────────────────

def test_claims_only_the_missed_rate_cut():
    """Lost bug: the refund summed every finding, pricing gap included."""
    inp, r, letter = _letter()
    assert {f.kind for f in r.findings} == {"missed_rate_cut", "pricing_gap"}
    missed = next(f for f in r.findings if f.kind == "missed_rate_cut")
    assert letter.claim_amount == missed.overcharged_so_far == D("12500")
    text = letter.text()
    assert "new borrowers" not in text.lower()
    assert "₹12,500" in text and "8.15%" in text
    assert "7.75%" not in text   # HDFC's new-borrower rate never appears


def test_annexure_adds_up_to_the_claim():
    inp, r, letter = _letter(last_reset=date(2023, 6, 1))
    assert len(letter.annexure) == 11
    total = sum(D(row.excess.replace("₹", "").replace(",", "")) for row in letter.annexure)
    assert total == letter.claim_amount == D("22496")
    assert letter.annexure_total == "₹22,496"


def test_no_you_anywhere_in_the_letter():
    _, _, letter = _letter()
    assert stray_you(letter.text()) is None
    assert stray_you("Thank you.") == "you"
    assert stray_you("Your rate is high.") == "Your"


def test_placeholders_until_borrower_given():
    _, _, letter = _letter()
    text = letter.text()
    assert NAME in text and ACCOUNT in text
    inp = _inp()
    r = check_loan(inp)
    filled = grievance_letter(
        inp, r, Borrower(name="A. Kumar", account="HL0042", phone="98xxxxxx01",
                         email="a@example.com", address="Pune"),
        sent_on=TODAY,
    ).text()
    assert "[" not in filled
    assert "home loan account HL0042" in filled and "A. Kumar" in filled


def test_unknown_lender_gets_placeholder_and_no_pricing_talk():
    _, _, letter = _letter(lender=None, loan_start=date(2024, 1, 1), start_rate=D("0.0900"))
    assert letter.recipient[-1] == BANK_NAME
    assert "cuts not passed on" in letter.subject


def test_unknown_benchmark_is_explained_in_the_letter():
    _, _, letter = _letter(benchmark=Benchmark.UNKNOWN)
    assert "treats that benchmark as the RBI policy repo rate" in letter.text()


def test_recent_cut_left_out_is_said_plainly():
    # 5 Dec 2025 cut to 5.25% is inside the reset window on 15 Jan 2026.
    inp, r, letter = _letter(as_of=date(2026, 1, 15), loan_start=date(2024, 1, 1), start_rate=D("0.0900"),
                             current_rate=D("0.0900"))
    assert r.repo_today < r.repo_reference_now
    assert "the most recent cut, to 5.25%, is left out" in letter.text()


def test_gap_without_whole_months_asks_for_reset_only():
    _, r, letter = _letter(last_reset=date(2026, 9, 1))
    assert letter.claim_amount == 0
    assert not letter.annexure
    assert not any("Refund" in q for q in letter.requests)
    assert letter.requests[0].startswith("Reset the rate on this loan to 8.15%")


@pytest.mark.parametrize("kw, msg", [
    (dict(current_rate=D("0.0815")), "new borrowers"),                        # pricing gap only
    (dict(current_rate=D("0.0815"), lender="Nope Bank"), "matches"),          # nothing at all
    (dict(loan_start=date(2017, 5, 1), start_rate=D("0.0850"), current_rate=D("0.0960"),
          benchmark=Benchmark.UNKNOWN, lender="SBI"), "MCLR"),
])
def test_nothing_to_claim_says_why(kw, msg):
    inp = _inp(**kw)
    with pytest.raises(NothingToClaim, match=msg):
        grievance_letter(inp, check_loan(inp))


# ── Internal Ombudsman follow-up ────────────────────────────────────────────

def test_io_followup_names_the_decision_date():
    inp = _inp()
    r = check_loan(inp)
    letter = io_followup_letter(
        inp, r, sent_on=date(2026, 9, 1), reply=Reply.REJECTED, reply_on=date(2026, 9, 10),
        bank_reference="GRV-123",
    )
    text = letter.text()
    assert "GRV-123" in letter.subject
    assert "by 1 October 2026" in text
    assert "rejected it" in text
    assert stray_you(text) is None


def test_io_followup_only_for_rejections():
    inp = _inp()
    with pytest.raises(ValueError):
        io_followup_letter(inp, check_loan(inp), sent_on=TODAY, reply=Reply.FIXED, reply_on=TODAY)


# ── RBI Ombudsman complaint ────────────────────────────────────────────────

def test_ombudsman_complaint_is_prefilled_in_third_person():
    inp = _inp()
    r = check_loan(inp)
    t = india_timeline(date(2026, 8, 1), today=TODAY)
    c = ombudsman_complaint(inp, r, t, sent_on=date(2026, 8, 1))
    assert c.facts.startswith("The complainant holds home loan account")
    assert stray_you(c.facts + " " + c.relief) is None
    fields = {f.label: f.value for f in c.fields}
    assert fields["Name of the bank"] == "HDFC Bank"
    assert fields["Bank's reply"] == "No reply within 30 days"
    assert fields["Amount in dispute"] == "₹12,500"
    assert c.opens == date(2026, 9, 1)
    assert c.deadline == date(2026, 11, 29)
    assert any("cms.rbi.org.in" in h for h in c.how_to_file)
    assert c.claim_amount == D("12500")
