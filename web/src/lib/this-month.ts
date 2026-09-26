/**
 * This month's move, read off the plan's first month: the extra each loan
 * gets above its minimum, and the emergency-fund and goal shares. Home
 * shows this, so it matches /plan (it used to guess "the whole surplus to
 * the highest-rate loan" three different ways, ignoring the strategy and
 * the emergency-fund split).
 */
import type { PlanData } from '@/components/plan/PlanData';

export interface MoveTarget {
  /** Position in user.loans. */
  index: number;
  /** Extra above the minimum this month, rounded to the rupee/dollar. */
  amount: number;
}

export interface ThisMonthMove {
  /** Loans getting extra, largest first. */
  targets: MoveTarget[];
  ef: number;
  goals: number;
  surplus: number;
}

/** Null when the plan didn't come from the engine (offline sample). */
export function thisMonthMove(plan: PlanData): ThisMonthMove | null {
  if (!plan.live) return null;
  const pay = plan.monthlyPayments.find((p) => p.month === 1)?.perLoan ?? {};
  const min = plan.firstMonthMinimums;
  const targets = Object.keys(pay)
    .map(Number)
    .map((index) => ({ index, amount: Math.round(Number(pay[index]) - Number(min[index] ?? 0)) }))
    .filter((t) => t.amount >= 1)
    .sort((a, b) => b.amount - a.amount);
  const a = plan.surplusAllocation;
  return {
    targets,
    ef: Math.round(a?.efSlice ?? 0),
    goals: Math.round(a?.goalSlice ?? 0),
    surplus: Math.round(a?.surplus ?? plan.surplus),
  };
}
