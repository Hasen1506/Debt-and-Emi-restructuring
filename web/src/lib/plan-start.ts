/**
 * Per-user override for "when does month 1 of the plan begin?"
 *
 * Default: now (current calendar month). Users who say "I'll start
 * serious budgeting from next month" or "from FY start" can pick a
 * future YYYY-MM. The engine receives the corresponding 1-12
 * simulation_start_month value.
 *
 * Future months that are >12 months out get clamped silently — the
 * engine's annual hike anchoring assumes start month ∈ [1, 12]. Users
 * who really want to defer that far should set a goal event instead.
 */

import type { Country } from './api';
import { getCountryMonth } from './today';

const COOKIE_NAME = 'finoptima_plan_start';
const COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

/** Stored value: YYYY-MM string, or empty for "use today". */
function normalize(v: string | null | undefined): string {
  if (!v) return '';
  // Accept YYYY-MM only.
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(v)) return '';
  return v;
}

// ─── Client ────────────────────────────────────────────────────────────────

export function readPlanStartClient(): string {
  if (typeof document === 'undefined') return '';
  const match = document.cookie.match(new RegExp(`(?:^|; )${COOKIE_NAME}=([^;]*)`));
  return normalize(match ? decodeURIComponent(match[1]) : null);
}

export function writePlanStartClient(value: string) {
  if (typeof document === 'undefined') return;
  const v = normalize(value);
  document.cookie = `${COOKIE_NAME}=${v}; path=/; max-age=${COOKIE_MAX_AGE}; SameSite=Lax`;
  void import('./server-sync').then(({ syncSliceToServer }) =>
    syncSliceToServer('plan_start', v),
  );
}

// ─── Server ────────────────────────────────────────────────────────────────

export async function loadPlanStartServer(): Promise<string> {
  const { cookies } = await import('next/headers');
  return normalize(cookies().get(COOKIE_NAME)?.value);
}

/**
 * Resolve to a 1-12 simulation_start_month that the engine understands.
 * Falls back to the country-anchored "today's month" when the user
 * hasn't set a preference.
 */
export function resolveStartMonth(
  planStart: string,
  country: Country,
): number {
  if (planStart) {
    const m = Number(planStart.slice(5, 7));
    if (m >= 1 && m <= 12) return m;
  }
  return getCountryMonth(country);
}

/**
 * Months between today's calendar month and the user-picked start.
 * Returns 0 if the start is in the past or unset.
 */
export function monthsUntilStart(planStart: string, today: Date = new Date()): number {
  if (!planStart) return 0;
  const year = Number(planStart.slice(0, 4));
  const month = Number(planStart.slice(5, 7));
  const target = new Date(year, month - 1, 1);
  const diff =
    (target.getFullYear() - today.getFullYear()) * 12 +
    (target.getMonth() - today.getMonth());
  return diff > 0 ? diff : 0;
}
