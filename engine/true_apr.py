"""True annual cost of a loan: one formula, shared with the web.

Roadmap PR C (audit 2026-10-07 §11). The effective rate used for ordering
(`formulas.effective_rate`) is a linear approximation: nominal × (1 − tax
shield) + fee spread linearly + GST. A 42% card shows 49.56% (42 × 1.18),
leaving out monthly compounding (about 51% before GST).

This module works out the true annual cost from the cash flows: the IRR of
what you receive (principal less the processing fee and its GST) against
what you pay each month (EMI, GST on interest, insurance), less the tax the
interest saves, compounded monthly: (1 + i)^12 − 1. Its TypeScript twin is
`web/src/lib/true-apr.ts`; both run the same algorithm in floating point
and are checked against each other through
`engine/tests/fixtures/true_apr_cases.json` (differential test).

It is shown beside the effective rate; it does not (yet) drive the payoff
order — see docs/IDEAS.md.
"""
from __future__ import annotations

import math
from dataclasses import dataclass


@dataclass(frozen=True)
class TrueAprInputs:
    nominal: float                  # yearly nominal rate, 0.42 = 42%
    months: int | None              # remaining tenure; None/0 = revolving (cards)
    fee_rate: float = 0.0           # processing fee spread per year (processing_fee_amortised)
    insurance_rate: float = 0.0     # yearly, on the balance
    gst_on_interest: float = 0.0    # 0.18 for an Indian credit card
    gst_on_fee: float = 0.0         # 0.18 on an Indian processing fee
    shield: float = 0.0             # share of interest given back as tax saved (0..1)


@dataclass(frozen=True)
class TrueApr:
    nominal: float
    compounding: float   # added by monthly compounding
    gst: float           # added by GST on interest and fee
    fees: float          # added by the processing fee and insurance
    tax: float           # taken off by the tax benefit (≤ 0)
    apr: float           # nominal + compounding + gst + fees + tax


def _annualise(i: float) -> float:
    return (1.0 + i) ** 12 - 1.0


def _monthly_irr(x: TrueAprInputs) -> float:
    r = x.nominal / 12.0
    if not x.months or x.months <= 0:
        return r * (1.0 + x.gst_on_interest) * (1.0 - x.shield) + x.insurance_rate / 12.0
    n = int(x.months)
    # 1 − (1+r)^−n via expm1/log1p: the plain form cancels at tiny rates
    # (r ≈ 1e-8 lost half its digits and gave a negative "compounding",
    # W5 Hypothesis finding true_apr(TrueAprInputs(1.192092896e-07, 1))).
    disc = -math.expm1(-n * math.log1p(r))
    emi = 1.0 / n if disc == 0 else r / disc
    flows = []
    bal = 1.0
    for _ in range(n):
        interest = bal * r
        flows.append(emi + interest * x.gst_on_interest - interest * x.shield + bal * x.insurance_rate / 12.0)
        bal = bal + interest - emi
    received = 1.0 - x.fee_rate * n / 12.0 * (1.0 + x.gst_on_fee)

    def pv(i: float) -> float:
        total, d = 0.0, 1.0
        for f in flows:
            d /= 1.0 + i
            total += f * d
        return total

    lo, hi = -0.05, 1.0
    for _ in range(100):
        mid = (lo + hi) / 2.0
        if pv(mid) > received:
            lo = mid
        else:
            hi = mid
    return (lo + hi) / 2.0


def true_apr(x: TrueAprInputs) -> TrueApr:
    base = TrueAprInputs(x.nominal, x.months)
    with_fees = TrueAprInputs(x.nominal, x.months, x.fee_rate, x.insurance_rate, 0.0, 0.0, 0.0)
    with_gst = TrueAprInputs(x.nominal, x.months, x.fee_rate, x.insurance_rate, x.gst_on_interest, x.gst_on_fee, 0.0)
    a0 = _annualise(_monthly_irr(base))
    a1 = _annualise(_monthly_irr(with_fees))
    a2 = _annualise(_monthly_irr(with_gst))
    a3 = _annualise(_monthly_irr(x))
    # Steps in order: compounding, then fees, then GST (on interest and on
    # the fee), then the tax benefit; each is what that step adds.
    return TrueApr(
        nominal=x.nominal,
        compounding=a0 - x.nominal,
        gst=a2 - a1,
        fees=a1 - a0,
        tax=a3 - a2,
        apr=a3,
    )


