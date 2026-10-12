"""Shared lender outcomes: what banks did after a borrower's letter.

After sending a grievance letter, a borrower can record what the bank
did and share it anonymously. Once a bank has MIN_REPORTS shared
reports, Loan Check shows e.g. "HDFC Bank: 80% fixed in full · median
12 days · median rate cut 0.55%".

A report carries only the bank, the outcome, the days the bank took and
the rate before and after. No name, account number, amount or date.

Reports are **unverified** unless the borrower adds the text of the
bank's reply (pasted or read from an uploaded file in the browser) and that
text names the bank and states the new rate. Then the report is stored with
verified=True; the reply text itself is never stored or logged. This is a
consistency check, not proof: the text could be typed by hand. The
scorecard says which figures rest on checked replies (critique #55, #71).
"""
from __future__ import annotations

from dataclasses import dataclass, field, replace
from decimal import Decimal
from enum import Enum
from statistics import median
from typing import Iterable, Optional

import re

from engine import lenders

D = Decimal
MIN_REPORTS = 5
REPLY_DAYS = 30            # a bank has 30 days to answer a complaint
MAX_DAYS = 365
MAX_CUT = D("0.03")        # a larger cut on one letter is not plausible
RATE_LOW, RATE_HIGH = D("0.04"), D("0.20")


class Outcome(str, Enum):
    FIXED_FULL = "fixed_full"      # the rate cut owed, in full
    FIXED_PART = "fixed_part"      # some of it, or only for a fee
    REFUSED = "refused"
    NO_REPLY = "no_reply"


FIXED = (Outcome.FIXED_FULL, Outcome.FIXED_PART)


class OutcomeInputError(ValueError):
    def __init__(self, field: str, message: str):
        super().__init__(message)
        self.field = field
        self.message = message


@dataclass(frozen=True)
class OutcomeReport:
    lender_id: str
    outcome: Outcome
    days_taken: Optional[int]          # to the bank's answer; for no reply, days waited
    rate_before: Decimal
    rate_after: Optional[Decimal]      # only when the rate changed
    verified: bool = False

    @property
    def rate_cut(self) -> Optional[Decimal]:
        if self.rate_after is None:
            return None
        return self.rate_before - self.rate_after


def _pct(x: Decimal) -> str:
    return f"{(x * 100).normalize():f}%"


def _rate_patterns(rate: Decimal) -> list[str]:
    """8.4% → ['8.40', '8.4'] followed by '%' or 'per cent' / 'percent' / 'p.a.'."""
    pct = (rate * 100).quantize(D("0.01"))
    forms = {f"{pct:f}", f"{pct.normalize():f}"}
    return [re.escape(f) + r"\s*(%|per\s*cent|percent|p\.?\s*a\.?)" for f in forms]


def bank_reply_matches(text: Optional[str], lender_id: str, rate_after: Optional[Decimal]) -> bool:
    """Does the bank's reply name this bank and state the new rate?

    Both must appear. Only the yes/no answer is kept; the text is not."""
    if not text or rate_after is None:
        return False
    found = lenders.by_id(lender_id)
    if found is None:
        return False
    norm = " " + lenders.normalise(text) + " "
    names = {lenders.normalise(found.name)} | {
        k for k, v in lenders._BY_KEY.items() if v.id == lender_id  # noqa: SLF001 (same package)
    }
    if not any(f" {n} " in norm for n in names if n):
        return False
    flat = re.sub(r"\s+", " ", text.lower())
    return any(re.search(r"(?<![\d.])" + p, flat) for p in _rate_patterns(rate_after))


def make_report(
    lender: Optional[str],
    outcome: Outcome,
    days_taken: Optional[int],
    rate_before: Decimal,
    rate_after: Optional[Decimal],
    bank_reply_text: Optional[str] = None,
) -> OutcomeReport:
    """Check a report before it is shared. Problems raise OutcomeInputError."""
    found = lenders.resolve_bank(lender)
    if found is None:
        raise OutcomeInputError(
            "lender",
            f"Reports are shared only for the banks on our list. Pick your bank from the list"
            f"{'' if not lender else f' ({lender!r} is not on it)'}.",
        )
    if not (RATE_LOW <= rate_before <= RATE_HIGH):
        raise OutcomeInputError(
            "rate_before", f"The rate before your letter must be between {_pct(RATE_LOW)} and {_pct(RATE_HIGH)}.")
    if days_taken is None:
        raise OutcomeInputError(
            "days_taken",
            "Still needed: how many days you waited." if outcome == Outcome.NO_REPLY
            else "Still needed: how many days the bank took to answer.",
        )
    if not (0 <= days_taken <= MAX_DAYS):
        raise OutcomeInputError("days_taken", f"Days must be between 0 and {MAX_DAYS}.")

    if outcome in FIXED:
        if rate_after is None:
            raise OutcomeInputError("rate_after", "Still needed: your new rate.")
        cut = rate_before - rate_after
        if cut <= 0:
            raise OutcomeInputError(
                "rate_after",
                "The new rate must be lower than the rate before your letter. "
                "If the bank did not lower it, choose 'Refused'.",
            )
        if cut > MAX_CUT:
            raise OutcomeInputError(
                "rate_after", f"A cut of more than {_pct(MAX_CUT)} from one letter is unusual. Check both rates.")
    elif rate_after is not None and rate_after != rate_before:
        raise OutcomeInputError(
            "rate_after",
            "The rate changed, so the bank did fix something: choose 'Fixed in full' or 'Partly fixed'.",
        )
    if outcome == Outcome.NO_REPLY and days_taken < REPLY_DAYS:
        raise OutcomeInputError(
            "days_taken",
            f"Banks have {REPLY_DAYS} days to reply. Report 'No reply' once {REPLY_DAYS} days have passed.",
        )
    return OutcomeReport(
        lender_id=found.id,
        outcome=outcome,
        days_taken=days_taken,
        rate_before=rate_before,
        rate_after=rate_after if outcome in FIXED else None,
        verified=outcome in FIXED and bank_reply_matches(bank_reply_text, found.id, rate_after),
    )


@dataclass(frozen=True)
class LenderScore:
    lender_id: str
    lender: str
    reports: int
    shown: bool                       # enough reports to show the figures
    counts: dict[str, int] = field(default_factory=dict)
    fixed_in_full_pct: Optional[Decimal] = None
    fixed_any_pct: Optional[Decimal] = None
    median_days: Optional[Decimal] = None        # among answers that fixed something
    median_rate_cut: Optional[Decimal] = None    # among answers that fixed something
    verified_reports: int = 0


def _median(values: list) -> Optional[Decimal]:
    return D(median(values)) if values else None


def _share(n: int, total: int) -> Decimal:
    return (D(n) * 100 / D(total)).quantize(D("1"))


def score(lender_id: str, reports: Iterable[OutcomeReport], min_reports: int = MIN_REPORTS) -> LenderScore:
    """The scorecard for one lender. Figures only from `min_reports` up."""
    rows = list(reports)
    lender = lenders.by_id(lender_id)
    counts = {o.value: 0 for o in Outcome}
    for r in rows:
        counts[r.outcome.value] += 1
    base = LenderScore(
        lender_id=lender_id,
        lender=lender.name if lender else lender_id,
        reports=len(rows),
        shown=len(rows) >= min_reports,
        verified_reports=sum(1 for r in rows if r.verified),
    )
    if not base.shown:
        return base
    fixed = [r for r in rows if r.outcome in FIXED]
    return replace(
        base,
        counts=counts,
        fixed_in_full_pct=_share(counts[Outcome.FIXED_FULL.value], len(rows)),
        fixed_any_pct=_share(len(fixed), len(rows)),
        median_days=_median([r.days_taken for r in fixed if r.days_taken is not None]),
        median_rate_cut=_median([r.rate_cut for r in fixed if r.rate_cut is not None]),
    )


def scorecard(reports: Iterable[OutcomeReport], min_reports: int = MIN_REPORTS) -> dict[str, LenderScore]:
    """One score per lender that has any report."""
    by_lender: dict[str, list[OutcomeReport]] = {}
    for r in reports:
        by_lender.setdefault(r.lender_id, []).append(r)
    return {lid: score(lid, rows, min_reports) for lid, rows in by_lender.items()}


def headline(s: LenderScore) -> Optional[str]:
    """'HDFC Bank: 80% fixed in full · median 12 days · median rate cut 0.55%'."""
    if not s.shown:
        return None
    parts = [f"{s.fixed_in_full_pct}% fixed in full"]
    if s.median_days is not None:
        parts.append(f"median {s.median_days.normalize():f} days")
    if s.median_rate_cut is not None:
        parts.append(f"median rate cut {_pct(s.median_rate_cut.quantize(D('0.0001')))}")
    return f"{s.lender}: " + " · ".join(parts)
