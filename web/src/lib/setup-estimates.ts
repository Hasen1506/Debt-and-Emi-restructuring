/**
 * "I don't know" on setup's loan fields (sprint G10, grill #16a). An
 * estimate is always labelled as one, saved with the loan as
 * `estimated_fields`, and replaced the moment the person types the real
 * number. Nothing here is a default the plan uses silently.
 */
import Decimal from 'decimal.js';
import { remainingBalance } from './amortization';
import raw from './rate-cards.json';
import type { Country, LoanType } from './api';

interface Range { low: string; high: string }
interface Card {
  country: Country;
  scrape_tier?: string;
  home_loan?: Range | null;
  personal_loan?: Range | null;
  auto_loan?: Range | null;
  education_loan?: Range | null;
  credit_card?: { apr_low: string; apr_high: string } | null;
}
const data = raw as unknown as { as_of: string; source: string; institutions: Record<string, Card> };

export const TYPICAL_RATE_AS_OF = data.as_of;

function rangeOf(c: Card, t: LoanType): Range | null {
  if (t === 'credit_card') return c.credit_card ? { low: c.credit_card.apr_low, high: c.credit_card.apr_high } : null;
  if (t === 'home_loan' || t === 'personal_loan' || t === 'auto_loan' || t === 'education_loan') return c[t] ?? null;
  return null;
}

/** The middle of the tracked banks' published ranges for this kind of
 *  loan (the median of each bank's mid-rate), as a fraction; null when no
 *  tracked bank publishes one (gold loans, pay later). */
export function typicalRate(country: Country, loanType: LoanType): number | null {
  const mids = Object.values(data.institutions)
    .filter((c) => c.country === country && (c.scrape_tier ?? 'A') === 'A')
    .map((c) => rangeOf(c, loanType))
    .filter((r): r is Range => !!r && Number(r.high) > 0)
    .map((r) => (Number(r.low) + Number(r.high)) / 2)
    .sort((a, b) => a - b);
  if (!mids.length) return null;
  const n = mids.length;
  const m = n % 2 ? mids[(n - 1) / 2] : (mids[n / 2 - 1] + mids[n / 2]) / 2;
  return Number(m.toFixed(4));
}

/** What's still owed on an EMI loan from what was borrowed: the standard
 *  reducing-balance schedule (the same one engine/formulas.remaining_balance
 *  uses), after `paidMonths` of `originalMonths` EMIs at `annualRate`. */
export function estimateBalance(amount: string | number, annualRate: string | number, originalMonths: number, paidMonths: number): string | null {
  const P = new Decimal(amount || 0);
  const n = Math.round(originalMonths);
  const k = Math.round(paidMonths);
  if (!(P.gt(0) && n > 0 && k >= 0)) return null;
  if (k >= n) return '0';
  return remainingBalance(P, annualRate || 0, n, k).toFixed(0);
}

/** Months between a start month ('YYYY-MM') and this month ('YYYY-MM'). */
export function monthsSince(start: string, now: string): number | null {
  const a = start.match(/^(\d{4})-(\d{2})$/);
  const b = now.match(/^(\d{4})-(\d{2})$/);
  if (!a || !b) return null;
  const d = (Number(b[1]) - Number(a[1])) * 12 + (Number(b[2]) - Number(a[2]));
  return d >= 0 ? d : null;
}

/** Mark a field estimated on the loan (or clear it once typed). */
export function withEstimate<T extends { estimated_fields?: string[] }>(loan: T, field: string, on: boolean): T {
  const cur = new Set(loan.estimated_fields ?? []);
  if (on) cur.add(field); else cur.delete(field);
  const next = { ...loan, estimated_fields: Array.from(cur) };
  if (!next.estimated_fields.length) delete (next as { estimated_fields?: string[] }).estimated_fields;
  return next;
}
