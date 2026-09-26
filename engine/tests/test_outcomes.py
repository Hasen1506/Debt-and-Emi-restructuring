"""Lender matching and the outcome scorecard (engine/lenders.py, engine/outcomes.py)."""
from decimal import Decimal

import pytest

from engine import lenders
from engine.models import Country
from engine.outcomes import (
    MIN_REPORTS, Outcome, OutcomeInputError, OutcomeReport, headline, make_report, score, scorecard,
)

D = Decimal


# ── lenders ─────────────────────────────────────────────────────────────────

@pytest.mark.parametrize("typed, expected", [
    ("HDFC Bank", "IN_HDFC"),
    ("hdfc", "IN_HDFC"),
    ("HDFC Bank Ltd.", "IN_HDFC"),
    ("  The HDFC Bank Limited ", "IN_HDFC"),
    ("State Bank of India", "IN_SBI"),
    ("SBI", "IN_SBI"),
    ("Bank of India", "IN_BOI"),
    ("Central Bank of India", "IN_CENTRAL_BANK"),
    ("Union Bank of India", "IN_UNION_BANK"),
    ("Punjab & Sind Bank", "IN_PUNJAB_AND_SIND"),
    ("Punjab National Bank", "IN_PNB"),
    ("J&K Bank", "IN_JANDK"),
    ("Kotak Mahindra Bank", "IN_KOTAK"),
    ("ICICI", "IN_ICICI"),
    ("idfc first bank", "IN_IDFC_FIRST"),
    ("Ujjivan Bank", "IN_UJJIVAN_SFB"),
])
def test_names_people_type_find_one_bank(typed, expected):
    assert lenders.resolve(typed).id == expected


@pytest.mark.parametrize("typed", [
    "", "   ", "Bank", "Fake Bank", "Totally Real Bank", "LIC Housing Finance", "KreditBee",
    "HDFC Bank Fake", "Indian", "Yes",
])
def test_unknown_names_find_none(typed):
    assert lenders.resolve(typed) is None


def test_only_india_for_now():
    assert lenders.resolve("HDFC Bank", Country.US) is None
    assert lenders.resolve(None) is None


def test_every_bank_resolves_by_its_own_name():
    for lender in lenders.all_lenders():
        assert lenders.resolve(lender.name) == lender
        assert lenders.by_id(lender.id) == lender


# ── one report ──────────────────────────────────────────────────────────────

def test_a_fixed_report():
    r = make_report("HDFC", Outcome.FIXED_FULL, 12, D("0.0925"), D("0.0850"))
    assert r.lender_id == "IN_HDFC" and r.rate_cut == D("0.0075") and not r.verified


def test_refused_and_no_reply_keep_no_new_rate():
    assert make_report("SBI", Outcome.REFUSED, 20, D("0.09"), None).rate_after is None
    assert make_report("SBI", Outcome.REFUSED, 20, D("0.09"), D("0.09")).rate_after is None
    assert make_report("SBI", Outcome.NO_REPLY, 45, D("0.09"), None).rate_cut is None


@pytest.mark.parametrize("args, field, words", [
    (("Fake Bank", Outcome.FIXED_FULL, 10, D("0.09"), D("0.085")), "lender", "banks on our list"),
    ((None, Outcome.FIXED_FULL, 10, D("0.09"), D("0.085")), "lender", "Pick your bank"),
    (("SBI", Outcome.FIXED_FULL, 10, D("0.30"), D("0.085")), "rate_before", "between 4% and 20%"),
    (("SBI", Outcome.FIXED_FULL, None, D("0.09"), D("0.085")), "days_taken", "Still needed"),
    (("SBI", Outcome.FIXED_FULL, 400, D("0.09"), D("0.085")), "days_taken", "between 0 and 365"),
    (("SBI", Outcome.FIXED_FULL, -1, D("0.09"), D("0.085")), "days_taken", "between 0 and 365"),
    (("SBI", Outcome.FIXED_FULL, 10, D("0.09"), None), "rate_after", "new rate"),
    (("SBI", Outcome.FIXED_PART, 10, D("0.09"), D("0.095")), "rate_after", "must be lower"),
    (("SBI", Outcome.FIXED_PART, 10, D("0.09"), D("0.09")), "rate_after", "must be lower"),
    (("SBI", Outcome.FIXED_FULL, 10, D("0.12"), D("0.08")), "rate_after", "unusual"),
    (("SBI", Outcome.REFUSED, 10, D("0.09"), D("0.085")), "rate_after", "Fixed in full"),
    (("SBI", Outcome.NO_REPLY, 12, D("0.09"), None), "days_taken", "30 days"),
])
def test_bad_reports_name_the_field(args, field, words):
    with pytest.raises(OutcomeInputError) as e:
        make_report(*args)
    assert e.value.field == field and words in e.value.message


# ── the scorecard ───────────────────────────────────────────────────────────

def _r(outcome, days, before="0.0925", after=None, lender="IN_HDFC"):
    return OutcomeReport(lender, outcome, days, D(before), D(after) if after else None)


def test_nothing_shown_below_five_reports():
    s = score("IN_HDFC", [_r(Outcome.FIXED_FULL, 10, after="0.085")] * (MIN_REPORTS - 1))
    assert s.reports == 4 and not s.shown
    assert s.fixed_in_full_pct is None and s.counts == {} and headline(s) is None


def test_figures_from_five_reports():
    rows = [
        _r(Outcome.FIXED_FULL, 10, after="0.0850"),     # cut 0.75
        _r(Outcome.FIXED_FULL, 14, after="0.0870"),     # cut 0.55
        _r(Outcome.FIXED_FULL, 12, after="0.0880"),     # cut 0.45
        _r(Outcome.FIXED_PART, 30, after="0.0900"),     # cut 0.25
        _r(Outcome.REFUSED, 25),
        _r(Outcome.NO_REPLY, 60),
    ]
    s = score("IN_HDFC", rows)
    assert s.shown and s.reports == 6
    assert s.counts == {"fixed_full": 3, "fixed_part": 1, "refused": 1, "no_reply": 1}
    assert s.fixed_in_full_pct == D("50") and s.fixed_any_pct == D("67")
    assert s.median_days == D("13")                      # of 10, 12, 14, 30
    assert s.median_rate_cut == D("0.0050")              # of 0.25, 0.45, 0.55, 0.75
    assert headline(s) == "HDFC Bank: 50% fixed in full · median 13 days · median rate cut 0.5%"


def test_the_roadmap_example():
    rows = ([_r(Outcome.FIXED_FULL, d, after="0.0870") for d in (8, 12, 12, 20)]
            + [_r(Outcome.REFUSED, 30)])
    assert headline(score("IN_HDFC", rows)) == (
        "HDFC Bank: 80% fixed in full · median 12 days · median rate cut 0.55%")


def test_no_fixes_means_no_medians():
    s = score("IN_SBI", [_r(Outcome.REFUSED, 20, lender="IN_SBI")] * 5)
    assert s.fixed_in_full_pct == D("0") and s.median_days is None and s.median_rate_cut is None
    assert headline(s) == "SBI: 0% fixed in full"


def test_scorecard_groups_by_lender():
    rows = [_r(Outcome.REFUSED, 20, lender="IN_SBI")] * 2 + [_r(Outcome.REFUSED, 20)] * 5
    card = scorecard(rows)
    assert card["IN_SBI"].reports == 2 and not card["IN_SBI"].shown
    assert card["IN_HDFC"].reports == 5 and card["IN_HDFC"].shown
