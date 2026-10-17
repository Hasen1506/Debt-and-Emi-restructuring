/**
 * UX2 #20: after a lump sum, "lower your EMI or finish sooner?" is the
 * borrower's call. RightDue asks and never picks one silently.
 *
 * India: banks ask which one, and with no instruction they cut the months
 * (HSBC India home loan page; Axis Bank part-payment help; engine/prepay_choice.py
 * has the quotes and URLs). USA: the payment stays and the loan ends sooner;
 * a lower payment needs a "recast" the servicer agrees to, often for a fee,
 * and FHA, VA and USDA loans can't be recast (chase.com/personal/mortgage/recast,
 * read 17 Oct 2026).
 */
import type { Country, LoanPayload, PrepayMode, UserPayload } from './api';
import { balanceEditEntries, readActivityClient, type ActivityEntry, type BalanceDropReason } from './activity';
import { commitActivity } from './commit-activity';
import { emiFor } from './rate-decision';
import { loadProfileClient, saveProfileClient } from './user-store';
import { resolveLoanIndex } from './loan-ids';

export type { PrepayMode };

/** Loans the question applies to: an EMI loan, not a card. */
export function asksPrepayChoice(loan: LoanPayload | undefined): boolean {
  return !!loan && loan.loan_type !== 'credit_card' && Number(loan.scheduled_emi) > 0 &&
    Number(loan.tenure_months_remaining) > 0 && Number(loan.outstanding) > 0;
}

/** The EMI after `principalPaid` comes off, over the months left; never above
 *  today's EMI. Null when the payment clears the loan or the loan has no EMI. */
export function lowerEmiAfter(loan: LoanPayload, principalPaid: number): number | null {
  if (!asksPrepayChoice(loan)) return null;
  const left = Number(loan.outstanding) - principalPaid;
  if (!(left > 0)) return null;
  const next = emiFor(left, Number(loan.nominal_rate) || 0, Number(loan.tenure_months_remaining));
  return Math.round(Math.min(Number(loan.scheduled_emi), next) * 100) / 100;
}

export const PREPAY_LABEL: Record<PrepayMode, { in: string; us: string }> = {
  reduce_tenure: { in: 'Finish sooner (keep my EMI)', us: 'Finish sooner (keep my payment)' },
  reduce_emi: { in: 'Lower my EMI (same end date)', us: 'Lower my payment (a recast)' },
};

export function prepayLabel(mode: PrepayMode, country: Country): string {
  return PREPAY_LABEL[mode][country === 'US' ? 'us' : 'in'];
}

/** What to tell the bank, by country. */
export function prepayChoiceNote(country: Country): string {
  return country === 'US'
    ? 'In the US an extra payment leaves your monthly payment as it is and the loan ends sooner. A lower payment needs a recast: ask your servicer. It often has a fee, and FHA, VA and USDA loans can’t be recast.'
    : 'Your bank asks which one. Tell it in writing when you pay: with no instruction, most banks keep the EMI and cut the months.';
}

/** 'reduce_emi': write the lower EMI into the saved profile (the bank's new
 *  EMI is the contract from now on). False when the loan changed or the
 *  browser didn't keep the save. */
export function saveLowerEmi(ref: { loanIndex: number; loanId?: string }, newEmi: number): boolean {
  const stored = loadProfileClient();
  const i = resolveLoanIndex(ref, stored.user.loans);
  const loan = stored.user.loans[i];
  if (!loan || !(newEmi > 0) || newEmi >= Number(loan.scheduled_emi)) return false;
  const loans = stored.user.loans.map((l, k) => (k === i ? { ...l, scheduled_emi: newEmi.toFixed(2) } : l));
  return saveProfileClient({ ...stored, user: { ...stored.user, loans } });
}

/** The Activity fields for a prepayment's answer (decimal strings). */
export function prepayFields(mode: PrepayMode, emiBefore: string | number, emiAfter: number | null): { prepayMode: PrepayMode; emiBefore?: string; emiAfter?: string } {
  return mode === 'reduce_emi' && emiAfter && emiAfter > 0
    ? { prepayMode: mode, emiBefore: Number(emiBefore).toFixed(2), emiAfter: emiAfter.toFixed(2) }
    : { prepayMode: mode };
}

/** UX2 #20: how much lower an EMI loan's balance is than the saved one (0
 *  for a card, a new loan, or a rise). */
export function balanceDropOf(loan: LoanPayload, saved: LoanPayload[]): number {
  const before = loan.id ? saved.find((p) => p.id === loan.id) : undefined;
  if (!before || loan.loan_type === 'credit_card' || !(Number(loan.outstanding) >= 0)) return 0;
  // A country switch converted it (₹ -> $): a smaller number, not a lower balance.
  if (before.currency && loan.currency && before.currency !== loan.currency) return 0;
  return Math.max(0, Number(before.outstanding) - Number(loan.outstanding));
}

/** UX2 #20: after a Profile save, log each lowered balance in Activity as
 *  the prepayment or correction the user said it was (lib/activity
 *  balanceEditEntries). The profile is already saved, so a failure here
 *  only loses the record. */
export function logBalanceDrops(savedBefore: LoanPayload[], user: UserPayload, reasons: Record<string, BalanceDropReason>, today: string, recordedAt: string): void {
  const stamp = Date.now().toString(36);
  const added: ActivityEntry[] = balanceEditEntries(savedBefore, user.loans, reasons, today, recordedAt)
    .map((e, k) => ({ ...e, id: `edit_${stamp}_${k}` }));
  if (added.length === 0) return;
  try {
    commitActivity([...added, ...readActivityClient()], user);
  } catch {
    /* commitActivity rolled back; the saved profile stands. */
  }
}
