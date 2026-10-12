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
import type { Country, LenderType, LoanPayload, LoanType } from './api';
import { loanMarket } from './currency';

export type FeeStatus = 'assumed' | 'unknown' | 'entered' | 'kfs';

export const RBI_PREPAYMENT_RULE = 'RBI (Pre-payment Charges on Loans) Directions, 2025, para 5(i), 2 July 2025';
export const RBI_PREPAYMENT_URL = 'https://www.rbi.org.in/Scripts/NotificationUser.aspx?Id=12878&Mode=0';

export const ASSUMED_REASON =
  'Assumed 0%: RBI bars prepayment charges on floating-rate loans to individuals (not for business) (RBI Directions, 2 July 2025).';
export const BUSINESS_REASON =
  "Not known: RBI's no-prepayment-charge rule covers business loans only from some lenders, and only for loans sanctioned from 1 January 2026. Check your loan agreement or Key Facts Statement.";
export const BUSINESS_BANK_REASON =
  'Assumed 0%: RBI bars prepayment charges on floating-rate business loans from commercial banks sanctioned from 1 January 2026 (RBI Directions, 2 July 2025, para 5(ii)(a)).';
export const BUSINESS_SMALL_REASON =
  'Assumed 0%: RBI bars prepayment charges on floating-rate business loans up to ₹50 lakh from small finance banks, sanctioned from 1 January 2026 (RBI Directions, 2 July 2025, para 5(ii)(b)).';
export const OTHER_LENDER_REASON =
  "Not known: RBI's no-prepayment-charge rule covers banks, co-operative banks and NBFCs/HFCs, not other lenders. Check your loan agreement.";
export const LENDER_TYPE_LABELS: Record<LenderType, string> = {
  bank: 'Bank (a commercial bank such as SBI, HDFC, ICICI)',
  small_finance_bank: 'Small finance bank or regional rural bank',
  cooperative_bank: 'Co-operative bank',
  nbfc: 'NBFC (a non-bank lender such as Bajaj Finance)',
  hfc: 'Housing finance company (HFC, such as LIC Housing Finance)',
  other: 'Someone else (employer, chit fund, private lender)',
};
export const RULE_START_YEAR = 2026;
export const SMALL_LENDER_BUSINESS_CAP = 5000000;

export const UNKNOWN_REASON =
  'Not known, so no fee is assumed. If you can, check your loan agreement or Key Facts Statement for a prepayment charge.';

export interface FeeDefault {
  pct: string;
  status: Exclude<FeeStatus, 'entered'>;
  reason: string;
}

/** The fee the plan uses when the field is blank. `market` is the country
 *  whose rules the loan is under. */
export interface FeeContext {
  lenderType?: LenderType;
  businessPurpose?: boolean;
  sanctionYear?: number;
  sanctionedAmount?: string | number;
}

export function prepaymentFeeDefault(loanType: LoanType, rateType: string, market: Country, ctx: FeeContext = {}): FeeDefault {
  if (!(market === 'IN' && rateType === 'floating' && loanType !== 'credit_card')) {
    return { pct: '0', status: 'unknown', reason: UNKNOWN_REASON };
  }
  if (ctx.lenderType === 'other') return { pct: '0', status: 'unknown', reason: OTHER_LENDER_REASON };
  if (!ctx.businessPurpose) return { pct: '0', status: 'assumed', reason: ASSUMED_REASON };
  // A business loan: RBI 2025 Directions para 5(ii), loans from 2026 only.
  const newRule = ctx.sanctionYear !== undefined && ctx.sanctionYear >= RULE_START_YEAR;
  if (newRule && ctx.lenderType === 'bank') return { pct: '0', status: 'assumed', reason: BUSINESS_BANK_REASON };
  const amt = ctx.sanctionedAmount === undefined || ctx.sanctionedAmount === '' ? NaN : Number(ctx.sanctionedAmount);
  if (newRule && ctx.lenderType === 'small_finance_bank' && Number.isFinite(amt) && amt <= SMALL_LENDER_BUSINESS_CAP) {
    return { pct: '0', status: 'assumed', reason: BUSINESS_SMALL_REASON };
  }
  return { pct: '0', status: 'unknown', reason: BUSINESS_REASON };
}

/** What the form shows for a loan's fee: the user's own figure, or the
 *  default with its one-line reason. */
export function feeShown(
  loan: Pick<LoanPayload, 'loan_type' | 'rate_type' | 'currency' | 'prepayment_penalty_pct' | 'kfs_fields'> &
    Partial<Pick<LoanPayload, 'lender_type' | 'business_purpose' | 'sanction_year' | 'sanctioned_amount'>>,
  country: Country,
): { status: FeeStatus; placeholder: string; hint: string } {
  // Read from the loan's own Key Facts Statement (roadmap PR G): it replaces
  // any default, the RBI one included.
  if ((loan.prepayment_penalty_pct ?? '').trim() !== '' && loan.kfs_fields?.includes('prepayment_penalty_pct')) {
    return { status: 'kfs', placeholder: '', hint: 'From your Key Facts Statement. Of any extra you pay.' };
  }
  if ((loan.prepayment_penalty_pct ?? '').trim() !== '') {
    return { status: 'entered', placeholder: '', hint: 'Of any extra you pay.' };
  }
  const d = prepaymentFeeDefault(loan.loan_type, loan.rate_type, loanMarket(loan, country), {
    lenderType: loan.lender_type,
    businessPurpose: loan.business_purpose,
    sanctionYear: loan.sanction_year,
    sanctionedAmount: loan.sanctioned_amount,
  });
  return d.status === 'assumed'
    ? { status: 'assumed', placeholder: '0 (assumed)', hint: d.reason }
    : { status: 'unknown', placeholder: 'Not known', hint: d.reason };
}
