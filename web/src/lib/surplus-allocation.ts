/**
 * Surplus allocation fallback — mirrors `engine/surplus.py:allocate_surplus`.
 *
 * Primary source of truth is now `plan.surplusAllocation` returned by the
 * /api/simulate endpoint. This client function exists only as a fallback
 * for the offline-mock branch when the simulate call errored out, so the
 * waterfall card can still render something coherent.
 *
 * Any change to engine/surplus.py allocation order should be mirrored
 * here so the mock-mode UI stays consistent; mismatches will only ever
 * show during the brief network failure window.
 */

export interface SurplusAllocation {
  goalSlice: number;
  efSlice: number;
  debtSlice: number;
}

export interface SurplusAllocationInput {
  surplus: number;
  efSplit: number;     // 0..1 fraction of surplus diverted to EF until target met
  efGap: number;       // efund_target - efund_balance, floored at 0
  efPreempted: boolean; // an active preempting goal is open (engine flag)
  /** Multi-goal monthly outflow — the total tier-pro-rata contribution
   *  across all active goals (critical → important → discretionary).
   *  When > 0, supersedes the binary efPreempted flag for routing.
   *  Default 0 preserves legacy preempted-flag behaviour. */
  goalOutflow?: number;
}

/**
 * Allocate surplus across three sinks following the engine's priority:
 *
 *   1. If `goalOutflow > 0` → that amount (clamped at surplus) goes to
 *      goal_slice; the remainder cascades through EF + debt.
 *   2. Else if a preempting goal is open → 100% to goal (EF + debt paused).
 *   3. Else: divert `efSplit` fraction to EF until gap closes.
 *   4. Remainder → highest-effective-APR debt.
 *
 * Returns zeros across the board when surplus is non-positive — the
 * caller should render the "nothing to allocate" state in that case.
 */
export function allocateSurplus(input: SurplusAllocationInput): SurplusAllocation {
  const { surplus, efSplit, efGap, efPreempted, goalOutflow = 0 } = input;
  if (surplus <= 0) {
    return { goalSlice: 0, efSlice: 0, debtSlice: 0 };
  }
  if (goalOutflow > 0) {
    const committedGoal = Math.min(goalOutflow, surplus);
    const remaining = surplus - committedGoal;
    if (remaining <= 0) {
      return { goalSlice: committedGoal, efSlice: 0, debtSlice: 0 };
    }
    if (efGap > 0 && efSplit > 0) {
      const want = remaining * efSplit;
      const efSlice = Math.min(want, efGap);
      return { goalSlice: committedGoal, efSlice, debtSlice: remaining - efSlice };
    }
    return { goalSlice: committedGoal, efSlice: 0, debtSlice: remaining };
  }
  if (efPreempted) {
    return { goalSlice: surplus, efSlice: 0, debtSlice: 0 };
  }
  if (efGap > 0 && efSplit > 0) {
    const want = surplus * efSplit;
    const efSlice = Math.min(want, efGap);
    return { goalSlice: 0, efSlice, debtSlice: surplus - efSlice };
  }
  return { goalSlice: 0, efSlice: 0, debtSlice: surplus };
}
