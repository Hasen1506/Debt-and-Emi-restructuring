/**
 * Round 2 (founder, item 4): income that varies by season. The user gives
 * a take-home for each calendar month (January first), or picks their lean
 * and high months with an amount for each; the plan then runs month by
 * month on that pattern (POST /api/simulate, user.seasonal_income; engine
 * income_scenarios). The seasonal reserve is opt-in: in good months the
 * plan holds back what the next lean stretch needs instead of prepaying,
 * so a lean month isn't borrowed on a card. It can cost a little more
 * interest than prepaying, so the page shows both versions side by side.
 * Pure helpers (no React), tested in tests/r2-engine-web.cjs.
 */
import type { SeasonalIncomePayload, SeasonalOutRaw } from './api';

export const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;

const whole = (v: string | number) => {
  const t = String(v ?? '').replace(/[,\s₹$]/g, '').trim();
  if (t === '') return null;
  const n = Number(t);
  return Number.isFinite(n) && n >= 0 && n <= 1e12 ? Math.round(n) : null;
};

/** Twelve amounts from a typical month plus lean and high months (1-12).
 *  A month named in both lists takes the high amount. */
export function patternFrom(opts: {
  typical: string | number;
  lean?: { months: number[]; amount: string | number };
  high?: { months: number[]; amount: string | number };
}): string[] | null {
  const typ = whole(opts.typical);
  if (typ === null) return null;
  const out = Array.from({ length: 12 }, () => typ);
  for (const spec of [opts.lean, opts.high]) {
    if (!spec || spec.months.length === 0) continue;
    const a = whole(spec.amount);
    if (a === null) return null;
    for (const m of spec.months) if (m >= 1 && m <= 12) out[m - 1] = a;
  }
  return out.map(String);
}

/** Twelve typed amounts → the payload's pattern, or an error in plain words. */
export function parsePattern(values: string[]): { pattern: string[] } | { error: string } {
  if (values.length !== 12) return { error: 'Give an amount for each of the 12 months.' };
  const out: string[] = [];
  for (let i = 0; i < 12; i++) {
    const n = whole(values[i]);
    if (n === null) return { error: `${MONTH_SHORT[i]}: type an amount (0 or more).` };
    out.push(String(n));
  }
  if (out.every((v) => v === '0')) return { error: 'At least one month needs some income.' };
  return { pattern: out };
}

/** Is this a real seasonal pattern (12 amounts, some income)? */
export function hasSeasonalPattern(s: SeasonalIncomePayload | null | undefined): s is SeasonalIncomePayload {
  return !!s && Array.isArray(s.pattern) && s.pattern.length === 12 && s.pattern.some((v) => Number(v) > 0);
}

/** Calendar months (1-12) below the year's average take-home. */
export function leanMonths(pattern: string[]): number[] {
  const nums = pattern.map(Number);
  const avg = nums.reduce((a, b) => a + b, 0) / 12;
  return nums.map((v, i) => (v < avg ? i + 1 : 0)).filter((m) => m > 0);
}

export function monthList(months: number[]): string {
  return months.map((m) => MONTH_SHORT[m - 1]).join(', ');
}

/**
 * The honest line under the reserve choice: interest and debt-free date with
 * the reserve and without, and the difference either way. Null when the
 * plan didn't run on the pattern.
 */
export function reserveLine(
  s: SeasonalOutRaw | null | undefined,
  money: (v: string | number) => string,
  dateLabel: (m: number | null) => string,
): string | null {
  if (!s || !s.applied || !s.with_reserve || !s.without_reserve) return null;
  const on = s.with_reserve;
  const off = s.without_reserve;
  const diff = Number(s.reserve_interest_difference ?? Number(on.total_interest_paid) - Number(off.total_interest_paid));
  const when = (r: typeof on) => (r.debt_free_month == null ? 'no debt-free date (a lean month can’t be covered)' : `debt-free ${dateLabel(r.debt_free_month)}`);
  const head =
    `With a reserve: ${money(on.total_interest_paid)} interest, ${when(on)}. ` +
    `Without: ${money(off.total_interest_paid)} interest, ${when(off)}.`;
  const verdict =
    Math.abs(diff) < 1
      ? ' Same interest either way.'
      : diff > 0
        ? ` The reserve costs ${money(diff)} more in interest: cash held back earns less than the loan costs.`
        : ` The reserve saves ${money(-diff)} in interest: less is borrowed on a card in lean months.`;
  const held = Number(s.peak_reserve ?? 0) > 0 ? ` It holds back up to ${money(s.peak_reserve as string)} in good months.` : '';
  return head + verdict + held;
}
