/**
 * One goal's numbers for the Goals ledger (REDESIGN R5.1): what's needed,
 * what's saved, how much a month from when, and its status. The ledger
 * row, the OPEN panel and the new-goal preview all read this, so they
 * can't disagree (the old page showed "₹1,05,000/mo for 15 months" and
 * "about 49k a month from now" for the same goal).
 */
import Decimal from 'decimal.js';
import { compareGoalsForOrder, fundedAmount, isOpenGoal, monthsUntil, type Goal } from './goals';
import { planDefersForGoals } from './goal-defer';
import { projectedLiquidatableValue } from './asset-returns';
import type { UserPayload } from './api';
import {
  analyseGoal,
  computeShortfallLevers,
  recommendedTier,
  type AchievabilityInput,
  type ShortfallLevers,
  type TierResult,
} from './achievability';
import type { GoalDeferResult } from './goal-defer';
import { deriveMetrics } from './derived';

/** Take-home less spending and EMIs: what a month leaves for goals. */
export function monthlySpare(user: UserPayload): number {
  const metrics = deriveMetrics({ user, marginalRate: '0', creditScore: null, isLive: true });
  return metrics.fxMissing.length ? 0 : Math.max(0, metrics.surplus.toNumber());
}

/**
 * Everything goalLine needs, for a set of open goals. Goals are taken in
 * the order they're funded (★ first, then by date), and each one sees
 * the spare cash the goals ahead of it leave.
 */
export function goalContext({
  goals,
  saved,
  user,
  today,
  indicativeRate,
}: {
  goals: Goal[];
  saved: Record<string, number>;
  user: UserPayload;
  today: Date;
  indicativeRate: number;
}): GoalContext {
  const monthlySurplus = monthlySpare(user);
  const planProjects = (user.loans ?? []).some((l) => Number(l.outstanding) > 0);
  const open = goals.filter(isOpenGoal).sort(compareGoalsForOrder);
  const maxTarget = open.reduce((m, g) => Math.max(m, monthsUntil(g, today)), 0);
  const series = new Array<number>(maxTarget).fill(monthlySurplus);
  const rows = open.map((g) => ({
    id: g.id,
    targetMonthIndex: monthsUntil(g, today),
    requiredAmount: fundedAmount(g),
    savedSoFar: saved[g.id] ?? 0,
  }));
  const defer: Record<string, GoalDeferResult> = {};
  const priorContribs: Record<string, Record<string, number[]>> = {};
  if (planProjects) {
    const planned = planDefersForGoals(rows, series);
    for (const r of planned.suggestions) defer[r.goalId] = r;
    const seen: Record<string, number[]> = {};
    for (const id of planned.orderedGoalIds) {
      priorContribs[id] = { ...seen };
      const draws = planned.proposedContributionsByGoal[id];
      if (draws) seen[id] = draws;
    }
  } else {
    // No debts: every goal saves from now, each taking what it needs
    // from what the goals ahead of it leave.
    const used = new Array<number>(maxTarget).fill(0);
    const seen: Record<string, number[]> = {};
    for (const r of rows) {
      priorContribs[r.id] = { ...seen };
      const need = r.targetMonthIndex > 0 ? Math.max(0, r.requiredAmount - r.savedSoFar) / r.targetMonthIndex : 0;
      const draws = new Array<number>(maxTarget).fill(0);
      for (let m = 0; m < r.targetMonthIndex; m++) {
        draws[m] = Math.min(need, Math.max(0, monthlySurplus - used[m]));
        used[m] += draws[m];
      }
      seen[r.id] = draws;
    }
  }
  const priorDraw: Record<string, number> = {};
  for (const r of rows) {
    if (r.targetMonthIndex <= 0) {
      priorDraw[r.id] = 0;
      continue;
    }
    let sum = 0;
    for (const arr of Object.values(priorContribs[r.id] ?? {})) {
      for (let m = 0; m < r.targetMonthIndex; m++) sum += arr[m] ?? 0;
    }
    priorDraw[r.id] = sum / r.targetMonthIndex;
  }
  const liquid = (user.assets ?? []).filter((a) => a.user_marks_liquid !== false);
  return {
    today,
    monthlySurplus,
    efBalance: Number(user.efund_balance || '0'),
    efTarget: Number(user.efund_target || '0'),
    totalExpenses: Number(user.fixed_expenses || '0') + Number(user.variable_expenses || '0'),
    planProjects,
    liquidatableValue: (g) => projectedLiquidatableValue(liquid, user.country, monthsUntil(g, today), user.asset_returns),
    indicativeRate,
    series,
    priorDraw,
    priorContribs,
    defer,
  };
}

export type GoalState =
  | 'funded'
  | 'on_track'
  | 'needs_backup'
  | 'short'
  | 'past'
  | 'no_amount'
  | 'closed';

export interface GoalContext {
  today: Date;
  monthlySurplus: number;
  efBalance: number;
  efTarget: number;
  totalExpenses: number;
  /** Debts to clear: saving for a goal waits for them (auto-defer). */
  planProjects: boolean;
  liquidatableValue: (goal: Goal) => number;
  indicativeRate: number;
  series: number[];
  priorDraw: Record<string, number>;
  priorContribs: Record<string, Record<string, number[]>>;
  defer: Record<string, GoalDeferResult>;
}

export interface GoalLine {
  required: number;
  saved: number;
  remaining: number;
  pct: number;
  months: number;
  /** Put aside a month, from `startIndex` months from now. */
  monthly: number;
  startIndex: number;
  state: GoalState;
  tiers: TierResult[];
  rec: TierResult | null;
  levers: ShortfallLevers | null;
}

export function goalLine(goal: Goal, saved: number, ctx: GoalContext): GoalLine {
  const required = fundedAmount(goal);
  const months = monthsUntil(goal, ctx.today);
  const remaining = Math.max(0, required - saved);
  const pct = required > 0 ? Math.min(100, (saved / required) * 100) : 0;
  const base = { required, saved, remaining, pct, months, tiers: [] as TierResult[], rec: null, levers: null };
  if (!isOpenGoal(goal)) return { ...base, monthly: 0, startIndex: 0, state: 'closed' };
  if (required <= 0) return { ...base, monthly: 0, startIndex: 0, state: 'no_amount' };
  if (remaining <= 0) return { ...base, monthly: 0, startIndex: 0, state: 'funded' };
  if (months <= 0) return { ...base, monthly: remaining, startIndex: 0, state: 'past' };

  const input: AchievabilityInput = {
    goal,
    savedSoFar: saved,
    monthlySurplus: ctx.monthlySurplus,
    efBalance: ctx.efBalance,
    efTarget: ctx.efTarget,
    monthlyExpenses: ctx.totalExpenses,
    priorGoalsMonthlyDraw: ctx.priorDraw[goal.id] ?? 0,
    monthlySurplusSeries: ctx.series,
    priorGoalsContributionsByMonth: ctx.priorContribs[goal.id] ?? {},
    seriesQuality: 'flat',
    planProjects: ctx.planProjects,
    liquidatableValue: ctx.liquidatableValue(goal),
    newLoanIndicativeRate: ctx.indicativeRate,
  };
  const tiers = analyseGoal(input);
  const rec = recommendedTier(tiers);
  const onTrack = tiers[0]?.achievable ?? false;
  const state: GoalState = onTrack ? 'on_track' : rec.achievable ? 'needs_backup' : 'short';
  const levers = onTrack ? null : computeShortfallLevers(input);

  // With debts to clear, saving waits until the last month that still
  // makes the date (the debts get the spare cash until then). Without
  // debts there's nothing to wait for.
  const d = ctx.defer[goal.id];
  const deferred = ctx.planProjects && goal.autoDefer !== false && d && !d.unreachable && d.startMonthIndex > 0;
  const startIndex = deferred ? d.startMonthIndex : 0;
  const monthly = deferred ? d.fundingMonthlyRate : remaining / months;
  return { required, saved, remaining, pct, months, monthly, startIndex, state, tiers, rec, levers };
}

export const GOAL_STATE_LABEL: Record<GoalState, string> = {
  funded: 'FUNDED',
  on_track: 'ON TRACK',
  needs_backup: 'NEEDS BACKUP',
  short: 'SHORT',
  past: 'DATE PASSED',
  no_amount: 'NO AMOUNT',
  closed: 'CLOSED',
};

export function goalStateTone(s: GoalState): 'pos' | 'neg' | 'accent' | null {
  if (s === 'funded' || s === 'on_track') return 'pos';
  if (s === 'short' || s === 'past') return 'neg';
  if (s === 'needs_backup') return 'accent';
  return null;
}
