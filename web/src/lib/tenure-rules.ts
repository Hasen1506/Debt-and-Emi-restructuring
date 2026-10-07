/**
 * Shortest and longest tenure a loan of each kind can have. Live QA (7 Oct)
 * checked a $5,000 personal loan "for 1 month" with no warning; that is a
 * bill, not a loan. Card EMI offers start at 3 months (no-cost EMI).
 */
export const MIN_TENURE_MONTHS: Record<string, number> = {
  credit_card: 3,
  bnpl: 3,
  personal_loan: 6,
  gold_loan: 3,
  auto_loan: 12,
  education_loan: 12,
  home_loan: 12,
};
export const MAX_TENURE_MONTHS = 480;

/** An error message for a tenure, or null when it's fine. */
export function tenureError(loanType: string, months: string | number): string | null {
  const text = String(months).trim();
  if (text === '') return 'Enter the number of months.';
  const n = Number(text);
  if (!Number.isInteger(n) || n <= 0) return 'Enter a whole number of months.';
  const min = MIN_TENURE_MONTHS[loanType] ?? 3;
  if (n < min) {
    return `${n} month${n === 1 ? '' : 's'} is too short for this kind of loan. The shortest is ${min} months; for a one-off payment, pay it from savings instead.`;
  }
  if (n > MAX_TENURE_MONTHS) return `That is more than ${MAX_TENURE_MONTHS / 12} years. Check the months.`;
  return null;
}
