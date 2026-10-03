/**
 * Fixed or floating, when the borrower isn't sure (AUDIT §10 M2). Most
 * people don't know, and every new loan used to start as "fixed": an
 * Indian bank home loan (almost always floating, linked to the repo rate
 * since October 2019) then showed no change in What if's rate rise, and
 * no reset dates on Plan.
 *
 * "Not sure" takes the usual type for that kind of loan, marked as
 * assumed (`rate_type_assumed`) so Plan can say so:
 *   • India: home and education loans from banks float (EBLR / RLLR,
 *     older ones MCLR); personal, car, gold and pay-later loans are fixed.
 *   • US: mortgages are mostly 30-year fixed; car, personal and federal
 *     student loans are fixed.
 */
import type { Country, LoanPayload, LoanType } from './api';

export type RateType = 'fixed' | 'floating';

export function likelyRateType(loanType: LoanType, country: Country): RateType {
  if (country === 'IN' && (loanType === 'home_loan' || loanType === 'education_loan')) return 'floating';
  return 'fixed';
}

/** How to tell, in one line, for the help under the choice. */
export const HOW_TO_TELL =
  "Your loan letter's \"Type of interest\" line says. Or: if your EMI or months left have changed without you asking, it's floating.";

/** Why "Not sure" landed where it did, said under the choice. */
export function assumedRateTypeNote(loanType: LoanType, country: Country): string {
  const t = likelyRateType(loanType, country);
  if (country === 'IN' && t === 'floating') {
    return 'Taken as floating: most bank home and education loans are, linked to the repo rate.';
  }
  if (country === 'US' && loanType === 'home_loan') return 'Taken as fixed: most US mortgages are 30-year fixed.';
  return 'Taken as fixed: most loans like this are.';
}

/** A loan with `patch` applied. A new kind of loan brings its usual rate
 *  type with it, unless the borrower picked one themselves. */
export function patchLoanKeepingRateType(loan: LoanPayload, patch: Partial<LoanPayload>, country: Country): LoanPayload {
  const next = { ...loan, ...patch };
  if (patch.loan_type && patch.loan_type !== loan.loan_type && loan.rate_type_assumed !== false && !('rate_type' in patch)) {
    next.rate_type = likelyRateType(patch.loan_type, country);
    next.rate_type_assumed = true;
  }
  return next;
}

/** The choice as the form shows it: "unsure" unless the borrower picked. */
export function rateTypeChoice(loan: Pick<LoanPayload, 'rate_type' | 'rate_type_assumed'>): RateType | 'unsure' {
  return loan.rate_type_assumed === false ? loan.rate_type : 'unsure';
}

/** What a choice sets on the loan. */
export function applyRateTypeChoice(choice: RateType | 'unsure', loanType: LoanType, country: Country): Pick<LoanPayload, 'rate_type' | 'rate_type_assumed'> {
  return choice === 'unsure'
    ? { rate_type: likelyRateType(loanType, country), rate_type_assumed: true }
    : { rate_type: choice, rate_type_assumed: false };
}
