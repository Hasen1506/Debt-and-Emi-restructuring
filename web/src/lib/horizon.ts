/**
 * Plan horizon derivation.
 *
 * The engine accepts an arbitrary `horizon_months`; /plan used to
 * hardcode 240 (20 years). That undershoots users with longer-tenure
 * loans (some HLs run 25-30 years) and overshoots users with only
 * short-tenure debts.
 *
 * Rule:
 *   1. Start at 240 (legacy baseline — keeps long-arc projections
 *      visible for users with no long loans).
 *   2. If any loan has tenure_months_remaining > 228, bump to
 *      (longest_tenure + 12) so the chart shows full payoff plus a
 *      one-year buffer.
 *   3. If a goal_target_month is supplied (from life-templates) and
 *      exceeds the current horizon, extend to cover it + 12.
 *   4. Hard cap at 600 months (50 years) — beyond that, even a FIRE
 *      user's projection is dominated by drift, not behaviour.
 */

import type { UserPayload } from './api';

const BASELINE = 240;
const MAX = 600;

export function deriveHorizonMonths(
  user: UserPayload,
  goalTargetMonth?: number,
): number {
  let horizon = BASELINE;

  for (const l of user.loans) {
    const tenure = Number(l.tenure_months_remaining || 0);
    if (tenure + 12 > horizon) horizon = tenure + 12;
  }

  if (goalTargetMonth && goalTargetMonth + 12 > horizon) {
    horizon = goalTargetMonth + 12;
  }

  return Math.min(horizon, MAX);
}
