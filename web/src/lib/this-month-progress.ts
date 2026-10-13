/**
 * Re-test 9 O-3: Home's "This month" strip is worked out on the server from
 * the plan, and the plan keeps this month's payments in it once they're
 * logged (see `plannedExtra` in lib/activity). So after both October
 * payments were marked paid, the strip still said "pay ₹54,000" above a
 * list showing both rows PAID. This reads what's been logged this month
 * the same way the Pay-this-month list does (lib/payment-state), so the
 * strip can say what's paid and what's still to go.
 */
import type { ActivityEntry } from './activity';
import { paymentState } from './payment-state';
import type { PayRow } from './pay-this-month';

/** Fund and goal ticks, per month (they aren't Activity entries). */
export const SET_ASIDE_KEY = 'rightdue_set_aside';
/** Fired in this tab when a fund or goal tick changes. */
export const SET_ASIDE_EVENT = 'rightdue:set-aside-changed';

export interface MonthProgress {
  /** Every row is paid in full (or ticked). */
  allPaid: boolean;
  /** Logged so far this month, in the user's currency (each row's own share). */
  paidUser: number;
  /** Rows with anything logged. */
  touched: number;
}

export function thisMonthProgress(
  rows: Pick<PayRow, 'key' | 'loanIndex' | 'minimum' | 'amount' | 'amountUser'>[],
  entries: ActivityEntry[],
  ticked: string[],
  month: string,
): MonthProgress {
  let paidUser = 0;
  let paidRows = 0;
  let touched = 0;
  for (const r of rows) {
    if (r.loanIndex === null) {
      if (ticked.includes(r.key)) {
        paidUser += r.amountUser;
        paidRows += 1;
        touched += 1;
      }
      continue;
    }
    const mine = entries.filter((e) => e.loanIndex === r.loanIndex && e.date.slice(0, 7) === month);
    const state = paymentState(mine, r.minimum, r.amount);
    if (state === 'due') continue;
    touched += 1;
    if (state === 'paid') {
      paidUser += r.amountUser;
      paidRows += 1;
      continue;
    }
    const sent = mine.reduce((s, e) => s + Number(e.amount || 0), 0);
    if (r.amount > 0) paidUser += Math.min(r.amountUser, (sent / r.amount) * r.amountUser);
  }
  return { allPaid: rows.length > 0 && paidRows === rows.length, paidUser: Math.round(paidUser), touched };
}

/** The strip's sentence once something is logged. All paid: that, instead
 *  of "pay …". Part paid: the plan's own sentence (what to pay and where the
 *  extra goes) with what's logged and what's left after it. Nothing
 *  logged: the plan's sentence as it is. */
export function progressLine(p: MonthProgress, total: number, money: (v: number) => string, planText: string): string {
  if (p.allPaid) return `This month: all paid, ${money(Math.max(p.paidUser, total))} logged. Nothing more is due until next month.`;
  if (p.touched === 0 || p.paidUser < 1) return planText;
  const left = Math.max(0, total - p.paidUser);
  return `${planText} ${money(p.paidUser)} of it is logged as paid; ${money(left)} still to pay.`;
}
