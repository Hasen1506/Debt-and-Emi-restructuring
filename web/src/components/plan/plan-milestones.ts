/**
 * When each loan clears on the plan's schedule, read off the engine's
 * per-loan balances. Shared by the trajectory chart's markers and the
 * amortisation table's ★ rows so the two can't disagree.
 */
import type { PlanData } from './PlanData';
import { LOAN_TYPE_NAME } from '@/lib/loan-types';

export interface LoanClear {
  index: number;
  /** The month the balance reaches 0 and stays there (1 = this month). */
  month: number;
  /** "Credit card", or "HDFC credit card" when two loans share a type. */
  name: string;
}

/** Loans that clear within the trajectory, earliest first. A loan that's
 *  still open at the end of it, or never had a balance, is left out. */
export function loanClears(plan: PlanData): LoanClear[] {
  const { loans } = plan.user;
  const traj = plan.trajectory;
  const lastMonth = traj[traj.length - 1]?.month ?? 0;
  const typeCount = new Map<string, number>();
  for (const l of loans) typeCount.set(l.loan_type, (typeCount.get(l.loan_type) ?? 0) + 1);
  const out: LoanClear[] = [];
  loans.forEach((loan, index) => {
    if (!traj.some((p) => p.balancesByLoanIndex)) return;
    // The month after the last one with a balance. A loan that starts
    // later (planned) has 0 until then, so only the last balance counts.
    let lastOwed = 0;
    for (const p of traj) {
      if (Number(p.balancesByLoanIndex?.[index] ?? 0) > 0.01) lastOwed = p.month;
    }
    const owedToday = Number(loan.outstanding || 0) > 0.01 && !(loan.planned_effective_month && loan.planned_effective_month > 1);
    // Paid off in month 1: no month had a balance after its payment.
    const month = lastOwed > 0 ? lastOwed + 1 : owedToday ? 1 : 0;
    if (month === 0 || month > lastMonth) return;
    const type = LOAN_TYPE_NAME[loan.loan_type];
    const name =
      (typeCount.get(loan.loan_type) ?? 0) > 1 && loan.bank
        ? `${loan.bank.replace(/\s+bank$/i, '')} ${type}`
        : type.charAt(0).toUpperCase() + type.slice(1);
    out.push({ index, month, name });
  });
  return out.sort((a, b) => a.month - b.month || a.index - b.index);
}
