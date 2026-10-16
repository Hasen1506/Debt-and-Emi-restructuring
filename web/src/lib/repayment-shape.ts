/**
 * How a loan is repaid, as Setup asks it (UX2-3). The engine has always
 * modelled interest-only and bullet loans (engine/contract.py
 * repayment_kind) and a pre-EMI window, but Setup only took an EMI, so an
 * education loan in moratorium, an overdraft, a gold loan paid at the end or
 * a US income-driven student loan hit "this loan would never be paid off".
 *
 *  - 'emi': the usual EMI (default).
 *  - 'interest_only': only the interest each month. With an end month:
 *    an education loan's moratorium (EMIs start after it, saved as a pre-EMI
 *    window) or a loan whose principal is due then; with none, an open
 *    credit line (overdraft, HELOC draw).
 *  - 'bullet': nothing until the end month, then principal and interest
 *    (Indian gold loans).
 */
import type { LoanPayload, LoanType } from './api';
import { emiFromMonths } from './quick-setup';
import { monthsBetween } from './roll-forward';

export type RepayShape = 'emi' | 'interest_only' | 'bullet';

/** Years of EMIs assumed after a moratorium when the EMI isn't typed: Indian
 *  education loans run 5-15 years after it; 10 is SBI's and most banks' usual
 *  term (founder decision pending, marked as an estimate on the loan). */
export const MORATORIUM_REPAY_MONTHS = 120;

/** The chips for a loan type, or null when it has none (cards, pay later). */
export function shapeChoices(loanType: LoanType, country: string): Array<[RepayShape, string]> | null {
  if (loanType === 'credit_card' || loanType === 'bnpl') return null;
  const regular: [RepayShape, string] = ['emi', country === 'US' ? 'Monthly payments' : 'EMI'];
  if (loanType === 'gold_loan') return [regular, ['interest_only', 'Interest only'], ['bullet', 'All at the end']];
  if (loanType === 'education_loan') return [regular, ['interest_only', country === 'US' ? 'Interest only for now' : 'Moratorium (interest only for now)']];
  if (loanType === 'home_loan') return [regular, ['interest_only', country === 'US' ? 'Interest only (HELOC draw)' : 'Pre-EMI (interest only for now)']];
  return [regular, ['interest_only', 'Interest only (overdraft, credit line)']];
}

export function shapeOf(loan: Pick<LoanPayload, 'repayment' | 'pre_emi_months_remaining'>): RepayShape {
  if (loan.repayment === 'interest_only' || loan.repayment === 'bullet') return loan.repayment;
  return (loan.pre_emi_months_remaining ?? 0) > 0 ? 'interest_only' : 'emi';
}

/** Interest only until a month, then EMIs: an education loan's moratorium or a
 *  home loan's pre-EMI while it's built (saved as the engine's pre-EMI window).
 *  On other loans an end month is when the amount borrowed is due. */
export function isMoratorium(loan: Pick<LoanPayload, 'loan_type' | 'repayment' | 'pre_emi_months_remaining'>, endMonth: string | undefined): boolean {
  const preEmi = loan.loan_type === 'education_loan' || loan.loan_type === 'home_loan' || (loan.pre_emi_months_remaining ?? 0) > 0;
  return preEmi && shapeOf(loan) === 'interest_only' && !!(endMonth ?? '').trim();
}

/** Setup shows its EMI box for an EMI loan, and for a moratorium (the EMI after it). */
export function shapeNeedsEmi(loan: Pick<LoanPayload, 'loan_type' | 'repayment' | 'pre_emi_months_remaining'>, endMonth: string | undefined): boolean {
  return shapeOf(loan) === 'emi' || isMoratorium(loan, endMonth);
}

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

/** The end month a saved loan implies, for Setup to show again. */
export function savedEndMonth(loan: LoanPayload, thisMonth: string): string {
  const n = (loan.pre_emi_months_remaining ?? 0) > 0 ? loan.pre_emi_months_remaining! : shapeOf(loan) !== 'emi' ? loan.tenure_months_remaining : 0;
  if (!(n > 0)) return '';
  const [y, m] = thisMonth.split('-').map(Number);
  const k = y * 12 + (m - 1) + n;
  return `${Math.floor(k / 12)}-${String((k % 12) + 1).padStart(2, '0')}`;
}

/** A moratorium's EMI may be left blank (an estimate is used). */
export function emiOptional(loan: LoanPayload, endMonth: string | undefined): boolean {
  return isMoratorium(loan, endMonth) && !(Number(loan.scheduled_emi) > 0);
}

/** What's wrong with the shape's answers, or null. */
export function shapeError(loan: LoanPayload, endMonth: string | undefined, thisMonth: string): string | null {
  const shape = shapeOf(loan);
  if (shape === 'emi' || !(Number(loan.outstanding) > 0)) return null;
  const end = (endMonth ?? '').trim();
  if (shape === 'bullet' && !end) return 'Enter the month it is due (on your pledge receipt), like 2027-04.';
  if (end && !MONTH.test(end)) return 'Enter the month as year-month, like 2027-04.';
  if (end && end <= thisMonth) return 'Enter a month after this one.';
  if (end && monthsBetween(thisMonth, end) > 600) return 'That is more than 50 years away. Check the month.';
  return null;
}

/** The loan as saved for its shape. `endMonth` is 'YYYY-MM' or blank. */
export function finishShape(loan: LoanPayload, endMonth: string | undefined, thisMonth: string, ccy: 'INR' | 'USD'): Partial<LoanPayload> {
  const shape = shapeOf(loan);
  const end = (endMonth ?? '').trim();
  const months = end && MONTH.test(end) && end > thisMonth ? monthsBetween(thisMonth, end) : 0;
  if (shape === 'emi') return { repayment: undefined, pre_emi_months_remaining: 0 };
  const interest = (Number(loan.outstanding) * Number(loan.nominal_rate)) / 12;
  const roundUp = (v: number) => String(ccy === 'INR' ? Math.ceil(v) : Math.ceil(v * 100) / 100);
  if (shape === 'bullet') return { repayment: 'bullet', scheduled_emi: '0', tenure_months_remaining: months, pre_emi_months_remaining: 0 };
  if (isMoratorium(loan, end) && months > 0) {
    const typed = Number(loan.scheduled_emi) > 0;
    const emi = typed ? loan.scheduled_emi : emiFromMonths(loan.outstanding, loan.nominal_rate, MORATORIUM_REPAY_MONTHS, ccy) ?? '0';
    const estimated = new Set(loan.estimated_fields ?? []);
    if (!typed) estimated.add('emi');
    return {
      repayment: 'emi', pre_emi_months_remaining: months, scheduled_emi: emi,
      tenure_months_remaining: typed ? loan.tenure_months_remaining : MORATORIUM_REPAY_MONTHS,
      estimated_fields: Array.from(estimated),
    };
  }
  return { repayment: 'interest_only', scheduled_emi: roundUp(interest), tenure_months_remaining: months, pre_emi_months_remaining: 0 };
}

/** One line under the chips saying what the plan will do. */
export function shapeNote(loan: LoanPayload, endMonth: string | undefined, money: (v: number) => string, country: string): string | null {
  const shape = shapeOf(loan);
  const interest = (Number(loan.outstanding) * Number(loan.nominal_rate)) / 12;
  const pay = country === 'US' ? 'payment' : 'EMI';
  const end = (endMonth ?? '').trim();
  if (shape === 'emi') {
    return loan.forgiveness_track === 'idr'
      ? 'On an income-driven plan the payment can be less than the interest; type what you pay.'
      : null;
  }
  if (shape === 'bullet') return `Nothing to pay until ${end || 'the due month'}; then the amount borrowed and its interest are due together.`;
  if (isMoratorium(loan, end)) {
    return `Interest of about ${money(interest)} a month until ${end}, then the ${pay} below. ` +
      `Leave the ${pay} blank if you don’t know it yet: the plan assumes ${MORATORIUM_REPAY_MONTHS / 12} years of ${pay}s, marked as an estimate.`;
  }
  return end
    ? `Interest of about ${money(interest)} a month; the amount borrowed is due in ${end}.`
    : `Interest of about ${money(interest)} a month, with no end date. Paying more brings the balance down; the plan shows when it’s worth it.`;
}
