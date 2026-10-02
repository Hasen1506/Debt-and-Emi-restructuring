/**
 * The user's own monthly total for debts: EMIs, card minimums and the
 * extra on top, in their currency. Empty means "all my spare cash" (the
 * default). The plan never pays more than this; what it doesn't pay
 * stays with the user. Minimums are paid even when they're above it.
 */

const COOKIE_NAME = 'finoptima_debt_budget';
const COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

/** '' for all spare cash, else a whole amount like '50000'. */
export function normalizeDebtBudget(v: string | null | undefined): string {
  const n = Number(String(v ?? '').replace(/[^\d.]/g, ''));
  return Number.isFinite(n) && n > 0 ? String(Math.round(n)) : '';
}

export function readDebtBudgetClient(): string {
  if (typeof document === 'undefined') return '';
  const match = document.cookie.match(new RegExp(`(?:^|; )${COOKIE_NAME}=([^;]*)`));
  return normalizeDebtBudget(match ? decodeURIComponent(match[1]) : null);
}

export function writeDebtBudgetClient(value: string) {
  if (typeof document === 'undefined') return;
  const v = normalizeDebtBudget(value);
  document.cookie = v
    ? `${COOKIE_NAME}=${v}; path=/; max-age=${COOKIE_MAX_AGE}; SameSite=Lax`
    : `${COOKIE_NAME}=; path=/; max-age=0; SameSite=Lax`;
  void import('./server-sync').then(({ syncSliceToServer }) => syncSliceToServer('debt_budget', v));
}

export async function loadDebtBudgetServer(): Promise<string> {
  const { cookies } = await import('next/headers');
  return normalizeDebtBudget(cookies().get(COOKIE_NAME)?.value);
}
