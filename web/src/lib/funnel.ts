/**
 * Counts-only funnel (A15, A18; docs/SETUP-FUNNEL.md, api/funnel.py).
 *
 * Each call adds one to a named counter on the server for today. Nothing that
 * identifies anyone is sent: no ids, no amounts, no lender names, no free text,
 * and the request goes out without cookies (credentials: 'omit'). What this
 * device remembers to avoid counting twice ("already counted the Plus door")
 * stays in localStorage and never leaves it.
 *
 * Off unless the site was built with NEXT_PUBLIC_FUNNEL=1; the server also
 * answers 404 until FUNNEL_ENABLED=true.
 */
import { browserApiBase } from './api-base';

export type FunnelEvent =
  | 'field_focus' | 'field_filled' | 'field_left_empty' | 'field_dont_know' | 'field_abandon'
  | 'plan_saved' | 'return_month2' | 'loan_check_finding_5k' | 'loan_check_result'
  | 'door_letter_shown' | 'door_letter_notify' | 'door_plus_shown' | 'door_plus_notify';

export interface FunnelDims { step?: number; field?: string; loan_kind?: string; country?: 'IN' | 'US' | '' }

export const FUNNEL_ONCE_KEY = 'rightdue_funnel_once';
export const FIRST_PLAN_KEY = 'rightdue_first_plan_ym';
/** A18 / A15: a Loan Check finding worth this much or more counts (and shows the letter-pack door). */
export const FINDING_THRESHOLD_INR = 5000;

export function funnelOn(): boolean {
  return process.env.NEXT_PUBLIC_FUNNEL === '1';
}

/** Body sent to /api/funnel: only known keys, only clean values. */
export function funnelBody(event: FunnelEvent, dims: FunnelDims = {}): string {
  const body: Record<string, string | number> = { event };
  if (event.startsWith('field_')) {
    const f = fieldKey(dims.field ?? '');
    if (!f) return '';
    body.field = f;
    body.step = Math.max(0, Math.min(9, Math.trunc(dims.step ?? 0)));
  }
  if (dims.loan_kind && /^[a-z_]{2,20}$/.test(dims.loan_kind)) body.loan_kind = dims.loan_kind;
  if (dims.country === 'IN' || dims.country === 'US') body.country = dims.country;
  return JSON.stringify(body);
}

/** "Months left (₹) 2" → "months_left": letters only, so no amount or number rides along. */
export function fieldKey(label: string): string {
  return label
    .toLowerCase()
    .replace(/[^a-z]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40)
    .replace(/_+$/g, '');
}

export function track(event: FunnelEvent, dims?: FunnelDims): void {
  if (!funnelOn() || typeof window === 'undefined') return;
  const body = funnelBody(event, dims);
  if (!body) return;
  try {
    void fetch(`${browserApiBase()}/api/funnel`, {
      method: 'POST',
      body,
      // text/plain: a "simple" request (no preflight); no cookies go with it.
      headers: { 'Content-Type': 'text/plain' },
      credentials: 'omit',
      keepalive: true,
    }).catch(() => { /* a lost count is fine */ });
  } catch { /* never let counting break the page */ }
}

function readOnce(): string[] {
  try {
    const v = JSON.parse(window.localStorage.getItem(FUNNEL_ONCE_KEY) || '[]');
    return Array.isArray(v) ? v.filter((x) => typeof x === 'string') : [];
  } catch { return []; }
}

/** Count `event` once per device for `key` (e.g. "door_plus_shown"). True if it counted now. */
export function trackOnce(key: string, event: FunnelEvent, dims?: FunnelDims): boolean {
  if (typeof window === 'undefined') return false;
  const seen = readOnce();
  if (seen.includes(key)) return false;
  try { window.localStorage.setItem(FUNNEL_ONCE_KEY, JSON.stringify([...seen, key].slice(-50))); } catch { /* private mode */ }
  track(event, dims);
  return true;
}

const ymNum = (ym: string) => Number(ym.slice(0, 4)) * 12 + Number(ym.slice(5, 7)) - 1;

/** Months since the first month this device showed a plan (0 = that month), or null before any plan. */
export function monthsSinceFirstPlan(firstYm: string | null, todayYm: string): number | null {
  if (!firstYm || !/^\d{4}-\d{2}$/.test(firstYm) || !/^\d{4}-\d{2}$/.test(todayYm)) return null;
  return ymNum(todayYm) - ymNum(firstYm);
}

/**
 * Called whenever Home shows a live plan. Remembers the first plan month on
 * this device and counts a "month-2 return" once: the first visit in the
 * calendar month after it. Returns months since the first plan.
 */
export function notePlanVisit(todayYm: string, country: 'IN' | 'US'): number | null {
  if (typeof window === 'undefined') return null;
  let first: string | null = null;
  try { first = window.localStorage.getItem(FIRST_PLAN_KEY); } catch { /* none */ }
  if (!first) {
    try { window.localStorage.setItem(FIRST_PLAN_KEY, todayYm); } catch { /* private mode */ }
    return 0;
  }
  const n = monthsSinceFirstPlan(first, todayYm);
  if (n === 1) trackOnce('return_month2', 'return_month2', { country });
  return n;
}
