/** A principal-only prepayment does not settle this month's EMI/minimum. */
import Decimal from 'decimal.js';
import type { ActivityEntry } from './activity';

export function isRegularPayment(e: ActivityEntry): boolean {
  return e.kind === 'paid_full' || e.kind === 'paid_partial' || e.kind === 'missed' ||
    (e.kind === 'paid_extra' && Number(e.scheduledEmi) > 0);
}

/** UX2 #20: a balance corrected in Profile is a record, not money paid. */
export function isMoneyPaid(e: ActivityEntry): boolean {
  return e.kind !== 'balance_correction';
}

export function regularPaid(entries: ActivityEntry[]): Decimal {
  return entries.reduce((sum, e) => {
    if (!isRegularPayment(e) || e.kind === 'missed') return sum;
    const amount = new Decimal(e.amount || '0');
    return sum.add(e.kind === 'paid_extra' ? Decimal.min(amount, e.scheduledEmi || '0') : amount);
  }, new Decimal(0));
}

export function paymentState(entries: ActivityEntry[], minimum: number, total: number): 'due' | 'missed' | 'part' | 'emi_paid' | 'paid' {
  entries = entries.filter(isMoneyPaid);
  const regular = entries.filter(isRegularPayment);
  if (entries.some(e => e.kind === 'closed')) return 'paid';
  if (regular.length === 0) return 'due';
  const covered = regularPaid(regular);
  if (covered.lte(0)) return 'missed';
  // Ignore only sub-cent arithmetic noise, not a real payment shortfall.
  if (covered.lt(Decimal.max(0, new Decimal(minimum).sub('0.005')))) return 'part';
  const paid = entries.reduce((sum, e) => sum.add(e.amount || '0'), new Decimal(0));
  return paid.lt(Decimal.max(0, new Decimal(total).sub('0.005'))) ? 'emi_paid' : 'paid';
}
