"""POST /api/loan-check — has a floating-rate home loan passed on RBI rate cuts?

Input problems come back as 422 with a single, user-facing message:
    {"detail": {"field": "loan_start", "message": "..."}}
Nothing is silently skipped: a month the server can't read is an error,
never a quietly missing finding. (A lost bug did exactly that: "03/2019"
typed into a Firefox month box made the rate-cut finding disappear.)
"""
import json
import re
from datetime import date
from decimal import Decimal
from pathlib import Path
from typing import Literal, Optional

from fastapi import APIRouter, HTTPException
from pydantic import Field

from api import rates_feed
from api.schemas import _Base
from engine import lenders as lender_registry
from engine.lenders import LenderType
from engine.loan_check import (
    Benchmark, LoanCheckInput, LoanCheckInputError, LoanCheckResult, SpreadChange, TOLERANCE,
    check_loan,
)
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
    )
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
