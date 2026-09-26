"""Loan Check — missed RBI rate cuts on floating-rate home loans."""
import random
from datetime import date
from decimal import Decimal

import pytest

from engine import policy_rates
from engine.loan_check import (
    Benchmark, LoanCheckInput, LoanCheckInputError, _inr, check_loan,
)
from engine.models import Country

D = Decimal
TODAY = date(2026, 9, 26)


def _inp(**kw) -> LoanCheckInput:
    base = dict(
        loan_start=date(2022, 1, 1), start_rate=D("0.0690"), current_rate=D("0.0890"),
        outstanding=D("4000000"), tenure_months_remaining=200, as_of=TODAY,
        benchmark=Benchmark.REPO,
    )
    base.update(kw)
    return LoanCheckInput(**base)


# ── policy-rate history ──────────────────────────────────────────────────────

def test_repo_history_lookup():
    assert policy_rates.rate_on(Country.IN, date(2018, 1, 1)) is None
    assert policy_rates.rate_on(Country.IN, date(2025, 12, 4)) == D("0.0550")
    assert policy_rates.rate_on(Country.IN, date(2025, 12, 5)) == D("0.0525")
    assert policy_rates.rate_on(Country.IN, TODAY) == D("0.0525")
    assert policy_rates.rate_on(Country.US, TODAY) == D("0.0400")


def test_repo_changes_between():
    ch = policy_rates.changes_between(Country.IN, date(2025, 1, 1), TODAY)
    assert [c[2] for c in ch] == [D("0.0625"), D("0.0600"), D("0.0550"), D("0.0525")]


def test_histories_are_sorted_and_plausible():
    for series in (policy_rates.REPO_RATE_IN, policy_rates.FED_FUNDS_UPPER_US):
        dates = [d for d, _ in series]
        assert dates == sorted(dates)
        assert all(D("0") <= r <= D("0.10") for _, r in series)


# ── missed rate cut ─────────────────────────────────────────────────────────

def test_missed_cut_found_and_counted_conservatively():
    r = check_loan(_inp(lender="HDFC Bank"))
    assert r.status == "issues_found"
    assert r.repo_at_start == D("0.0400")
    assert r.repo_reference_now == D("0.0525")
    assert r.expected_rate == D("0.0815")
    missed = [f for f in r.findings if f.kind == "missed_rate_cut"]
    assert len(missed) == 1
    f = missed[0]
    assert f.claimable and f.rate_gap == D("0.0075")
    # Counted from Apr 2026 (when the Dec 2025 cut left the 3-month window)
    # through Aug 2026: 5 whole months at today's balance.
    assert f.months_overcharged == 5
    assert f.overcharged_so_far == D("12500")
    assert r.claim_amount == D("12500")
    assert f.amount_this_year > 0
    assert f.citations, "every claimable finding cites its rule"


def test_last_reset_counts_further_back_month_by_month():
    r = check_loan(_inp(last_reset=date(2023, 6, 1)))
    f = r.findings[0]
    # Oct 2025–Mar 2026 at 0.50% over, Apr–Aug 2026 at 0.75% over.
    assert f.months_overcharged == 11
    assert f.overcharged_so_far == D("22500")


def test_cut_inside_reset_window_is_not_claimed_yet():
    # Jun 2025 cut to 5.50% is less than 3 months old on 15 Jul 2025;
    # the bank may not have reached its reset yet.
    r = check_loan(_inp(
        loan_start=date(2025, 1, 1), start_rate=D("0.0850"),
        current_rate=D("0.0825"), as_of=date(2025, 7, 15),
    ))
    assert r.repo_reference_now == D("0.0625")
    assert r.expected_rate == D("0.0825")
    assert r.status == "no_issue"
    assert r.claim_amount == 0


def test_rate_that_matches_is_no_issue():
    r = check_loan(_inp(current_rate=D("0.0815")))
    assert r.status == "no_issue"
    assert r.findings == []
    assert r.claim_amount == 0 and r.amount_at_stake_this_year == 0


def test_rate_below_expected_never_goes_negative():
    """Lost bug: 'Refund … estimated at −₹6,952'."""
    r = check_loan(_inp(current_rate=D("0.0790")))
    assert r.status == "no_issue"
    assert r.claim_amount == 0
    assert r.amount_at_stake_this_year == 0


def test_rise_without_repo_rise_is_flagged():
    r = check_loan(_inp(
        loan_start=date(2026, 1, 1), start_rate=D("0.0800"),
        current_rate=D("0.0850"), as_of=TODAY,
    ))
    f = r.findings[0]
    assert f.kind == "missed_rate_cut"
    assert "risen" in f.headline


# ── pricing gap is information, never a refund ──────────────────────────────

def test_pricing_gap_not_in_refund_claim():
    """Lost bug: the refund summed every finding, including 'you pay more
    than new borrowers', which a bank is not obliged to refund."""
    r = check_loan(_inp(lender="HDFC Bank"))
    kinds = {f.kind for f in r.findings}
    assert kinds == {"missed_rate_cut", "pricing_gap"}
    gap = next(f for f in r.findings if f.kind == "pricing_gap")
    assert not gap.claimable
    missed = next(f for f in r.findings if f.kind == "missed_rate_cut")
    assert r.claim_amount == missed.overcharged_so_far
    assert r.amount_at_stake_this_year == missed.amount_this_year


def test_pricing_gap_measured_after_fixing_missed_cut():
    r = check_loan(_inp(lender="HDFC Bank"))
    gap = next(f for f in r.findings if f.kind == "pricing_gap")
    # HDFC new-borrower low end is 7.75%; expected rate 8.15% → 0.40%,
    # not the 1.15% a naive current-minus-card comparison would give.
    assert gap.rate_gap == D("0.0040")


def test_pricing_gap_alone():
    r = check_loan(_inp(current_rate=D("0.0815"), lender="hdfc  bank"))
    assert [f.kind for f in r.findings] == ["pricing_gap"]
    assert r.status == "issues_found"
    assert r.claim_amount == 0 and r.amount_at_stake_this_year == 0


def test_unknown_lender_is_noted_not_guessed():
    r = check_loan(_inp(lender="Some Cooperative Bank"))
    assert all(f.kind != "pricing_gap" for f in r.findings)
    assert any("No rate card" in a for a in r.assumptions)


# ── benchmarks ──────────────────────────────────────────────────────────────

def test_pre_2019_unknown_benchmark_is_treated_as_mclr():
    r = check_loan(_inp(
        loan_start=date(2017, 5, 1), start_rate=D("0.0850"),
        current_rate=D("0.0960"), benchmark=Benchmark.UNKNOWN, lender="SBI",
    ))
    assert r.status == "not_applicable"
    assert r.findings[0].kind == "old_benchmark"
    assert r.claim_amount == 0
    assert r.findings[0].amount_this_year > 0   # 9.60% is above SBI's card


def test_post_2019_unknown_benchmark_assumes_repo():
    r = check_loan(_inp(benchmark=Benchmark.UNKNOWN))
    assert r.findings[0].kind == "missed_rate_cut"
    assert any("repo is assumed" in a for a in r.assumptions)


def test_repo_linked_before_july_2019_is_an_input_error():
    with pytest.raises(LoanCheckInputError, match="July 2019"):
        check_loan(_inp(loan_start=date(2018, 3, 1), start_rate=D("0.0850")))


# ── input validation: clear errors, never silent acceptance ────────────────

@pytest.mark.parametrize("kw, msg", [
    (dict(start_rate=D("8.55")), "percentage"),
    (dict(current_rate=D("9.5")), "percentage"),
    (dict(current_rate=D("0.000855")), "outside 1%"),
    (dict(start_rate=D("0.0300")), "below the RBI repo"),
    (dict(outstanding=D("0")), "Outstanding"),
    (dict(outstanding=D("1e30")), "Outstanding"),
    (dict(tenure_months_remaining=0), "Months left"),
    (dict(loan_start=date(2027, 1, 1)), "future"),
    (dict(last_reset=date(2021, 1, 1)), "before the loan"),
    (dict(emi=D("5000000")), "EMI"),
])
def test_bad_input_is_rejected(kw, msg):
    with pytest.raises(LoanCheckInputError, match=msg):
        check_loan(_inp(**kw))


def test_us_not_yet_supported():
    with pytest.raises(LoanCheckInputError, match="Indian"):
        check_loan(_inp(country=Country.US))


# ── property slice: 300 random loans ────────────────────────────────────────

def test_random_loans_never_negative_or_crash():
    rng = random.Random(20260926)
    months = []
    m = date(2019, 10, 1)
    while m <= date(2026, 9, 1):
        months.append(m)
        m = date(m.year + (m.month // 12), m.month % 12 + 1, 1)
    for _ in range(300):
        start = rng.choice(months)
        repo0 = policy_rates.rate_on(Country.IN, start)
        start_rate = (repo0 + D(rng.randint(150, 400)) / D("10000")).quantize(D("0.0001"))
        current = (D("0.0525") + D(rng.randint(100, 500)) / D("10000")).quantize(D("0.0001"))
        r = check_loan(LoanCheckInput(
            loan_start=start, start_rate=start_rate, current_rate=current,
            outstanding=D(rng.randint(100_000, 20_000_000)),
            tenure_months_remaining=rng.randint(1, 360), as_of=TODAY,
            lender=rng.choice([None, "SBI", "HDFC Bank", "ICICI Bank", "Nope Bank"]),
            benchmark=rng.choice(list(Benchmark)),
        ))
        assert r.claim_amount >= 0 and r.amount_at_stake_this_year >= 0
        for f in r.findings:
            assert f.amount_this_year >= 0 and f.overcharged_so_far >= 0
            assert f.rate_gap >= 0
            assert "−₹" not in f.detail and "-₹" not in f.detail
            if not f.claimable:
                assert f.overcharged_so_far == 0
        assert r.claim_amount == sum(
            (f.overcharged_so_far for f in r.findings if f.claimable), D("0"))


def test_inr_grouping():
    assert _inr(D("1234567")) == "₹12,34,567"
    assert _inr(D("999")) == "₹999"
    assert _inr(D("100000")) == "₹1,00,000"
    assert _inr(D("30767.4")) == "₹30,767"
