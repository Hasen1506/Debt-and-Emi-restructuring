/**
 * Shared loan-type label tables. Previously duplicated across five
 * components — see ActivityImpactBanner, ActivityLedger, LedgerScheduleTable,
 * TaxBreakdown.
 */

import type { LoanType } from '@/lib/api';

/** Short-form label for chips / inline tags: "home", "auto", "card" … */
export const LOAN_TYPE_SHORT: Record<LoanType, string> = {
  home_loan: 'home',
  auto_loan: 'auto',
  personal_loan: 'personal',
  credit_card: 'card',
  education_loan: 'education',
  gold_loan: 'gold',
  bnpl: 'BNPL',
};

/** Full name for sentences: "HDFC credit card", "SBI home loan". */
export const LOAN_TYPE_NAME: Record<LoanType, string> = {
  home_loan: 'home loan',
  auto_loan: 'car loan',
  personal_loan: 'personal loan',
  credit_card: 'credit card',
  education_loan: 'education loan',
  gold_loan: 'gold loan',
  bnpl: 'BNPL',
};

/** Starts a line or fills a label: "Home loan", or "HDFC credit card"
 *  when the lender is on file (its own capitals, " Bank" dropped). */
export function loanLabel(l: { bank?: string | null; loan_type: LoanType }): string {
  const t = LOAN_TYPE_NAME[l.loan_type];
  const bank = (l.bank ?? '').replace(/\s+bank$/i, '').trim();
  return bank ? `${bank} ${t}` : t.charAt(0).toUpperCase() + t.slice(1);
}
