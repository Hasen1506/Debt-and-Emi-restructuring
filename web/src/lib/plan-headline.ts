/**
 * Audit 80+ E13: the plan's answer as one sentence a screen reader can
 * jump to (an h2), in sentence case with whole words: "Debt-free: November
 * 2028, in 2 years 1 month". All-caps "NOV 2028 IN 2 YRS 1 MO" was read as
 * one run, and some voices spell "YRS" letter by letter.
 */
import type { Country } from './api';
import { formatMonthDate, getCountryToday, monthIndexToDate } from './today';

/** "2 years 1 month", "11 months", "1 year". */
export function monthsInWords(n: number): string {
  const y = Math.floor(n / 12);
  const m = n % 12;
  const parts: string[] = [];
  if (y > 0) parts.push(`${y} year${y === 1 ? '' : 's'}`);
  if (m > 0 || y === 0) parts.push(`${m} month${m === 1 ? '' : 's'}`);
  return parts.join(' ');
}

/** "November 2028" for a plan month (1 = this month). */
export function longMonth(monthIndex: number, country: Country, today: Date = getCountryToday(country)): string {
  return formatMonthDate(monthIndexToDate(monthIndex, today), 'long');
}

export function planHeadline(
  p: { debtFreeMonth: number | null; short: boolean; country: Country },
  today?: Date,
): string {
  if (p.short) return 'Your plan: this month is short';
  if (!p.debtFreeMonth) return 'Your plan: no payoff date at these figures';
  return `Debt-free: ${longMonth(p.debtFreeMonth, p.country, today)}, in ${monthsInWords(p.debtFreeMonth)}`;
}
