/**
 * Lifecycle-events store — discontinuous life events that perturb the
 * forward plan (a career switch, a rate revision, a planned-then-actual
 * home loan). Cookie-backed for now; migrates to a server-side
 * `lifecycle_events` table when auth + persistence land.
 *
 * Three kinds shipped in phase 1 (covers ~80% of real cases):
 *   • salary_reset           — base income replaced from a date forward
 *   • floating_rate_reset    — loan rate revised on a specific date
 *   • property_buy           — a planned loan with a target arrival date
 *
 * Each event carries a status. `planned` is a future intention; `confirmed`
 * means the user has marked it as actually-happened; `cancelled` means
 * they changed their mind. Status drives the /plan arrival prompt: once
 * a planned event's effectiveDate has passed, /plan banners "did this
 * happen?" with confirm / postpone / cancel actions.
 *
 * Engine integration is deferred — the simulator doesn't yet read this
 * store. For phase 1 the panel is an audit/planning surface. When the
 * engine does pick it up, *confirmed* events with past effectiveDate
 * should be folded into user state at the right month.
 */

import type { LoanPayload, UserPayload } from './api';

const COOKIE_NAME = 'finoptima_lifecycle';
const COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

export type LifecycleStatus = 'planned' | 'confirmed' | 'cancelled';

export type LifecycleKind =
  | 'salary_reset'
  | 'floating_rate_reset'
  | 'property_buy';

interface BaseEvent {
  /** Stable ID — `crypto.randomUUID()` in the browser. */
  id: string;
  status: LifecycleStatus;
  /** ISO YYYY-MM-DD — when the event takes effect. Future = planned,
   *  past + status='planned' triggers the /plan arrival prompt. */
  effectiveDate: string;
  /** ISO timestamp the user created the event — sort tiebreak only. */
  loggedAt: string;
  note?: string;
}

export interface SalaryResetEvent extends BaseEvent {
  kind: 'salary_reset';
  /** Pre-tax annual gross in residence currency, decimal string. */
  newAnnualGross: string;
  /** Optional take-home override. Empty → derive from gross at apply time. */
  newMonthlyTakeHome?: string;
}

export interface FloatingRateResetEvent extends BaseEvent {
  kind: 'floating_rate_reset';
  /** 0-based index into user.loans. */
  loanIndex: number;
  /** New nominal rate as decimal (0.084 = 8.4%). */
  newRate: string;
}

export interface PropertyBuyEvent extends BaseEvent {
  kind: 'property_buy';
  /** Full loan shape — same fields as a regular LoanPayload. On confirm,
   *  this draft is appended to user.loans (eventually; engine wiring is
   *  out of phase 1). */
  loanDraft: LoanPayload;
}

export type LifecycleEvent =
  | SalaryResetEvent
  | FloatingRateResetEvent
  | PropertyBuyEvent;

/** Distributive Omit so the union shape survives. `Omit<LifecycleEvent, K>`
 *  flattens the union into an intersection and drops the discriminated
 *  kind-specific fields, which breaks `addLifecycleEvent`'s draft input. */
export type LifecycleDraft =
  | Omit<SalaryResetEvent, 'id' | 'loggedAt'>
  | Omit<FloatingRateResetEvent, 'id' | 'loggedAt'>
  | Omit<PropertyBuyEvent, 'id' | 'loggedAt'>;

export const LIFECYCLE_KIND_LABEL: Record<LifecycleKind, string> = {
  salary_reset: 'Salary reset',
  floating_rate_reset: 'Floating-rate reset',
  property_buy: 'New loan / property',
};

// ─── (de)serialisation ──────────────────────────────────────────────────────

function isValid(v: unknown): v is LifecycleEvent {
  if (!v || typeof v !== 'object') return false;
  const e = v as Partial<LifecycleEvent>;
  if (
    typeof e.id !== 'string' ||
    typeof e.status !== 'string' ||
    typeof e.effectiveDate !== 'string' ||
    typeof e.loggedAt !== 'string'
  )
    return false;
  if (e.kind === 'salary_reset') {
    return typeof (e as SalaryResetEvent).newAnnualGross === 'string';
  }
  if (e.kind === 'floating_rate_reset') {
    return (
      typeof (e as FloatingRateResetEvent).loanIndex === 'number' &&
      typeof (e as FloatingRateResetEvent).newRate === 'string'
    );
  }
  if (e.kind === 'property_buy') {
    return !!(e as PropertyBuyEvent).loanDraft;
  }
  return false;
}

function safeParse(raw: string | null): LifecycleEvent[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isValid);
  } catch {
    return [];
  }
}

// ─── Client-side ────────────────────────────────────────────────────────────

function readClientCookie(): string | null {
  if (typeof document === 'undefined') return null;
  const match = document.cookie.match(
    new RegExp(`(?:^|; )${COOKIE_NAME}=([^;]*)`),
  );
  return match ? decodeURIComponent(match[1]) : null;
}

function writeClientCookie(value: string) {
  if (typeof document === 'undefined') return;
  document.cookie = `${COOKIE_NAME}=${encodeURIComponent(
    value,
  )}; path=/; max-age=${COOKIE_MAX_AGE}; SameSite=Lax`;
}

export function readLifecycleClient(): LifecycleEvent[] {
  return sortByDate(safeParse(readClientCookie()));
}

export function writeLifecycleClient(events: LifecycleEvent[]): void {
  writeClientCookie(JSON.stringify(events));
  void import('./server-sync').then(({ syncSliceToServer }) =>
    syncSliceToServer('lifecycle', events),
  );
}

export function addLifecycleEvent(
  events: LifecycleEvent[],
  draft: LifecycleDraft,
): LifecycleEvent[] {
  const id =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `lc_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const next = {
    ...draft,
    id,
    loggedAt: new Date().toISOString(),
  } as LifecycleEvent;
  return sortByDate([next, ...events]);
}

export function updateLifecycleEvent(
  events: LifecycleEvent[],
  id: string,
  patch: Partial<LifecycleEvent>,
): LifecycleEvent[] {
  return sortByDate(
    events.map((e) => (e.id === id ? ({ ...e, ...patch } as LifecycleEvent) : e)),
  );
}

export function removeLifecycleEvent(
  events: LifecycleEvent[],
  id: string,
): LifecycleEvent[] {
  return events.filter((e) => e.id !== id);
}

// ─── Engine integration: planned events → engine wire shape ────────────────

import type { LifecycleEventInput } from './api';

/** How many whole months from `from` (inclusive) to `to`. Returns at least 1. */
function monthsBetween(fromIso: string, toIso: string): number {
  const a = new Date(fromIso);
  const b = new Date(toIso);
  const years = b.getFullYear() - a.getFullYear();
  const months = b.getMonth() - a.getMonth();
  return Math.max(1, years * 12 + months + 1);
}

/**
 * Translate planned lifecycle events (status === 'planned', effectiveDate
 * in the future) into the engine's wire format. Confirmed past events
 * are already baked into the profile via `applyConfirmedEvent`; sending
 * them again would double-apply.
 *
 * `today` defaults to the current date — pass an explicit ISO to override
 * for deterministic tests.
 *
 * Skips kinds the engine doesn't yet handle (property_buy) — those stay
 * L1-only.
 */
export function plannedEventsForEngine(
  events: LifecycleEvent[],
  today: string = new Date().toISOString().slice(0, 10),
): LifecycleEventInput[] {
  const out: LifecycleEventInput[] = [];
  for (const e of events) {
    if (e.status !== 'planned') continue;
    if (e.effectiveDate <= today) continue;
    if (e.kind === 'salary_reset') {
      out.push({
        kind: 'salary_reset',
        effective_month: monthsBetween(today, e.effectiveDate),
        new_annual_gross: e.newAnnualGross,
        new_monthly_take_home: e.newMonthlyTakeHome,
      });
    } else if (e.kind === 'floating_rate_reset') {
      out.push({
        kind: 'floating_rate_reset',
        effective_month: monthsBetween(today, e.effectiveDate),
        loan_index: e.loanIndex,
        new_rate: e.newRate,
      });
    }
    // property_buy: engine doesn't handle yet; affects profile only on confirm
    // via L1 immediate-apply path.
  }
  return out;
}

// ─── Engine integration: apply a confirmed event to the profile ────────────

/**
 * Returns a new `UserPayload` with the event's effect baked in. Pure —
 * caller is responsible for persisting via `saveProfileClient`.
 *
 * Level 1 integration: the change applies "as if always true" — the
 * engine simulates the new profile from month 0. The trajectory will
 * technically show the past months at the new salary / new rate. That's
 * acceptable visually; a future level-2 pass will pipe events into the
 * engine so step-changes appear at the right month.
 *
 * For salary_reset we hit `annual_income` (the canonical engine field)
 * + propagate to whichever of annual_gross_salary/annual_business_income
 * was already populated, so tax-bracket math stays consistent.
 */
export function applyConfirmedEvent(
  user: UserPayload,
  event: LifecycleEvent,
): UserPayload {
  if (event.kind === 'salary_reset') {
    const next: UserPayload = { ...user, annual_income: event.newAnnualGross };
    if (user.annual_gross_salary) next.annual_gross_salary = event.newAnnualGross;
    if (user.annual_business_income) next.annual_business_income = event.newAnnualGross;
    if (event.newMonthlyTakeHome) next.monthly_income = event.newMonthlyTakeHome;
    return next;
  }
  if (event.kind === 'floating_rate_reset') {
    const loans = user.loans.slice();
    const target = loans[event.loanIndex];
    if (target) loans[event.loanIndex] = { ...target, nominal_rate: event.newRate };
    return { ...user, loans };
  }
  if (event.kind === 'property_buy') {
    return { ...user, loans: [...user.loans, event.loanDraft] };
  }
  return user;
}

// ─── Server-side ────────────────────────────────────────────────────────────

export async function readLifecycleServer(): Promise<LifecycleEvent[]> {
  const { cookies } = await import('next/headers');
  const raw = cookies().get(COOKIE_NAME)?.value;
  return sortByDate(safeParse(raw ?? null));
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function sortByDate(events: LifecycleEvent[]): LifecycleEvent[] {
  return events
    .slice()
    .sort((a, b) =>
      a.effectiveDate === b.effectiveDate
        ? b.loggedAt.localeCompare(a.loggedAt)
        : a.effectiveDate.localeCompare(b.effectiveDate),
    );
}

/**
 * Events that need the /plan arrival prompt: status='planned' AND
 * effectiveDate is today-or-past. Confirmed/cancelled are filtered out,
 * future planned events stay quiet until their date.
 */
export function pendingArrivals(
  events: LifecycleEvent[],
  today: Date = new Date(),
): LifecycleEvent[] {
  const todayIso = today.toISOString().slice(0, 10);
  return events.filter(
    (e) => e.status === 'planned' && e.effectiveDate <= todayIso,
  );
}

export function describeEvent(e: LifecycleEvent): string {
  if (e.kind === 'salary_reset') {
    return `Income → ${e.newAnnualGross}/yr gross`;
  }
  if (e.kind === 'floating_rate_reset') {
    const pct = (Number(e.newRate) * 100).toFixed(2);
    return `Loan ${e.loanIndex + 1} rate → ${pct}%`;
  }
  // property_buy
  const draft = e.loanDraft;
  const bank = draft.bank?.trim() || 'New loan';
  return `${bank} ${draft.loan_type.replace('_', ' ')} (${draft.outstanding})`;
}
