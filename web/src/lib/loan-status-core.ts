/** Round 3 (#13, #21): debt status and salary-deduction predicates, without
 *  the copy in lib/loan-status (kept small: lib/derived is in most routes). */
import type { LoanType } from './api';
import type { DebtStatus } from './loan-status';

type StatusLoan = { debt_status?: DebtStatus; overdue_amount?: string | null; scheduled_emi?: string };

export function debtStatus(l: { debt_status?: DebtStatus }): DebtStatus {
  return l.debt_status ?? 'normal';
}

/** Behind or with collectors: no "pay the minimum" advice for this loan. */
export function needsHelp(l: { debt_status?: DebtStatus }): boolean {
  const s = debtStatus(l);
  return s === 'behind' || s === 'collections';
}

export function isSettled(l: { debt_status?: DebtStatus }): boolean {
  return debtStatus(l) === 'settled';
}

/** Salary deduction makes sense for EMI loans, not cards or pay-later. */
export function canBeSalaryDeducted(t: LoanType): boolean {
  return t !== 'credit_card' && t !== 'bnpl';
}

/** The EMIs not already taken out of take-home (#21). */
export function emiOffTakeHome(l: { salary_deducted?: boolean; debt_status?: DebtStatus }): boolean {
  return !l.salary_deducted && !isSettled(l);
}

/** Founder 17 Oct 2026 (engine/debt_status.py): what a behind loan is behind
 *  by, in its own currency. Left blank, one EMI (`estimated`), as the engine. */
export function overdueOf(l: StatusLoan, minimum?: number): { amount: number; estimated: boolean } {
  const typed = Number(l.overdue_amount);
  if (l.overdue_amount != null && l.overdue_amount !== '' && Number.isFinite(typed) && typed >= 0) return { amount: typed, estimated: false };
  return { amount: Math.max(0, minimum ?? (Number(l.scheduled_emi) || 0)), estimated: true };
}

type LoggedEntry = { loanIndex: number; loanId?: string; kind: string; date: string; amount: string };

/** What has been logged on a behind loan since it was marked behind
 *  (`overdue_as_of`; without it, this month), and whether that covers the
 *  overdue amount: then Home asks to set the loan back to paying normally. */
export function catchUpProgress(
  l: StatusLoan & { id?: string; overdue_as_of?: string },
  index: number,
  entries: LoggedEntry[],
  todayIso: string,
): { logged: number; overdue: number; estimated: boolean; caughtUp: boolean } {
  const { amount, estimated } = overdueOf(l);
  const since = l.overdue_as_of ?? `${todayIso.slice(0, 7)}-01`;
  const logged = entries
    .filter((e) => (l.id && e.loanId ? e.loanId === l.id : e.loanIndex === index) && e.date >= since
      && (e.kind === 'paid_full' || e.kind === 'paid_partial' || e.kind === 'paid_extra' || e.kind === 'closed'))
    .reduce((s, e) => s + (Number(e.amount) || 0), 0);
  return { logged, overdue: amount, estimated, caughtUp: debtStatus(l) === 'behind' && amount > 0 && logged >= amount };
}
