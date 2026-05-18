'use client';

/**
 * Cash-flow event log — month-by-month confirmations of what the user
 * actually earned, spent, and paid in EMIs. Phase 2 of the cash module.
 *
 * Wire model
 *   • Onboarding writes cash_accounts (Phase 1).
 *   • First time /debts is opened with cash_accounts set, this slice
 *     stamps `startedAt = today` so the prompt only asks about months
 *     from that point forward.
 *   • Each calendar month past has a pending confirmation. User taps
 *     "Confirm" — defaults come from profile.user.monthly_income +
 *     fixed_expenses + sum-of-scheduled-EMIs. They can override.
 *   • On confirm: a MonthlyConfirmation gets logged AND the primary
 *     cash account balance bumps by netDelta (income − expenses − emis
 *     + interest). The event log is the audit trail; the per-account
 *     balance is the user-visible truth.
 *   • Backfillable: prompt lists all unconfirmed months back to baseline
 *     (no deadline, no penalty).
 *   • Skips the current month — income / expenses haven't fully landed
 *     yet. Only previous months become eligible.
 *
 * Quarterly reconciliation (every 90+ days), when added in Phase 3,
 * will let the user enter the *actual* balance per account. The gap
 * vs. derived becomes a single "untracked" event so the model
 * re-anchors to reality.
 */

import { syncSliceToServer } from './server-sync';

export interface MonthlyConfirmation {
  /** YYYY-MM */
  monthKey: string;
  /** Confirmed income for the month, decimal string. */
  income: string;
  /** Confirmed non-debt expenses, decimal string. */
  expenses: string;
  /** Confirmed total EMI / debt payments, decimal string. */
  emisPaid: string;
  /** Optional interest earned across cash accounts, decimal string. */
  interestEarned: string;
  /** Net change to cash for the month: income − expenses − emis + interest.
   *  Stored signed so the cash card can render trend without recomputing. */
  netDelta: string;
  /** Name of the cash account that received the net delta (typically the
   *  primary non-checking account). Matches CashAccountPayload.name. */
  primaryAccountName: string;
  /** ISO timestamp the confirmation was created. */
  confirmedAt: string;
  /** 'confirmed' = user accepted defaults; 'override' = user edited. */
  source: 'confirmed' | 'override';
  note?: string;
}

export interface CashEventsSlice {
  confirmations: MonthlyConfirmation[];
  /** YYYY-MM-DD the user first started cash tracking. Prompts only go
   *  back to the month containing this date. Unset = never started. */
  startedAt?: string;
}

const STORAGE_KEY = 'finoptima_cash_events';

const EMPTY: CashEventsSlice = { confirmations: [] };

// ─── Read / write ──────────────────────────────────────────────────────────

export function readCashEventsClient(): CashEventsSlice {
  if (typeof localStorage === 'undefined') return EMPTY;
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return EMPTY;
  try {
    const parsed = JSON.parse(raw);
    if (
      !parsed ||
      typeof parsed !== 'object' ||
      !Array.isArray(parsed.confirmations)
    ) {
      return EMPTY;
    }
    return parsed as CashEventsSlice;
  } catch {
    return EMPTY;
  }
}

export function writeCashEventsClient(slice: CashEventsSlice): void {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(slice));
  void syncSliceToServer('cash_events', slice);
}

// ─── Month-key helpers ─────────────────────────────────────────────────────

export function monthKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/** Human-readable month label, e.g. "April 2026". */
export function monthLabel(monthKey: string): string {
  const [y, m] = monthKey.split('-').map(Number);
  const d = new Date(y, m - 1, 1);
  return d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
}

/**
 * Months still owing confirmation. From the baseline month (inclusive)
 * up to and including last calendar month. The current month is never
 * prompted — income / expenses haven't fully posted yet.
 */
export function pendingMonths(
  slice: CashEventsSlice,
  today: Date = new Date(),
): string[] {
  if (!slice.startedAt) return [];
  const baseline = new Date(slice.startedAt + 'T00:00:00');
  if (Number.isNaN(baseline.getTime())) return [];

  const confirmed = new Set(slice.confirmations.map((c) => c.monthKey));
  // Last calendar month relative to `today`.
  const lastCalendarMonth = new Date(today.getFullYear(), today.getMonth() - 1, 1);
  const lastMk = monthKey(lastCalendarMonth);

  // Walk from baseline month forward.
  const result: string[] = [];
  const cursor = new Date(baseline.getFullYear(), baseline.getMonth(), 1);
  while (monthKey(cursor) <= lastMk) {
    const mk = monthKey(cursor);
    if (!confirmed.has(mk)) result.push(mk);
    cursor.setMonth(cursor.getMonth() + 1);
  }
  // Cap to most-recent 12 so very lapsed users don't see a wall of prompts.
  return result.slice(-12);
}

/**
 * Ensure the slice has a baseline date. If not, stamp it to today and
 * persist. Called by the check-in card the first time it mounts for a
 * user with populated cash_accounts.
 */
export function ensureStarted(slice: CashEventsSlice): CashEventsSlice {
  if (slice.startedAt) return slice;
  const next: CashEventsSlice = {
    ...slice,
    startedAt: new Date().toISOString().slice(0, 10),
  };
  writeCashEventsClient(next);
  return next;
}

/** Append a confirmation, replacing any prior entry for the same month. */
export function appendConfirmation(
  slice: CashEventsSlice,
  c: MonthlyConfirmation,
): CashEventsSlice {
  const filtered = slice.confirmations.filter((x) => x.monthKey !== c.monthKey);
  const next: CashEventsSlice = {
    ...slice,
    confirmations: [...filtered, c].sort((a, b) =>
      a.monthKey.localeCompare(b.monthKey),
    ),
  };
  writeCashEventsClient(next);
  return next;
}
