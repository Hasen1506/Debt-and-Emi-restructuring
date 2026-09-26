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
