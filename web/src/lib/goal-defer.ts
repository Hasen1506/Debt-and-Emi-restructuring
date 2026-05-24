/**
 * Deferred-start suggester for goals.
 *
 * When a goal needs less than `monthly_surplus × months_to_target`,
 * starting funding from month 0 splits the contribution across the
 * whole window — diluting debt prepay for longer than needed. Walking
 * backward through the engine's per-month surplus series (after
 * subtracting higher-priority goals' draws) finds the latest start
 * month that still hits the deadline. Everything before that point
 * stays in surplus → flows through EF / debt cascade → faster debt
 * clearance.
 *
 * Concrete example (the case that motivated this module):
 *   • Goal: ₹50k by Feb 2027 (9 months away)
 *   • Surplus: ₹30k/mo
 *   • Naive: ₹5.5k/mo × 9 = ₹49.5k. Debt prepay ₹24.5k/mo all 9 months.
 *   • Deferred: ₹0 × 7 mo, then ₹25k × 2 mo = ₹50k. Debt prepay
 *     ₹30k/mo for 7 months, ₹5k/mo for 2. Same total goal funding,
 *     measurably lower total interest because principal drops faster.
 *
 * Engine ALSO supports this — see `funding_start_month_index` on
 * GoalIn. This module computes the suggestion; the engine respects
 * whatever the client passes. Suggestion lives in /lib so /goals and
 * /plan can both call it without re-deriving.
 */

export interface DeferSuggestionInput {
  /** 0-based sim-month the goal is due (e.g. 9 = 9 months from now). */
  targetMonthIndex: number;
  /** Funded amount (= goal.amount × (1 + bufferPct)). */
  requiredAmount: number;
  /** Already saved toward this goal (subtracted from required before
   *  the walk). 0 when no contributions ledger entries yet. */
  savedSoFar?: number;
  /** Engine's pre-allocation surplus per month, indexed from 0. When
   *  shorter than targetMonthIndex, the last value is treated as the
   *  steady-state estimate for any trailing months (the engine's
   *  hike + inflation already shape the leading values). */
  monthlySurplusSeries: number[];
  /** Per-goal contribution series for goals that rank AHEAD of this
   *  one. Keyed by goal id; each array is aligned with
   *  `monthlySurplusSeries`. Sum of these per month is the draw this
   *  goal does NOT have access to. Optional — empty when this goal
   *  is at the front of the queue. */
  priorGoalsContributionsByMonth?: Record<string, number[]>;
}

export interface DeferSuggestion {
  /** Optimal start month — earliest month at which deferring funding
   *  to that point still hits the deadline. 0 means "no defer
   *  possible" (need the full window). */
  startMonthIndex: number;
  /** How many months of "all surplus → debt" the defer buys (i.e.
   *  startMonthIndex). Convenience field for the UI copy. */
  monthsDeferred: number;
  /** Concentrated monthly rate during the active funding window.
   *  ≈ required / (targetMonthIndex − startMonthIndex). 0 when the
   *  active window is degenerate. */
  fundingMonthlyRate: number;
  /** True when the goal can't be reached at all even with the full
   *  window. The UI should fall back to the shortfall-levers (extend
   *  date / lower target / increase surplus) rather than recommending
   *  a defer. */
  unreachable: boolean;
}

/**
 * Walk backward from `targetMonthIndex - 1` summing the per-month
 * surplus available to this goal (raw surplus minus prior-goal draws)
 * until the cumulative tail covers `requiredAmount`. The start of
 * that cumulative tail is the latest defer point.
 *
 * When the surplus series is shorter than the goal's window, the
 * last available value is extrapolated forward — matches the
 * achievability T1 fallback so the two surfaces give consistent
 * estimates.
 */
export function computeDeferSuggestion(
  input: DeferSuggestionInput,
): DeferSuggestion {
  const {
    targetMonthIndex,
    requiredAmount,
    savedSoFar = 0,
    monthlySurplusSeries,
    priorGoalsContributionsByMonth = {},
  } = input;

  const remaining = Math.max(0, requiredAmount - savedSoFar);
  if (remaining === 0 || targetMonthIndex <= 0) {
    return {
      startMonthIndex: 0,
      monthsDeferred: 0,
      fundingMonthlyRate: 0,
      unreachable: false,
    };
  }

  // Build the per-month series the goal can actually access. For
  // months past the engine series end, use the last engine value
  // (the steady-state estimate after hike / inflation have been
  // applied for as long as the engine modeled).
  const tail = monthlySurplusSeries[monthlySurplusSeries.length - 1] ?? 0;
  const priorSums = (m: number) => {
    let s = 0;
    for (const arr of Object.values(priorGoalsContributionsByMonth)) {
      s += arr[m] ?? 0;
    }
    return s;
  };
  const availableAt = (m: number): number => {
    const surplus =
      m < monthlySurplusSeries.length ? monthlySurplusSeries[m] : tail;
    return Math.max(0, surplus - priorSums(m));
  };

  // Walk backward from the last fundable month. The start is the
  // earliest m where the sum from m..target-1 covers `remaining`.
  let cumulative = 0;
  for (let m = targetMonthIndex - 1; m >= 0; m--) {
    cumulative += availableAt(m);
    if (cumulative >= remaining) {
      const monthsActive = targetMonthIndex - m;
      return {
        startMonthIndex: m,
        monthsDeferred: m,
        fundingMonthlyRate: monthsActive > 0 ? remaining / monthsActive : 0,
        unreachable: false,
      };
    }
  }

  // Couldn't reach even with the full window — caller should fall
  // back to the shortfall-levers, not the defer suggestion.
  return {
    startMonthIndex: 0,
    monthsDeferred: 0,
    fundingMonthlyRate: targetMonthIndex > 0 ? remaining / targetMonthIndex : 0,
    unreachable: true,
  };
}

/** Convert a sim-month index (0-based, relative to today) to a
 *  YYYY-MM string for display + cookie persistence. */
export function simMonthToCalendar(
  startIndex: number,
  today: Date = new Date(),
): string {
  const d = new Date(today.getFullYear(), today.getMonth() + startIndex, 1);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

// ─── Multi-goal driver ─────────────────────────────────────────────────────

export interface GoalForDefer {
  /** Unique id — used to key proposed contributions across goals. */
  id: string;
  targetMonthIndex: number;
  requiredAmount: number;
  savedSoFar: number;
}

export interface GoalDeferResult extends DeferSuggestion {
  goalId: string;
}

export interface MultiGoalDeferPlan {
  suggestions: GoalDeferResult[];
  /** Synthesized per-goal monthly contribution series, aligned with
   *  `monthlySurplusSeries`. Flat run-rate during the active window,
   *  zeros before/after; eat-available when unreachable. Feed into
   *  achievability.ts as `priorGoalsContributionsByMonth` so each
   *  goal's T1 sum subtracts higher-priority claims month-by-month
   *  instead of using the flat `priorGoalsMonthlyDraw` approximation. */
  proposedContributionsByGoal: Record<string, number[]>;
  /** Processing order — caller can slice this to determine which
   *  goals ranked AHEAD of a given goal (everything before its
   *  index in this list). */
  orderedGoalIds: string[];
}

/**
 * Single-pass multi-goal defer planner. Walks goals in the order
 * caller provides (which should be the engine's user-effective
 * priority order: bumped first, then by order_index / target date).
 *
 * For each goal:
 *   1. Subtract already-committed contributions from higher-priority
 *      goals from the per-month surplus pool.
 *   2. Walk back to find the latest defer point that still hits the
 *      goal's deadline.
 *   3. Synthesize the goal's proposed monthly contributions across
 *      its active window and add them to the running prior-draw map.
 *
 * Deterministic in one pass — no goal sees its own future
 * contributions, so the result doesn't oscillate across iterations
 * of the render loop.
 *
 * Inputs are pure data; the caller is responsible for clamping
 * fundingStart > targetMonth never happens (the suggester never
 * returns that, but a manually-set value should be validated by
 * the persistence layer).
 */
export function planDefersForGoals(
  goals: GoalForDefer[],
  monthlySurplusSeries: number[],
): MultiGoalDeferPlan {
  const priorDraws: Record<string, number[]> = {};
  const suggestions: GoalDeferResult[] = [];
  const orderedGoalIds: string[] = [];

  for (const g of goals) {
    const suggestion = computeDeferSuggestion({
      targetMonthIndex: g.targetMonthIndex,
      requiredAmount: g.requiredAmount,
      savedSoFar: g.savedSoFar,
      monthlySurplusSeries,
      priorGoalsContributionsByMonth: priorDraws,
    });
    suggestions.push({ goalId: g.id, ...suggestion });
    orderedGoalIds.push(g.id);

    // Synthesize this goal's proposed contributions per month so
    // subsequent goals see the correct "leftover surplus". When the
    // goal is unreachable, treat its draw as the full available
    // surplus each month from month 0 — that's the engine's actual
    // behavior (the unreachable goal eats everything it can).
    const start = suggestion.unreachable ? 0 : suggestion.startMonthIndex;
    const end = g.targetMonthIndex;
    const drawSeries = new Array<number>(Math.max(end, 0)).fill(0);
    if (end > start) {
      const remaining = Math.max(0, g.requiredAmount - g.savedSoFar);
      if (suggestion.unreachable) {
        // Eat whatever's available each month, up to remaining.
        let leftToTake = remaining;
        for (let m = start; m < end && leftToTake > 0; m++) {
          const available = Math.max(
            0,
            (monthlySurplusSeries[m] ??
              monthlySurplusSeries[monthlySurplusSeries.length - 1] ??
              0) -
              Object.values(priorDraws).reduce(
                (s, arr) => s + (arr[m] ?? 0),
                0,
              ),
          );
          const take = Math.min(available, leftToTake);
          drawSeries[m] = take;
          leftToTake -= take;
        }
      } else {
        // Flat run-rate across the active window.
        const months = end - start;
        const perMonth = remaining / months;
        for (let m = start; m < end; m++) {
          drawSeries[m] = perMonth;
        }
      }
    }
    priorDraws[g.id] = drawSeries;
  }
  return {
    suggestions,
    proposedContributionsByGoal: priorDraws,
    orderedGoalIds,
  };
}
