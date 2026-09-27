/**
 * This month's move, read off the plan's first month: the extra each loan
 * gets above its minimum, and the emergency-fund and goal shares. Home
 * shows this, so it matches /plan (it used to guess "the whole surplus to
 * the highest-rate loan" three different ways, ignoring the strategy and
 * the emergency-fund split).
 */
import type { PlanData } from '@/components/plan/PlanData';
import { loanToUser } from '@/lib/currency';

export interface MoveTarget {
  /** Position in user.loans. */
  index: number;
  /** Extra above the minimum this month, in the loan's own currency,
   *  rounded to the rupee/dollar. */
  amount: number;
  /** The same in the user's currency (what it costs out of the surplus). */
  amountUser: number;
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
  const { country, loans } = plan.user;
  const targets = Object.keys(pay)
    .map(Number)
    .map((index) => {
      const amount = Math.round(Number(pay[index]) - Number(min[index] ?? 0));
      const user = loans[index] ? loanToUser(amount, loans[index], country, plan.fxRatesUsed) : amount;
      return { index, amount, amountUser: Math.round(user ?? amount) };
    })
    .filter((t) => t.amount >= 1)
    // Largest first in one currency: ₹4.8 lakh is not more than $6,000.
    .sort((a, b) => b.amountUser - a.amountUser);
  const a = plan.surplusAllocation;
  return {
    targets,
    ef: Math.round(a?.efSlice ?? 0),
    goals: Math.round(a?.goalSlice ?? 0),
    surplus: Math.round(a?.surplus ?? plan.surplus),
  };
}
