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

/** The user's own name for a loan (live test #4: "Dad's car loan"), trimmed
 *  and kept short; '' when there is none. Profile → Loans sets it. */
export const NICKNAME_MAX = 40;
export function loanNickname(l: { nickname?: string | null }): string {
  return (l.nickname ?? '').replace(/\s+/g, ' ').trim().slice(0, NICKNAME_MAX);
}

function bankAndType(l: { bank?: string | null; loan_type: LoanType }): string {
  const bank = (l.bank ?? '').replace(/\s+bank$/i, '').trim();
  return bank ? `${bank} ${LOAN_TYPE_NAME[l.loan_type]}` : LOAN_TYPE_NAME[l.loan_type];
}

/** Starts a line or fills a label: "Home loan", or "HDFC credit card"
 *  when the lender is on file (its own capitals, " Bank" dropped). With a
 *  nickname: "Dad's car loan (HDFC car loan)". */
export function loanLabel(l: { bank?: string | null; loan_type: LoanType; nickname?: string | null }): string {
  const base = bankAndType(l);
  const hasBank = (l.bank ?? '').trim() !== '';
  const cap = hasBank ? base : base.charAt(0).toUpperCase() + base.slice(1);
  const nick = loanNickname(l);
  return nick ? `${nick} (${base})` : cap;
}

/** Mid-sentence: "home loan", or "HDFC credit card" with a lender, or the
 *  user's own name for it. */
export function loanName(l: { bank?: string | null; loan_type: LoanType; nickname?: string | null }): string {
  return loanNickname(l) || bankAndType(l);
}
