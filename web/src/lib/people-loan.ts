/**
 * A loan from a person: family, a friend, a chit fund, an informal
 * lender. Mapped onto the engine's EMI, interest-only and bullet loans
 * so the plan, Home and the payoff order already know what to do.
 *
 *  - No interest: rate 0. Avalanche pays it last (its cost is 0).
 *  - Yearly %: stored as the engine's annual rate.
 *  - Monthly %: stored as monthly × 12, simple, which is the rate the
 *    engine charges each month.
 *  - A fixed rupee amount: stored as the annual rate that accrues that
 *    amount on today's balance (amount × 12 / balance).
 *  - Fixed EMI: an ordinary EMI loan.
 *  - Pay whenever: no required payment and no end date. Extra payments
 *    still reduce it. Nothing is due, so charts have a zero minimum.
 *  - Lump sum: a bullet. The whole balance is due in the named month,
 *    and that minimum is paid before any extra.
 */
import type { LoanPayload } from './api';

export type PeopleInterest = 'none' | 'annual' | 'monthly' | 'fixed';
export type PeopleRepay = 'emi' | 'whenever' | 'lump';

export function peopleRate(interest: PeopleInterest, input: string, balance: string): string {
  const n = Number(input);
  const bal = Number(balance);
  if (interest === 'none' || !(n > 0)) return '0';
  if (interest === 'annual') return String(n / 100);
  if (interest === 'monthly') return String((n * 12) / 100);
  if (!(bal > 0)) return '0';
  return String((n * 12) / bal);
}

/** Months from `thisMonth` ('YYYY-MM') until `due` ('YYYY-MM'), at least 1. */
export function monthsUntil(thisMonth: string, due: string): number {
  if (!/^\d{4}-\d{2}$/.test(due) || !/^\d{4}-\d{2}$/.test(thisMonth)) return 0;
  const [y, m] = thisMonth.split('-').map(Number);
  const [dy, dm] = due.split('-').map(Number);
  return Math.max(0, (dy - y) * 12 + (dm - m));
}

export function peoplePatch(
  loan: LoanPayload,
  patch: {
    interest?: PeopleInterest;
    rateInput?: string;
    repay?: PeopleRepay;
    due?: string;
    thisMonth: string;
  },
): Partial<LoanPayload> {
  const interest = patch.interest ?? loan.people_interest ?? 'none';
  const repay = patch.repay ?? loan.people_repay ?? 'whenever';
  const input = patch.rateInput ?? loan.people_rate_input ?? '';
  const due = patch.due ?? loan.people_due ?? '';
  const rate = peopleRate(interest, input, loan.outstanding);
  const base: Partial<LoanPayload> = {
    loan_type: 'people_loan',
    lender_type: 'other',
    rate_type: 'fixed',
    rate_type_assumed: false,
    people_interest: interest,
    people_rate_input: input,
    people_repay: repay,
    people_due: due || undefined,
    nominal_rate: rate,
    // The engine charges this amount each month instead of rate × balance.
    fixed_monthly_interest: interest === 'fixed' && Number(input) > 0 ? input : undefined,
  };
  if (repay === 'whenever') {
    return { ...base, repayment: undefined, scheduled_emi: '0', tenure_months_remaining: 0, pre_emi_months_remaining: 0 };
  }
  if (repay === 'lump') {
    const months = monthsUntil(patch.thisMonth, due);
    return { ...base, repayment: 'bullet', scheduled_emi: '0', tenure_months_remaining: Math.max(1, months), pre_emi_months_remaining: 0 };
  }
  return { ...base, repayment: undefined, pre_emi_months_remaining: 0 };
}
