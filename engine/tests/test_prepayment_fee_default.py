"""Roadmap PR K: what a blank prepayment fee means, and the rate-card
suggestion never contradicting RBI's floating-rate rule.

RBI (Pre-payment Charges on Loans) Directions, 2025, RBI/2025-26/64,
DoR.MCS.REC.38/01.01.001/2025-26, July 2, 2025, para 5(i):
https://www.rbi.org.in/Scripts/NotificationUser.aspx?Id=12878&Mode=0
"""
from __future__ import annotations

import json
from decimal import Decimal as D
from pathlib import Path

from engine.models import Country, LoanType
from engine.prepayment_fee import ASSUMED_REASON, RBI_URL, UNKNOWN_REASON, prepayment_fee_default
from engine.rate_cards import lookup_loan_terms

ROOT = Path(__file__).resolve().parents[2]
TABLE = json.loads((ROOT / "engine" / "tests" / "fixtures" / "prepayment_fee_defaults.json").read_text(encoding="utf-8"))


def test_the_shared_table():
    # The same table the web test reads (web/tests/roadmap-k-fees.cjs).
    assert len(TABLE["cases"]) == 7 * 2 * 2
    for c in TABLE["cases"]:
        d = prepayment_fee_default(c["loan_type"], c["rate_type"], c["market"])
        assert (str(d.pct), d.status, d.reason) == (c["pct"], c["status"], c["reason"]), c


def test_floating_indian_loans_are_assumed_zero_and_cite_rbi():
    for lt in ("home_loan", "personal_loan", "auto_loan", "education_loan", "gold_loan", "bnpl"):
        d = prepayment_fee_default(lt, "floating", "IN")
        assert d.pct == 0 and d.status == "assumed" and "RBI" in d.reason and "2 July 2025" in d.reason
    assert "NotificationUser.aspx?Id=12878" in RBI_URL


def test_fixed_cards_and_us_loans_are_unknown_with_no_fee_assumed():
    for args in (("personal_loan", "fixed", "IN"), ("credit_card", "floating", "IN"), ("credit_card", "fixed", "IN"),
                 ("home_loan", "floating", "US"), ("auto_loan", "fixed", "US")):
        d = prepayment_fee_default(*args)
        assert d.pct == 0 and d.status == "unknown" and d.reason == UNKNOWN_REASON
        assert "loan agreement" in d.reason
    assert ASSUMED_REASON != UNKNOWN_REASON


def test_a_banks_curated_fee_never_overrides_rbi_on_a_floating_indian_loan():
    # rate_cards.py has per-bank "industry norm" personal-loan fees (3–5%).
    # On a floating-rate loan RBI bars the fee, so the suggestion is 0.
    for bank in ("SBI", "HDFC Bank", "ICICI Bank", "Axis Bank", "Kotak Mahindra", "PNB"):
        t = lookup_loan_terms(bank, Country.IN, LoanType.PERSONAL, rate_type="floating")
        assert t.prepayment_penalty_pct == D("0"), bank
    # Fixed rate: no rule fixes it, so the bank's indicative entry stands.
    assert lookup_loan_terms("HDFC Bank", Country.IN, LoanType.PERSONAL, rate_type="fixed").prepayment_penalty_pct > 0
