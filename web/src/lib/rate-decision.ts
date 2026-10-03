/**
 * What the next RBI or Fed decision does to each loan (AUDIT §10 M5).
 *
 * A floating loan follows the central bank at its own reset, not on the
 * day of the decision:
 *   • India: bank home and education loans since October 2019 are linked
 *     to the repo rate (EBLR / RLLR) and reset at least every three
 *     months; older MCLR loans reset every six or twelve months and lag.
 *     Banks usually keep the EMI and change the months left; RBI's rules
 *     let the borrower ask for the EMI to change instead.
 *   • US: card APRs follow the prime rate within a statement or two;
 *     adjustable mortgages and HELOCs at their adjustment dates. Fixed
 *     mortgages, car and personal loans don't move.
 *
 * For an existing loan there's nothing to wait for: the change comes by
 * itself. Waiting on a decision matters for a new loan or a switch.
 */
import type { Country, LoanPayload } from './api';
import { MONTH_NAMES_SHORT } from './today';

/** One step of a central bank move: a quarter point. */
export const RATE_STEP = 0.0025;

/** The EMI that clears `principal` at `annualRate` in `months`. */
export function emiFor(principal: number, annualRate: number, months: number): number {
  if (!(months > 0) || !(principal > 0)) return 0;
  const r = annualRate / 12;
  if (r === 0) return principal / months;
  const f = Math.pow(1 + r, months);
  return (principal * r * f) / (f - 1);
}

/** Months for `emi` to clear `principal` at `annualRate`; null when the
 *  EMI doesn't cover the interest. */
export function monthsFor(principal: number, annualRate: number, emi: number): number | null {
  if (!(principal > 0)) return 0;
  const r = annualRate / 12;
  if (r === 0) return emi > 0 ? Math.ceil(principal / emi) : null;
  if (emi <= principal * r) return null;
  return Math.ceil(-Math.log(1 - (principal * r) / emi) / Math.log(1 + r));
}

export type RateFollow = 'floating' | 'card';

export interface RateMove {
  loan: LoanPayload;
  follows: RateFollow;
  /** EMI loans: the EMI with the months kept, at today's rate, a quarter
   *  point up and a quarter point down. */
  emi?: { now: number; up: number; down: number };
  /** EMI loans: months left with the EMI kept (null: it wouldn't clear). */
  months?: { now: number | null; up: number | null; down: number | null };
  /** Cards: a month's interest on today's balance, a quarter point up. */
  interestUp?: number;
}

/** Whether a decision moves this loan's rate: a floating EMI loan, or in
 *  the US a credit card (variable APR on the prime rate). */
export function followsCentralBank(loan: LoanPayload, country: Country): RateFollow | null {
  if (!(Number(loan.outstanding) > 0)) return null;
  if (loan.loan_type === 'credit_card') return country === 'US' ? 'card' : null;
  return loan.rate_type === 'floating' && Number(loan.scheduled_emi) > 0 ? 'floating' : null;
}

export function rateMove(loan: LoanPayload, country: Country, step = RATE_STEP): RateMove | null {
  const follows = followsCentralBank(loan, country);
  if (!follows) return null;
  const p = Number(loan.outstanding);
  const rate = Number(loan.nominal_rate);
  if (!(rate >= 0)) return null;
  if (follows === 'card') return { loan, follows, interestUp: (p * step) / 12 };
  const n = Number(loan.tenure_months_remaining) || 0;
  const emi = Number(loan.scheduled_emi);
  const down = Math.max(0, rate - step);
  return {
    loan,
    follows,
    ...(n > 0 ? { emi: { now: emiFor(p, rate, n), up: emiFor(p, rate + step, n), down: emiFor(p, down, n) } } : {}),
    months: { now: monthsFor(p, rate, emi), up: monthsFor(p, rate + step, emi), down: monthsFor(p, down, emi) },
  };
}

function addMonths(iso: string, k: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1 + k, 1));
  const last = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0)).getUTCDate();
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, '0')}-${String(Math.min(d, last)).padStart(2, '0')}`;
}

export function dayLabel(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  return `${d} ${MONTH_NAMES_SHORT[m - 1]} ${y}`;
}

/** The loan's first reset on or after the decision, when its reset date
 *  is on file (stepping on by its reset frequency); null when it isn't. */
export function firstResetAfter(loan: LoanPayload, decision: string): string | null {
  const next = loan.next_reset_date?.slice(0, 10);
  if (!next || !/^\d{4}-\d{2}-\d{2}$/.test(next)) return null;
  if (next >= decision) return next;
  const freq = Number(loan.rate_reset_frequency_months) || 0;
  if (freq <= 0) return null;
  for (let k = 1; k <= 24; k++) {
    const d = addMonths(next, k * freq);
    if (d >= decision) return d;
  }
  return null;
}

/** When a decision on `decision` reaches this loan, in a phrase. */
export function whenItApplies(move: RateMove, country: Country, decision: string | null): string {
  if (move.follows === 'card') return 'from your next statement or the one after';
  const reset = decision ? firstResetAfter(move.loan, decision) : null;
  if (reset) return `from its reset on ${dayLabel(reset)}`;
  if (country === 'IN') {
    return 'from its next reset: within three months if it is linked to the repo rate (most since October 2019), six to twelve if to MCLR';
  }
  return 'from its next adjustment date';
}
