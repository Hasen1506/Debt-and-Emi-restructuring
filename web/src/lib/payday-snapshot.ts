/**
 * What the app sends the server for the payday email: this month's
 * payment rows, read off Home's "Pay this month" (lib/pay-this-month).
 * Names, amounts and kinds only. No account numbers, no balances, no UPI
 * IDs: the email needs none of them (engine/payday.py checks the same).
 * A behind loan with a catch-up this month goes as 'catch_up', a loan with a
 * collection agency as 'collections' (left out of the total), and its
 * settlement pot as 'pot'.
 */
import type { PayThisMonth } from './pay-this-month';

export interface PaydaySnapshot {
  month: string;
  made_on: string;
  country: 'IN' | 'US';
  currency: 'INR' | 'USD';
  rows: { name: string; amount: string; currency: string; kind: string; due_day?: number }[];
}

export function paydaySnapshot(data: PayThisMonth, country: 'IN' | 'US', todayIso: string): PaydaySnapshot {
  return {
    month: todayIso.slice(0, 7),
    made_on: todayIso,
    country,
    currency: country === 'IN' ? 'INR' : 'USD',
    rows: data.rows.slice(0, 20).map((r) => ({
      name: r.name.slice(0, 60),
      amount: String(Math.round(r.amount)),
      currency: r.currency,
      // Founder 17 Oct 2026: not a normal due for a loan that is behind or with collectors.
      kind: r.held === 'collections' ? 'collections' : r.behind && r.catchUp ? 'catch_up' : r.kind,
      ...(r.dueDay ? { due_day: r.dueDay } : {}),
    })),
  };
}

/** Refresh the server's copy at most once a day per month's list. */
export const SNAPSHOT_SENT_KEY = 'rightdue_payday_snapshot_sent';

export function snapshotNeedsSend(lastSent: string | null, todayIso: string, fingerprint: string): boolean {
  return lastSent !== `${todayIso}|${fingerprint}`;
}

/** A short fingerprint of the rows, so a change the same day is sent too. */
export function rowsFingerprint(s: PaydaySnapshot): string {
  let h = 0;
  for (const ch of JSON.stringify(s.rows)) h = (h * 31 + ch.charCodeAt(0)) | 0;
  return (h >>> 0).toString(36);
}
