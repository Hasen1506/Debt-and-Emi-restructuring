/**
 * Founder, 18 Oct 2026: every money figure the "How much a month toward
 * debts?" prompt and the TO DEBTS chip suggest says how it was arrived at,
 * in one line, from the figures the plan itself uses, so the sum matches:
 *
 *   All spare cash ₹X = take-home ₹A − costs ₹B − emergency fund ₹C
 *                       [− goals ₹G] [− other set-asides ₹R]
 *   EMIs and minimums ₹Y = card minimum ₹10,000 [+ home loan EMI ₹…]
 *   Suggested ₹S = halfway between ₹Y and ₹X
 *
 * A, B: what /simulate gets (runArgs.user: take-home, fixed + variable
 * spending). C, G: the engine's first-month split (surplus_allocation).
 * Y: this month's EMIs and minimums (firstMonthMinimums). X: Y plus the
 * engine's debt slice. R is whatever else the engine holds back first
 * (a fixed emergency-fund top-up, gap repayment); it is the difference of
 * the rounded terms, so the line always adds up to the rupee.
 */
import type { PlanData } from '@/components/plan/PlanData';
import { loanToUser } from './currency';
import { loanLabel } from './loan-types';

export interface DebtBudgetFigures {
  takeHome: number;
  costs: number;
  fund: number;
  goals: number;
  other: number;
  /** This month's EMIs and minimums (user's currency, whole units). */
  required: number;
  /** EMIs and minimums plus all spare cash. */
  allSpare: number;
  /** Suggested set total. */
  suggested: number;
  minimums: { label: string; amount: number; card: boolean }[];
}

type PlanSlice = Pick<PlanData, 'user' | 'runArgs' | 'firstMonthMinimums' | 'fxRatesUsed' | 'surplus' | 'surplusAllocation'>;

export function debtBudgetFigures(plan: PlanSlice): DebtBudgetFigures {
  const u = plan.runArgs?.user ?? plan.user;
  const minimums = Object.entries(plan.firstMonthMinimums ?? {})
    .map(([i, v]) => {
      const loan = plan.user.loans[Number(i)];
      if (!loan) return null;
      const amount = Math.round(loanToUser(Number(v), loan, plan.user.country, plan.fxRatesUsed) ?? Number(v));
      return amount > 0 ? { label: loanLabel(loan), amount, card: loan.loan_type === 'credit_card' } : null;
    })
    .filter((m): m is NonNullable<typeof m> => m !== null);
  const required = minimums.reduce((s, m) => s + m.amount, 0);
  const a = plan.surplusAllocation;
  const extra = Math.round(Math.max(0, a ? a.debtSlice : plan.surplus || 0));
  const allSpare = required + extra;
  const takeHome = Math.round(Number(u.monthly_income) || 0);
  const costs = Math.round((Number(u.fixed_expenses) || 0) + (Number(u.variable_expenses) || 0));
  const fund = Math.round(Math.max(0, a?.efSlice ?? 0));
  const goals = Math.round(Math.max(0, a?.goalSlice ?? 0));
  const other = takeHome - costs - fund - goals - allSpare;
  // Never suggest less than the EMIs and minimums the plan pays anyway (fix 25).
  const suggested = Math.round(Math.max(required, (required + allSpare) / 2));
  return { takeHome, costs, fund, goals, other, required, allSpare, suggested, minimums };
}

/** "₹98,646 = take-home ₹1,50,000 − costs ₹40,000 − emergency fund ₹11,354
 *  (₹10,000 of EMIs and minimums + ₹88,646 extra)". */
export function allSpareLine(f: DebtBudgetFigures, money: (v: number) => string): string {
  const parts = [`take-home ${money(f.takeHome)}`, `costs ${money(f.costs)}`];
  if (f.fund > 0) parts.push(`emergency fund ${money(f.fund)}`);
  if (f.goals > 0) parts.push(`goals ${money(f.goals)}`);
  let line = `${money(f.allSpare)} = ${parts.join(' − ')}`;
  if (f.other >= 1) line += ` − other set-asides ${money(f.other)}`;
  else if (f.other <= -1) line += ` + ${money(-f.other)} the plan finds elsewhere`;
  return `${line} (${money(f.required)} of EMIs and minimums + ${money(f.allSpare - f.required)} extra)`;
}

/** "₹10,000 = Axis credit card minimum ₹10,000 + Home loan EMI ₹30,000". */
export function minimumsLine(f: DebtBudgetFigures, money: (v: number) => string, emiWord = 'EMI'): string {
  if (f.minimums.length === 0) return `${money(0)}: nothing is due this month`;
  return `${money(f.required)} = ${f.minimums.map((m) => `${m.label} ${m.card ? 'minimum' : emiWord} ${money(m.amount)}`).join(' + ')}`;
}

/** "Suggested ₹54,323 = halfway between EMIs and minimums ₹10,000 and all spare cash ₹98,646". */
export function suggestedLine(f: DebtBudgetFigures, money: (v: number) => string): string {
  if (f.suggested <= f.required) return `Suggested ${money(f.suggested)} = your EMIs and minimums; nothing is spare above them`;
  return `Suggested ${money(f.suggested)} = halfway between EMIs and minimums ${money(f.required)} and all spare cash ${money(f.allSpare)}`;
}
