/**
 * UX walkthrough fix 4: one "what you owe today" figure. The engine defines
 * it (engine/owed_today.py, /simulate's owed_today): the plan's opening
 * balance less the principal in this month's EMIs already paid. Plan shows
 * both when they differ, with the reason, so they never read as two totals.
 */
import type { SimulateResponse } from './api';

export interface OwedTodayFigures {
  today: number;
  startOfMonth: number;
  /** The interest inside the EMIs already paid this month. */
  interestInPaid: number;
  /** Owed-fix: card payments (and the plan's own extra) logged this month. */
  paidOff?: number;
}

/** Owed-fix: one payment logged this month on a loan, for the plan's start row. */
export interface PaidNowNote {
  index: number;
  /** Comes off the opening balance (loan's currency). */
  amount: number;
  /** Cash logged this month. */
  paid: number;
  date: string;
}

export function owedTodayOf(r: Pick<SimulateResponse, 'owed_today' | 'owed_start_of_month' | 'owed_today_interest_in_paid' | 'owed_today_paid_off'>): OwedTodayFigures | null {
  if (r.owed_today == null || r.owed_start_of_month == null) return null;
  return { today: Number(r.owed_today), startOfMonth: Number(r.owed_start_of_month), interestInPaid: Number(r.owed_today_interest_in_paid ?? 0), paidOff: Number(r.owed_today_paid_off ?? 0) };
}

/** "9 Oct" from '2026-10-09'. */
export function shortDay(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return '';
  const names = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${Number(m[3])} ${names[Number(m[2]) - 1]}`;
}

/** "₹49,01,430 at the start of October, before the EMIs you've already
 *  paid; ₹48,85,000 after them, what you owe today." Null when the two agree. */
export function owedTodayLine(o: OwedTodayFigures | null | undefined, monthName: string, money: (v: number) => string): string | null {
  if (!o || Math.abs(o.startOfMonth - o.today) < 1) return null;
  const off = o.paidOff ?? 0;
  const principal = o.startOfMonth - o.today - off;
  // Owed-fix: payments logged this month (a card) come straight off.
  if (off >= 1) {
    const emis = principal >= 1 ? `, and the EMIs you’ve paid repaid ${money(principal)} of principal` : '';
    return `${money(o.startOfMonth)} at the start of ${monthName}; less ${money(off)} paid this month${emis}, you owe ${money(o.today)} now. The plan’s ${monthName} payments include what you’ve already paid.`;
  }
  return `${money(o.startOfMonth)} at the start of ${monthName}, before the EMIs you’ve already paid; ${money(o.today)} after them, which is what you owe today. Those EMIs repaid ${money(principal)} of principal${o.interestInPaid >= 1 ? ` (the other ${money(o.interestInPaid)} was interest)` : ''}.`;
}
