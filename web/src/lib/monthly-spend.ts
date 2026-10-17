/**
 * Monthly-spend log — user-typed "I actually spent ₹X in {month}".
 *
 * Stored separately from the activity-ledger because the activity-
 * ledger is loan-payment-shaped (paid_full, paid_partial, missed) and
 * the engine reads it to apply trajectory deltas. A monthly spend
 * actual is a different concept — it doesn't move any loan, it just
 * lets BudgetMonthCard show a variance line against the planned
 * fixed+variable envelope.
 *
 * One entry per (monthIso) is the steady state, but multiple entries
 * for the same month are allowed (treat the latest by loggedAt as
 * authoritative). The cookie digest mirrors `{monthIso → spent}` so
 * server-rendered pages can read the latest value without a hydration
 * round-trip.
 */

import { syncSliceToServer } from './server-sync';

export interface MonthlySpendEntry {
  id: string;
  /** Month the spend applies to — 'YYYY-MM' (we don't track per-day). */
  monthIso: string;
  /** Total spent in user residence currency, decimal string. */
  spent: string;
  /** Optional free-text note ("month-end credit-card bill was higher"). */
  note?: string;
  /** When the entry was logged — ISO datetime. Used to pick the
   *  authoritative value when multiple entries exist for one month. */
  loggedAt: string;
}

const STORAGE_KEY = 'rightdue_monthly_spend';
const DIGEST_COOKIE = 'rightdue_monthly_spend_digest';

function safeParse(raw: string | null): MonthlySpendEntry[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw);
    if (!Array.isArray(v)) return [];
    return v.filter(isValid);
  } catch {
    return [];
  }
}

function isValid(v: unknown): v is MonthlySpendEntry {
  if (!v || typeof v !== 'object') return false;
  const e = v as Partial<MonthlySpendEntry>;
  return (
    typeof e.id === 'string' &&
    typeof e.monthIso === 'string' &&
    /^\d{4}-\d{2}$/.test(e.monthIso) &&
    typeof e.spent === 'string' &&
    typeof e.loggedAt === 'string'
  );
}

export function readMonthlySpendClient(): MonthlySpendEntry[] {
  if (typeof localStorage === 'undefined') return [];
  return safeParse(localStorage.getItem(STORAGE_KEY));
}

export function writeMonthlySpendClient(entries: MonthlySpendEntry[]): void {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
  if (typeof document !== 'undefined') {
    const digest = latestByMonth(entries);
    const value = btoa(JSON.stringify(digest));
    document.cookie = `${DIGEST_COOKIE}=${value}; path=/; max-age=${60 * 60 * 24 * 365}; SameSite=Lax`;
  }
  void syncSliceToServer('monthly_spend', entries);
}

export function newMonthlySpendId(): string {
  return `ms_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function addMonthlySpend(
  entries: MonthlySpendEntry[],
  draft: Omit<MonthlySpendEntry, 'id' | 'loggedAt'>,
): MonthlySpendEntry[] {
  const entry: MonthlySpendEntry = {
    ...draft,
    id: newMonthlySpendId(),
    loggedAt: new Date().toISOString(),
  };
  return [entry, ...entries];
}

/** Most-recent entry per month — picks by `loggedAt` descending so a
 *  later correction wins over the first guess. */
export function latestByMonth(
  entries: MonthlySpendEntry[],
): Record<string, number> {
  const winners: Record<string, MonthlySpendEntry> = {};
  for (const e of entries) {
    const prev = winners[e.monthIso];
    if (!prev || e.loggedAt > prev.loggedAt) {
      winners[e.monthIso] = e;
    }
  }
  const out: Record<string, number> = {};
  for (const [month, entry] of Object.entries(winners)) {
    const v = Number(entry.spent || '0');
    if (Number.isFinite(v) && v >= 0) out[month] = v;
  }
  return out;
}
