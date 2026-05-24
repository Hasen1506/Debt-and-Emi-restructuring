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
import { efShortfallTappable } from './ef-tappable';

export interface TierResult {
  tier: 'T1' | 'T2' | 'T3';
  achievable: boolean;
  /** Total amount the user can mass on the deadline via this tier —
   *  contributions already logged + projected new contribution from
   *  this tier's sources. The `achievable` check compares this against
   *  `required`. */
  reachable: number;
  /** Money already logged via the contributions ledger that counts
   *  toward this goal. Reported separately from `reachable` so the
   *  UI can render "saved X + projected Y = reachable X+Y" without
   *  re-deriving. */
  savedSoFar: number;
  /** Forward contribution this tier projects on top of `savedSoFar`. */
  projectedContribution: number;
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
  /** Already-logged contributions toward this goal. Counted toward
   *  `reachable` so a partially-saved goal isn't reported short on
   *  the strength of forward surplus alone. */
  savedSoFar: number;
  /** Projected monthly surplus (₹/$ per month) — the KPI shown on /plan
   *  after fixed + variable + EMI minimums. */
  monthlySurplus: number;
  /** Current EF balance in user currency. */
  efBalance: number;
  /** EF target. */
  efTarget: number;
  /** User's typical monthly expense base — used by the EF tappable
   *  helper to enforce a "1 month of expenses" safety floor (the
   *  hard minimum kept liquid in every shortfall scenario). Falls
   *  back to a fraction of EF target when omitted. */
  monthlyExpenses?: number;
  /** Quality hint for `monthlySurplusSeries`. 'live' means the values
   *  came from the engine and include lifecycle/inflation effects;
   *  'flat' means the caller synthesised a flat series from a single
   *  current-surplus snapshot. Drives the tier description so /goals
   *  doesn't overclaim "based on projection" when it's actually a
   *  flat snapshot. */
  seriesQuality?: 'live' | 'flat';
  /** Sum of monthly run-rates for goals that rank AHEAD of `goal` in
   *  the engine's serial-fill order (bumped goals first, then by
   *  order_index / target date). These goals claim their slice of
   *  surplus before this one does, so the realistic T1 ceiling is
   *  `(monthlySurplus − priorGoalsMonthlyDraw) × months`. Default 0
   *  reproduces the legacy "this goal in isolation" upper bound, which
   *  is correct when this goal is at the front of the queue.
   *
   *  Note: this is a FLAT approximation — it assumes prior goals draw
   *  the same amount every month for the entire window. Wrong once
   *  prior goals expire (their target month passes). Prefer
   *  `priorGoalsContributionsByMonth` when the engine series is
   *  available; this field stays for callers that don't have it. */
  priorGoalsMonthlyDraw?: number;
  /** Engine-truth surplus series, one entry per simulated month
   *  starting at month 0 (current). When provided, T1 reachable is
   *  `sum(monthlySurplusSeries[0..months] − priorContributions[m])`
   *  — the authoritative number that accounts for inflation, hike,
   *  lifecycle events, and prior-goal expiry. When omitted, falls
   *  back to the flat `monthlySurplus × months` approximation. */
  monthlySurplusSeries?: number[];
  /** Engine-truth per-prior-goal contribution series, keyed by goal
   *  id; each value is an array of monthly draws aligned with
   *  `monthlySurplusSeries`. A prior goal that expires at month 6
   *  has zeros from month 6 onward — so the achievability sum
   *  correctly reclaims the freed surplus. Only consulted when
   *  `monthlySurplusSeries` is also present. */
  priorGoalsContributionsByMonth?: Record<string, number[]>;
  /** Sum of currently-liquid assets eligible for liquidation. Decimal
   *  string from the portfolio. Zero when user has nothing to sell. */
  liquidatableValue: number;
  /** Lowest indicative new-loan rate available, as a decimal (e.g.
   *  0.10 = 10%). Caller pulls from rate-cards.ts. */
  newLoanIndicativeRate: number;
}

/** How surplus reached this number — drives the user-facing copy. */
type SurplusBasis = 'live-series' | 'flat-series' | 'flat-fallback';

/** Forward contribution this goal can claim from surplus over the
 *  remaining `months`. Excludes anything the user has already saved —
 *  that's reported separately. Three input modes:
 *
 *    • engine series tagged `live`: sums the per-month leftover after
 *      higher-priority goals, accounting for raises + lifecycle events.
 *    • engine series tagged `flat` (or unset): same sum, but caller has
 *      told us the series doesn't include forward variation — surfaces
 *      as a flatter "based on today's surplus" tier description.
 *    • no series: falls back to monthlySurplus × months.
 */
function computeT1Reachable(
  input: AchievabilityInput,
  months: number,
): { reachable: number; basis: SurplusBasis } {
  const series = input.monthlySurplusSeries;
  if (series && series.length > 0) {
    const window = Math.min(months, series.length);
    const priorByGoal = input.priorGoalsContributionsByMonth ?? {};
    let total = 0;
    for (let m = 0; m < window; m++) {
      let priorDraw = 0;
      for (const arr of Object.values(priorByGoal)) {
        priorDraw += arr[m] ?? 0;
      }
      total += Math.max(0, (series[m] ?? 0) - priorDraw);
    }
    // If the series ran out before the goal's window (target past
    // horizon), extrapolate the last available month forward — the
    // last value is the best estimate for "what would continue absent
    // further events".
    if (window < months) {
      const tailSurplus = series[series.length - 1] ?? 0;
      const tailMonths = months - window;
      total += Math.max(0, tailSurplus) * tailMonths;
    }
    const basis: SurplusBasis =
      input.seriesQuality === 'live' ? 'live-series' : 'flat-series';
    return { reachable: total, basis };
  }
  const priorDraw = Math.max(0, input.priorGoalsMonthlyDraw ?? 0);
  const surplusAvailable = Math.max(0, input.monthlySurplus - priorDraw);
  return { reachable: surplusAvailable * months, basis: 'flat-fallback' };
}

function describeT1(
  basis: SurplusBasis,
  months: number,
  priorDrawForLabel: number,
): string {
  const priorClause =
    priorDrawForLabel > 0
      ? `, after the ${currencyShort(priorDrawForLabel)}/mo your higher-priority goals take first`
      : '';
  if (basis === 'live-series') {
    return (
      `From your projected monthly cashflow over the next ${months} months${priorClause}. ` +
      `Includes upcoming pay changes and life events you've planned for.`
    );
  }
  if (basis === 'flat-series') {
    return (
      `From your current monthly surplus held steady for ${months} months${priorClause}. ` +
      `This doesn't yet account for upcoming pay changes — open /plan for the full projection.`
    );
  }
  return (
    `From your current monthly surplus held steady for ${months} months${priorClause}. ` +
    `Rough estimate — open /plan for a month-by-month projection.`
  );
}

/** Run all three tiers and return them in order. The caller decides
 *  which to surface — typically the first achievable one, but power
 *  users may want to see all three so they can pick a stricter source. */
export function analyseGoal(input: AchievabilityInput): TierResult[] {
  const { goal, savedSoFar, liquidatableValue } = input;
  const months = monthsUntil(goal);
  const required = fundedAmount(goal);
  const allowed = new Set(goal.fundingSources);
  const saved = Math.max(0, savedSoFar);

  if (months === 0 || required === 0) {
    return [
      noopTier(
        'T1',
        required,
        saved,
        'Target month is now or past — set a future date.',
      ),
    ];
  }

  // Already-funded short-circuit. Saved-so-far alone may cover the
  // goal; in that case every tier is trivially achievable and the
  // forward levers don't need to run.
  if (saved >= required) {
    return ['T1', 'T2', 'T3'].map(
      (t) =>
        ({
          tier: t as TierResult['tier'],
          achievable: true,
          reachable: saved,
          savedSoFar: saved,
          projectedContribution: 0,
          required,
          shortfall: 0,
          description: `Already funded — you've put aside ${currencyShort(saved)} of ${currencyShort(required)}.`,
          sources: [{ source: 'surplus' as GoalFundingSource, contributes: 0 }],
        }) satisfies TierResult,
    );
  }

  // T1 — surplus only. The engine routes surplus serially: goals
  // ranked ahead of this one (bumped first, then by date) claim
  // their run-rates first. EF top-up + debt prepay come AFTER goals
  // so they don't subtract here. `t1Projected` is the forward
  // contribution; `saved` is added to give the total `reachable`.
  const { reachable: t1Projected, basis } = computeT1Reachable(input, months);
  const priorDrawForLabel = Math.max(0, input.priorGoalsMonthlyDraw ?? 0);
  const t1Reachable = saved + t1Projected;
  const t1Description = composeTierDescription(
    saved,
    describeT1(basis, months, priorDrawForLabel),
  );
  const t1: TierResult = {
    tier: 'T1',
    achievable: allowed.has('surplus') && t1Reachable >= required,
    reachable: t1Reachable,
    savedSoFar: saved,
    projectedContribution: t1Projected,
    required,
    shortfall: Math.max(0, required - t1Reachable),
    description: t1Description,
    sources: [{ source: 'surplus', contributes: t1Projected }],
  };

  // T2 — surplus + EF tap. Pull from existing EF down to the safety
  // floor (one month of expenses when caller passes monthlyExpenses,
  // else a fraction of EF target as a legacy fallback). The
  // ef-tappable helper is the single source of truth for this math
  // across goals + EF advisor surfaces.
  const efAvailable = allowed.has('ef')
    ? efShortfallTappable({
        efBalance: input.efBalance,
        efTarget: input.efTarget,
        monthlyExpenses: input.monthlyExpenses,
      })
    : 0;
  const t2Reachable = t1Reachable + efAvailable;
  const t2: TierResult = {
    tier: 'T2',
    achievable: allowed.has('ef') && t2Reachable >= required,
    reachable: t2Reachable,
    savedSoFar: saved,
    projectedContribution: t1Projected + efAvailable,
    required,
    shortfall: Math.max(0, required - t2Reachable),
    description:
      allowed.has('ef')
        ? composeTierDescription(
            saved,
            `Surplus for ${months} months plus up to ${currencyShort(efAvailable)} tapped from your emergency fund (keeping one month of expenses as a safety floor).`,
          )
        : 'EF tap disabled on this goal — toggle it on if you want this option.',
    sources: [
      { source: 'surplus', contributes: t1Projected },
      { source: 'ef', contributes: efAvailable },
    ],
  };

  // T3 — last-resort: liquidation OR new loan, whichever the user
  // allows. Treated as alternatives, not additive — the card surfaces
  // both options for the user to pick. The `reachable` value is the
  // max of (T2 + liquidation) and (T2 + new_loan): "you can definitely
  // get here via at least one path."
  const liquidContribution = allowed.has('liquidation') ? liquidatableValue : 0;
  const t3LiquidReachable = t2Reachable + liquidContribution;
  const newLoanContribution = allowed.has('new_loan')
    ? Math.max(0, required - t2Reachable)
    : 0;
  const t3LoanReachable = t2Reachable + newLoanContribution;
  const t3Reachable = Math.max(t3LiquidReachable, t3LoanReachable);
  const t3: TierResult = {
    tier: 'T3',
    achievable: t3Reachable >= required,
    reachable: t3Reachable,
    savedSoFar: saved,
    projectedContribution: t3Reachable - saved,
    required,
    shortfall: Math.max(0, required - t3Reachable),
    description: composeTierDescription(
      saved,
      buildT3Description(
        allowed,
        t1Projected,
        efAvailable,
        liquidContribution,
        newLoanContribution,
        input.newLoanIndicativeRate,
        months,
      ),
    ),
    sources: [
      { source: 'surplus', contributes: t1Projected },
      { source: 'ef', contributes: efAvailable },
      { source: 'liquidation', contributes: liquidContribution },
      { source: 'new_loan', contributes: newLoanContribution },
    ],
  };

  return [t1, t2, t3];
}

function composeTierDescription(saved: number, forward: string): string {
  if (saved <= 0) return forward;
  return `Already saved ${currencyShort(saved)}. ${forward}`;
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
  saved: number,
  reason: string,
): TierResult {
  const reachable = Math.min(saved, required);
  return {
    tier,
    achievable: required > 0 && reachable >= required,
    reachable,
    savedSoFar: saved,
    projectedContribution: 0,
    required,
    shortfall: Math.max(0, required - reachable),
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
  parts.push(`Forward surplus over ${months} months: up to ${currencyShort(surplus)}.`);
  if (allowed.has('ef') && ef > 0) {
    parts.push(`Pull from emergency fund: up to ${currencyShort(ef)}.`);
  }
  if (allowed.has('liquidation') && liquid > 0) {
    parts.push(`Sell from portfolio: up to ${currencyShort(liquid)}.`);
  }
  if (allowed.has('new_loan') && newLoan > 0) {
    parts.push(
      `Or borrow ${currencyShort(newLoan)} at around ${(rate * 100).toFixed(1)}% (indicative).`,
    );
  }
  if (parts.length === 1) {
    parts.push('No backup sources enabled — turn one on above or adjust the goal.');
  }
  return parts.join(' ');
}

// ─── Earliest feasible date ────────────────────────────────────────────────

/**
 * Earliest month (counted from today, 1-based) at which `goal` could be
 * fully funded by pure surplus accumulation — accounting for the
 * engine's projected surplus series (when supplied), the draws already
 * committed to higher-priority goals, and the savedSoFar contributions
 * already on the ledger.
 *
 * Returns the number of months from now to the earliest feasible month
 * (where m=1 means "by next month"). Returns null when the goal cannot
 * be funded by surplus alone within a 50-year scan window — typically
 * because surplus minus prior-goal draws is ≤ 0 indefinitely.
 *
 * The walk mirrors `computeExtendMonthsBy` but starts at month 0 with no
 * lump-sum credit, so the answer is the unconditional "when does
 * forward surplus alone get me there?" — the answer to "what's the
 * soonest date I could put on this goal?"
 */
export function earliestFeasibleMonths(input: AchievabilityInput): number | null {
  const required = fundedAmount(input.goal);
  const remaining = required - input.savedSoFar;
  if (remaining <= 0) return 0;

  const series = input.monthlySurplusSeries;
  if (series && series.length > 0) {
    const priorByGoal = input.priorGoalsContributionsByMonth ?? {};
    const tail = series[series.length - 1] ?? 0;
    let cumulative = 0;
    const maxScan = series.length + 600;
    for (let m = 0; m < maxScan; m++) {
      const priorDraw = Object.values(priorByGoal).reduce(
        (s, arr) => s + (arr[m] ?? 0),
        0,
      );
      const available = m < series.length ? series[m] ?? 0 : tail;
      cumulative += Math.max(0, available - priorDraw);
      if (cumulative >= remaining) return m + 1;
    }
    return null;
  }

  const priorDraw = Math.max(0, input.priorGoalsMonthlyDraw ?? 0);
  const surplusRouting = Math.max(0, input.monthlySurplus - priorDraw);
  if (surplusRouting <= 0) return null;
  return Math.max(1, Math.ceil(remaining / surplusRouting));
}

/** YYYY-MM label for `monthsFromNow` months from `today`. */
export function monthsToTargetLabel(
  monthsFromNow: number,
  today: Date = new Date(),
): string {
  if (monthsFromNow <= 0) {
    return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;
  }
  const target = new Date(today.getFullYear(), today.getMonth() + monthsFromNow, 1);
  return `${target.getFullYear()}-${String(target.getMonth() + 1).padStart(2, '0')}`;
}

// ─── Honest "can't afford" levers ──────────────────────────────────────────

export interface ShortfallLevers {
  /** Extra months past the target date that would close the gap with
   *  current surplus + (optional) EF + liquid sources. 0 when the
   *  lump-sum sources alone already cover the gap (no extra time
   *  needed). Null only when surplus is zero AND lump-sum < required
   *  — i.e. the goal genuinely can't be reached by waiting. */
  extendMonthsBy: number | null;
  /** Lower the target amount by this much (in user ccy) to fit the
   *  current horizon + (optional) EF/liquid sources. Always ≥ 0. */
  lowerTargetBy: number;
  /** Extra monthly surplus needed to hit the goal on the current date,
   *  assuming ONLY surplus contributes — independent of EF/liquid
   *  toggles. This lets the UI show "increase surplus by X (or tap
   *  EF/portfolio instead)" without conflating two levers. Always ≥ 0. */
  increaseSurplusBy: number;
  /** Same lever as `increaseSurplusBy`, but counting EF/liquid lump
   *  sums as already-spent — i.e. "if you also tap EF + portfolio,
   *  this is what's left to find each month." Shown alongside
   *  `increaseSurplusBy` so the user can compare a surplus-only
   *  fix against a mixed approach. Always ≥ 0; ≤ increaseSurplusBy. */
  increaseSurplusByWithLumpSum: number;
  /** Total currency this goal would unlock if it were bumped ahead of
   *  earlier-dated goals (the prior-goal monthly draw, multiplied by
   *  this goal's window). 0 when no prior goals exist or when the goal
   *  is already at the front of the queue. */
  bumpPriorityGain: number;
  /** True when bumping priority alone makes the goal achievable
   *  without changing target/date/surplus — i.e. the prior-goal draw
   *  is the binding constraint. Lets the UI offer the bump as a
   *  one-click fix instead of just an informational note. */
  bumpPriorityClosesGap: boolean;
}

/**
 * Compute the "honest" levers shown when a goal isn't achievable with
 * the user's current surplus + allowed sources. Mirrors the
 * purchase-advisor levers but for savings goals.
 *
 *   • extendMonthsBy: keep target + surplus, push the date out. Walks
 *     forward through the engine surplus series (extrapolating the
 *     tail value when the series ends before the answer is found) so
 *     the lever uses actual post-hike / post-event surplus instead of
 *     the historical window's average.
 *   • lowerTargetBy:  keep date + surplus + lumpSum, drop the target.
 *   • increaseSurplusBy: keep date + target, increase monthly inflow.
 *     Reported as the SURPLUS-ONLY uplift needed (lumpSum sources
 *     treated as zero) so the label doesn't promise a fix that
 *     silently depends on tapping EF/portfolio.
 *   • increaseSurplusByWithLumpSum: same lever with lumpSum applied —
 *     for users who plan to tap EF/portfolio AND raise surplus.
 *
 * Returns them all so the UI can present a side-by-side picker. None
 * mutate the goal; the caller applies whichever the user chooses.
 */
export function computeShortfallLevers(input: AchievabilityInput): ShortfallLevers {
  const { goal, liquidatableValue } = input;
  const months = monthsUntil(input.goal);
  const required = fundedAmount(input.goal);
  const saved = Math.max(0, input.savedSoFar);
  if (months === 0 || required === 0 || saved >= required) {
    return {
      extendMonthsBy: null,
      lowerTargetBy: 0,
      increaseSurplusBy: 0,
      increaseSurplusByWithLumpSum: 0,
      bumpPriorityGain: 0,
      bumpPriorityClosesGap: false,
    };
  }

  const allowed = new Set(goal.fundingSources);
  const { reachable: surplusProjected } = computeT1Reachable(input, months);

  // Non-monthly contribution sources (EF + liquid, both lump-sum
  // assumptions). new_loan doesn't extend "feasible by time" so it
  // doesn't enter the extend-months lever. EF tappable is sourced
  // from the shared helper so this stays consistent with analyseGoal.
  const efAvailable = allowed.has('ef')
    ? efShortfallTappable({
        efBalance: input.efBalance,
        efTarget: input.efTarget,
        monthlyExpenses: input.monthlyExpenses,
      })
    : 0;
  const liquidAvailable = allowed.has('liquidation') ? liquidatableValue : 0;
  const lumpSum = efAvailable + liquidAvailable;

  // The user has saved `saved` so the gap to close is `required - saved`.
  // Every lever below works against this remaining gap, never the full
  // required amount, so partial progress isn't double-counted.
  const remainingToFund = required - saved;

  // extendMonthsBy: walk forward through the engine surplus series
  // accumulating month-by-month until cumulative ≥ (remainingToFund − lumpSum).
  // When the series ends before the answer, extrapolate the tail value
  // forward (same convention as computeT1Reachable). Null only when
  // surplus inflow is zero AND lumpSum can't cover the gap on its own.
  const remainingAfterLump = Math.max(0, remainingToFund - lumpSum);
  const extendMonthsBy = computeExtendMonthsBy(
    input,
    months,
    remainingAfterLump,
  );

  // lowerTargetBy: how much to chop from required so that
  //   saved + surplusProjected + lumpSum >= required'
  const reachableNow = saved + surplusProjected + lumpSum;
  const lowerTargetByPrecise = Math.max(0, required - reachableNow);

  // increaseSurplusBy: per-month uplift needed if the user is NOT
  // tapping EF/portfolio. Derived from the surplus-only gap on the
  // remaining-to-fund amount so the label matches what the lever
  // actually fixes.
  const surplusOnlyGap = Math.max(0, remainingToFund - surplusProjected);
  const increaseSurplusBy = months > 0 ? Math.ceil(surplusOnlyGap / months) : 0;

  // increaseSurplusByWithLumpSum: same lever assuming the user also
  // taps EF/portfolio. Always ≤ increaseSurplusBy.
  const increaseSurplusByWithLumpSum =
    months > 0 ? Math.ceil(lowerTargetByPrecise / months) : 0;

  // bumpPriority: would unlocking the prior-goal monthly draw close
  // the gap? Counts the per-month claim higher-priority goals are
  // currently taking, summed across this goal's window. When the
  // per-month series is available we use it directly (captures
  // deferred goals concentrating draws into the tail); otherwise fall
  // back to the flat priorGoalsMonthlyDraw × months estimate.
  const priorByGoal = input.priorGoalsContributionsByMonth ?? {};
  let bumpPriorityGain = 0;
  if (Object.keys(priorByGoal).length > 0) {
    for (const arr of Object.values(priorByGoal)) {
      for (let m = 0; m < months; m++) {
        bumpPriorityGain += arr[m] ?? 0;
      }
    }
  } else {
    bumpPriorityGain = Math.max(0, input.priorGoalsMonthlyDraw ?? 0) * months;
  }
  // surplusProjected already had prior draws subtracted; adding the
  // gain back simulates "what if this goal were at the front of the
  // queue." Compare with saved + lumpSum + bumped projection.
  const projectionIfBumped = surplusProjected + bumpPriorityGain;
  const bumpPriorityClosesGap =
    bumpPriorityGain > 0 &&
    saved + projectionIfBumped + lumpSum >= required;

  return {
    extendMonthsBy,
    lowerTargetBy: Math.round(lowerTargetByPrecise),
    increaseSurplusBy,
    increaseSurplusByWithLumpSum,
    bumpPriorityGain: Math.round(bumpPriorityGain),
    bumpPriorityClosesGap,
  };
}

function computeExtendMonthsBy(
  input: AchievabilityInput,
  months: number,
  remainingAfterLump: number,
): number | null {
  if (remainingAfterLump <= 0) {
    // saved-so-far plus lump-sum sources already cover the gap — no
    // extra time needed.
    return 0;
  }
  const series = input.monthlySurplusSeries;
  if (series && series.length > 0) {
    const priorByGoal = input.priorGoalsContributionsByMonth ?? {};
    const tail = series[series.length - 1] ?? 0;
    let cumulative = 0;
    // Walk forward from month 0; goal achievability is hit when
    // cumulative ≥ remainingAfterLump. Return the OVERFLOW past the
    // original target month (m+1 ≥ months → m+1 − months).
    // Cap forward extrapolation: if tail ≤ 0, no infinite extend works.
    const maxScan = Math.max(months, series.length) + 600; // 50yr safety
    for (let m = 0; m < maxScan; m++) {
      const priorDraw = Object.values(priorByGoal).reduce(
        (s, arr) => s + (arr[m] ?? 0),
        0,
      );
      const available =
        m < series.length ? series[m] ?? 0 : tail;
      cumulative += Math.max(0, available - priorDraw);
      if (cumulative >= remainingAfterLump) {
        return Math.max(0, m + 1 - months);
      }
    }
    // Couldn't close even after maxScan — surplus tail too low.
    return null;
  }
  // Flat fallback when no engine series wired through.
  const priorDraw = Math.max(0, input.priorGoalsMonthlyDraw ?? 0);
  const surplusRouting = Math.max(0, input.monthlySurplus - priorDraw);
  if (surplusRouting <= 0) return null;
  return Math.max(0, Math.ceil(remainingAfterLump / surplusRouting) - months);
}
