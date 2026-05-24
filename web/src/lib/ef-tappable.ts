/**
 * Emergency-fund tappable math — one place that decides how much of
 * the user's EF can be pulled toward a shortfall, and what the
 * untouchable safety floor is.
 *
 * Two questions, two helpers — answered consistently so /goals (goal
 * achievability), /plan (shortfall narrative), and any future surface
 * give the same number for the same user state.
 *
 *   • `efSafetyFloor` — the absolute minimum that must stay liquid no
 *     matter what (one month of expenses, or a fraction of EF target
 *     when expenses aren't passed). This is the "never tap below here"
 *     line.
 *
 *   • `efShortfallTappable` — money the user can pull from EF to fund
 *     a non-emergency shortfall (e.g. a goal). Above the safety floor.
 *
 * Distinct from the cash-advisor `sacredFloor` (= full EF target),
 * which answers "should we sweep idle cash to debt?" and treats the
 * whole EF target as untouchable. The achievability surface is
 * answering a different question: "you've already missed the goal —
 * what's the most you could ethically tap?". So this floor is lower.
 */

const DEFAULT_SAFETY_FRACTION = 0.5;

export interface EfTappableInput {
  /** Current EF balance in user currency. */
  efBalance: number;
  /** User-configured EF target. */
  efTarget: number;
  /** Total monthly expenses (fixed + variable). Optional — when
   *  omitted, falls back to `efTarget × DEFAULT_SAFETY_FRACTION`. */
  monthlyExpenses?: number;
}

/**
 * The "never tap below" floor. The user can borrow / liquidate / change
 * their goal scope — but this much should stay liquid.
 *
 * When `monthlyExpenses` is supplied, the floor is one month of
 * expenses (covers rent + groceries + utility cycle while the user
 * re-orients). Without it, fall back to half the EF target — same
 * approximation the legacy achievability surface used so existing
 * tests stay stable until they're explicitly migrated.
 */
export function efSafetyFloor(input: EfTappableInput): number {
  if (typeof input.monthlyExpenses === 'number' && input.monthlyExpenses > 0) {
    return input.monthlyExpenses;
  }
  return input.efTarget * DEFAULT_SAFETY_FRACTION;
}

/**
 * How much of the EF can be tapped for a shortfall — balance above the
 * safety floor, never negative. Pure function; the caller decides
 * whether to actually recommend the tap based on goal kind, funding
 * source allowlist, and the user's risk preference.
 */
export function efShortfallTappable(input: EfTappableInput): number {
  return Math.max(0, input.efBalance - efSafetyFloor(input));
}
