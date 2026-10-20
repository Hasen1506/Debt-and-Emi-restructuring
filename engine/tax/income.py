"""Pre-tax income when the user gave only take-home (audit C9 / C20).

QuickSetup stores take-home × 12 in `annual_income`; `annual_gross_salary`
is set only when the user types it (Form 16 / W-2). Anything that needs
gross pay (the Indian slab, the US §221 / §163(h)(4) MAGI phase-outs) used
to read take-home as gross, or skip the phase-out entirely. This solves the
gross pay whose take-home (income tax + FICA / EPF, engine/simulation.py
`estimated_take_home`) equals the monthly take-home on file, the same way
web/src/lib/quick-setup.ts `marginalRateFromTakeHome` does. Callers label
the result "estimated".
"""
from __future__ import annotations

from decimal import Decimal

D = Decimal


def gross_from_take_home(user, monthly_take_home: Decimal) -> Decimal:
    """Annual gross whose estimated monthly take-home is `monthly_take_home`
    (bisection; take-home rises with gross in both countries)."""
    from engine.simulation import estimated_take_home
    if monthly_take_home <= 0:
        return D("0")
    lo, hi = monthly_take_home * 12, monthly_take_home * 12 * 4
    while estimated_take_home(user, hi) < monthly_take_home and hi < D("1e13"):
        hi *= 2
    for _ in range(60):
        mid = (lo + hi) / 2
        if estimated_take_home(user, mid) < monthly_take_home:
            lo = mid
        else:
            hi = mid
        if hi - lo < D("1"):
            break
    return hi.quantize(D("1"))


def user_gross(user) -> tuple[Decimal | None, bool]:
    """(annual pre-tax income, estimated?). Typed gross salary or business
    income wins; else it is solved from take-home; None when neither is on
    file."""
    # Salary and business income together (a salaried person with a side business).
    typed = (user.annual_gross_salary or D("0")) + (user.annual_business_income or D("0"))
    if typed:
        return typed, False
    th = user.monthly_income if user.monthly_income and user.monthly_income > 0 else (
        user.annual_income / 12 if user.annual_income else D("0"))
    if th <= 0:
        return None, False
    return gross_from_take_home(user, th), True
