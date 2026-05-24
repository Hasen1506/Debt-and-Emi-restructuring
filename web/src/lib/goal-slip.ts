/**
 * Goal-slip calculator — given a baseline monthly surplus and a hypothetical
 * change to it (typically a negative delta from a new EMI or a what-if cut),
 * report how each active goal's earliest-feasible month shifts.
 *
 * Used by /tools/purchase and /tools/sensitivity to surface a "buying this
 * delays Goal X by N months" callout. Computes purely from surplus/EF
 * inputs the FE already has; doesn't touch the engine, so it's cheap to
 * run as the user types.
 *
 * The math mirrors the achievability T1 walk: cumulative surplus minus
 * prior-goal draws, with the baseline and adjusted surplus producing two
 * earliest-feasible answers we diff.
 */

import { earliestFeasibleMonths, monthsToTargetLabel } from './achievability';
import type { Goal } from './goals';
import { monthsUntil } from './goals';

export interface GoalSlipRow {
  goalId: string;
  goalLabel: string;
  /** User's chosen target months from today — what they wrote on the goal. */
  targetMonths: number;
  /** Earliest feasible months at baseline surplus. null = infeasible. */
  baseEarliest: number | null;
  /** Earliest feasible months at adjusted surplus. null = infeasible. */
  postEarliest: number | null;
  /** Positive when post > base (i.e. goal slips later); null when either
   *  side is infeasible (the row is then a "newly broken" callout). */
  slipMonths: number | null;
  /** Convenience labels for the UI: 'YYYY-MM' or null when infeasible. */
  baseEarliestLabel: string | null;
  postEarliestLabel: string | null;
  /** True when the post-change earliest exceeds the user's chosen target —
   *  the purchase/what-if actually breaks the deadline. */
  breaksDeadline: boolean;
}

export function computeGoalSlip(args: {
  goals: Goal[];
  contributionTotals: Record<string, number>;
  baselineMonthlySurplus: number;
  /** Negative when the change reduces surplus (e.g. new EMI); positive
   *  when the change increases it (e.g. expense cut). */
  surplusDelta: number;
  efBalance: number;
  efTarget: number;
  monthlyExpenses?: number;
  /** Indicative new-loan rate for the T3 tier — passed through but only
   *  the T1 walk is consulted here, so the value is largely cosmetic
   *  for slip math. */
  newLoanIndicativeRate?: number;
  /** Sum of currently-liquid portfolio value. */
  liquidatableValue?: number;
  today?: Date;
}): GoalSlipRow[] {
  const today = args.today ?? new Date();
  const baseSurplus = Math.max(0, args.baselineMonthlySurplus);
  const postSurplus = Math.max(0, args.baselineMonthlySurplus + args.surplusDelta);

  const rows: GoalSlipRow[] = [];
  for (const goal of args.goals) {
    if (!goal.amount || Number(goal.amount) <= 0) continue;
    const saved = args.contributionTotals[goal.id] ?? 0;
    const sharedInput = {
      goal,
      savedSoFar: saved,
      efBalance: args.efBalance,
      efTarget: args.efTarget,
      monthlyExpenses: args.monthlyExpenses,
      liquidatableValue: args.liquidatableValue ?? 0,
      newLoanIndicativeRate: args.newLoanIndicativeRate ?? 0,
    };
    const baseEarliest = earliestFeasibleMonths({
      ...sharedInput,
      monthlySurplus: baseSurplus,
    });
    const postEarliest = earliestFeasibleMonths({
      ...sharedInput,
      monthlySurplus: postSurplus,
    });
    // Signed: positive = goal moves LATER (slip), negative = goal moves
    // EARLIER (pull-forward). Callers that only care about slips can
    // filter `slipMonths > 0`; the what-if panel reads negative values
    // to surface "goal Z lands 4 months sooner".
    const slipMonths =
      baseEarliest !== null && postEarliest !== null
        ? postEarliest - baseEarliest
        : null;
    const targetMonths = monthsUntil(goal, today);
    const breaksDeadline =
      postEarliest === null || (targetMonths > 0 && postEarliest > targetMonths);
    rows.push({
      goalId: goal.id,
      goalLabel: goal.label || '(unnamed)',
      targetMonths,
      baseEarliest,
      postEarliest,
      slipMonths,
      baseEarliestLabel:
        baseEarliest !== null ? monthsToTargetLabel(baseEarliest, today) : null,
      postEarliestLabel:
        postEarliest !== null ? monthsToTargetLabel(postEarliest, today) : null,
      breaksDeadline,
    });
  }
  return rows;
}

/** Filter to the goals materially affected: slip ≥ 1 month, or the
 *  change just broke a previously-feasible deadline, or it newly made
 *  the goal infeasible. Used by /tools/purchase to surface "this delays
 *  Goal X." */
export function materialSlips(rows: GoalSlipRow[]): GoalSlipRow[] {
  return rows.filter((r) => {
    if (r.breaksDeadline && r.baseEarliest !== null) return true;
    if (r.postEarliest === null && r.baseEarliest !== null) return true;
    if (r.slipMonths !== null && r.slipMonths >= 1) return true;
    return false;
  });
}

/** Filter to goals that gain meaningful timeline (pull-forward) — used
 *  by the what-if "trim spending" slider to surface "Goal Z lands 4
 *  months sooner". Returns rows with slipMonths ≤ −1. */
export function materialPullForwards(rows: GoalSlipRow[]): GoalSlipRow[] {
  return rows.filter((r) => r.slipMonths !== null && r.slipMonths <= -1);
}
