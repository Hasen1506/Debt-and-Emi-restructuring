/**
 * Live re-test 6B (R6B-2..5): small, shared input checks for the
 * what-if boxes and Invest-or-prepay, kept pure so the
 * unit tests read the same rules the pages use.
 */
import { parseAmountText, type AmountCurrency } from './amount';

/** A what-if box: an amount ('integer', the shared parser: "5L", "₹2,00,000")
 *  or signed basis points ('bps'). Blank is 0. Out of range is clamped and
 *  said so; unreadable text is an error and the value is left alone. */
export function parseWhatIfBox(
  raw: string,
  mode: 'integer' | 'bps',
  currency: AmountCurrency,
  min: number,
  max: number,
  step = 1,
): { value: number | null; error: string | null; note: string | null } {
  const t = raw.trim();
  if (t === '') return { value: 0, error: null, note: null };
  let n: number;
  if (mode === 'bps') {
    const s = t.replace(/\s|,/g, '').replace(/bps?$/i, '');
    if (!/^[+-]?\d+(\.\d+)?$/.test(s)) return { value: null, error: 'Type a whole number of basis points, like 50 or -25.', note: null };
    n = Number(s);
    if (step > 0) n = Math.round(n / step) * step;
  } else {
    const p = parseAmountText(t, currency);
    if (p.value === null) return { value: null, error: p.error, note: null };
    n = Number(Number(p.value).toFixed(2));
  }
  if (!Number.isFinite(n)) return { value: null, error: 'Type a number.', note: null };
  const clamped = Math.min(max, Math.max(min, n));
  const fmt = (x: number) => (mode === 'bps' ? String(x) : x.toLocaleString(currency === 'INR' ? 'en-IN' : 'en-US'));
  const note = clamped !== n ? `Kept within ${fmt(min)} to ${fmt(max)}: set to ${fmt(clamped)}.` : null;
  return { value: clamped, error: null, note };
}

/** R6B-3: years an asset has been held: a whole number from 1 to 100. */
export function yearsHeldError(raw: string): string | null {
  const t = raw.trim();
  if (t === '') return null;
  if (!/^\d+(\.\d+)?$/.test(t)) return 'Enter whole years, from 1 to 100.';
  const n = Number(t);
  if (!Number.isInteger(n)) return 'Enter whole years, from 1 to 100.';
  if (n < 1 || n > 100) return 'Years held must be from 1 to 100.';
  return null;
}

/** R6B-4: one range for expected inflation, used by the field and the sim. */
export const INFLATION_MIN = 0;
export const INFLATION_MAX = 100;
export function inflationError(raw: string): string | null {
  const t = raw.trim();
  if (t === '') return null;
  const n = Number(t);
  if (!Number.isFinite(n) || !/^-?\d*\.?\d+$/.test(t)) return 'Enter inflation as a percent, like 6.';
  if (n < INFLATION_MIN || n > INFLATION_MAX) return `Inflation must be from ${INFLATION_MIN}% to ${INFLATION_MAX}% a year.`;
  return null;
}

/** R6B-5: a tax bracket shown to one decimal ("31.2%", "30%"). */
export function bracketLabel(rate: number): string {
  if (!Number.isFinite(rate)) return '';
  const pct = rate <= 1 ? rate * 100 : rate;
  return `${Number(pct.toFixed(1))}%`;
}

/** R6B-4: the line where the 5,000 runs would be names only the field(s)
 *  that stop them, never a field that is fine. */
export function mcNote(yearsRaw: string, inflationRaw: string): string {
  const bad: string[] = [];
  if (yearsRaw.trim() === '' || yearsHeldError(yearsRaw)) bad.push('the years held (whole years, 1 to 100)');
  if (inflationRaw.trim() === '' || inflationError(inflationRaw)) bad.push(`"Prices rise a year" (${INFLATION_MIN} to ${INFLATION_MAX}%)`);
  if (bad.length === 0) return '';
  return `Fix ${bad.join(' and ')} to see the 5,000 runs (beats the loan, keeps up with prices).`;
}
