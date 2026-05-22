/**
 * Surplus allocation logic — mirrors `engine/surplus.py` so the
 * SurplusWaterfall card on /plan can render the same breakdown the
 * engine actually applies, without a round-trip.
 *
 * IMPORTANT: any change to engine/surplus.py allocation order MUST be
 * mirrored here, and the unit tests in surplus-allocation.test.ts MUST
 * be updated alongside. If/when the engine API starts returning the
 * pre-computed allocation, this module should be deleted in favour of
 * reading the server value.
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
}

/**
 * Allocate surplus across three sinks following the engine's priority:
 *
 *   1. If a preempting goal is open, 100% to goal (EF + debt paused).
 *   2. Else: divert `efSplit` fraction to EF until gap closes.
 *   3. Remainder → highest-effective-APR debt.
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
