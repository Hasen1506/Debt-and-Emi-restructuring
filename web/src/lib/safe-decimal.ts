import Decimal from 'decimal.js';

/**
 * A Decimal from a form value, where blank means zero. `new Decimal('')`
 * throws, and half-filled forms and new profiles carry '' in amount
 * fields: a fresh income stream crashed setup on its second step.
 * Anything that isn't a number reads as zero too.
 */
export function dec(v: string | number | Decimal | null | undefined): Decimal {
  if (v instanceof Decimal) return v;
  if (v == null) return new Decimal(0);
  const t = typeof v === 'string' ? v.trim() : v;
  if (t === '') return new Decimal(0);
  try {
    return new Decimal(t);
  } catch {
    return new Decimal(0);
  }
}
