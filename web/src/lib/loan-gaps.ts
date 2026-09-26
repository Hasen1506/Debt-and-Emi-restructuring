/**
 * The inputs a loan needs before the plan can project it.
 *
 * Setup used to let a balance through with a blank rate or EMI, and the
 * blanks became 0: a ₹1 lakh card read as a 0% loan (so home said to
 * invest instead of paying it), and a home loan with no EMI was never
 * paid down. Setup now asks for them; pages use this to say "add these"
 * instead of projecting from a profile saved before that.
 */
import type { LoanPayload, LoanType } from './api';
import { dec } from './safe-decimal';

export type LoanGapField = 'rate' | 'emi';

/** Loan types that are never interest-free, so a 0% rate means it's
 *  missing. Personal loans, BNPL and car loans can be 0% ("no-cost EMI",
 *  dealer offers), so an entered 0 stands for those. */
const NEVER_ZERO_RATE: ReadonlySet<LoanType> = new Set([
  'credit_card',
  'home_loan',
  'education_loan',
  'gold_loan',
]);

/** Cards revolve: the bank sets the minimum, so no EMI is needed. */
export function needsEmi(type: LoanType): boolean {
  return type !== 'credit_card';
}

/** What this loan is missing, for a saved loan (blanks already stored as 0). */
export function loanGaps(loan: Pick<LoanPayload, 'loan_type' | 'nominal_rate' | 'scheduled_emi'>): LoanGapField[] {
  const gaps: LoanGapField[] = [];
  if (NEVER_ZERO_RATE.has(loan.loan_type) && dec(loan.nominal_rate).lte(0)) gaps.push('rate');
  if (needsEmi(loan.loan_type) && dec(loan.scheduled_emi).lte(0)) gaps.push('emi');
  return gaps;
}

/** Setup's check on a loan being typed in: a blank field is missing even
 *  where 0 would be allowed. Returns a message per missing field. */
export function loanDraftErrors(
  loan: Pick<LoanPayload, 'loan_type' | 'nominal_rate' | 'scheduled_emi' | 'outstanding'>,
): Partial<Record<LoanGapField, string>> {
  if (dec(loan.outstanding).lte(0)) return {};
  const out: Partial<Record<LoanGapField, string>> = {};
  const rateBlank = (loan.nominal_rate ?? '').trim() === '';
  if (loan.loan_type === 'credit_card' && (rateBlank || dec(loan.nominal_rate).lte(0))) {
    out.rate = 'Enter the card’s interest rate, e.g. 42 (a 3.5% monthly rate is 42% a year).';
  } else if (rateBlank) {
    out.rate = 'Enter the interest rate from your statement (0 only if it’s really interest-free).';
  } else if (NEVER_ZERO_RATE.has(loan.loan_type) && dec(loan.nominal_rate).lte(0)) {
    out.rate = 'This kind of loan always charges interest. Enter the rate from your statement.';
  }
  if (needsEmi(loan.loan_type) && dec(loan.scheduled_emi).lte(0)) {
    out.emi = 'Enter the monthly EMI the bank takes (on your statement or banking app).';
  }
  return out;
}

export interface ProfileGap {
  /** Position in user.loans. */
  index: number;
  loan: LoanPayload;
  missing: LoanGapField[];
}

/** Open loans the plan can't project yet. */
export function projectionGaps(loans: LoanPayload[] | undefined): ProfileGap[] {
  return (loans ?? [])
    .map((loan, index) => ({ index, loan, missing: loanGaps(loan) }))
    .filter((g) => dec(g.loan.outstanding).gt(0) && g.missing.length > 0);
}

/** "the rate and EMI" / "the rate" / "the EMI". */
export function describeGap(missing: LoanGapField[]): string {
  const words = missing.map((f) => (f === 'rate' ? 'interest rate' : 'EMI'));
  return `the ${words.join(' and ')}`;
}
