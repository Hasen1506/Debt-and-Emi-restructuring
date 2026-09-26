"""POST /api/loan-check — has a floating-rate home loan passed on RBI rate cuts?

Input problems come back as 422 with a single, user-facing message:
    {"detail": {"field": "loan_start", "message": "..."}}
Nothing is silently skipped: a month the server can't read is an error,
never a quietly missing finding. (A lost bug did exactly that: "03/2019"
typed into a Firefox month box made the rate-cut finding disappear.)
"""
import re
from datetime import date
from decimal import Decimal
from typing import Literal, Optional

from fastapi import APIRouter, HTTPException

from api.schemas import _Base
from engine.loan_check import (
    Benchmark, LoanCheckInput, LoanCheckInputError, LoanCheckResult, TOLERANCE, check_loan,
)

D = Decimal
router = APIRouter(tags=["loan-check"])

_MONTH_RE = re.compile(r"^(\d{4})-(0[1-9]|1[0-2])$")
_DATE_RE = re.compile(r"^(\d{4})-(0[1-9]|1[0-2])-(\d{2})$")


class LoanCheckRequest(_Base):
    country: Literal["IN"] = "IN"
    lender: Optional[str] = None
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


class CitationOut(_Base):
    rule: str
    requirement: str
    source: str
    verified_against_text: bool


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
    stale_rates_warning: Optional[str]


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
    )
    try:
        return inp, check_loan(inp)
    except LoanCheckInputError as e:
        raise bad("input", str(e))


def citation_out(c) -> CitationOut:
    return CitationOut(
        rule=c.rule, requirement=c.requirement, source=c.source,
        verified_against_text=c.verified_against_text,
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
        stale_rates_warning=result.stale_rates_warning,
    )
