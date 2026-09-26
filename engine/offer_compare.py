"""Offer comparison: keep the loan, pay the bank's fee to reset, or move it.

The usual reply to a complaint or a request for a lower rate is an offer:
"we can move you to our current rate for a fee". This works out what each
choice costs from today, and which is cheapest for as long as the borrower
expects to keep the loan.

Cost of an option = interest paid over the months counted + money paid up
front (fees, GST, stamp duty, legal and valuation charges). Principal is
the same whichever way it is repaid, so it is left out.

When Loan Check has found a rate cut the bank should already have passed
on (`entitled_rate`), the baseline is the loan at that rate, not today's
rate: a fee that only buys what the rules already require is not a saving.

Rounding rule (the golden check in tests/test_offer_golden.py holds the
engine to it):
- EMI: the formula EMI rounded UP to the next whole rupee, so the loan
  never runs past its term.
- Interest each month: balance × annual rate ÷ 12, rounded to the paisa
  (half up). Monthly reducing balance.
- The last instalment is whatever clears the balance, so it is usually a
  little less than the EMI.
- A fee quoted "plus GST" has 18% GST added, rounded to the rupee (half up).
- Totals are rounded to the rupee (half up) only when shown.
Banks differ in small ways (some round the EMI to the nearest rupee, some
charge interest on a daily balance). That moves totals by a few rupees,
never the verdict.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date
from decimal import ROUND_CEILING, ROUND_HALF_UP, Decimal
from enum import Enum
from typing import Optional

from engine.citations import PREPAYMENT_NO_CHARGE, Citation
from engine.formulas import emi as formula_emi
from engine.loan_check import TOLERANCE, _add_months, _inr, _month_start, _pct

D = Decimal

GST_RATE_IN = D("0.18")
# Moving a loan takes weeks of paperwork and a fresh credit check, so it has
# to beat the next best choice by at least this much to be worth suggesting.
REFINANCE_MARGIN = D("10000")
MAX_MONTHS = 480
MAX_OUTSTANDING = D("1000000000")   # ₹100 crore
MAX_FEE_PERCENT = D("0.05")


class Mode(str, Enum):
    LOWER_EMI = "lower_emi"   # same months left, smaller EMI
    SAME_EMI = "same_emi"     # keep paying today's EMI, finish sooner


class OfferInputError(ValueError):
    def __init__(self, field: str, message: str):
        super().__init__(message)
        self.field = field


@dataclass(frozen=True)
class ResetOffer:
    rate: Decimal
    fee: Decimal = D("0")                    # flat amount, or…
    fee_percent: Optional[Decimal] = None    # …a fraction of the outstanding
    fee_plus_gst: bool = False               # quoted "plus GST"


@dataclass(frozen=True)
class RefinanceOffer:
    rate: Decimal
    lender: Optional[str] = None
    processing_fee: Decimal = D("0")
    processing_fee_percent: Optional[Decimal] = None
    fee_plus_gst: bool = False
    stamp_duty: Decimal = D("0")             # on the new mortgage; set by the state
    legal_and_valuation: Decimal = D("0")
    prepayment_charge: Decimal = D("0")      # asked by the current bank to close
    months: Optional[int] = None             # new tenure; default: months left


@dataclass(frozen=True)
class OfferInput:
    outstanding: Decimal
    current_rate: Decimal
    months_left: int
    as_of: date
    lender: Optional[str] = None
    reset: Optional[ResetOffer] = None
    refinance: Optional[RefinanceOffer] = None
    mode: Mode = Mode.LOWER_EMI
    horizon_months: Optional[int] = None     # how long the borrower expects to keep the loan
    entitled_rate: Optional[Decimal] = None  # Loan Check's expected rate, if lower
    floating: bool = True


@dataclass(frozen=True)
class Schedule:
    emi: Decimal
    interest: list[Decimal]      # per month, to the paisa
    last_payment: Decimal

    @property
    def months(self) -> int:
        return len(self.interest)

    @property
    def total_interest(self) -> Decimal:
        return sum(self.interest, D("0"))

    def interest_through(self, months: int) -> Decimal:
        return sum(self.interest[:months], D("0"))


@dataclass(frozen=True)
class CostLine:
    label: str
    amount: Decimal


@dataclass(frozen=True)
class Option:
    key: str                     # keep | keep_owed | reset | refinance
    label: str
    rate: Decimal
    emi: Decimal
    months: int
    last_payment: Decimal
    upfront: list[CostLine]
    upfront_total: Decimal
    interest_total: Decimal      # whole remaining life, to the rupee
    cost_to_horizon: Decimal     # interest in the months counted + upfront
    saving: Decimal              # against the baseline, over the months counted
    break_even_month: Optional[int]
    break_even_on: Optional[date]
    schedule: Schedule = field(repr=False, compare=False, default=None)


@dataclass(frozen=True)
class Comparison:
    options: list[Option]
    baseline: str                # key of the option savings are measured against
    horizon_months: int
    verdict: str                 # keep | reset | refinance
    headline: str
    reason: str
    next_step: str
    warnings: list[str]
    notes: list[str]
    citations: list[Citation]

    def option(self, key: str) -> Optional[Option]:
        return next((o for o in self.options if o.key == key), None)


def _paise(x: Decimal) -> Decimal:
    return x.quantize(D("0.01"), rounding=ROUND_HALF_UP)


def _rupees(x: Decimal) -> Decimal:
    return x.quantize(D("1"), rounding=ROUND_HALF_UP)


def rounded_emi(principal: Decimal, rate: Decimal, months: int) -> Decimal:
    """The formula EMI rounded up to the next whole rupee."""
    return formula_emi(principal, rate, months).quantize(D("1"), rounding=ROUND_CEILING)


def bank_schedule(
    principal: Decimal, rate: Decimal, months: Optional[int] = None,
    emi: Optional[Decimal] = None,
) -> Schedule:
    """Month-by-month repayment under the rounding rule above.

    Give `months` for a fixed term (EMI worked out), or `emi` to pay a set
    amount until the balance is cleared (term worked out).
    """
    if emi is None:
        if not months or months <= 0:
            raise ValueError("months or emi is needed")
        emi = rounded_emi(principal, rate, months)
    monthly = rate / D("12")
    balance = principal
    interest: list[Decimal] = []
    limit = months if months else MAX_MONTHS * 2
    for k in range(limit):
        i = _paise(balance * monthly)
        if emi <= i and balance > 0:
            raise OfferInputError(
                "mode", f"At {_pct(rate)} today's EMI of {_inr(emi)} does not cover the "
                f"monthly interest of {_inr(i)}. Compare with a lower EMI instead.",
            )
        interest.append(i)
        due = balance + i
        if due <= emi or (months and k == limit - 1):
            return Schedule(emi=emi, interest=interest, last_payment=due)
        balance = due - emi
    raise OfferInputError(
        "mode", f"At {_pct(rate)} today's EMI of {_inr(emi)} would take more than "
        f"{limit // 12} years to clear the loan. Compare with a lower EMI instead.",
    )


def _fee(amount: Decimal, percent: Optional[Decimal], plus_gst: bool,
         outstanding: Decimal, label: str) -> list[CostLine]:
    base = _rupees(outstanding * percent) if percent is not None else amount
    if base <= 0:
        return []
    lines = [CostLine(label, base)]
    if plus_gst:
        lines.append(CostLine(f"GST on the {label.lower()} (18%)", _rupees(base * GST_RATE_IN)))
    return lines


def _check_rate(field_name: str, label: str, rate: Decimal) -> None:
    if rate > 1:
        raise OfferInputError(field_name, f"{label} {rate} looks like a percentage. Send it as a fraction (8.55% is 0.0855).")
    if not (D("0.01") <= rate <= D("0.30")):
        raise OfferInputError(field_name, f"{label} must be between 1% and 30%. Got {rate * 100}%.")


def _check_money(field_name: str, label: str, amount: Decimal) -> None:
    if amount < 0:
        raise OfferInputError(field_name, f"{label} can't be negative.")
    if amount > MAX_OUTSTANDING:
        raise OfferInputError(field_name, f"{label} of {_inr(amount)} is too large. Check the number.")


def _check_percent(field_name: str, label: str, value: Optional[Decimal]) -> None:
    if value is None:
        return
    if value > 1:
        raise OfferInputError(field_name, f"{label} {value} looks like a percentage. Send it as a fraction (0.5% is 0.005).")
    if not (0 <= value <= MAX_FEE_PERCENT):
        raise OfferInputError(field_name, f"{label} must be between 0% and 5% of the loan. Got {value * 100}%.")


def validate(inp: OfferInput) -> None:
    if not (D("1000") <= inp.outstanding <= MAX_OUTSTANDING):
        raise OfferInputError("outstanding", "The amount outstanding must be between ₹1,000 and ₹100 crore.")
    if not (1 <= inp.months_left <= MAX_MONTHS):
        raise OfferInputError("tenure_months_remaining", f"Months left must be between 1 and {MAX_MONTHS}.")
    _check_rate("current_rate", "Current rate", inp.current_rate)
    if inp.entitled_rate is not None:
        _check_rate("entitled_rate", "Rate owed", inp.entitled_rate)
    if inp.reset is None and inp.refinance is None:
        raise OfferInputError("reset", "Still needed: the bank's offer or a new lender's offer.")
    if inp.horizon_months is not None and not (1 <= inp.horizon_months <= MAX_MONTHS):
        raise OfferInputError("horizon_months", f"Months you expect to keep the loan must be between 1 and {MAX_MONTHS}.")
    r = inp.reset
    if r is not None:
        _check_rate("reset.rate", "The bank's offered rate", r.rate)
        _check_money("reset.fee", "The bank's fee", r.fee)
        _check_percent("reset.fee_percent", "The bank's fee", r.fee_percent)
        if r.fee_percent is not None and r.fee > 0:
            raise OfferInputError("reset.fee", "Enter the bank's fee as an amount or a percentage, not both.")
    f = inp.refinance
    if f is not None:
        _check_rate("refinance.rate", "The new lender's rate", f.rate)
        for name, label, amount in (
            ("processing_fee", "Processing fee", f.processing_fee),
            ("stamp_duty", "Stamp duty", f.stamp_duty),
            ("legal_and_valuation", "Legal and valuation charges", f.legal_and_valuation),
            ("prepayment_charge", "Prepayment charge", f.prepayment_charge),
        ):
            _check_money(f"refinance.{name}", label, amount)
        _check_percent("refinance.processing_fee_percent", "Processing fee", f.processing_fee_percent)
        if f.processing_fee_percent is not None and f.processing_fee > 0:
            raise OfferInputError("refinance.processing_fee", "Enter the processing fee as an amount or a percentage, not both.")
        if f.months is not None and not (1 <= f.months <= MAX_MONTHS):
            raise OfferInputError("refinance.months", f"The new loan's term must be between 1 and {MAX_MONTHS} months.")


def _month_label(d: date) -> str:
    return f"{d:%b %Y}"


def _span(months: int) -> str:
    years, rest = divmod(months, 12)
    if years and rest:
        return f"{years} year{'s' if years > 1 else ''} {rest} month{'s' if rest > 1 else ''}"
    if years:
        return f"{years} year{'s' if years > 1 else ''}"
    return f"{rest} month{'s' if rest > 1 else ''}"


def _break_even(base: Schedule, s: Schedule, upfront: Decimal) -> Optional[int]:
    """First month by which interest saved against the baseline covers the
    money paid up front. 0 when nothing is paid up front; None if it never
    catches up."""
    if upfront <= 0:
        return 0
    saved = D("0")
    for m in range(max(base.months, s.months)):
        b = base.interest[m] if m < base.months else D("0")
        o = s.interest[m] if m < s.months else D("0")
        saved += b - o
        if saved >= upfront:
            return m + 1
    return None


def compare_offers(inp: OfferInput) -> Comparison:
    validate(inp)
    P, n = inp.outstanding, inp.months_left
    h = min(inp.horizon_months or n, n)
    bank = (inp.lender or "").strip() or "the bank"
    keep_emi = rounded_emi(P, inp.current_rate, n)

    def schedule(rate: Decimal, months: Optional[int] = None) -> Schedule:
        if inp.mode is Mode.SAME_EMI:
            return bank_schedule(P, rate, emi=keep_emi)
        return bank_schedule(P, rate, months=months or n)

    raw: list[tuple[str, str, Decimal, Schedule, list[CostLine]]] = [
        ("keep", "Keep as is", inp.current_rate, bank_schedule(P, inp.current_rate, months=n), []),
    ]
    owed = inp.entitled_rate is not None and inp.entitled_rate < inp.current_rate - TOLERANCE
    if owed:
        raw.append(("keep_owed", "Keep, with the owed cut passed on", inp.entitled_rate,
                    schedule(inp.entitled_rate), []))
    if inp.reset is not None:
        r = inp.reset
        raw.append(("reset", f"Pay {bank}'s fee to reset", r.rate, schedule(r.rate),
                    _fee(r.fee, r.fee_percent, r.fee_plus_gst, P, "Reset fee")))
    if inp.refinance is not None:
        f = inp.refinance
        costs = _fee(f.processing_fee, f.processing_fee_percent, f.fee_plus_gst, P, "Processing fee")
        costs += [CostLine(label, amount) for label, amount in (
            ("Stamp duty", f.stamp_duty),
            ("Legal and valuation", f.legal_and_valuation),
            (f"Prepayment charge from {bank}", f.prepayment_charge),
        ) if amount > 0]
        who = (f.lender or "").strip() or "a new lender"
        raw.append(("refinance", f"Move the loan to {who}", f.rate, schedule(f.rate, f.months), costs))

    base_key = "keep_owed" if owed else "keep"
    base_sched = next(s for k, _, _, s, _ in raw if k == base_key)
    base_cost = base_sched.interest_through(h)
    first_emi = _month_start(inp.as_of)

    options: list[Option] = []
    for key, label, rate, s, costs in raw:
        upfront = sum((c.amount for c in costs), D("0"))
        cost_h = s.interest_through(h) + upfront
        be = _break_even(base_sched, s, upfront) if key in ("reset", "refinance") else None
        options.append(Option(
            key=key, label=label, rate=rate, emi=s.emi, months=s.months,
            last_payment=_rupees(s.last_payment), upfront=costs, upfront_total=upfront,
            interest_total=_rupees(s.total_interest), cost_to_horizon=_rupees(cost_h),
            saving=_rupees(base_cost - cost_h),
            break_even_month=be,
            break_even_on=_add_months(first_emi, be) if be else None,
            schedule=s,
        ))

    return _verdict(inp, options, base_key, h, bank)


def _verdict(inp: OfferInput, options: list[Option], base_key: str, h: int, bank: str) -> Comparison:
    get = {o.key: o for o in options}
    keep, reset, refi = get["keep"], get.get("reset"), get.get("refinance")
    horizon = "the rest of the loan" if h == inp.months_left else f"the next {_span(h)}"
    warnings: list[str] = []
    notes: list[str] = []
    citations: list[Citation] = []

    owed = base_key == "keep_owed"
    if owed:
        notes.append(
            f"Loan Check found the rate should already be {_pct(inp.entitled_rate)} under the "
            f"RBI rules, so savings are measured against the loan at that rate. Getting there "
            f"should cost nothing; the complaint letter asks for it."
        )
        if reset is not None and reset.rate >= inp.entitled_rate - TOLERANCE:
            warnings.append(
                f"The fee only buys the rate cut {bank} should have passed on free "
                f"({_pct(inp.entitled_rate)} is owed; the offer is {_pct(reset.rate)}). "
                f"Ask for it without a fee first."
            )
    if reset is not None and reset.rate >= inp.current_rate:
        warnings.append(f"The offered rate {_pct(reset.rate)} is not lower than today's {_pct(inp.current_rate)}.")
    if refi is not None and inp.refinance.prepayment_charge > 0 and inp.floating:
        warnings.append(
            f"{bank[0].upper() + bank[1:]} should not charge anything to close a floating-rate "
            f"home loan taken by an individual. Ask for the "
            f"{_inr(inp.refinance.prepayment_charge)} charge to be dropped; the comparison "
            f"below includes it as entered."
        )
        citations.append(PREPAYMENT_NO_CHARGE)
    if inp.mode is Mode.SAME_EMI:
        notes.append(f"Every option keeps today's EMI of {_inr(keep.emi)} and finishes sooner at a lower rate.")
    else:
        notes.append(f"Every option is worked out over the same {_span(inp.months_left)} left, unless the new loan's term is set.")
    if h < inp.months_left:
        notes.append(f"Costs count the next {_span(h)}: interest paid in that time plus money paid up front.")
    notes.append("Amounts are not adjusted for inflation or for what the fee could earn if kept.")

    reset_ok = reset is not None and reset.saving > 0
    refi_ok = refi is not None and refi.saving >= REFINANCE_MARGIN and (
        not reset_ok or refi.saving - reset.saving >= REFINANCE_MARGIN
    )

    def pays_by(o: Option) -> str:
        if not o.break_even_month:
            return "Nothing is paid up front, so it saves from the first EMI."
        return f"It pays for itself by {_month_label(o.break_even_on)} (month {o.break_even_month})."

    if refi_ok:
        verdict = "refinance"
        headline = f"Move the loan: it saves about {_inr(refi.saving)} over {horizon}"
        reason = (
            f"At {_pct(refi.rate)}, after {_inr(refi.upfront_total)} of costs up front, moving "
            f"costs {_inr(refi.saving)} less than "
            + ("keeping the loan at the rate owed" if owed else "keeping it as is")
            + (f", and {_inr(refi.saving - reset.saving)} less than paying {bank}'s fee" if reset_ok else "")
            + f". {pays_by(refi)}"
        )
        next_step = (
            "Get the new lender's sanction letter first, with the rate, the spread over the "
            f"repo rate and every fee in writing. Then ask {bank} for the foreclosure letter "
            "(the exact amount to close) and the list of documents it will return. Show the "
            f"sanction letter to {bank} too: it may match the rate to keep the loan."
        )
    elif reset_ok:
        verdict = "reset"
        headline = f"Pay the fee: it saves about {_inr(reset.saving)} over {horizon}"
        reason = (
            f"At {_pct(reset.rate)}, after the {_inr(reset.upfront_total)} fee, the loan costs "
            f"{_inr(reset.saving)} less than "
            + ("at the rate owed" if owed else "keeping it as is")
            + f". {pays_by(reset)}"
        )
        if refi is not None and refi.saving > reset.saving:
            reason += (
                f" Moving the loan would save {_inr(refi.saving)}, not enough more to be "
                f"worth weeks of paperwork."
            )
        elif refi is not None:
            reason += " Moving the loan would save less."
        next_step = (
            f"Accept in writing and ask {bank} to confirm the new rate, the spread, the fee "
            "including GST, and whether the EMI or the term changes. Check the next "
            "statement shows the new rate."
        )
    else:
        verdict = "keep"
        headline = (
            "Don't pay: press for the rate cut you are owed" if owed
            else "Keep the loan as it is for now"
        )
        parts = []
        for o in (reset, refi):
            if o is None:
                continue
            what = "The fee" if o.key == "reset" else "Moving"
            if o.saving <= 0 and o.break_even_month is None:
                parts.append(f"{what} never pays for itself.")
            elif o.saving <= 0 and o.break_even_month > h:
                parts.append(
                    f"{what} pays for itself only by {_month_label(o.break_even_on)} "
                    f"(month {o.break_even_month}), after {horizon}."
                )
            elif o.saving <= 0:
                parts.append(
                    f"{what} costs more over {horizon}: the longer term adds more "
                    f"interest than the lower rate saves."
                )
            else:
                parts.append(
                    f"Moving saves only {_inr(o.saving)}, less than the {_inr(REFINANCE_MARGIN)} "
                    f"it takes to be worth the paperwork."
                )
        reason = " ".join(parts)
        next_step = (
            f"Turn the offer down for now. The complaint asks {bank} to apply the owed rate "
            "without a fee; if it refuses, the Internal Ombudsman and RBI Ombudsman steps follow."
            if owed else
            f"Turn the offer down for now, or ask {bank} for a lower fee or rate. Check again "
            "after the next RBI rate change."
        )

    return Comparison(
        options=options, baseline=base_key, horizon_months=h, verdict=verdict,
        headline=headline, reason=reason, next_step=next_step,
        warnings=warnings, notes=notes, citations=citations,
    )
