/**
 * What a blank prepayment fee means (roadmap PR K, founder decision
 * 2026-10-08). Twin of engine/prepayment_fee.py; both are tested against
 * the same table.
 *
 * The field is optional and never blocks the plan:
 *   • A floating-rate loan in India that isn't a card: 0%, shown as
 *     "assumed". RBI bars prepayment charges on floating-rate loans to
 *     individuals for purposes other than business: Reserve Bank of India
 *     (Pre-payment Charges on Loans) Directions, 2025, RBI/2025-26/64,
 *     DoR.MCS.REC.38/01.01.001/2025-26, July 2, 2025, para 5(i)
 *     (https://www.rbi.org.in/Scripts/NotificationUser.aspx?Id=12878&Mode=0).
 *     Loans sanctioned before 1 Jan 2026 fall under the circulars it
 *     repeals for their period, e.g. DBOD.Dir.BC.No.110/13.03.00/2013-14,
 *     May 7, 2014 (banks; floating-rate term loans to individuals).
 *   • Fixed-rate loans, cards and US loans: unknown. No fee is assumed
 *     (0% in the math) and the form gently says to check the agreement.
 * No lender-specific fee is ever filled in.
 */
import type { Country, LoanPayload, LoanType } from './api';
import { loanMarket } from './currency';

export type FeeStatus = 'assumed' | 'unknown' | 'entered';

export const RBI_PREPAYMENT_RULE = 'RBI (Pre-payment Charges on Loans) Directions, 2025, para 5(i), 2 July 2025';
export const RBI_PREPAYMENT_URL = 'https://www.rbi.org.in/Scripts/NotificationUser.aspx?Id=12878&Mode=0';

export const ASSUMED_REASON =
  'Assumed 0%: RBI bars prepayment charges on floating-rate loans to individuals (not for business) (RBI Directions, 2 July 2025).';
export const UNKNOWN_REASON =
  'Not known, so no fee is assumed. If you can, check your loan agreement or Key Facts Statement for a prepayment charge.';

export interface FeeDefault {
  pct: string;
  status: Exclude<FeeStatus, 'entered'>;
  reason: string;
}

/** The fee the plan uses when the field is blank. `market` is the country
 *  whose rules the loan is under. */
export function prepaymentFeeDefault(loanType: LoanType, rateType: string, market: Country): FeeDefault {
  if (market === 'IN' && rateType === 'floating' && loanType !== 'credit_card') {
    return { pct: '0', status: 'assumed', reason: ASSUMED_REASON };
  }
  return { pct: '0', status: 'unknown', reason: UNKNOWN_REASON };
}

/** What the form shows for a loan's fee: the user's own figure, or the
 *  default with its one-line reason. */
export function feeShown(
  loan: Pick<LoanPayload, 'loan_type' | 'rate_type' | 'currency' | 'prepayment_penalty_pct'>,
  country: Country,
): { status: FeeStatus; placeholder: string; hint: string } {
  if ((loan.prepayment_penalty_pct ?? '').trim() !== '') {
    return { status: 'entered', placeholder: '', hint: 'Of any extra you pay.' };
  }
  const d = prepaymentFeeDefault(loan.loan_type, loan.rate_type, loanMarket(loan, country));
  return d.status === 'assumed'
    ? { status: 'assumed', placeholder: '0 (assumed)', hint: d.reason }
    : { status: 'unknown', placeholder: 'Not known', hint: d.reason };
}
