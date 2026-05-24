/**
 * Surplus allocation fallback — mirrors `engine/surplus.py:allocate_surplus`.
 *
 * Primary source of truth is `plan.surplusAllocation` returned by the
 * /api/simulate endpoint. This client function exists only as a fallback
 * for the offline-mock branch when the simulate call errored out, so
 * the waterfall card can still render something coherent.
 *
 * Contract matches the engine: `surplus` is POST-GOAL (the caller has
 * already pulled goal outflow off the top); this function only routes
 * the residual across EF + debt. Any change to engine/surplus.py
 * allocation order should be mirrored here so the mock-mode UI stays
 * consistent.
 */

export interface SurplusAllocation {
  goalSlice: number;
  efSlice: number;
  debtSlice: number;
}

export interface SurplusAllocationInput {
  /** Surplus remaining after goals have been pulled. The caller is
   *  responsible for the goal subtraction; this helper only handles
   *  the EF/debt cascade. */
  surplus: number;
  efSplit: number;     // 0..1 fraction of surplus diverted to EF until target met
  efGap: number;       // efund_target - efund_balance, floored at 0
  efPreempted: boolean; // an active preempting goal is open (engine flag)
}

/**
 * Route post-goal surplus through the EF + debt cascade. Mirrors the
 * engine: `ef_preempted` → 100% goal slice; else EF gets `efSplit ×
 * surplus` capped at `efGap`, debt gets the rest.
 *
 * Returns zeros across the board when surplus is non-positive — the
 * caller should render the "nothing to allocate" state in that case.
 */
export function allocateSurplus(input: SurplusAllocationInput): SurplusAllocation {
  const { surplus, efSplit, efGap, efPreempted } = input;
  if (surplus <= 0) {
    return { goalSlice: 0, efSlice: 0, debtSlice: 0 };
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
