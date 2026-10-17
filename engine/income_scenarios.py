"""Income that isn't one flat salary: seasonal business income, a career
switch with a gap, and a salary shift (audit 80+, founder note on A20:
"Businesses may not pay every quarter; users starting a business,
switching careers, salary shifts, expense variance — are those handled?").

The simulator models income as one monthly figure that grows by an annual
hike and can be replaced by a SALARY_RESET life event. That averages a
shop-owner's Diwali quarter into eleven fake "normal" months and hides the
lean months where the plan actually runs short. This module builds the
month-by-month take-home first, then hands it to the simulator as a series
of SALARY_RESET events with the annual hike switched off (the hikes are
already inside the path), so the simulator's own month loop, gap borrowing
and cascade see the real shape of the year.

Rules this module follows (all are the user's own inputs; nothing here is
a market figure):
* **Hikes** fire exactly as the simulator fires them (same first-hike month
  and same per-year rate: `simulation._first_hike_month_index`,
  `_resolve_hike_rate`), so a path with no scenario reproduces the plain
  simulation month for month (tested).
* **Seasonal income**: twelve take-home amounts, January to December. Each
  year's hike (for a business owner, their growth rate) scales the whole
  pattern.
* **Career switch**: from `gap_from_month`, `gap_months` months at
  `gap_income` (default ₹0 — a sabbatical, a notice-period gap, the first
  months of a new business), then `new_monthly_take_home`. The new job's
  hikes start 12 months after it begins, at `new_hike_rate` (default: the
  user's current hike rate). Anything stated about the old job stops.
* **Salary shift**: from `from_month`, take-home changes by `pct` (+0.20 =
  a 20% raise, −0.15 = a pay cut). It applies on top of every hike before
  it. A SALARY_RESET event, by contrast, states the new figure outright;
  the simulator no longer stacks a same-month hike on top of a reset
  (fixed in simulation.py alongside this module).

Expense swings (a school-fee month, an annual insurance premium) use the
simulator's existing expense inputs and one-off events; this module is
about income only.
"""
from __future__ import annotations

from copy import copy
from dataclasses import dataclass, field
from decimal import Decimal
from typing import Optional, Sequence

from engine.models import LifecycleEvent, LifecycleEventKind, User
from engine.simulation import _first_hike_month_index, _resolve_hike_rate, simulate_plan

D = Decimal
CENT = D("0.01")


@dataclass(frozen=True)
class SeasonalIncome:
    """Take-home for each calendar month, January first (12 amounts)."""
    pattern: tuple[Decimal, ...]

    def __post_init__(self):
        if len(self.pattern) != 12:
            raise ValueError("a seasonal pattern needs 12 monthly amounts, January to December")
        if any(D(x) < 0 for x in self.pattern):
            raise ValueError("monthly income can't be negative")
        if sum(D(x) for x in self.pattern) <= 0:
            raise ValueError("a seasonal pattern needs some income in the year")


@dataclass(frozen=True)
class CareerSwitch:
    gap_from_month: int                     # 1-based sim month the old income stops
    new_monthly_take_home: Decimal
    gap_months: int = 0
    gap_income: Decimal = D("0")
    new_hike_rate: Optional[Decimal] = None  # None: the user's current hike rate

    def __post_init__(self):
        if self.gap_from_month < 1 or self.gap_months < 0:
            raise ValueError("the switch month must be 1 or later and the gap can't be negative")
        if D(self.new_monthly_take_home) < 0 or D(self.gap_income) < 0:
            raise ValueError("income can't be negative")
        if self.new_hike_rate is not None and not (D("-0.5") <= D(self.new_hike_rate) <= D("1")):
            raise ValueError("a yearly hike must be between -50% and +100%")


@dataclass(frozen=True)
class SalaryShift:
    from_month: int
    pct: Decimal                            # +0.20 raise, -0.15 cut

    def __post_init__(self):
        if self.from_month < 1:
            raise ValueError("a shift starts in month 1 or later")
        if D(self.pct) <= D("-1"):
            raise ValueError("a pay cut can't be 100% or more; use a career switch with a gap")


@dataclass
class IncomeScenario:
    seasonal: Optional[SeasonalIncome] = None
    career_switch: Optional[CareerSwitch] = None
    shifts: Sequence[SalaryShift] = field(default_factory=tuple)


def build_income_path(
    user: User,
    horizon_months: int,
    scenario: Optional[IncomeScenario] = None,
    simulation_start_month: int = 1,
) -> list[Decimal]:
    """Take-home for sim months 1..horizon (list index 0 = month 1)."""
    if horizon_months < 1:
        raise ValueError("horizon must be at least one month")
    if not 1 <= simulation_start_month <= 12:
        raise ValueError("simulation_start_month is a calendar month, 1-12")
    sc = scenario or IncomeScenario()
    shifts_at: dict[int, Decimal] = {}
    for s in sc.shifts:
        shifts_at[s.from_month] = (shifts_at.get(s.from_month, D("1"))) * (D("1") + D(s.pct))

    first_hike = _first_hike_month_index(simulation_start_month, user.hike_effective_month)
    hikes_on = user.annual_hike_rate > 0 or bool(user.hike_schedule)
    cs = sc.career_switch
    new_start = (cs.gap_from_month + cs.gap_months) if cs else None
    new_rate = (D(cs.new_hike_rate) if cs and cs.new_hike_rate is not None else user.annual_hike_rate)

    level = D("1")        # old income: hikes and shifts so far
    new_level = D("1")    # new job: its own hikes and shifts
    path: list[Decimal] = []
    for m in range(1, horizon_months + 1):
        cal = (simulation_start_month - 1 + m - 1) % 12          # 0 = January
        in_gap = cs is not None and cs.gap_from_month <= m < new_start
        on_new = cs is not None and m >= new_start
        if on_new:
            yrs = m - new_start
            if yrs > 0 and yrs % 12 == 0 and new_rate != 0:
                new_level *= D("1") + new_rate
            if m in shifts_at:
                new_level *= shifts_at[m]
            income = D(cs.new_monthly_take_home) * new_level
        elif in_gap:
            income = D(cs.gap_income)
        else:
            # Same firing rule as simulation._simulate_plan.
            if hikes_on and m >= first_hike and (m - first_hike) % 12 == 0:
                rate = _resolve_hike_rate(user, (m - first_hike) // 12 + 1)
                if rate > 0:
                    level *= D("1") + rate
            if m in shifts_at:
                level *= shifts_at[m]
            base = D(sc.seasonal.pattern[cal]) if sc.seasonal else user.monthly_income
            income = base * level
        path.append(income.quantize(CENT))
    return path


def to_lifecycle_events(path: Sequence[Decimal]) -> list[LifecycleEvent]:
    """One SALARY_RESET (net monthly) for each month whose income differs
    from the month before. Month 1 is the user's monthly_income."""
    return [
        LifecycleEvent(kind=LifecycleEventKind.SALARY_RESET, effective_month=m,
                       new_monthly_take_home=path[m - 1])
        for m in range(2, len(path) + 1)
        if path[m - 1] != path[m - 2]
    ]


def plan_user(user: User, path: Sequence[Decimal]) -> User:
    """A copy of the user whose month-1 income is the path's and whose hikes
    are off (the path already holds them)."""
    u = copy(user)
    u.monthly_income = path[0]
    u.annual_hike_rate = D("0")
    u.hike_schedule = []
    return u


def simulate_with_income(user: User, path: Sequence[Decimal], *args, seasonal_reserve: bool = True, **kwargs):
    """simulate_plan on a month-by-month income path. Other life events
    still apply; salary resets must be expressed in the path instead.

    `seasonal_reserve` (round 2, default on): the plan knows the path, so
    in good months it holds back what the next lean stretch will need
    (engine/simulation.py `income_lookahead`) instead of prepaying debt and
    borrowing later. A flat path never dips, so it changes nothing there."""
    if seasonal_reserve:
        kwargs.setdefault("income_lookahead", list(path))
    events = list(kwargs.pop("lifecycle_events", None) or [])
    if any(e.kind == LifecycleEventKind.SALARY_RESET for e in events):
        raise ValueError("put salary changes in the income path, not as separate resets")
    kwargs.setdefault("horizon_months", len(path))
    return simulate_plan(plan_user(user, path), *args,
                         lifecycle_events=events + to_lifecycle_events(path), **kwargs)


@dataclass
class IncomeShape:
    average: Decimal
    lowest: Decimal
    highest: Decimal
    zero_months: int
    lean_months: list[int]            # sim months below the year's spending
    buffer_needed: Decimal            # cash that carries the lean months


def income_shape(path: Sequence[Decimal], monthly_outgo: Decimal) -> IncomeShape:
    """How lumpy the income is against what goes out each month (spending
    plus EMIs and minimums). `buffer_needed` is the deepest the running
    balance (income − outgo, from ₹0) ever goes: the savings a business
    owner needs so the lean months never turn into card debt."""
    if not path:
        raise ValueError("empty income path")
    outgo = D(monthly_outgo)
    running = D("0")
    low = D("0")
    lean: list[int] = []
    for i, x in enumerate(path, start=1):
        running += D(x) - outgo
        low = min(low, running)
        if D(x) < outgo:
            lean.append(i)
    n = D(len(path))
    return IncomeShape(
        average=(sum(D(x) for x in path) / n).quantize(CENT),
        lowest=min(path), highest=max(path),
        zero_months=sum(1 for x in path if D(x) == 0),
        lean_months=lean,
        buffer_needed=(-low).quantize(CENT),
    )
