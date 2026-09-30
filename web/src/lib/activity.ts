/**
 * Activity ledger — user-recorded payment events.
 *
 * Replaces the hardcoded LOG + CALENDAR arrays the Insights page used to
 * render. Each event is one of:
 *   • paid_full    — user paid the scheduled EMI (or more) on/before due date
 *   • paid_partial — user paid less than the EMI; we compute `overdue` and
 *                    surface a penalty estimate
 *   • missed       — user paid nothing this cycle; penalty estimate uses
 *                    the full EMI as `overdue`
 *   • paid_extra   — user paid MORE than the scheduled EMI (lump sum,
 *                    overpayment, prepayment). The excess reduces
 *                    outstanding when /plan re-simulates.
 *   • closed       — user cleared the loan entirely. Outstanding goes to 0
 *                    and the loan drops out of the projection.
 *
 * Stored in localStorage rather than a cookie — entries are unbounded and
 * cookies cap at 4KB. localStorage is also better for cross-tab consistency
 * (a `storage` event fires, so the Insights page updates if the user logs
 * an event in another tab).
 *
 * The shape stays JSON-serialisable strings for Decimals so we never round
 * floats. Convert with `new Decimal(...)` at render time.
 */
import type { LoanPayload } from './api';
import { alignToLoans } from './loan-ids';
import { loadProfileClient } from './user-store';

export type ActivityKind =
  | 'paid_full'
  | 'paid_partial'
  | 'missed'
  | 'paid_extra'
  | 'closed';

export interface ActivityEntry {
  /** Stable ID — `crypto.randomUUID()` in the browser, kept as string. */
  id: string;
  /** 0-based index into the user's `loans` list. -1 = pre-onboarding entry
   *  or a loan since removed, filtered out before render. Kept pointing at
   *  the loan's current position by `alignToLoans`; `loanId` is what
   *  identifies the loan. */
  loanIndex: number;
  /** The loan's stable id (LoanPayload.id). Missing on entries logged
   *  before loans had ids until they're next aligned. */
  loanId?: string;
  kind: ActivityKind;
  /** ISO date 'YYYY-MM-DD' of the payment event. */
  date: string;
  /** Amount paid, decimal string. Always non-negative.
   *  • missed: '0' (must be zero)
   *  • paid_full: actual amount sent (usually >= scheduledEmi)
   *  • paid_partial: amount sent (< scheduledEmi)
   *  • paid_extra: full amount paid (engine credits amount - scheduledEmi as
   *                additional principal reduction beyond the regular EMI)
   *  • closed: amount sent to clear the loan (informational only — the
   *            outstanding is forced to zero regardless) */
  amount: string;
  /** What the user's scheduled EMI was for that cycle. Stored explicitly so
   *  the penalty estimate doesn't drift if the loan's scheduled_emi later
   *  changes. */
  scheduledEmi: string;
  /** Optional user-provided penalty override (₹/$) — replaces the engine
   *  estimate for missed/partial events when the user's statement carries
   *  a different figure. Ignored for other kinds. */
  penaltyOverride?: string;
  /** Optional free-text note. */
  note?: string;
  /** Optional source tag for prepayments — e.g. 'sold-asset', 'bonus',
   *  'gift', 'refund'. Pure metadata: the engine doesn't branch on it,
   *  but the UI uses it to surface "covered by X" badges and the
   *  changelog reads better. */
  source?: string;
  /** Residence-currency cash already debited by a tool; recap must not debit it again. */
  cashDebited?: string;
  /** Number of forward months this prepayment covers. Set when the user
   *  used the "Prepay forward N months" flow — purely informational; the
   *  principal reduction is captured by the paid_extra amount itself. */
  coversForwardMonths?: number;
  /** When the user logged this (not when it happened). Used for sort
   *  tiebreaks when multiple entries share a date. */
  loggedAt: string;
  /** Credit cards only: the user's reported new outstanding balance
   *  AFTER this payment was applied. When set, the activity-deltas
   *  cookie includes a `balanceOverride` so the server re-anchors the
   *  card's outstanding to this value before simulating, instead of
   *  letting it drift from the original onboarding figure.
   *
   *  Blank / unset → outstanding unchanged (previous behavior). Engine
   *  ignores this on non-card loans, which have amortization. */
  newOutstanding?: string;
}

export const ACTIVITY_KINDS: ActivityKind[] = [
  'paid_full',
  'paid_partial',
  'missed',
  'paid_extra',
  'closed',
];

const STORAGE_KEY = 'finoptima_activity';

function safeParse(raw: string | null): ActivityEntry[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isActivityEntry);
  } catch {
    return [];
  }
}

function isActivityEntry(v: unknown): v is ActivityEntry {
  if (!v || typeof v !== 'object') return false;
  const e = v as Partial<ActivityEntry>;
  return (
    typeof e.id === 'string' &&
    typeof e.loanIndex === 'number' &&
    typeof e.kind === 'string' &&
    ACTIVITY_KINDS.includes(e.kind as ActivityKind) &&
    typeof e.date === 'string' &&
    typeof e.amount === 'string' &&
    typeof e.scheduledEmi === 'string' &&
    typeof e.loggedAt === 'string'
  );
}

/** localStorage key: the date setup last saved the user's balances. A card
 *  entered then is up to date even with no activity logged yet. */
export const BALANCES_ENTERED_KEY = 'finoptima_balances_entered';

export function readActivityClient(): ActivityEntry[] {
  if (typeof window === 'undefined') return [];
  return safeParse(window.localStorage.getItem(STORAGE_KEY));
}

export function writeActivityClient(entries: ActivityEntry[]): void {
  if (typeof window === 'undefined') return;
  // Name each entry's loan by id before it's stored, against the saved
  // loans (a page may hold a copy of the list read before ids existed).
  const stored = loadProfileClient();
  if (stored.isLive) entries = alignToLoans(entries, stored.user.loans);
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
  void import('./server-sync').then(({ syncSliceToServer }) =>
    syncSliceToServer('activity', entries),
  );
}

export function addActivityEntry(
  entries: ActivityEntry[],
  draft: Omit<ActivityEntry, 'id' | 'loggedAt'>,
  loans?: Pick<LoanPayload, 'id'>[],
): ActivityEntry[] {
  const loanId = draft.loanId ?? loans?.[draft.loanIndex]?.id;
  if (loanId) draft = { ...draft, loanId };
  const id =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `act_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const entry: ActivityEntry = {
    ...draft,
    id,
    loggedAt: new Date().toISOString(),
  };
  return [entry, ...entries];
}

export function removeActivityEntry(
  entries: ActivityEntry[],
  id: string,
): ActivityEntry[] {
  return entries.filter((e) => e.id !== id);
}

/**
 * Sort newest-first by event date, with logged-at as a tiebreak so multiple
 * entries on the same day stay in input order.
 */
export function sortActivityNewestFirst(entries: ActivityEntry[]): ActivityEntry[] {
  return [...entries].sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? 1 : -1;
    return a.loggedAt < b.loggedAt ? 1 : -1;
  });
}

/**
 * How much principal+interest went unpaid for this event. 0 for paid_full /
 * paid_extra / closed; `scheduledEmi - amount` for paid_partial;
 * `scheduledEmi` for missed. Always non-negative.
 */
export function overdueAmount(entry: ActivityEntry): string {
  if (entry.kind === 'paid_full' || entry.kind === 'paid_extra' || entry.kind === 'closed') {
    return '0';
  }
  if (entry.kind === 'missed') return entry.scheduledEmi;
  // paid_partial
  const owed = Number(entry.scheduledEmi) - Number(entry.amount);
  return String(Math.max(0, owed));
}

/**
 * Days late, measured from the entry's date to `today` (or to a custom
 * reference for testing). Clamps to 0 minimum.
 */
export function daysLate(entry: ActivityEntry, now: Date = new Date()): number {
  if (entry.kind !== 'paid_partial' && entry.kind !== 'missed') return 0;
  const eventDate = new Date(entry.date);
  if (Number.isNaN(eventDate.getTime())) return 0;
  const diffMs = now.getTime() - eventDate.getTime();
  return Math.max(0, Math.floor(diffMs / (1000 * 60 * 60 * 24)));
}

/**
 * For `paid_extra` events, how much principal beyond the scheduled EMI was
 * applied. Used to reduce outstanding in the projection. Always non-negative.
 */
export function extraPrincipal(entry: ActivityEntry): string {
  if (entry.kind !== 'paid_extra') return '0';
  const extra = Number(entry.amount) - Number(entry.scheduledEmi);
  return String(Math.max(0, extra));
}
