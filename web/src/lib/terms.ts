/**
 * Live re-test 8 R8-2: the one place that says a debt word the way a
 * borrower in this country says it. India says "EMI"; a US borrower says
 * "monthly payment". Pages either use `paymentWords(country)` (r7-inputs)
 * for a single word, or pass a whole sentence through `localTerms`.
 *
 * India-only words that have no US meaning ("lakh", "crore", "RBI",
 * "CIBIL") must never be in a US string at all; web/tests/r8-fixes.cjs
 * renders the US strings and checks for them.
 */
import { paymentWords, type CountryCode } from './r7-inputs';

export { paymentWords };

/** Words a US-rendered string must not contain. */
export const INDIA_ONLY_WORDS = /\b(EMIs?|lakhs?|crores?|RBI|CIBIL)\b/i;

/**
 * A sentence written with India's "EMI" in the user's own words. India:
 * unchanged. US: "EMI(s)" becomes "monthly payment(s)" ("an EMI" becomes
 * "a monthly payment"), in capitals when the sentence is in capitals.
 */
export function localTerms(text: string, country: CountryCode | string | null | undefined): string {
  if (country !== 'US' || !text) return text;
  const caps = !/[a-z]/.test(text);
  const pw = paymentWords('US');
  const one = caps ? pw.one.toUpperCase() : pw.one;
  const many = caps ? pw.many.toUpperCase() : pw.many;
  return text
    // A shop's "EMI offer" is a pay-over-time offer in the US.
    .replace(/\b([Aa])n EMI offer\b/g, (_m, a: string) => `${a} ${caps ? 'PAY-OVER-TIME' : 'pay-over-time'} offer`)
    .replace(/\bEMI offer\b/g, caps ? 'PAY-OVER-TIME offer' : 'pay-over-time offer')
    .replace(/\bAN EMI OFFER\b/g, 'A PAY-OVER-TIME OFFER')
    .replace(/\bEMI OFFER\b/g, 'PAY-OVER-TIME OFFER')
    .replace(/\b([Aa])n EMI\b/g, (_m, a: string) => `${a} ${one}`)
    .replace(/\bAN EMI\b/g, `A ${one}`)
    .replace(/\bEMIs\b/g, many)
    .replace(/\bEMIS\b/g, many)
    .replace(/(^|[.!?]\s+)EMI\b/g, (_m, pre: string) => `${pre}${caps ? one : one.charAt(0).toUpperCase() + one.slice(1)}`)
    .replace(/\bEMI\b/g, one);
}
