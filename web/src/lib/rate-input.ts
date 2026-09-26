/**
 * Parse an interest rate typed as a percentage ("8.55", "8.55%").
 *
 * People often type the fraction instead ("0.0855" for 8.55%). Read as a
 * percentage that would be 0.0855%, and every downstream number would be
 * silently wrong, so a value under 1 is never accepted as-is: the caller
 * shows `error` plus a one-click `suggestion`.
 */
import Decimal from 'decimal.js';

export interface ParsedRate {
  /** Annual rate as a fraction string ("0.0855"), or null if unusable. */
  fraction: string | null;
  error: string | null;
  /** Percentage string to offer as the fix, e.g. "8.55". */
  suggestion: string | null;
}

export function parsePercentInput(
  raw: string,
  { min = 1, max = 30 }: { min?: number; max?: number } = {},
): ParsedRate {
  const s = raw.trim().replace(/%$/, '').trim();
  if (s === '') return { fraction: null, error: null, suggestion: null };
  if (!/^\d*\.?\d+$/.test(s)) {
    return { fraction: null, error: 'Enter a number, like 8.55.', suggestion: null };
  }
  const v = new Decimal(s);
  if (v.gt(0) && v.lt(1)) {
    const pct = v.mul(100).toDecimalPlaces(2).toString();
    return {
      fraction: null,
      error: `${s} looks like a fraction. Did you mean ${pct}%?`,
      suggestion: pct,
    };
  }
  if (v.lt(min) || v.gt(max)) {
    return {
      fraction: null,
      error: `Enter a rate between ${min}% and ${max}%.`,
      suggestion: null,
    };
  }
  return { fraction: v.div(100).toString(), error: null, suggestion: null };
}

/** Same check for a spread, which can legitimately be under 1%. Only an
 *  obviously fractional value like 0.0035 (0.35%) is questioned. */
export function parseSpreadInput(raw: string): ParsedRate {
  const s = raw.trim().replace(/%$/, '').trim();
  if (s === '') return { fraction: null, error: null, suggestion: null };
  if (!/^\d*\.?\d+$/.test(s)) {
    return { fraction: null, error: 'Enter a number, like 0.35.', suggestion: null };
  }
  const v = new Decimal(s);
  if (v.gt(0) && v.lt(0.1) && s.replace(/^0*\./, '').length > 2) {
    const pct = v.mul(100).toDecimalPlaces(2).toString();
    return {
      fraction: null,
      error: `${s} looks like a fraction. Did you mean ${pct}%?`,
      suggestion: pct,
    };
  }
  if (v.gt(10)) {
    return { fraction: null, error: 'Enter a spread between 0% and 10%.', suggestion: null };
  }
  return { fraction: v.div(100).toString(), error: null, suggestion: null };
}
