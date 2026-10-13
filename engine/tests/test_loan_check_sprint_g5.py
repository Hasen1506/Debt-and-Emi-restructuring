"""Loan Check regressions from the Oct 2026 live test (L#7–L#10, L#28) and
the critique (#5 reset watch, #40 lender type), Sprint G5.

The live-test loan: SBI, ₹30L, started Mar 2022 at 9.15%, now 9.15%,
repo-linked, "one rate" mode.
"""
from datetime import date
from decimal import Decimal

import pytest

from engine.lenders import LenderType, resolve, resolve_bank
from engine.loan_check import (
    Benchmark, LoanCheckInput, LoanCheckInputError, SpreadChange, check_loan,
)

D = Decimal
TODAY = date(2026, 10, 12)


def live(**kw) -> LoanCheckInput:
    base = dict(
        loan_start=date(2022, 3, 1), start_rate=D("0.0915"), current_rate=D("0.0915"),
        outstanding=D("3000000"), tenure_months_remaining=200, as_of=TODAY,
        benchmark=Benchmark.REPO,
    )
    base.update(kw)
    return LoanCheckInput(**base)


CUT = dict(loan_start=date(2024, 1, 1), start_rate=D("0.0900"), current_rate=D("0.0950"),
           lender_type=LenderType.COMMERCIAL_BANK, last_reset=date(2025, 1, 1))


# ── L#7: a negative gap is good news, said plainly ─────────────────────────

def test_negative_gap_is_in_your_favour_not_a_conversation():
    r = check_loan(live(lender="SBI"))
    assert r.gap < 0 and r.verdict == "below_expected"
    assert r.status == "no_issue" and r.claim_amount == 0
    below = next(f for f in r.findings if f.kind == "below_expected")
    assert not below.claimable
    assert "in your favour" in below.detail and "nothing to claim" in below.detail
    assert "in your favour" in r.summary
    # The summary never claims the bank "passed on" changes it has not.
    assert "passed on" not in r.summary


def test_negative_gap_mentions_a_recent_repo_rise_still_inside_the_window():
    """Repo rose 5.25% → 5.50% on 7 Oct 2026; banks have three months to reset."""
    r = check_loan(live(lender="SBI", loan_start=date(2026, 1, 1),
                        start_rate=D("0.0800"), current_rate=D("0.0800")))
    below = next(f for f in r.findings if f.kind == "below_expected")
    assert "07 Oct 2026" in below.detail and "has not reached your loan yet" in below.detail


# ── L#8: same numbers, same verdict, whatever the lender name ──────────────

@pytest.mark.parametrize("name", ["SBI", "Some Bank I Typed", None])
def test_verdict_does_not_depend_on_the_bank_name(name):
    r = check_loan(live(lender=name, lender_type=LenderType.COMMERCIAL_BANK))
    assert (r.status, r.verdict) == ("no_issue", "below_expected")


def test_missing_rate_card_is_said_out_loud():
    r = check_loan(live(lender="Some Bank I Typed", lender_type=LenderType.COMMERCIAL_BANK))
    assert "We don't have a published new-borrower rate card for Some Bank I Typed" in r.new_borrower_note
    r = check_loan(live(lender="SBI"))
    assert "SBI publishes for new borrowers" in r.new_borrower_note
    assert "never changes the verdict" in r.new_borrower_note


def test_hfc_is_not_judged_by_the_bank_rule():
    r = check_loan(live(lender="LIC Housing Finance"))
    assert r.lender_type == LenderType.HFC and r.lender_type_source == "from_name"
    assert r.status == "not_applicable" and r.verdict == "rule_not_binding"
    assert not r.rule_applies and r.claim_amount == 0
    f = r.findings[0]
    assert f.kind == "rule_not_binding" and not f.claimable
    assert "housing finance company" in f.headline
    assert "National Housing Bank" in f.next_step and "GRIDS" in f.next_step
    assert "60 days" in f.detail
    assert all(c.verified_against_text for c in f.citations)


def test_hfc_with_a_missed_cut_still_gets_no_refund_claim():
    """Same numbers that give a bank a refund claim: an HFC gets information only."""
    bank = check_loan(live(**CUT))
    assert bank.verdict == "missed_rate_cut" and bank.claim_amount > 0
    hfc = check_loan(live(loan_start=date(2024, 1, 1), start_rate=D("0.0900"),
                          current_rate=D("0.0950"), lender="My Local Housing Co",
                          lender_type=LenderType.HFC))
    assert hfc.verdict == "rule_not_binding" and hfc.claim_amount == 0
    assert "above that" in hfc.findings[0].detail


@pytest.mark.parametrize("kind", [LenderType.NBFC, LenderType.COOPERATIVE_BANK, LenderType.REGIONAL_RURAL_BANK])
def test_other_unbound_lenders(kind):
    r = check_loan(live(lender="Lender X", lender_type=kind))
    assert r.verdict == "rule_not_binding" and not r.findings[0].claimable


def test_small_finance_bank_is_bound():
    r = check_loan(live(lender="AU SFB", loan_start=date(2024, 1, 1),
                        start_rate=D("0.0900"), current_rate=D("0.0950")))
    assert r.lender_type == LenderType.SMALL_FINANCE_BANK and r.verdict == "missed_rate_cut"


# ── L#10: the lender picker can't be contradicted silently ─────────────────

def test_name_and_type_must_agree():
    with pytest.raises(LoanCheckInputError) as e:
        check_loan(live(lender="SBI", lender_type=LenderType.HFC))
    assert e.value.field == "lender_type"
    with pytest.raises(LoanCheckInputError):
        check_loan(live(lender="PNB Housing", lender_type=LenderType.COMMERCIAL_BANK))


def test_unknown_type_is_an_explicit_assumption():
    r = check_loan(live(lender="Mystery Lender"))
    assert r.lender_type_source == "assumed"
    assert any("lender type was not given" in a for a in r.assumptions)


def test_outcome_reports_stay_bank_only():
    assert resolve("LIC HFL").type == LenderType.HFC
    assert resolve_bank("LIC HFL") is None
    assert resolve_bank("hdfc").name == "HDFC Bank"


# ── L#9: the spread question ────────────────────────────────────────────────


def test_spread_rise_reduces_the_gap():
    base = check_loan(live(**CUT, spread_changed=SpreadChange.NO))
    raised = check_loan(live(**CUT, spread_changed=SpreadChange.YES, spread_change=D("0.0025")))
    assert raised.expected_rate == base.expected_rate + D("0.0025")
    assert raised.gap == base.gap - D("0.0025")
    assert raised.claim_amount < base.claim_amount
    assert any("raised your spread by 0.25%" in a for a in raised.assumptions)
    assert any("has not changed your spread" in a for a in base.assumptions)


def test_spread_rise_that_explains_the_whole_gap_means_no_claim():
    full = check_loan(live(**CUT, spread_changed=SpreadChange.NO))
    r = check_loan(live(**CUT, spread_changed=SpreadChange.YES, spread_change=full.gap))
    assert r.verdict == "matches" and r.claim_amount == 0


def test_unsure_spread_is_said_and_asked():
    r = check_loan(live(**CUT))
    assert any("not sure whether your spread changed" in a for a in r.assumptions)


def test_spread_yes_needs_an_amount():
    with pytest.raises(LoanCheckInputError) as e:
        check_loan(live(**CUT, spread_changed=SpreadChange.YES))
    assert e.value.field == "spread_change"
    with pytest.raises(LoanCheckInputError):
        check_loan(live(**CUT, spread_changed=SpreadChange.NO, spread_change=D("0.001")))
    with pytest.raises(LoanCheckInputError):
        check_loan(live(**CUT, spread_changed=SpreadChange.YES, spread_change=D("0.25")))


# ── L#28: the ₹ figure carries its framing next to it ──────────────────────

def test_rupee_figures_are_framed_as_estimates():
    r = check_loan(live(**{**CUT, "lender_type": LenderType.UNKNOWN}, lender="HDFC Bank"))
    for f in r.findings:
        if f.amount_this_year > 0:
            assert "estimate for your own conversation with the bank" in f.detail, f.kind
    missed = next(f for f in r.findings if f.kind == "missed_rate_cut")
    assert "not a confirmed refund" in missed.detail
    assert "An estimated" in r.summary


# ── #5: reset watch ─────────────────────────────────────────────────────────

def test_reset_watch_after_the_october_2026_hike():
    r = check_loan(live(lender="SBI", next_policy_meeting=date(2026, 12, 4)))
    w = r.reset_watch
    assert w.last_change == date(2026, 10, 7)
    assert w.last_change_from == D("0.0525") and w.last_change_to == D("0.0550")
    assert w.check_by == date(2027, 1, 6)
    assert "04 Dec 2026" in w.detail
    assert all(c.verified_against_text for c in w.citations)


def test_reset_watch_mclr_uses_last_reset():
    r = check_loan(live(lender="SBI", benchmark=Benchmark.MCLR, last_reset=date(2026, 4, 1)))
    assert r.reset_watch.check_by == date(2027, 4, 1)


def test_reset_watch_for_hfc_has_no_bank_deadline():
    r = check_loan(live(lender="LIC Housing Finance"))
    assert r.reset_watch.check_by is None
    assert "immediately" in r.reset_watch.detail


def test_old_benchmark_cites_the_no_fee_switch():
    r = check_loan(live(lender="SBI", benchmark=Benchmark.MCLR))
    f = r.findings[0]
    assert {c.paragraph for c in f.citations} >= {"paragraph 41, first and second provisos"}
    assert "reasonable administrative or legal costs" in f.next_step
