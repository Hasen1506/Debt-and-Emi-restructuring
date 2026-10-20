"""POST /api/loan-check — has a floating-rate home loan passed on RBI rate cuts?

Input problems come back as 422 with a single, user-facing message:
    {"detail": {"field": "loan_start", "message": "..."}}
Nothing is silently skipped: a month the server can't read is an error,
never a quietly missing finding. (A lost bug did exactly that: "03/2019"
typed into a Firefox month box made the rate-cut finding disappear.)
"""
import json
import re
from datetime import date, timedelta
from decimal import Decimal
from pathlib import Path
from typing import Literal, Optional

from fastapi import APIRouter, HTTPException
from pydantic import Field

from api import rates_feed
from api.schemas import _Base
from engine import lenders as lender_registry
from engine.lenders import LenderType
from engine import policy_rates
from engine.loan_check import (
    BankAction, Benchmark, ChoiceOffered, LoanCheckInput, LoanCheckInputError, LoanCheckResult,
    SpreadChange, TOLERANCE, check_loan,
)
from engine.rate_reset import rate_move_impact
from engine.models import Country

D = Decimal
router = APIRouter(tags=["loan-check"])

_MONTH_RE = re.compile(r"^(\d{4})-(0[1-9]|1[0-2])$")
_DATE_RE = re.compile(r"^(\d{4})-(0[1-9]|1[0-2])-(\d{2})$")


class LoanCheckRequest(_Base):
    country: Literal["IN"] = "IN"
    lender: Optional[str] = Field(None, max_length=120)
    loan_start: str                        # "YYYY-MM"
    # Either the headline starting rate, or benchmark + spread. Fractions.
    start_rate: Optional[Decimal] = None
    start_benchmark_rate: Optional[Decimal] = None
    start_spread: Optional[Decimal] = None
    current_rate: Decimal
    outstanding: Decimal
    tenure_months_remaining: int
    emi: Optional[Decimal] = None
    benchmark: Benchmark = Benchmark.UNKNOWN
    last_reset: Optional[str] = None       # "YYYY-MM"
    as_of: Optional[str] = None            # "YYYY-MM-DD"; defaults to today
    # What kind of lender (the screen always asks; a known name fills it in).
    lender_type: LenderType = LenderType.UNKNOWN
    # Has the bank changed the spread? With "yes", spread_change is the
    # change as a signed fraction (+0.0025 = raised by 0.25 points).
    spread_changed: SpreadChange = SpreadChange.UNSURE
    spread_change: Optional[Decimal] = None
    # Hike cycle (audit 80+ A11): what the lender did after the last rise,
    # and whether it offered the EMI / tenure / prepay choice.
    bank_action: BankAction = BankAction.UNKNOWN
    choice_offered: ChoiceOffered = ChoiceOffered.UNSURE
    # The borrower's rate history from statements, for the rises-vs-cuts check.
    rate_history: list["RateHistoryIn"] = Field(default_factory=list, max_length=60)
    # MCLR / base rate: the repo-linked rate the bank quotes for a switch, and its cost.
    switch_rate: Optional[Decimal] = None
    switch_cost: Optional[Decimal] = None


class RateHistoryIn(_Base):
    month: str                             # "YYYY-MM" the rate took effect
    rate: Decimal                          # fraction


LoanCheckRequest.model_rebuild()


class CitationOut(_Base):
    rule: str
    requirement: str
    source: str
    verified_against_text: bool
    clause: str = ""
    paragraph: str = ""
    url: str = ""
    checked_on: str = ""


class FindingOut(_Base):
    kind: str
    headline: str
    detail: str
    claimable: bool
    rate_gap: Decimal
    amount_this_year: Decimal
    overcharged_so_far: Decimal
    months_overcharged: int
    citations: list[CitationOut]
    next_step: str


class ResetWatchOut(_Base):
    headline: str
    detail: str
    check_by: Optional[str]
    last_change: Optional[str]
    last_change_from: Optional[Decimal]
    last_change_to: Optional[Decimal]
    next_meeting: Optional[str]
    citations: list[CitationOut]


class RepoChangeOut(_Base):
    date: str
    old_rate: Decimal
    new_rate: Decimal


class RateMoveOut(_Base):
    rate_before: Decimal
    rate_after: Decimal
    outstanding: Decimal
    emi_before: Decimal
    months_before: int
    interest_before: Decimal
    emi_after: Decimal
    emi_change: Decimal
    interest_emi_option: Decimal
    months_after: Optional[int]
    months_change: Optional[int]
    interest_tenure_option: Optional[Decimal]
    tenure_option_possible: bool
    prepay_to_keep_both: Decimal
    tenure_premium: Optional[Decimal]


class RateRiseOut(_Base):
    decided: str
    repo_from: Decimal
    repo_to: Decimal
    status: str                     # applied | pending | if_passed_on
    reach_by: Optional[str]
    impact: RateMoveOut


class SwitchOut(_Base):
    current_rate: Decimal
    switch_rate: Decimal
    switch_cost: Decimal
    interest_saved_12m: Decimal
    interest_saved_rest: Decimal
    net_saving_rest: Decimal
    months_saved: int
    payback_months: Optional[int]


class MoveReachedOut(_Base):
    decided: str
    repo_from: Decimal
    repo_to: Decimal
    reached: Optional[str]
    lag_months: Optional[int]
    late_months: int


class PassThroughOut(_Base):
    moves: list[MoveReachedOut]
    avg_rise_lag: Optional[Decimal]
    avg_cut_lag: Optional[Decimal]
    late_cuts: int
    late_cut_interest: Decimal
    asymmetric: bool
    notes: list[str]


class LoanCheckResponse(_Base):
    status: str
    summary: str
    findings: list[FindingOut]
    start_rate: Decimal
    expected_rate: Optional[Decimal]
    current_rate: Decimal
    repo_at_start: Optional[Decimal]
    repo_reference_now: Optional[Decimal]
    repo_today: Decimal
    repo_changes_since_start: list[RepoChangeOut]
    claim_amount: Decimal
    amount_at_stake_this_year: Decimal
    assumptions: list[str]
    rates_as_of: str
    rates_source: str
    stale_rates_warning: Optional[str]
    verdict: str
    gap: Optional[Decimal]
    lender_name: Optional[str]
    lender_type: str
    lender_type_source: str
    rule_applies: bool
    new_borrower_note: str
    reset_watch: Optional[ResetWatchOut]
    rate_rise: Optional[RateRiseOut] = None
    switch: Optional[SwitchOut] = None
    pass_through: Optional[PassThroughOut] = None


def bad(field: str, message: str) -> HTTPException:
    return HTTPException(status_code=422, detail={"field": field, "message": message})


def _parse_month(field: str, label: str, value: str) -> date:
    m = _MONTH_RE.match(value.strip())
    if not m:
        raise bad(field, f"{label} must be a month like 2021-03 (year-month). Got '{value}'.")
    year = int(m.group(1))
    if year < 1990:
        raise bad(field, f"{label} {value} is before 1990. Check the year.")
    return date(year, int(m.group(2)), 1)


def parse_date(field: str, value: str) -> date:
    m = _DATE_RE.match(value.strip())
    try:
        if not m:
            raise ValueError
        return date(int(m.group(1)), int(m.group(2)), int(m.group(3)))
    except ValueError:
        raise bad(field, f"{field} must be a date like 2026-09-26. Got '{value}'.")


def _check_fraction(field: str, label: str, value: Decimal, low: Decimal, high: Decimal) -> None:
    if value > 1:
        raise bad(field, f"{label} {value} looks like a percentage. Send it as a fraction (8.55% is 0.0855).")
    if not (low <= value <= high):
        raise bad(field, f"{label} must be between {low * 100}% and {high * 100}%. Got {value * 100}%.")


def _resolve_start_rate(req: LoanCheckRequest) -> Decimal:
    bench, spread = req.start_benchmark_rate, req.start_spread
    split_given = bench is not None or spread is not None
    if split_given and (bench is None or spread is None):
        missing = "start_spread" if spread is None else "start_benchmark_rate"
        label = "the spread over the benchmark" if spread is None else "the benchmark rate at the start"
        raise bad(missing, f"Still needed: {label}.")
    if split_given:
        _check_fraction("start_benchmark_rate", "Benchmark rate", bench, D("0.01"), D("0.20"))
        _check_fraction("start_spread", "Spread", spread, D("0"), D("0.10"))
        total = bench + spread
        if req.start_rate is not None and abs(req.start_rate - total) > TOLERANCE:
            raise bad(
                "start_rate",
                f"Starting rate {req.start_rate * 100}% does not match benchmark + spread "
                f"({total * 100}%). Enter one or the other.",
            )
        return total
    if req.start_rate is None:
        raise bad("start_rate", "Still needed: the starting rate (or benchmark + spread).")
    return req.start_rate


_CALENDAR = Path(__file__).parent.parent / "data" / "central_bank_calendar.json"


def next_rbi_meeting(today: date) -> Optional[date]:
    """The next scheduled MPC decision day on or after `today`, if published."""
    try:
        meetings = json.loads(_CALENDAR.read_text())["meetings"]["IN"]
        days = sorted(date.fromisoformat(m["date"]) for m in meetings)
    except (OSError, ValueError, KeyError):
        return None
    return next((d for d in days if d >= today), None)


def run_loan_check(req: LoanCheckRequest) -> tuple[LoanCheckInput, LoanCheckResult]:
    """Parse and check a request; input problems raise a 422 with the field."""
    loan_start = _parse_month("loan_start", "Loan start month", req.loan_start)
    last_reset = (
        _parse_month("last_reset", "Month the rate last changed", req.last_reset)
        if req.last_reset else None
    )
    as_of = parse_date("as_of", req.as_of) if req.as_of else date.today()
    start_rate = _resolve_start_rate(req)

    inp = LoanCheckInput(
        loan_start=loan_start,
        start_rate=start_rate,
        current_rate=req.current_rate,
        outstanding=req.outstanding,
        tenure_months_remaining=req.tenure_months_remaining,
        as_of=as_of,
        lender=req.lender,
        emi=req.emi,
        benchmark=req.benchmark,
        last_reset=last_reset,
        lender_type=req.lender_type,
        spread_changed=req.spread_changed,
        spread_change=req.spread_change,
        next_policy_meeting=next_rbi_meeting(as_of),
        bank_action=req.bank_action,
        choice_offered=req.choice_offered,
        rate_history=[
            (_parse_month("rate_history", "Rate change month", h.month), h.rate)
            for h in req.rate_history
        ],
        switch_rate=req.switch_rate,
        switch_cost=req.switch_cost,
    )
    for h in req.rate_history:
        if h.rate > 1:
            raise bad("rate_history", f"Rate {h.rate} looks like a percentage. Send it as a fraction (8.55% is 0.0855).")
    if req.switch_rate is not None and req.switch_rate > 1:
        raise bad("switch_rate", f"Rate {req.switch_rate} looks like a percentage. Send it as a fraction.")
    if req.spread_change is not None and abs(req.spread_change) >= 1:
        raise bad("spread_change", f"Spread change {req.spread_change} looks like a percentage. "
                                   f"Send it as a fraction (0.25 points is 0.0025).")
    try:
        return inp, check_loan(inp)
    except LoanCheckInputError as e:
        raise bad(e.field, str(e))


def citation_out(c) -> CitationOut:
    return CitationOut(
        rule=c.rule, requirement=c.requirement, source=c.source,
        verified_against_text=c.verified_against_text, clause=c.clause,
        paragraph=c.paragraph, url=c.url, checked_on=c.checked_on,
    )


def reset_watch_out(w) -> Optional[ResetWatchOut]:
    if w is None:
        return None
    iso = lambda d: d.isoformat() if d else None  # noqa: E731
    return ResetWatchOut(
        headline=w.headline, detail=w.detail, check_by=iso(w.check_by),
        last_change=iso(w.last_change), last_change_from=w.last_change_from,
        last_change_to=w.last_change_to, next_meeting=iso(w.next_meeting),
        citations=[citation_out(c) for c in w.citations],
    )


@router.post("/loan-check", response_model=LoanCheckResponse)
def loan_check(req: LoanCheckRequest) -> LoanCheckResponse:
    inp, result = run_loan_check(req)
    start_rate = inp.start_rate

    return LoanCheckResponse(
        status=result.status,
        summary=result.summary,
        findings=[
            FindingOut(
                kind=f.kind,
                headline=f.headline,
                detail=f.detail,
                claimable=f.claimable,
                rate_gap=f.rate_gap,
                amount_this_year=f.amount_this_year,
                overcharged_so_far=f.overcharged_so_far,
                months_overcharged=f.months_overcharged,
                citations=[citation_out(c) for c in f.citations],
                next_step=f.next_step,
            )
            for f in result.findings
        ],
        start_rate=start_rate,
        expected_rate=result.expected_rate,
        current_rate=req.current_rate,
        repo_at_start=result.repo_at_start,
        repo_reference_now=result.repo_reference_now,
        repo_today=result.repo_today,
        repo_changes_since_start=[
            RepoChangeOut(date=d.isoformat(), old_rate=o, new_rate=n)
            for d, o, n in result.repo_changes_since_start
        ],
        claim_amount=result.claim_amount,
        amount_at_stake_this_year=result.amount_at_stake_this_year,
        assumptions=result.assumptions,
        rates_as_of=result.rates_as_of.isoformat(),
        rates_source=rates_feed.source_label(Country.IN),
        stale_rates_warning=result.stale_rates_warning,
        verdict=result.verdict,
        gap=result.gap,
        lender_name=result.lender_name,
        lender_type=result.lender_type.value,
        lender_type_source=result.lender_type_source,
        rule_applies=result.rule_applies,
        new_borrower_note=result.new_borrower_note,
        reset_watch=reset_watch_out(result.reset_watch),
        rate_rise=rate_rise_out(result.rate_rise),
        switch=SwitchOut(**vars(result.switch)) if result.switch else None,
        pass_through=pass_through_out(result.pass_through),
    )


def _iso(d) -> Optional[str]:
    return d.isoformat() if d else None


def move_out(im) -> RateMoveOut:
    return RateMoveOut(**vars(im))


def rate_rise_out(rr) -> Optional[RateRiseOut]:
    if rr is None:
        return None
    return RateRiseOut(
        decided=rr.decided.isoformat(), repo_from=rr.repo_from, repo_to=rr.repo_to,
        status=rr.status, reach_by=_iso(rr.reach_by), impact=move_out(rr.impact),
    )


def pass_through_out(pt) -> Optional[PassThroughOut]:
    if pt is None:
        return None
    return PassThroughOut(
        moves=[
            MoveReachedOut(decided=m.decided.isoformat(), repo_from=m.repo_from, repo_to=m.repo_to,
                           reached=_iso(m.reached), lag_months=m.lag_months, late_months=m.late_months)
            for m in pt.moves
        ],
        avg_rise_lag=pt.avg_rise_lag, avg_cut_lag=pt.avg_cut_lag, late_cuts=pt.late_cuts,
        late_cut_interest=pt.late_cut_interest, asymmetric=pt.asymmetric, notes=pt.notes,
    )


# ─────────────────────────────────────────────────────────────────────────────
# Public "RBI decision: what happens to your EMI" page (audit 80+ A19)
# ─────────────────────────────────────────────────────────────────────────────

# Hypothetical next moves the page shows side by side. These are scenarios,
# not forecasts: RightDue shows no odds (prediction markets are blocked in
# India under the Promotion and Regulation of Online Gaming Act, 2025; see
# docs/LOAN-CHECK-HIKE-CYCLE.md).
NEXT_MOVE_SCENARIOS = (D("0"), D("0.0025"), D("0.0050"))


class RbiDecisionRequest(_Base):
    outstanding: Decimal = Field(gt=0, le=D("10000000000"))
    current_rate: Decimal = Field(ge=D("0.01"), le=D("0.30"))
    tenure_months_remaining: int = Field(ge=1, le=480)
    emi: Optional[Decimal] = Field(None, gt=0)
    # Has the last decision already reached the loan's rate?
    reached: Literal["yes", "no", "unsure"] = "unsure"
    as_of: Optional[str] = None            # "YYYY-MM-DD"; defaults to today


class DecisionOut(_Base):
    decided: str
    repo_from: Decimal
    repo_to: Decimal
    move: Decimal                          # signed
    source_url: str
    reach_by: str                          # decision + 91 days (3-month reset window)


class ScenarioOut(_Base):
    move: Decimal
    impact: Optional[RateMoveOut]          # None for "no change"


class RbiDecisionResponse(_Base):
    decision: DecisionOut
    applied_to: str                        # "rate_after" | "rate_before"
    impact: RateMoveOut
    next_meeting: Optional[str]
    scenarios: list[ScenarioOut]
    rates_as_of: str
    rates_source: str
    notes: list[str]


# Where each decision's text is on rbi.org.in (the calendar file names it).
_DECISION_SOURCES = {
    date(2026, 10, 7): "https://www.rbi.org.in/Scripts/BS_PressReleaseDisplay.aspx?prid=63742",
}


class RbiLatestResponse(_Base):
    decision: DecisionOut
    next_meeting: Optional[str]
    rates_as_of: str
    rates_source: str


def _latest_decision(as_of: date) -> DecisionOut:
    hist = [(d, r) for d, r in policy_rates.history(Country.IN) if d <= as_of]
    if len(hist) < 2:
        # Before the second recorded repo decision there is no move to apply (was an IndexError, a 500).
        raise bad("as_of", "No RBI repo rate change is on record before this date.")
    (last_day, last_rate), prev = hist[-1], hist[-2][1]
    return DecisionOut(
        decided=last_day.isoformat(), repo_from=prev, repo_to=last_rate, move=last_rate - prev,
        source_url=_DECISION_SOURCES.get(last_day, "https://www.rbi.org.in/Scripts/BS_PressReleaseDisplay.aspx"),
        reach_by=(last_day + timedelta(days=91)).isoformat(),
    )


@router.get("/rbi-decision/latest", response_model=RbiLatestResponse)
def rbi_decision_latest(as_of: Optional[str] = None) -> RbiLatestResponse:
    """The last RBI repo decision and the next meeting, for the public page's header."""
    day = parse_date("as_of", as_of) if as_of else date.today()
    return RbiLatestResponse(
        decision=_latest_decision(day), next_meeting=_iso(next_rbi_meeting(day)),
        rates_as_of=policy_rates.rates_as_of(Country.IN).isoformat(),
        rates_source=rates_feed.source_label(Country.IN),
    )


@router.post("/rbi-decision", response_model=RbiDecisionResponse)
def rbi_decision(req: RbiDecisionRequest) -> RbiDecisionResponse:
    """The last RBI repo decision applied to one loan, and the next meeting's
    possible moves, without sign-in. Runs the same reset arithmetic as Loan
    Check (engine/rate_reset.py)."""
    if req.current_rate > 1:
        raise bad("current_rate", "Send the rate as a fraction (8.55% is 0.0855).")
    as_of = parse_date("as_of", req.as_of) if req.as_of else date.today()
    hist = [(d, r) for d, r in policy_rates.history(Country.IN) if d <= as_of]
    if len(hist) < 2:
        # Before the second recorded repo decision there is no move to apply (was an IndexError, a 500).
        raise bad("as_of", "No RBI repo rate change is on record before this date.")
    (_last_day, last_rate), prev = hist[-1], hist[-2][1]
    move = last_rate - prev
    notes: list[str] = []
    if req.reached == "yes":
        before, after, applied = req.current_rate - move, req.current_rate, "rate_after"
        emi = None
    else:
        before, after, applied = req.current_rate, req.current_rate + move, "rate_before"
        emi = req.emi
        if req.reached == "unsure":
            notes.append(
                "Taken as not yet on your rate. If your statement already shows the new rate, "
                "choose 'yes': the figures then run from your old rate."
            )
    if before <= 0 or after <= 0:
        raise bad("current_rate", "The rate is too low for this move. Check the number.")
    if emi is not None and emi > req.outstanding:
        raise bad("emi", "EMI must not be more than the outstanding balance.")
    try:
        im = rate_move_impact(req.outstanding, before, after, req.tenure_months_remaining, emi)
    except ValueError as e:
        raise bad("input", str(e))
    if not im.tenure_option_possible:
        notes.append(
            "At the new rate your EMI would not cover the month's interest, so the bank must "
            "raise the EMI: a longer tenure alone is not allowed to make the balance grow."
        )
    scenarios = []
    for m in NEXT_MOVE_SCENARIOS:
        if m == 0:
            scenarios.append(ScenarioOut(move=m, impact=None))
            continue
        x = rate_move_impact(req.outstanding, after, after + m, req.tenure_months_remaining,
                             None)
        scenarios.append(ScenarioOut(move=m, impact=move_out(x)))
    return RbiDecisionResponse(
        decision=_latest_decision(as_of),
        applied_to=applied,
        impact=move_out(im),
        next_meeting=_iso(next_rbi_meeting(as_of)),
        scenarios=scenarios,
        rates_as_of=policy_rates.rates_as_of(Country.IN).isoformat(),
        rates_source=rates_feed.source_label(Country.IN),
        notes=notes,
    )


class LenderChoiceOut(_Base):
    id: str
    name: str
    type: str
    has_rate_card: bool
    rule_applies: bool


@router.get("/loan-check/lenders", response_model=list[LenderChoiceOut])
def loan_check_lenders() -> list[LenderChoiceOut]:
    """Lenders the Loan Check picker offers, with the type that decides which
    RBI rules bind them (engine/lenders.py)."""
    return [
        LenderChoiceOut(id=x.id, name=x.name, type=x.type.value,
                        has_rate_card=x.has_rate_card, rule_applies=x.eblr_bound)
        for x in lender_registry.all_lenders()
    ]
