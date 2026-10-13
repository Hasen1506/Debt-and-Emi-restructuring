import { MAX_TENURE_MONTHS } from './tenure-rules';

/** Pure EMI: P * r * (1+r)^n / ((1+r)^n - 1), with r = annualRate / 12. */
export function computeEMI(principal: number, annualRate: number, months: number): number {
  if (months <= 0) return 0;
  const r = annualRate / 12;
  if (r === 0) return principal / months;
  const pow = Math.pow(1 + r, months);
  return (principal * r * pow) / (pow - 1);
}

/**
 * Live re-test 3 R3-2: one bank's EMI and interest for New Debt Check's
 * table, or null figures when there's nothing honest to show: no amount,
 * months outside 1 to 480, or a rate that isn't a number. Interest is
 * never negative (0 months used to give −₹3,00,000).
 */
export function bankEstimate(
  principal: number,
  annualRate: number,
  months: number,
): { emi: number; interest: number; valid: boolean } {
  const valid =
    Number.isFinite(principal) && principal > 0 &&
    Number.isFinite(annualRate) && annualRate >= 0 &&
    Number.isInteger(months) && months >= 1 && months <= MAX_TENURE_MONTHS;
  if (!valid) return { emi: 0, interest: 0, valid: false };
  const emi = computeEMI(principal, annualRate, months);
  return { emi, interest: Math.max(0, emi * months - principal), valid: true };
}
