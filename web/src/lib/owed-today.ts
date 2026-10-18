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
}

export function owedTodayOf(r: Pick<SimulateResponse, 'owed_today' | 'owed_start_of_month' | 'owed_today_interest_in_paid'>): OwedTodayFigures | null {
  if (r.owed_today == null || r.owed_start_of_month == null) return null;
  return { today: Number(r.owed_today), startOfMonth: Number(r.owed_start_of_month), interestInPaid: Number(r.owed_today_interest_in_paid ?? 0) };
}

/** "₹49,01,430 at the start of October, before the EMIs you've already
 *  paid; ₹48,85,000 after them, what you owe today." Null when the two agree. */
export function owedTodayLine(o: OwedTodayFigures | null | undefined, monthName: string, money: (v: number) => string): string | null {
  if (!o || Math.abs(o.startOfMonth - o.today) < 1) return null;
  const principal = o.startOfMonth - o.today;
  return `${money(o.startOfMonth)} at the start of ${monthName}, before the EMIs you’ve already paid; ${money(o.today)} after them, which is what you owe today. Those EMIs repaid ${money(principal)} of principal${o.interestInPaid >= 1 ? ` (the other ${money(o.interestInPaid)} was interest)` : ''}.`;
}
