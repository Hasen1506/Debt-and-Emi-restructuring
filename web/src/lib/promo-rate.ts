/**
 * UX2B-5: a card at 0% (a balance transfer or intro offer) was treated as a
 * missing rate, and a promo's end was never asked, so the plan either
 * blocked it or charged 0% for ever. Setup now takes 0% with an optional
 * last promo month and the rate after it; the plan switches rates then.
 */
import type { LoanPayload } from './api';
import { monthsBetween } from './roll-forward';

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

/** What's wrong with the promo answers, or null. Both are optional, but an
 *  end month needs the rate after it. */
export function promoError(loan: Pick<LoanPayload, 'promo_until' | 'rate_after_promo'>, thisMonth: string): string | null {
  const end = (loan.promo_until ?? '').trim();
  if (!end) return null;
  if (!MONTH.test(end)) return 'Enter the month as year-month, like 2027-04.';
  if (end < thisMonth) return 'That month has passed. Enter the card’s rate now instead.';
  if (!(Number(loan.rate_after_promo) > 0)) return 'Enter the rate after the offer ends (on the offer letter), e.g. 42.';
  return null;
}

/** The loan as the engine runs it in a plan starting `planMonth`: months at
 *  the promo rate (the end month included), then the rate after. A promo
 *  already over runs at the rate after. Loans without one are unchanged. */
export function promoForEngine<T extends LoanPayload>(loan: T, planMonth: string): T {
  const end = (loan.promo_until ?? '').trim();
  const after = (loan.rate_after_promo ?? '').trim();
  if (!MONTH.test(end) || !(Number(after) > 0)) return loan;
  if (end < planMonth) return { ...loan, nominal_rate: after, promo_months: 0 };
  return { ...loan, promo_months: monthsBetween(planMonth, end) + 1 };
}
