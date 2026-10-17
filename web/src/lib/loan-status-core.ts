/** Round 3 (#13, #21): debt status and salary-deduction predicates, without
 *  the copy in lib/loan-status (kept small: lib/derived is in most routes). */
import type { LoanType } from './api';
import type { DebtStatus } from './loan-status';

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
