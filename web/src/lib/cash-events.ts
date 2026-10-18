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

import { formatIso, localIsoDate } from './today';
import { syncSliceToServer } from './server-sync';

/**
 * Funding source for any prepayment beyond the scheduled minimum.
 *
 *   • surplus           — money came out of regular cash flow (income −
 *                         expenses). The primary cash account absorbs the
 *                         hit, same as before this dimension existed.
 *   • savings_drawdown  — user dipped into idle savings/asset balance to
 *                         pay the extra. We deduct excess from
 *                         `user.savings_balance` and leave the primary
 *                         cash account untouched for the excess portion.
 *   • ef_drawdown       — emergency fund was tapped. We deduct excess
 *                         from `user.efund_balance`. Surfaces a warning
 *                         later if EF dips below target.
 *   • one_off           — windfall (bonus, gift, refund) not previously
 *                         in the model. No tracked balance shrinks; this
 *                         is essentially "external money paid down debt".
 *
 * The tag affects ONLY excess-above-scheduled portions. The scheduled
 * EMI itself always counts as regular cash flow regardless of source —
 * that's what defines an EMI.
 */
export type PaymentSource =
  | 'surplus'
  | 'savings_drawdown'
  | 'ef_drawdown'
  | 'one_off';

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
  /** Where the *excess* portion of `emisPaid` came from. See
   *  PaymentSource docstring. Older entries with no tag default to
   *  'surplus' at read time, preserving pre-feature behaviour. */
  paymentSource?: PaymentSource;
  /** Amount of `emisPaid` that exceeded the scheduled minimum, decimal
   *  string. Stored alongside the source so future audit views can show
   *  "you drew ₹X from EF in May" without re-deriving from scheduled
   *  EMIs (which may have shifted since). 0 when no excess. */
  excessPaid?: string;
}

export interface CashEventsSlice {
  confirmations: MonthlyConfirmation[];
  /** Completed cash actions: persisted ids prevent double application. */
  transfers?: {id: string; date: string; amount: string; source: string; accountName?: string; note: string}[];
  /** YYYY-MM-DD the user first started cash tracking. Prompts only go
   *  back to the month containing this date. Unset = never started. */
  startedAt?: string;
  /** Name of the cash account that absorbs each month's net delta. Stamped
   *  once at `startedAt` time so future confirmations keep referencing the
   *  same account even if the user reorders / renames accounts in the
   *  cash_accounts list. Falls back to live picking when unset (legacy
   *  slices) so older users don't break. */
  primaryAccountName?: string;
}

const STORAGE_KEY = 'rightdue_cash_events';

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

/** Long month, e.g. "April 2026". */
export function monthLabel(monthKey: string): string {
  return formatIso(monthKey, 'long');
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
  // Entered balances are current as of the baseline date. Do not replay a
  // whole month's income over a balance captured partway through that month.
  const cursor = new Date(baseline.getFullYear(), baseline.getMonth() + (baseline.getDate() > 1 ? 1 : 0), 1);
  while (monthKey(cursor) <= lastMk) {
    const mk = monthKey(cursor);
    if (!confirmed.has(mk)) result.push(mk);
    cursor.setMonth(cursor.getMonth() + 1);
  }
  // Cap to most-recent 12 so very lapsed users don't see a wall of prompts.
  return result.slice(-12);
}

/**
 * Ensure the slice has a baseline date and a primary-account stamp. If
 * either is missing, set them and persist. Called by the check-in card
 * the first time it mounts for a user with populated cash_accounts.
 *
 * `primaryAccountName` is picked from the live cash_accounts list (first
 * checking, else the first liquid account) once. Stamping it on the slice means
 * later renames / reorderings of the accounts don't silently shift which
 * account absorbs the monthly net.
 */
export function ensureStarted(
  slice: CashEventsSlice,
  candidatePrimaryName?: string,
): CashEventsSlice {
  if (slice.startedAt && slice.primaryAccountName) return slice;
  const next: CashEventsSlice = {
    ...slice,
    startedAt: slice.startedAt ?? localIsoDate(new Date()),
    primaryAccountName:
      slice.primaryAccountName ?? candidatePrimaryName ?? undefined,
  };
  writeCashEventsClient(next);
  return next;
}
