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

/** Short names for an automatic label: "Card 1", "Personal loan 2" (E3). */
const AUTO_LABEL: Record<LoanType, string> = {
  home_loan: 'Home loan',
  auto_loan: 'Car loan',
  personal_loan: 'Personal loan',
  credit_card: 'Card',
  education_loan: 'Education loan',
  gold_loan: 'Gold loan',
  bnpl: 'BNPL',
};

/**
 * Audit 80 E3: three cards with no lender all read "Credit card" on Home,
 * Activity and Plan, and the plan's "put ₹400 extra on your credit card"
 * couldn't say which. Any loan whose label would repeat, and that has no
 * nickname of its own, gets "Card 1 / 2 / 3" (in the order entered) as its
 * nickname. A lender or nickname the user typed is never replaced, and a
 * label that is already unique is left alone. Pure; returns new objects only
 * for the loans it names.
 */
export function disambiguateLoans<T extends { bank?: string | null; loan_type: LoanType; nickname?: string | null }>(loans: T[]): T[] {
  const count = new Map<string, number>();
  for (const l of loans) count.set(loanLabel(l), (count.get(loanLabel(l)) ?? 0) + 1);
  const taken = new Set(loans.map((l) => loanNickname(l)).filter(Boolean));
  const seen = new Map<LoanType, number>();
  return loans.map((l) => {
    if ((count.get(loanLabel(l)) ?? 0) < 2 || loanNickname(l)) return l;
    let n = (seen.get(l.loan_type) ?? 0) + 1;
    // The lender, if any, still shows beside it: "Card 1 (HDFC credit card)".
    const name = (k: number) => `${AUTO_LABEL[l.loan_type]} ${k}`;
    while (taken.has(name(n))) n++;
    seen.set(l.loan_type, n);
    taken.add(name(n));
    return { ...l, nickname: name(n) };
  });
}
