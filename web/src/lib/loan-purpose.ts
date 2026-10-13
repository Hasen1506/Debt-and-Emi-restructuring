/**
 * "Is this loan for a business?" (live test #11, sprint L3).
 *
 * A blank prepayment fee on an Indian floating-rate loan reads as "0
 * (assumed)" because RBI bars prepayment charges on floating-rate loans to
 * individuals for purposes other than business (lib/prepayment-fee,
 * RBI (Pre-payment Charges on Loans) Directions, 2025, para 5(i)). The live
 * test found that assumption was applied without asking. Profile → Loans now
 * asks on every loan the rule could cover; a "yes" turns the default into
 * "Not known" with its own reason. The math is the same either way (a blank
 * fee is 0% in the plan); what changes is what the form tells the user to
 * check.
 *
 * The field is `LoanPayload.business_purpose` (unset = not answered, read as
 * a personal loan, the app's usual case). G1 (cards-fees) owns the fee rule
 * itself and may add a lender-type field beside this one; this file only
 * wraps `feeShown`.
 */
import type { Country, LoanPayload } from './api';
import { loanMarket } from './currency';
import { BUSINESS_REASON, feeShown, RBI_PREPAYMENT_RULE, type FeeStatus } from './prepayment-fee';

/** G1's reason for a business loan's fee (lib/prepayment-fee owns the rule). */
export { BUSINESS_REASON };

export const PURPOSE_QUESTION = 'Is this loan for a business?';

/** Plain words for "a person's own loan" beside the question. */
export const PURPOSE_HELP =
  `A loan you took for yourself or your family (a home, a car, studies, personal needs) is "not for business". ` +
  `A loan for running a shop, a firm or a practice is "for a business", even in your own name. ` +
  `It matters because RBI bars prepayment charges on floating-rate loans to individuals only when the loan is not for business (${RBI_PREPAYMENT_RULE}).`;

/** Whether to ask: the loan is one the RBI 0% rule could cover (Indian
 *  rules, floating rate, not a card). */
export function asksBusinessPurpose(
  loan: Pick<LoanPayload, 'loan_type' | 'rate_type' | 'currency'>,
  country: Country,
): boolean {
  return loanMarket(loan, country) === 'IN' && loan.rate_type === 'floating' && loan.loan_type !== 'credit_card';
}

/** `feeShown`, which already applies the business answer (with the lender
 *  type and sanction year, sprint G1). This only adds what an unanswered
 *  question assumes. */
export function feeShownWithPurpose(
  loan: Pick<LoanPayload, 'loan_type' | 'rate_type' | 'currency' | 'prepayment_penalty_pct' | 'kfs_fields' | 'business_purpose'> &
    Partial<Pick<LoanPayload, 'lender_type' | 'sanction_year' | 'sanctioned_amount'>>,
  country: Country,
): { status: FeeStatus; placeholder: string; hint: string } {
  const shown = feeShown(loan, country);
  if (shown.status === 'assumed' && loan.business_purpose === undefined && asksBusinessPurpose(loan, country)) {
    return { ...shown, hint: `${shown.hint} Assumes the loan is not for a business: answer the question below if it is.` };
  }
  return shown;
}
