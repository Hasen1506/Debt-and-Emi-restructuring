import type { LoanPayload } from './api';

/** Planned drafts aren't stored loans and cannot receive a saved rate change. */
export function isOpenCurrentLoan(loan: LoanPayload | undefined): loan is LoanPayload {
  const balance = Number(loan?.outstanding);
  return !!loan && Number.isFinite(balance) && balance > 0 && !loan.planned_effective_month;
}

/** Pick only from the options the user can actually see. */
export function rateChangeLoanIndex(loans: LoanPayload[], requested?: number): number {
  if (requested != null && isOpenCurrentLoan(loans[requested])) return requested;
  const floating = loans.findIndex(l => isOpenCurrentLoan(l) && l.rate_type === 'floating');
  return floating >= 0 ? floating : loans.findIndex(isOpenCurrentLoan);
}

/** An older form may have opened before the automatic ID migration.
 * Accept only a unique unchanged snapshot; never transfer it to a neighbour. */
export function currentLoanIndex(ref: {loanIndex: number; loanId?: string}, legacy: LoanPayload | undefined, loans: LoanPayload[]): number {
  if (ref.loanId) return loans.findIndex(l => l.id === ref.loanId);
  if (!legacy) return -1;
  const snapshot = (l: LoanPayload) => JSON.stringify({...l, id: undefined});
  const matching = loans.map((loan,index) => ({loan,index})).filter(x => snapshot(x.loan) === snapshot(legacy));
  return matching.length === 1 ? matching[0].index : -1;
}
