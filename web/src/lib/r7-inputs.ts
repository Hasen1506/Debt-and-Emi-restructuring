/**
 * Live re-test 7 (14 Oct 2026) helpers, pure so web/tests can check them.
 *  - R7-6: the credit-score check (India 300–900, US FICO 300–850).
 *  - R7-7: the word for a loan's monthly instalment by country ("EMI" is
 *    Indian usage; a US borrower says "monthly payment"), and the loan
 *    kinds Setup offers (gold loans are an Indian product).
 *  - R7-5: an API bound on a rate field, which the API keeps as a fraction
 *    (le=10 means 1000%), said in percent.
 */

export type CountryCode = 'IN' | 'US';

/** R7-6: the range a credit score can take in each country. */
export function creditScoreRange(country: CountryCode | string): { min: number; max: number; bureaus: string } {
  return country === 'US'
    ? { min: 300, max: 850, bureaus: 'FICO' }
    : { min: 300, max: 900, bureaus: 'CIBIL/Experian/CRIF' };
}

/** R7-6: blank is fine (the field is optional); anything else must be a
 *  whole number in the country's range. */
export function creditScoreError(raw: string, country: CountryCode | string): string | null {
  const t = (raw ?? '').trim();
  if (t === '') return null;
  const { min, max, bureaus } = creditScoreRange(country);
  const say = `Enter a score from ${min} to ${max} (${bureaus}), a whole number.`;
  if (!/^\d+$/.test(t)) return say;
  const n = Number(t);
  if (n < min || n > max) return say;
  return null;
}

/** R7-6: the score to use, or '' while what's typed isn't a valid score. */
export function usableCreditScore(raw: string, country: CountryCode | string): string {
  return creditScoreError(raw, country) === null ? (raw ?? '').trim() : '';
}

/** R7-7: how a borrower in this country names a loan's monthly instalment. */
export function paymentWords(country: CountryCode | string): {
  /** "EMI" / "monthly payment" */
  one: string;
  /** "EMIs" / "monthly payments" */
  many: string;
  /** A field label: "EMI a month" / "Monthly payment" */
  field: string;
  /** In capitals for bracket buttons: "EMI" / "MONTHLY PAYMENT" */
  upper: string;
  /** "First EMI" / "First payment" */
  first: string;
} {
  return country === 'US'
    ? { one: 'monthly payment', many: 'monthly payments', field: 'Monthly payment', upper: 'MONTHLY PAYMENT', first: 'First payment' }
    : { one: 'EMI', many: 'EMIs', field: 'EMI a month', upper: 'EMI', first: 'First EMI' };
}

/** R7-7: loan kinds that exist only in India. */
export const INDIA_ONLY_LOAN_TYPES: readonly string[] = ['gold_loan', 'loan_against_property', 'home_topup', 'two_wheeler_loan'];

/** R7-7: the loan-kind chips for this country; a kind already chosen stays
 *  so a saved loan never loses its label. */
export function loanKindsFor<T extends string>(
  chips: ReadonlyArray<readonly [T, string]>,
  country: CountryCode | string,
  current?: string,
): Array<readonly [T, string]> {
  if (country !== 'US') return [...chips];
  return chips.filter(([t]) => !INDIA_ONLY_LOAN_TYPES.includes(t) || t === current);
}

/** R7-5: API fields that hold a rate as a fraction of 1 (0.12 = 12%). */
export function isFractionRateField(field: string): boolean {
  const last = (field || '').split('.').pop() || '';
  if (/(exchange|fx)_rate$/.test(last)) return false;
  return /(^|_)rate$/.test(last) || /_yield$/.test(last) || /_return$/.test(last) || last === 'inflation';
}

/** R7-5: "10" (a fraction) → "1000%"; "0.125" → "12.5%". */
export function fractionAsPercent(v: string): string {
  const n = Number(v) * 100;
  if (!Number.isFinite(n)) return `${v}`;
  return `${Number(n.toFixed(4))}%`;
}
