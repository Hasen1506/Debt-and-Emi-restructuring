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
 * Planned events enter the forward simulation at their effective month.
 * Confirmed events update the saved profile and keep an undo snapshot.
 */

import Decimal from 'decimal.js';
import { compressToEncodedURIComponent, decompressFromEncodedURIComponent } from 'lz-string';
import { computeAnnualTax } from './tax-brackets';
import { localIsoDate } from './today';
import type { LoanPayload, UserPayload } from './api';
import { deriveMarginalRateForUser } from './deductions';
import { resolveLoanIndex } from './loan-ids';
import { LOAN_TYPE_NAME, loanLabel } from './loan-types';

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
  /** Snapshot of the profile fields BEFORE applyConfirmedEvent ran.
   *  Populated when status flips planned→confirmed; consumed by
   *  undoConfirmedEvent when user reopens/cancels/deletes a previously-
   *  confirmed event. Undoing an older confirmation rebases the next
   *  confirmation's snapshot, preserving the latest change. */
  appliedSnapshot?: AppliedSnapshot;
}

export interface AppliedSnapshot {
  appliedAt?: string;
  appliedSequence?: number;
  // salary_reset
  prevAnnualIncome?: string;
  prevMonthlyIncome?: string;
  prevAnnualGrossSalary?: string;
  prevAnnualBusinessIncome?: string;
  // floating_rate_reset
  prevLoanRate?: string;
  prevLoanIndex?: number;
  // property_buy — stable identity; index retained for legacy snapshots.
  addedLoanIndex?: number;
  addedLoanId?: string;
  prevLoanId?: string;
  /** Pre-apply marginal rate. Captured because the post-apply user
   *  may sit in a different tax bracket — a salary jump from ₹10L to
   *  ₹25L flips the user from 20% (old regime) to 30%, and the stored
   *  marginalRate must follow or every downstream calc (purchase
   *  advisor, effective-APR, tax sleeve) will lie. On undo we restore
   *  the prior value rather than re-deriving, so the round-trip is
   *  exact even if bracket tables shift between confirm and undo. */
  prevMarginalRate?: string;
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
  /** 0-based index into user.loans when the event was planned. */
  loanIndex: number;
  /** The loan's stable id: wins over loanIndex, so removing another loan
   *  in Setup doesn't move the reset onto its neighbour. */
  loanId?: string;
  /** New nominal rate as decimal (0.084 = 8.4%). */
  newRate: string;
}

export interface PropertyBuyEvent extends BaseEvent {
  kind: 'property_buy';
  /** Forecast at the effective month; append to saved loans on confirm. */
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
    const parsed = JSON.parse(raw.startsWith('z1.') ? decompressFromEncodedURIComponent(raw.slice(3)) || '' : raw);
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

export function writeLifecycleClient(events: LifecycleEvent[], sync = true): void {
  const value = 'z1.' + compressToEncodedURIComponent(JSON.stringify(events));
  if (value.length > 3800) throw new Error('Life event details exceed browser storage. Shorten notes or remove old events, then retry.');
  const before = readClientCookie();
  writeClientCookie(value);
  if (readClientCookie() !== value) {
    if (before != null) writeClientCookie(before);
    else if (typeof document !== 'undefined') document.cookie = `${COOKIE_NAME}=; path=/; max-age=0`;
    throw new Error('Life events could not be saved. Your previous events are unchanged.');
  }
  if (sync) void import('./server-sync').then(({ syncSliceToServer }) =>
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
  const years = Number(toIso.slice(0,4)) - Number(fromIso.slice(0,4));
  const months = Number(toIso.slice(5,7)) - Number(fromIso.slice(5,7));
  return Math.max(1, years * 12 + months + 1);
}

/**
 * Translate planned lifecycle events (status === 'planned', effectiveDate
 * including overdue intentions) into the engine's wire format. Confirmed events
 * are already baked into the profile via `applyConfirmedEvent`; sending
 * them again would double-apply.
 *
 * `today` defaults to the current date — pass an explicit ISO to override
 * for deterministic tests.
 *
 * Overdue intentions enter month 1 until confirmed, postponed or cancelled.
 */
export function plannedEventsForEngine(
  events: LifecycleEvent[],
  today: string = localIsoDate(new Date()),
  loans?: Pick<LoanPayload, 'id'>[],
  user?: UserPayload,
): LifecycleEventInput[] {
  const out: LifecycleEventInput[] = [];
  for (const e of events) {
    if (e.status !== 'planned') continue;

    if (e.kind === 'salary_reset') {
      out.push({
        kind: 'salary_reset',
        effective_month: monthsBetween(today, e.effectiveDate),
        new_annual_gross: e.newAnnualGross,
        new_monthly_take_home: e.newMonthlyTakeHome ?? (user ? estimatedTakeHome(user, e.newAnnualGross) : undefined),
      });
    } else if (e.kind === 'floating_rate_reset') {
      const loanIndex = loans ? resolveLoanIndex(e, loans) : e.loanIndex;
      if (loanIndex < 0) continue;              // the loan was removed
      out.push({
        kind: 'floating_rate_reset',
        effective_month: monthsBetween(today, e.effectiveDate),
        loan_index: loanIndex,
        new_rate: e.newRate,
      });
    }
    if (e.kind === 'property_buy') {
      out.push({kind: 'property_buy', effective_month: monthsBetween(today, e.effectiveDate), loan_draft: {...e.loanDraft, id: `lifecycle_${e.id}`}});
    }
  }
  return out;
}

// ─── Engine integration: apply a confirmed event to the profile ────────────

/**
 * Returns a new `UserPayload` with the event's effect baked in. Pure —
 * caller is responsible for persisting via `saveProfileClient`.
 *
 * Confirmation updates today's baseline. Planned events continue to
 * enter the forecast at their effective month until confirmed/cancelled.
 *
 * For salary_reset we hit `annual_income` (the canonical engine field)
 * + propagate to whichever of annual_gross_salary/annual_business_income
 * was already populated, so tax-bracket math stays consistent.
 */
export function applyConfirmedEvent(
  user: UserPayload,
  event: LifecycleEvent,
): { user: UserPayload; snapshot: AppliedSnapshot } {
  if (event.kind === 'salary_reset') {
    const snapshot: AppliedSnapshot = {
      prevAnnualIncome: user.annual_income,
      prevMonthlyIncome: user.monthly_income,
      prevAnnualGrossSalary: user.annual_gross_salary,
      prevAnnualBusinessIncome: user.annual_business_income,
    };
    const next: UserPayload = { ...user, annual_income: event.newAnnualGross };
    if (user.annual_gross_salary) next.annual_gross_salary = event.newAnnualGross;
    if (user.annual_business_income) next.annual_business_income = event.newAnnualGross;
    next.monthly_income = event.newMonthlyTakeHome ?? estimatedTakeHome(user, event.newAnnualGross);
    if (user.income_type === 'salaried') next.annual_gross_salary = event.newAnnualGross;
    else next.annual_business_income = event.newAnnualGross;
    return { user: next, snapshot };
  }
  if (event.kind === 'floating_rate_reset') {
    const loans = user.loans.slice();
    const idx = resolveLoanIndex(event, loans);
    const target = idx >= 0 ? loans[idx] : undefined;
    const snapshot: AppliedSnapshot = {
      prevLoanIndex: idx,
      prevLoanId: target?.id,
      prevLoanRate: target?.nominal_rate,
    };
    if (!target) throw new Error('The loan for this event no longer exists.');
    if (target) loans[idx] = { ...target, nominal_rate: event.newRate };
    return { user: { ...user, loans }, snapshot };
  }
  if (event.kind === 'property_buy') {
    const addedLoanId = `lifecycle_${event.id}`;
    const snapshot: AppliedSnapshot = { addedLoanIndex: user.loans.length, addedLoanId };
    return {
      // Borrowed on the event's date: the plan rolls it forward from there.
      user: { ...user, loans: [...user.loans, {...event.loanDraft, id: addedLoanId, balance_as_of: event.effectiveDate}] },
      snapshot,
    };
  }
  return { user, snapshot: {} };
}

/**
 * Apply event + refresh the stored marginal tax rate to match the
 * updated user fields. Wraps `applyConfirmedEvent` so callers don't
 * have to remember the two-step (apply → re-derive); skipping the
 * re-derive was a real bug — a salary-bump from ₹10L to ₹25L left the
 * stored `marginalRate` at 20% when actual was 30%, silently mis-pricing
 * every downstream tax-aware calc (purchase advisor, effective APR,
 * tax sleeve). The previous marginalRate is stashed in the snapshot so
 * undo is a round-trip exact, not a re-derive that could differ if
 * bracket tables shift between confirm and undo.
 */
export function applyConfirmedEventWithRefresh(
  user: UserPayload,
  prevMarginalRate: string,
  event: LifecycleEvent,
): { user: UserPayload; marginalRate: string; snapshot: AppliedSnapshot } {
  const { user: updatedUser, snapshot } = applyConfirmedEvent(user, event);
  const marginalRate = deriveMarginalRateForUser(updatedUser);
  return {
    user: updatedUser,
    marginalRate,
    snapshot: { ...snapshot, prevMarginalRate, appliedAt: new Date().toISOString() },
  };
}

/**
 * Inverse of applyConfirmedEvent. Restores the pre-confirm profile state
 * from event.appliedSnapshot. No-op if the snapshot is missing.
 *
 * For stacked confirmations, call undoLifecycleInStack so removing an
 * older event preserves the latest salary/rate and rebases its undo.
 */
export function undoConfirmedEvent(
  user: UserPayload,
  event: LifecycleEvent,
): UserPayload {
  const snap = event.appliedSnapshot;
  if (!snap) return user;
  if (event.kind === 'salary_reset') {
    const next: UserPayload = { ...user };
    if (snap.prevAnnualIncome !== undefined) next.annual_income = snap.prevAnnualIncome;
    if (snap.prevMonthlyIncome !== undefined) next.monthly_income = snap.prevMonthlyIncome;
    if (snap.prevAnnualGrossSalary !== undefined) {
      next.annual_gross_salary = snap.prevAnnualGrossSalary;
    } else {
      delete next.annual_gross_salary;
    }
    if (snap.prevAnnualBusinessIncome !== undefined) {
      next.annual_business_income = snap.prevAnnualBusinessIncome;
    } else {
      delete next.annual_business_income;
    }
    return next;
  }
  if (event.kind === 'floating_rate_reset' && snap.prevLoanIndex !== undefined) {
    const loans = user.loans.slice();
    const idx = resolveLoanIndex({loanIndex: snap.prevLoanIndex, loanId: snap.prevLoanId ?? event.loanId}, loans);
    const target = loans[idx];
    if (target && snap.prevLoanRate !== undefined) {
      loans[idx] = { ...target, nominal_rate: snap.prevLoanRate };
    }
    return { ...user, loans };
  }
  if (event.kind === 'property_buy' && (snap.addedLoanId || snap.addedLoanIndex !== undefined)) {
    const loans = user.loans.slice();
    let idx = snap.addedLoanId ? loans.findIndex(l => l.id === snap.addedLoanId) : -1;
    if(!snap.addedLoanId) {
      const matches=loans.map((l,i)=>({l,i})).filter(({l})=>l.bank===event.loanDraft.bank && l.loan_type===event.loanDraft.loan_type && l.currency===event.loanDraft.currency);
      const exact=matches.filter(({l})=>l.outstanding===event.loanDraft.outstanding && l.nominal_rate===event.loanDraft.nominal_rate);
      const candidates=exact.length ? exact : matches;
      if(candidates.length>1) throw new Error('This older event cannot identify its loan uniquely. Check the matching loans in Setup before undoing it.');
      idx=candidates[0]?.i ?? -1;
    }
    // Legacy snapshots are matched by draft rather than removing an unrelated index.
    if (idx >= 0) loans.splice(idx, 1);
    return { ...user, loans };
  }
  return user;
}

/**
 * Inverse of `applyConfirmedEventWithRefresh`. Restores both the user
 * fields and the stored marginal rate. Prefers the snapshot's
 * `prevMarginalRate` (round-trip exact) and falls back to re-deriving
 * from the restored user — covers legacy events whose snapshots
 * pre-date the marginalRate-staleness fix.
 */
export function undoConfirmedEventWithRefresh(
  user: UserPayload,
  event: LifecycleEvent,
): { user: UserPayload; marginalRate: string } {
  const restoredUser = undoConfirmedEvent(user, event);
  const fromSnapshot = event.appliedSnapshot?.prevMarginalRate;
  const marginalRate = fromSnapshot ?? deriveMarginalRateForUser(restoredUser);
  return { user: restoredUser, marginalRate };
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
  const todayIso = localIsoDate(today);
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
  const name = draft.bank?.trim() ? loanLabel(draft) : `New ${LOAN_TYPE_NAME[draft.loan_type]}`;
  return `${name} (${draft.outstanding})`;
}

/** Estimated income-tax-only net. Payroll/PF/insurance deductions require the override. */
export function estimatedTakeHome(user: UserPayload, gross: string): string {
  const income = new Decimal(gross);
  const tax = computeAnnualTax(user.country, user.tax_regime, user.income_type, income.toNumber(), user.filing_status);
  const state = user.country === 'US' ? income.mul(user.state_marginal_rate ?? 0) : new Decimal(0);
  return Decimal.max(0, income.minus(tax).minus(state)).div(12).toFixed(2);
}

/** Remove an older event without undoing a later confirmation of the same field.
 * Transfer the older baseline to the next event's undo snapshot. */
export function undoLifecycleInStack(user: UserPayload, event: LifecycleEvent, events: LifecycleEvent[]): {user: UserPayload; marginalRate: string; events: LifecycleEvent[]} {
  const sameField = (e: LifecycleEvent) => event.kind === 'salary_reset' ? e.kind === 'salary_reset'
    : event.kind === 'floating_rate_reset' && e.kind === 'floating_rate_reset'
      && resolveLoanIndex(event, user.loans) === resolveLoanIndex(e, user.loans);
  const compare = (a: LifecycleEvent,b: LifecycleEvent) => a.appliedSnapshot?.appliedSequence != null && b.appliedSnapshot?.appliedSequence != null
    ? a.appliedSnapshot.appliedSequence - b.appliedSnapshot.appliedSequence
    : (a.appliedSnapshot?.appliedAt ?? a.loggedAt).localeCompare(b.appliedSnapshot?.appliedAt ?? b.loggedAt);
  const later = events.filter(e => e.id !== event.id && e.status === 'confirmed' && sameField(e) && compare(e,event)>0).sort(compare)[0];
  if (later) {
    const snapshot = {...event.appliedSnapshot, appliedAt: later.appliedSnapshot?.appliedAt, appliedSequence:later.appliedSnapshot?.appliedSequence};
    return {user, marginalRate: deriveMarginalRateForUser(user), events: updateLifecycleEvent(events,later.id,{appliedSnapshot:snapshot})};
  }
  return {...undoConfirmedEventWithRefresh(user,event), events};
}
