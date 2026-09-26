/**
 * Parse a fee typed as an amount ("25000", "₹25,000") or a share of the
 * loan ("0.35%").
 *
 * A bare small number is ambiguous: "0.5" is far more likely half a
 * percent than fifty paise, so anything under ₹100 without a "%" is
 * refused with a one-click fix rather than guessed.
 */
import Decimal from 'decimal.js';

export interface ParsedFee {
  amount: string | null;     // rupees
  percent: string | null;    // fraction of the outstanding ("0.0035")
  error: string | null;
  suggestion: string | null; // replacement text, e.g. "0.5%"
}

const EMPTY: ParsedFee = { amount: null, percent: null, error: null, suggestion: null };

export function parseFeeInput(raw: string): ParsedFee {
  const s = raw.trim().replace(/^₹/, '').replace(/,/g, '').trim();
  if (s === '') return EMPTY;
  const isPct = s.endsWith('%');
  const n = isPct ? s.slice(0, -1).trim() : s;
  if (!/^\d*\.?\d+$/.test(n)) {
    return { ...EMPTY, error: 'Enter an amount like 25000, or a percentage like 0.35%.' };
  }
  const v = new Decimal(n);
  if (isPct) {
    if (v.gt(5)) return { ...EMPTY, error: 'A fee above 5% of the loan is unusual. Check the number.' };
    return { ...EMPTY, percent: v.div(100).toString() };
  }
  if (v.gt(0) && v.lt(100)) {
    return {
      ...EMPTY,
      error: `₹${n} is very small. Is it a percentage of the loan?`,
      suggestion: `${n}%`,
    };
  }
  return { ...EMPTY, amount: v.toString() };
}

/** Parse a plain rupee amount. Blank is zero. */
export function parseAmountInput(raw: string): { amount: string | null; error: string | null } {
  const s = raw.trim().replace(/^₹/, '').replace(/,/g, '').trim();
  if (s === '') return { amount: null, error: null };
  if (!/^\d*\.?\d+$/.test(s)) return { amount: null, error: 'Enter an amount in rupees, like 20000.' };
  return { amount: new Decimal(s).toString(), error: null };
}
