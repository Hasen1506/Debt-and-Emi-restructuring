/**
 * Money typed by a person: "25,00,000", "25L", "1.5 cr", "$2.4k", "250,000".
 *
 * Amount fields store plain digits ("2500000") so every caller and the
 * engine keep working; this module turns what was typed into those digits,
 * groups digits the way the currency writes them (Indian lakh/crore commas
 * for rupees, thousands for dollars), and spells out the scale ("25 lakh")
 * so 25 lakh and 2.5 crore never look alike.
 */
import Decimal from 'decimal.js';

export type AmountCurrency = 'INR' | 'USD';

const SUFFIX: Record<string, number> = {
  k: 1e3, thousand: 1e3,
  l: 1e5, lac: 1e5, lacs: 1e5, lakh: 1e5, lakhs: 1e5, lk: 1e5,
  cr: 1e7, crore: 1e7, crores: 1e7,
  m: 1e6, mn: 1e6, million: 1e6,
  b: 1e9, bn: 1e9, billion: 1e9,
};

export interface ParsedAmount {
  /** Plain digits ("2500000", "2400.5"); '' when blank; null when unreadable. */
  value: string | null;
  error: string | null;
}

/** Read what was typed. Blank is ''. Commas, spaces, ₹, $, Rs and a scale word are allowed. */
export function parseAmountText(raw: string, currency: AmountCurrency = 'INR'): ParsedAmount {
  const s = raw
    .trim()
    .toLowerCase()
    .replace(/^(₹|\$|rs\.?|inr|usd)/, '')
    .replace(/[,\s_]/g, '');
  if (s === '') return { value: '', error: null };
  if (/^-/.test(s)) return { value: null, error: 'Amounts can\'t be negative.' };
  const m = /^(\d*\.?\d+)\.?([a-z]*)$/.exec(s);
  if (!m) {
    const eg = currency === 'INR' ? '25,00,000 or 25L' : '250,000 or 250k';
    return { value: null, error: `Type a number, like ${eg}.` };
  }
  const mult = m[2] === '' ? 1 : SUFFIX[m[2]];
  if (mult === undefined) {
    return { value: null, error: `"${m[2]}" isn't a scale I know. Use k, L (lakh), cr, or m.` };
  }
  const amount = new Decimal(m[1]).mul(mult).toDecimalPlaces(2);
  // The API refuses more than 1e12; huge inputs also used to be stored in
  // exponent form ("1e+23"), which later digit checks rejected (P2-21).
  if (amount.gt(MAX_AMOUNT)) {
    return {
      value: null,
      error: currency === 'INR' ? 'That is more than ₹1 lakh crore. Check the amount.' : 'That is more than $1 trillion. Check the amount.',
    };
  }
  return { value: amount.toFixed(), error: null };
}

/** The largest amount the API accepts (api/schemas.py MAX_AMOUNT). */
export const MAX_AMOUNT = new Decimal('1e12');

/** Errors worth showing while the person is still typing (not just on blur):
 *  a minus sign, letters with no number, or an impossible size. */
export function isImmediateAmountError(raw: string, parsed: ParsedAmount): boolean {
  if (!parsed.error) return false;
  if (isPartialScale(raw)) return false;
  const s = raw.trim().replace(/^(₹|\$|rs\.?|inr|usd)/i, '').replace(/[,\s_]/g, '');
  return s.startsWith('-') || /^[^\d.]/.test(s) || parsed.error.startsWith('That is more than');
}

/** True when two stored amounts are the same number ("2500000" and "2500000.00"). */
export function sameAmount(a: string, b: string): boolean {
  if (a === b) return true;
  const ok = (v: string) => /^-?\d*\.?\d+$/.test(v.trim());
  return ok(a) && ok(b) && new Decimal(a.trim()).eq(new Decimal(b.trim()));
}

/** "2500000" → "25,00,000" (INR) or "2,500,000" (USD). Text that isn't digits is returned as is. */
export function groupDigits(value: string, currency: AmountCurrency): string {
  const m = /^(\d*)(\.\d*)?$/.exec(value);
  if (!m) return value;
  const int = m[1].replace(/^0+(?=\d)/, '');
  const frac = m[2] ?? '';
  return groupInt(int, currency) + frac;
}

function groupInt(int: string, currency: AmountCurrency): string {
  if (int.length <= 3) return int;
  const last3 = int.slice(-3);
  const head = int.slice(0, -3);
  const size = currency === 'INR' ? 2 : 3;
  const parts: string[] = [];
  for (let end = head.length; end > 0; end -= size) parts.unshift(head.slice(Math.max(0, end - size), end));
  return `${parts.join(',')},${last3}`;
}

/** A stored amount for display: "2500000.00" → "25,00,000". Not for text mid-typing. */
export function formatAmount(value: string, currency: AmountCurrency): string {
  const t = value.trim();
  if (!/^\d*\.?\d+$/.test(t)) return groupDigits(t, currency);
  return groupDigits(new Decimal(t).toDecimalPlaces(2).toString(), currency);
}

/** The scale in words: "₹25 lakh", "₹1.5 crore", "$2.4 thousand", "$1.25 million". Null under ₹1 lakh / $1,000. */
export function amountInWords(value: string, currency: AmountCurrency): string | null {
  if (!/^\d*\.?\d+$/.test(value)) return null;
  const v = new Decimal(value);
  const scales: Array<[number, string]> =
    currency === 'INR'
      ? // Audit 80 B21: nobody says "₹5.2 thousand"; below a lakh the
        // grouped figure is enough, so no echo.
        [[1e7, 'crore'], [1e5, 'lakh']]
      : [[1e9, 'billion'], [1e6, 'million'], [1e3, 'thousand']];
  const sym = currency === 'INR' ? '₹' : '$';
  for (const [n, word] of scales) {
    if (v.gte(n)) {
      const x = v.div(n).toDecimalPlaces(2, Decimal.ROUND_DOWN);
      return `${sym}${x.toString()} ${word}`;
    }
  }
  return null;
}

/**
 * Regroup digits while the person types, keeping the caret after the same
 * digit. Text with a scale word ("25L") is left alone until it's finished.
 */
export function regroupWhileTyping(
  text: string,
  caret: number,
  currency: AmountCurrency,
): { text: string; caret: number } {
  if (!/^[\d,]*\.?\d*$/.test(text)) return { text, caret };
  const countBefore = text.slice(0, caret).replace(/,/g, '').length;
  const next = groupDigits(text.replace(/,/g, ''), currency);
  let seen = 0;
  let pos = 0;
  while (pos < next.length && seen < countBefore) {
    if (next[pos] !== ',') seen++;
    pos++;
  }
  return { text: next, caret: pos };
}

/** True while a scale word is half typed ("25 la", "1.5 cro", "2 mil"):
 *  the person is still typing, so this is not an error yet (live re-test NEW-1). */
export function isPartialScale(raw: string): boolean {
  const s = raw.trim().toLowerCase().replace(/^(₹|\$|rs\.?|inr|usd)/, '').replace(/[,\s_]/g, '');
  const m = /^(\d*\.?\d+)\.?([a-z]+)$/.exec(s);
  if (!m) return false;
  const w = m[2];
  return !(w in SUFFIX) && Object.keys(SUFFIX).some((k) => k.startsWith(w));
}

/** What an amount field hands its caller for the typed text: plain digits
 *  when readable, otherwise ''. Never the raw text ("25 la" or
 *  "2,50,00,00,25,0000" used to reach Decimal math and crash the page,
 *  live re-test NEW-1). */
export function amountForCaller(raw: string, currency: AmountCurrency = 'INR'): string {
  const v = parseAmountText(raw, currency).value;
  return v === null ? '' : v;
}
