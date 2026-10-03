/**
 * The user's own monthly total for debts: EMIs, card minimums and the
 * extra on top, in their currency. Empty means "all my spare cash" (the
 * default). The plan never pays more than this; what it doesn't pay
 * stays with the user. Minimums are paid even when they're above it.
 */

import Decimal from 'decimal.js';

const COOKIE_NAME = 'finoptima_debt_budget';
const COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

/** '' for all spare cash, else a positive amount with at most two decimals. */
export function normalizeDebtBudget(v: string | null | undefined): string {
  const raw = String(v ?? '').replace(/[,₹$\s]/g, '');
  if (!/^\d+(?:\.\d*)?$/.test(raw)) return '';
  const n = new Decimal(raw).toDecimalPlaces(2);
  return n.isFinite() && n.gt(0) ? n.toString() : '';
}

export function readDebtBudgetClient(): string {
  if (typeof document === 'undefined') return '';
  const match = document.cookie.match(new RegExp(`(?:^|; )${COOKIE_NAME}=([^;]*)`));
  return normalizeDebtBudget(match ? decodeURIComponent(match[1]) : null);
}

export function writeDebtBudgetClient(value: string, sync = true) {
  if (typeof document === 'undefined') return;
  const v = normalizeDebtBudget(value);
  document.cookie = v
    ? `${COOKIE_NAME}=${v}; path=/; max-age=${COOKIE_MAX_AGE}; SameSite=Lax`
    : `${COOKIE_NAME}=; path=/; max-age=0; SameSite=Lax`;
  if (readDebtBudgetClient() !== v) throw new Error('The monthly debt budget could not be saved.');
  if (sync) void import('./server-sync').then(({ syncSliceToServer }) => syncSliceToServer('debt_budget', v));
}

export async function loadDebtBudgetServer(): Promise<string> {
  const { cookies } = await import('next/headers');
  return normalizeDebtBudget((await cookies()).get(COOKIE_NAME)?.value);
}
