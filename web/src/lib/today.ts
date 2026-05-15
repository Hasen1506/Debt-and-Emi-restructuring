/**
 * Country-aware "today" + FY anchor.
 *
 * Why this exists: every other place in the app that needs "what's today?"
 * was calling `new Date()` directly, which renders in the visitor's browser
 * timezone. If an IN user opens the app from a server in PST, "May 15" can
 * read as "May 14" mid-day. Same for schedules that say "starting Jul 2026" —
 * the start month was based on UTC slop, not the user's wall-clock month.
 *
 * This module gives the rest of the app one helper to call. It returns a
 * Date *normalised* to the user's country (IST for IN, ET for US) so the
 * calendar-month component is what the user expects, regardless of server
 * or browser tz. It also exposes the FY anchor (April for IN, January for
 * US) so onboarding can default the hike-effective-month picker.
 *
 * Works in both server and client components — no DOM/window deps.
 */

import type { Country } from '@/lib/api';

const COUNTRY_TZ: Record<Country, string> = {
  IN: 'Asia/Kolkata',
  US: 'America/New_York',
};

/** FY-start month (1-12) by country. IN=April, US=January. */
export const FY_ANCHOR_MONTH: Record<Country, number> = {
  IN: 4,
  US: 1,
};

export const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
] as const;

export const MONTH_NAMES_SHORT = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
] as const;

/**
 * Today's wall-clock date in the user's country, as a Date object with
 * year/month/day matching the country's local calendar. The time component
 * is set to midday-local to avoid DST-boundary off-by-one when this Date is
 * later passed to `toLocaleDateString` in another tz.
 */
export function getCountryToday(country: Country): Date {
  const tz = COUNTRY_TZ[country];
  const now = new Date();
  // Use Intl to extract the country's local Y/M/D directly, no math.
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  return new Date(get('year'), get('month') - 1, get('day'), 12, 0, 0, 0);
}

/** 1-12, suitable for sending to the engine as `simulation_start_month`. */
export function getCountryMonth(country: Country): number {
  return getCountryToday(country).getMonth() + 1;
}

/** Display label like "Friday, 15 May 2026 · IST". */
export function formatCountryDateLong(country: Country): string {
  const d = getCountryToday(country);
  const day = d.toLocaleDateString('en-GB', { weekday: 'long' });
  const date = d.toLocaleDateString('en-GB', {
    day: '2-digit', month: 'long', year: 'numeric',
  });
  const tzLabel = country === 'IN' ? 'IST' : 'ET';
  return `${day}, ${date} · ${tzLabel}`;
}

/** Short label like "FRI 15 MAY 2026 IST". */
export function formatCountryDateShort(country: Country): string {
  const d = getCountryToday(country);
  const s = d.toLocaleDateString('en-GB', {
    weekday: 'short', day: '2-digit', month: 'short', year: 'numeric',
  });
  const tzLabel = country === 'IN' ? 'IST' : 'ET';
  return `${s.toUpperCase()} ${tzLabel}`;
}

/**
 * Convert a 1-based sim month index into a "Mon yy" label, anchored at the
 * country's today. Replaces the old api.ts `monthIndexToLabel` which always
 * used `new Date()` and en-IN formatting regardless of country.
 */
export function monthIndexToCountryLabel(
  monthIndex: number | null,
  country: Country,
): string {
  if (monthIndex === null) return '—';
  const start = getCountryToday(country);
  const d = new Date(start.getFullYear(), start.getMonth() + monthIndex, 1);
  const locale = country === 'IN' ? 'en-IN' : 'en-US';
  return d.toLocaleDateString(locale, { month: 'short', year: 'numeric' });
}
