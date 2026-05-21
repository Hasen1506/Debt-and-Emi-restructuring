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
  /** Current EF-split slider value (0–1). When > 0, the assumed
   *  funding from surplus is `surplus × (1 − ef_split)` because the
   *  rest gets diverted to EF. preemptsEf=true on the goal overrides
   *  this — surplus runs at full whack. */
  efSplit: number;
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
  const { goal, monthlySurplus, efBalance, efTarget, efSplit, liquidatableValue } = input;
  const months = monthsUntil(goal);
  const required = fundedAmount(goal);
  const allowed = new Set(goal.fundingSources);

  if (months === 0 || required === 0) {
    return [
      noopTier('T1', required, 'Target month is now or past — set a future date.'),
    ];
  }

  // T1 — surplus only.
  const surplusRoutingToGoal = goal.preemptsEf
    ? monthlySurplus
    : monthlySurplus * (1 - efSplit);
  const t1Reachable = Math.max(0, surplusRoutingToGoal * months);
  const t1: TierResult = {
    tier: 'T1',
    achievable: allowed.has('surplus') && t1Reachable >= required,
    reachable: t1Reachable,
    required,
    shortfall: Math.max(0, required - t1Reachable),
    description: goal.preemptsEf
      ? `Full surplus routed to this goal for ${months} months (EF top-up paused — pre-empt is on).`
      : `${Math.round((1 - efSplit) * 100)}% of surplus routed to this goal for ${months} months. ${
          efSplit > 0 ? 'Other surplus continues to fill EF.' : ''
        }`.trim(),
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
