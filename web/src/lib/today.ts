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
 * The only two ways a month is written. Long is a sentence ("July 2029",
 * "18 July 2029"). Short is a tile or a column ("Jul 2029", "18 Jul 2029").
 * Neither is uppercased, and neither drops the century: "JUL 2029" and
 * "Jul '29" were a third and a fourth way of saying the same month.
 */
export function formatMonth(
  year: number,
  monthIndex0: number,
  style: 'long' | 'short',
  day?: number,
): string {
  const name = style === 'long' ? MONTH_NAMES[monthIndex0] : MONTH_NAMES_SHORT[monthIndex0];
  return day != null ? `${day} ${name} ${year}` : `${name} ${year}`;
}

export function formatMonthDate(d: Date, style: 'long' | 'short', withDay = false): string {
  return formatMonth(d.getFullYear(), d.getMonth(), style, withDay ? d.getDate() : undefined);
}

/**
 * "2026-10-09" → "9 Oct 2026" (short) or "9 October 2026" (long).
 * "2026-10" → "Oct 2026" / "October 2026". Reads the digits, so a UTC
 * midnight does not shift the day. Text with no date is returned as given.
 */
export function formatIso(iso: string, style: 'long' | 'short' = 'short'): string {
  const m = /^(\d{4})-(\d{2})(?:-(\d{2}))?/.exec(iso.trim());
  if (!m) return iso;
  const month = Number(m[2]) - 1;
  if (month < 0 || month > 11) return iso;
  return formatMonth(Number(m[1]), month, style, m[3] ? Number(m[3]) : undefined);
}

/**
 * Today's wall-clock date in the user's country, as a Date object with
 * year/month/day matching the country's local calendar. The time component
 * is set to midday-local to avoid DST-boundary off-by-one when this Date is
 * later passed to `toLocaleDateString` in another tz.
 */
/** YYYY-MM-DD of a date in local time. `toISOString()` gives the UTC
 *  date, which in India is yesterday until 05:30. */
export function localIsoDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function getCountryToday(country: Country, now: Date = new Date()): Date {
  const tz = COUNTRY_TZ[country];
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

/** "2026-10": the country's current month, for comparing with entry dates. */
export function countryMonthKey(country: Country): string {
  return localIsoDate(getCountryToday(country)).slice(0, 7);
}

/** 1-12, suitable for sending to the engine as `simulation_start_month`. */
export function getCountryMonth(country: Country): number {
  return getCountryToday(country).getMonth() + 1;
}

/**
 * First day of the calendar month that sim month `monthIndex` falls in.
 * Month 1 is the current month (the engine's `simulation_start_month`),
 * so month N is N − 1 months from now. Adding N was a month late
 * everywhere: debt-free dates, the schedule table, the chart axis.
 */
export function monthIndexToDate(monthIndex: number, start: Date): Date {
  return new Date(start.getFullYear(), start.getMonth() + monthIndex - 1, 1);
}

/**
 * When a trajectory point sits on the calendar. Month 0 is today (what's
 * owed now). Month n ≥ 1 is the last day of that sim month: the engine's
 * balance is the end of the month, and month 1 is still this month, so it
 * must not take a full slot away from today.
 */
export function trajectoryPointDate(monthIndex: number, start: Date): Date {
  if (monthIndex <= 0) return new Date(start.getFullYear(), start.getMonth(), start.getDate(), 12, 0, 0, 0);
  const first = monthIndexToDate(monthIndex, start);
  return new Date(first.getFullYear(), first.getMonth() + 1, 0, 12, 0, 0, 0);
}

/** 0 at `first`, 1 at `end`, spaced by the dates above. */
export function trajectoryTimeFraction(month: number, first: number, end: number, start: Date): number {
  const t = (m: number) => trajectoryPointDate(m, start).getTime();
  const span = t(end) - t(first);
  if (span <= 0) return 0;
  return (t(month) - t(first)) / span;
}

/**
 * A 1-based sim month as the short form ("Jul 2029"), anchored at the
 * country's today. Sentences use formatMonthDate(..., 'long').
 */
export function monthIndexToCountryLabel(
  monthIndex: number | null,
  country: Country,
  style: 'long' | 'short' = 'short',
): string {
  if (monthIndex === null) return '—';
  return formatMonthDate(monthIndexToDate(monthIndex, getCountryToday(country)), style);
}

/** A count of months as years and months: "4 yrs 6 mo", "11 mo", "1 yr". */
export function monthsSpan(n: number): string {
  const y = Math.floor(n / 12);
  const mo = n % 12;
  return `${y > 0 ? `${y} yr${y > 1 ? 's' : ''} ` : ''}${mo > 0 || y === 0 ? `${mo} mo` : ''}`.trim();
}
