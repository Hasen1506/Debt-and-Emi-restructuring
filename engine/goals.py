"""§4.31 — Serial-fill multi-goal monthly allocation, engine-side.

Each month the simulator routes a chunk of surplus to active goals
before the EF/debt cascade runs. This module owns that routing.

Why engine-side: goals expire. Without the engine knowing each goal's
target month, the trajectory simulates "constant goal outflow forever"
even after goals have hit their date. With staggered targets the
constant-outflow assumption understates how fast debt clears once
goals roll off.

Why serial (not pro-rata): pro-rata splits surplus across all
competing goals so when surplus is tight, EVERY goal ends up partial
— meaning nothing hits its date. Serial fills goals in the user's
chosen order, fully covering each in turn until the pool runs dry.
The last goals may get nothing this month, but the earlier ones land
on time. Pairs cleanly with the per-goal fill-rate UI the user sees.

Ordering:
  1. `priority_bump=True` goals first (single user override flag,
     replaces the old 3-tier critical/important/discretionary model).
  2. Within each group: `order_index` ascending (drag-to-reorder),
     then `target_month_index` ascending (earlier dates first),
     then `id` for a stable tiebreak.

Goal lifecycle:
  • target_month_index reached or passed → no more contribution.
    `saved_at_target` snapshots the saved amount on the first month
    we reach the target so fill-rate badges show "what hit the date".
  • saved_so_far >= required → over_funded, no more contribution.
  • pool exhausted before reaching this goal → surplus_exhausted.
  • got a positive contribution below run-rate → partial_fill
    (counts as not-fully-on-track for the any_goal_short flag).

Mutation contract: serial_fill_allocation mutates `saved_so_far` and
`saved_at_target` on each input goal so the caller can pass the same
list each month and see accumulation. Returned contributions reflect
this month only.
"""
from dataclasses import dataclass, field
from decimal import Decimal
from typing import Literal

D = Decimal

QueuedReason = Literal[
    "past_date",         # target month reached or passed
    "over_funded",       # saved_so_far ≥ required
    "surplus_exhausted", # pool drained before reaching this goal
    "partial_fill",      # got something, but below run-rate
    "deferred",          # before funding_start_month_index — intentional
    "waiting_on_debt",   # funding rule "after debt X clears" (roadmap PR F) — intentional
]

# Funding rules (roadmap PR F):
#   schedule    — the run-rate that lands the goal on its date (the legacy behaviour)
#   fixed       — a fixed amount a month (`funding_amount`), up to what is still needed
#   surplus_pct — a share of the month's spare cash (`funding_pct`, 0–1)
#   after_debt  — nothing until a loan clears (`after_loan_index`, the loan's
#                 position in user.loans), or until every high-interest loan
#                 has cleared (`after_loan_index` None); then the run-rate.
#                 This is "debt first", the default for a new goal.
FundingRule = Literal["schedule", "fixed", "surplus_pct", "after_debt"]
FUNDING_RULES = ("schedule", "fixed", "surplus_pct", "after_debt")

# "High-interest" for the debt-first rule: a nominal rate at or above this
# (credit cards, most personal loans; not home, car or education loans).
HIGH_APR_THRESHOLD = {"IN": D("0.12"), "US": D("0.10")}


def high_apr_threshold(country) -> Decimal:
    c = country.value if hasattr(country, "value") else str(country)
    return HIGH_APR_THRESHOLD.get(c, HIGH_APR_THRESHOLD["IN"])


def debt_gate(loans, country, position_of=None):
    """The `debt_cleared(after_loan_index)` callable the allocator asks.

    `loans` are the user's loans in their current state; `position_of`
    maps id(loan) → its index in user.loans (defaults to list order).
    A loan named by index has cleared when its balance is 0 (or it isn't
    in the list). None asks "has every high-interest loan cleared?"."""
    pos = position_of or {id(l): i for i, l in enumerate(loans)}
    open_idx = {pos[id(l)] for l in loans if l.outstanding > 0 and id(l) in pos}
    limit = high_apr_threshold(country)
    high_open = any(l.outstanding > 0 and l.nominal_rate >= limit for l in loans)

    def cleared(idx):
        if idx is None:
            return not high_open
        return idx not in open_idx
    return cleared


@dataclass
class GoalState:
    """Mutable per-goal state threaded across the trajectory loop."""
    id: str
    target_month_index: int
    required_amount: Decimal
    saved_so_far: Decimal = D("0")
    # User's single explicit priority knob — when True, this goal is
    # funded ahead of goals with earlier target dates. Replaces the
    # 3-tier critical/important/discretionary model (which forced
    # users to learn tier semantics + pro-rata mechanics).
    priority_bump: bool = False
    # Stable within-group ordering (lower = earlier). Set by the drag
    # UI; None falls back to target_month_index ordering. Kept distinct
    # from target_month_index so the user can sequence two goals with
    # the same target date.
    order_index: int | None = None
    # Snapshot of `saved_so_far` the first month current_sim_month
    # reaches `target_month_index`. Drives the "X% of target met by
    # your date" fill-rate badge on /goals + /plan. None until target
    # month is reached.
    saved_at_target: Decimal | None = None
    # Deferred-start: when set, the engine emits a `deferred` queued
    # reason for every month current_sim_month < funding_start_month_index
    # and routes 0 to this goal. Once we reach the start month, the
    # standard run-rate / remaining_required math takes over — naturally
    # concentrating contributions into the shorter active window (e.g.
    # 50k goal at month 9 with start=7 → ~25k/mo across months 7+8).
    # Useful when required_amount × months_to_target ≪ monthly_surplus:
    # debt prepay gets the full surplus until funding kicks in, which
    # reduces lifetime interest more than spreading the goal across the
    # whole window. None preserves the legacy "start at month 0" behavior.
    funding_start_month_index: int | None = None
    # Funding rule (roadmap PR F); see FUNDING_RULES above.
    funding_rule: str = "schedule"
    funding_amount: Decimal | None = None
    funding_pct: Decimal | None = None
    after_loan_index: int | None = None


@dataclass(frozen=True)
class GoalContribution:
    """One month's allocation result for a single goal."""
    goal_id: str
    amount: Decimal
    run_rate: Decimal
    queued_reason: QueuedReason | None = None


@dataclass(frozen=True)
class MonthlyGoalAllocation:
    """Aggregated result for one sim month."""
    contributions: list[GoalContribution] = field(default_factory=list)
    total_outflow: Decimal = D("0")
    # True when at least one active goal received less than its
    # run-rate this month (partial_fill or surplus_exhausted). Drives
    # the "some goals are short — review levers" banner on /plan.
    any_goal_short: bool = False


def _sort_key(g: GoalState) -> tuple[int, int, int, str]:
    """User-effective ordering: bumps first, then by order_index, then
    by target month, then by id for stable tiebreak."""
    return (
        0 if g.priority_bump else 1,
        g.order_index if g.order_index is not None else 10**9,
        g.target_month_index,
        g.id,
    )


def serial_fill_allocation(
    goals: list[GoalState],
    available_surplus: Decimal,
    current_sim_month: int,
    debt_cleared=None,
) -> MonthlyGoalAllocation:
    """Walk goals in user-effective order; each takes its run-rate
    from the remaining surplus pool. Later goals get 0 once pool
    drains. Mutates each goal's `saved_so_far` + `saved_at_target`.

    `current_sim_month` is 0-based (m=0 = first month of the sim).
    A goal with `target_month_index <= current_sim_month` has expired
    and is reported `past_date` with zero contribution.

    Returns one `GoalContribution` per input goal, even for those
    that received nothing — the queued_reason explains why so the UI
    can surface honest "this goal isn't getting funded because…" notes.

    Surplus ≤ 0 still iterates the goal list so `past_date` /
    `over_funded` / `surplus_exhausted` rows are populated for the
    UI; the funding branch (`contribution > 0`) is naturally
    short-circuited because `remaining` starts at 0.
    """
    # Always snapshot saved_at_target for goals whose target month has
    # arrived, even when surplus is zero — the fill-rate badge still
    # needs to know "this goal hit its date with X saved".
    for g in goals:
        if g.saved_at_target is None and current_sim_month >= g.target_month_index:
            g.saved_at_target = g.saved_so_far

    if not goals:
        return MonthlyGoalAllocation()

    ordered = sorted(goals, key=_sort_key)
    # Clamp negative surplus to 0 so the funding branch can't draw
    # from a negative pool. Past-date / over-funded / surplus-
    # exhausted rows still emit so the UI gets honest status signals
    # in lean months.
    remaining = available_surplus if available_surplus > 0 else D("0")
    month_surplus = remaining
    contributions: list[GoalContribution] = []
    any_short = False

    for g in ordered:
        months_remaining = g.target_month_index - current_sim_month
        if months_remaining <= 0:
            contributions.append(
                GoalContribution(
                    goal_id=g.id,
                    amount=D("0"),
                    run_rate=D("0"),
                    queued_reason="past_date",
                )
            )
            continue
        remaining_required = g.required_amount - g.saved_so_far
        if remaining_required <= 0:
            contributions.append(
                GoalContribution(
                    goal_id=g.id,
                    amount=D("0"),
                    run_rate=D("0"),
                    queued_reason="over_funded",
                )
            )
            continue
        # Deferred-start: skip funding until the configured start
        # month. Surplus stays in the pool for downstream goals + the
        # EF/debt cascade — that's the whole point (more debt prepay
        # while we wait). `deferred` is NOT counted as `any_goal_short`
        # because the goal is intentionally idle, not falling behind.
        if (
            g.funding_start_month_index is not None
            and current_sim_month < g.funding_start_month_index
        ):
            contributions.append(
                GoalContribution(
                    goal_id=g.id,
                    amount=D("0"),
                    run_rate=D("0"),
                    queued_reason="deferred",
                )
            )
            continue
        # "After debt X clears" (roadmap PR F): idle until it has. Like
        # `deferred`, intentional, so not counted as falling short.
        if g.funding_rule == "after_debt" and debt_cleared is not None and not debt_cleared(g.after_loan_index):
            contributions.append(
                GoalContribution(
                    goal_id=g.id,
                    amount=D("0"),
                    run_rate=D("0"),
                    queued_reason="waiting_on_debt",
                )
            )
            continue
        run_rate = remaining_required / D(months_remaining)
        # What this goal's rule asks for this month. The run-rate lands it
        # on its date; a fixed amount or a share of spare cash may not.
        if g.funding_rule == "fixed" and g.funding_amount is not None:
            run_rate = g.funding_amount
        elif g.funding_rule == "surplus_pct" and g.funding_pct is not None:
            run_rate = month_surplus * g.funding_pct
        # Cap target at remaining_required so a near-finished goal in
        # its last month doesn't try to grab more than it needs.
        target = min(run_rate, remaining_required)
        if remaining <= 0:
            contributions.append(
                GoalContribution(
                    goal_id=g.id,
                    amount=D("0"),
                    run_rate=run_rate,
                    queued_reason="surplus_exhausted",
                )
            )
            any_short = True
            continue
        contribution = min(target, remaining)
        g.saved_so_far += contribution
        remaining -= contribution
        # Use a tiny tolerance when comparing to run-rate so a few
        # paise of float drift doesn't flag a fully-funded goal as
        # short.
        is_short = contribution < target - D("0.01")
        contributions.append(
            GoalContribution(
                goal_id=g.id,
                amount=contribution,
                run_rate=run_rate,
                queued_reason="partial_fill" if is_short else None,
            )
        )
        if is_short:
            any_short = True

    total_outflow = sum((c.amount for c in contributions), D("0"))
    return MonthlyGoalAllocation(
        contributions=contributions,
        total_outflow=total_outflow,
        any_goal_short=any_short,
    )


