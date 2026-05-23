/**
 * Goal achievability — three-tier analysis the goal card presents
 * to the user before they commit.
 *
 * Tiers:
 *   T1 — surplus only. Run the projection: surplus × months_to_target
 *        (minus EF diversion if applicable) ≥ funded_amount.
 *   T2 — surplus + EF tap. Suspend EF top-up; in extreme cases, draw
 *        from existing EF balance. Surplus × months + ef_available ≥ funded.
 *   T3 — surplus + EF + liquidation OR new_loan. Last resort.
 *        Shortfall = funded − (surplus × months + ef_available).
 *        Caller decides whether to surface liquidation, new_loan, or
 *        both based on user's funding_sources allowlist.
 *
 * The checker doesn't run the engine — it uses the user's
 * `monthlySurplus` (the same value /plan shows in the KPI strip) and
 * the EF state on the profile. That's accurate enough for goal sizing;
 * the engine still runs separately for the debt trajectory.
 */

import type { Goal, GoalFundingSource } from './goals';
import { fundedAmount, monthsUntil } from './goals';

export interface TierResult {
  tier: 'T1' | 'T2' | 'T3';
  achievable: boolean;
  /** Amount the user can definitely accumulate via this tier's sources. */
  reachable: number;
  /** Funded target (amount + buffer). */
  required: number;
  /** Shortfall in user currency. 0 when achievable. */
  shortfall: number;
  /** Human-readable summary of the funding mix used. */
  description: string;
  /** Per-source breakdown of where the money comes from. */
  sources: { source: GoalFundingSource; contributes: number }[];
}

export interface AchievabilityInput {
  goal: Goal;
  /** Projected monthly surplus (₹/$ per month) — the KPI shown on /plan
   *  after fixed + variable + EMI minimums. */
  monthlySurplus: number;
  /** Current EF balance in user currency. */
  efBalance: number;
  /** EF target. */
  efTarget: number;
  /** Sum of monthly run-rates for goals that rank AHEAD of `goal` in
   *  the engine's serial-fill order (bumped goals first, then by
   *  order_index / target date). These goals claim their slice of
   *  surplus before this one does, so the realistic T1 ceiling is
   *  `(monthlySurplus − priorGoalsMonthlyDraw) × months`. Default 0
   *  reproduces the legacy "this goal in isolation" upper bound, which
   *  is correct when this goal is at the front of the queue. */
  priorGoalsMonthlyDraw?: number;
  /** Sum of currently-liquid assets eligible for liquidation. Decimal
   *  string from the portfolio. Zero when user has nothing to sell. */
  liquidatableValue: number;
  /** Lowest indicative new-loan rate available, as a decimal (e.g.
   *  0.10 = 10%). Caller pulls from rate-cards.ts. */
  newLoanIndicativeRate: number;
}

/** Run all three tiers and return them in order. The caller decides
 *  which to surface — typically the first achievable one, but power
 *  users may want to see all three so they can pick a stricter source. */
export function analyseGoal(input: AchievabilityInput): TierResult[] {
  const { goal, monthlySurplus, efBalance, efTarget, liquidatableValue } = input;
  const months = monthsUntil(goal);
  const required = fundedAmount(goal);
  const allowed = new Set(goal.fundingSources);

  if (months === 0 || required === 0) {
    return [
      noopTier('T1', required, 'Target month is now or past — set a future date.'),
    ];
  }

  // T1 — surplus only.
  //
  // Engine routes surplus serially: goals ahead of this one in
  // user-effective order (bumped first, then by date) claim their
  // run-rates first. EF top-up + debt prepay come AFTER goals, so
  // they don't subtract here. The realistic ceiling is the surplus
  // left after higher-priority goals have taken their share.
  const priorDraw = Math.max(0, input.priorGoalsMonthlyDraw ?? 0);
  const surplusAvailable = Math.max(0, monthlySurplus - priorDraw);
  const t1Reachable = surplusAvailable * months;
  const t1: TierResult = {
    tier: 'T1',
    achievable: allowed.has('surplus') && t1Reachable >= required,
    reachable: t1Reachable,
    required,
    shortfall: Math.max(0, required - t1Reachable),
    description: priorDraw > 0
      ? `Surplus alone for ${months} months, after ${currencyShort(priorDraw)}/mo claimed by higher-priority goals. Engine-side fill rate is the authoritative number.`
      : `Surplus alone for ${months} months. Engine-side fill rate is the authoritative number.`,
    sources: [{ source: 'surplus', contributes: t1Reachable }],
  };

  // T2 — surplus + EF tap. We can pull from existing EF, but not below
  // a floor of 1 month's expenses (roughly half the target — close
  // enough; the EF advisor computes the precise floor elsewhere).
  const efAvailable = Math.max(0, efBalance - efTarget * 0.5);
  const t2Reachable = t1Reachable + (allowed.has('ef') ? efAvailable : 0);
  const t2: TierResult = {
    tier: 'T2',
    achievable: allowed.has('ef') && t2Reachable >= required,
    reachable: t2Reachable,
    required,
    shortfall: Math.max(0, required - t2Reachable),
    description:
      allowed.has('ef')
        ? `Surplus for ${months} months + ${currencyShort(efAvailable)} tapped from EF (keeping a 50% floor of target).`
        : 'EF tap disabled on this goal — toggle it on if you want this option.',
    sources: [
      { source: 'surplus', contributes: t1Reachable },
      { source: 'ef', contributes: allowed.has('ef') ? efAvailable : 0 },
    ],
  };

  // T3 — last-resort: liquidation OR new loan, whichever the user
  // allows. We treat them as alternatives, not additive — the card
  // surfaces both options for the user to pick. The "reachable" value
  // here is the max of (T2 + liquidation) and (T2 + new_loan), to
  // express "you can definitely get here via at least one path."
  const liquidContribution = allowed.has('liquidation') ? liquidatableValue : 0;
  const t3LiquidReachable = t2Reachable + liquidContribution;
  const newLoanContribution = allowed.has('new_loan') ? Math.max(0, required - t2Reachable) : 0;
  const t3LoanReachable = t2Reachable + newLoanContribution;
  const t3Reachable = Math.max(t3LiquidReachable, t3LoanReachable);
  const t3: TierResult = {
    tier: 'T3',
    achievable: t3Reachable >= required,
    reachable: t3Reachable,
    required,
    shortfall: Math.max(0, required - t3Reachable),
    description: buildT3Description(
      allowed,
      t1Reachable,
      efAvailable,
      liquidContribution,
      newLoanContribution,
      input.newLoanIndicativeRate,
      months,
    ),
    sources: [
      { source: 'surplus', contributes: t1Reachable },
      { source: 'ef', contributes: allowed.has('ef') ? efAvailable : 0 },
      { source: 'liquidation', contributes: liquidContribution },
      { source: 'new_loan', contributes: newLoanContribution },
    ],
  };

  return [t1, t2, t3];
}

/** First achievable tier from the analysis, or T3 (with shortfall) when none. */
export function recommendedTier(tiers: TierResult[]): TierResult {
  for (const t of tiers) {
    if (t.achievable) return t;
  }
  return tiers[tiers.length - 1];
}

function noopTier(
  tier: TierResult['tier'],
  required: number,
  reason: string,
): TierResult {
  return {
    tier,
    achievable: false,
    reachable: 0,
    required,
    shortfall: required,
    description: reason,
    sources: [],
  };
}

function currencyShort(n: number): string {
  if (n >= 1e7) return `${(n / 1e7).toFixed(1)}Cr`;
  if (n >= 1e5) return `${(n / 1e5).toFixed(1)}L`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(0)}k`;
  return Math.round(n).toString();
}

function buildT3Description(
  allowed: Set<GoalFundingSource>,
  surplus: number,
  ef: number,
  liquid: number,
  newLoan: number,
  rate: number,
  months: number,
): string {
  const parts: string[] = [];
  parts.push(`Surplus for ${months} months: ${currencyShort(surplus)}.`);
  if (allowed.has('ef') && ef > 0) parts.push(`EF tap: ${currencyShort(ef)}.`);
  if (allowed.has('liquidation') && liquid > 0) {
    parts.push(`Liquidatable portfolio: up to ${currencyShort(liquid)}.`);
  }
  if (allowed.has('new_loan') && newLoan > 0) {
    parts.push(
      `Or take a ${currencyShort(newLoan)} loan at ~${(rate * 100).toFixed(1)}% (indicative).`,
    );
  }
  if (parts.length === 1) parts.push('No additional sources allowed — adjust the goal.');
  return parts.join(' ');
}

// ─── Honest "can't afford" levers ──────────────────────────────────────────

export interface ShortfallLevers {
  /** Extra months past the target date that would close the gap with
   *  current surplus + (optional) EF + liquid sources. Null when even
   *  unlimited horizon won't close it (surplus + EF + liquid still < required). */
  extendMonthsBy: number | null;
  /** Lower the target amount by this much (in user ccy) to fit the
   *  current horizon + sources. Always ≥ 0. */
  lowerTargetBy: number;
  /** Extra monthly surplus needed to hit the goal on the current date,
   *  without changing sources. Always ≥ 0. */
  increaseSurplusBy: number;
}

/**
 * Compute the three "honest" levers shown when a goal isn't achievable
 * with the user's current surplus + allowed sources. Mirrors the
 * purchase-advisor levers but for savings goals: rather than telling
 * the user "no", show them what would need to change.
 *
 *   • extendMonthsBy: keep target + surplus, push the date out.
 *   • lowerTargetBy:  keep date + surplus, drop the target amount.
 *   • increaseSurplusBy: keep date + target, increase monthly inflow.
 *
 * Returns all three so the UI can present them side-by-side — the user
 * picks which lever to pull. None of them mutate the goal; the caller
 * applies whichever the user chooses.
 */
export function computeShortfallLevers(input: AchievabilityInput): ShortfallLevers {
  const { goal, monthlySurplus, efBalance, efTarget, liquidatableValue } = input;
  const months = require_('months', input);
  const required = require_('required', input);
  if (months === 0 || required === 0) {
    return {
      extendMonthsBy: null,
      lowerTargetBy: 0,
      increaseSurplusBy: 0,
    };
  }

  const allowed = new Set(goal.fundingSources);
  // Mirror the T1 ceiling: subtract higher-priority goals' run-rates
  // from the surplus this goal can route per month. Without the
  // deduction, levers would tell the user "you can hit this date with
  // ₹X/mo extra" when in reality a bumped sibling goal would still
  // eat that ₹X.
  const priorDraw = Math.max(0, input.priorGoalsMonthlyDraw ?? 0);
  const surplusRouting = Math.max(0, monthlySurplus - priorDraw);

  // Non-monthly contribution sources (EF + liquid, both lump-sum
  // assumptions). New_loan doesn't extend "feasible by time" — it just
  // takes whatever shortfall remains, so it's excluded from the
  // extend-months lever (taking a longer-tenure loan is a different
  // question that lives in the purchase advisor).
  const efAvailable = allowed.has('ef')
    ? Math.max(0, efBalance - efTarget * 0.5)
    : 0;
  const liquidAvailable = allowed.has('liquidation') ? liquidatableValue : 0;
  const lumpSum = efAvailable + liquidAvailable;

  // extendMonthsBy: how many extra months at current surplus to close
  // (required − lumpSum). Null when even with infinite horizon, surplus
  // is zero (can't extend out of a hole if no inflow).
  const remainingAfterLump = Math.max(0, required - lumpSum);
  const extendMonthsBy =
    surplusRouting > 0
      ? Math.max(0, Math.ceil(remainingAfterLump / surplusRouting) - months)
      : null;

  // lowerTargetBy: how much to chop from required so that
  //   surplus × months + lumpSum >= required'
  const reachableNow = surplusRouting * months + lumpSum;
  const lowerTargetBy = Math.max(0, Math.round(required - reachableNow));

  // increaseSurplusBy: extra monthly inflow needed so that
  //   (surplus + delta) × months + lumpSum >= required
  const increaseSurplusBy =
    months > 0 ? Math.max(0, Math.ceil(lowerTargetBy / months)) : 0;

  return {
    extendMonthsBy,
    lowerTargetBy,
    increaseSurplusBy,
  };
}

/** Tiny helper to share the same `monthsUntil` / `fundedAmount` derivation
 *  with `analyseGoal` without re-importing them at every call site. */
function require_(kind: 'months' | 'required', input: AchievabilityInput): number {
  if (kind === 'months') return monthsUntil(input.goal);
  return fundedAmount(input.goal);
}
