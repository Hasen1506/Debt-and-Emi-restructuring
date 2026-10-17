/**
 * UX2B-9: a home loan taken jointly. Setup never asked the user's share, and
 * the Tax page said "enter only your part of the EMI", which with the whole
 * balance read as "this loan would never be paid off". Now the whole loan's
 * balance and EMI are entered, with "your share, %" (saved as tax_share and
 * marked joint_split); the plan runs on that share of the balance and EMI,
 * and the tax break on it. Loans saved before (no joint_split) are untouched.
 */
import type { LoanPayload } from './api';

const scale = (v: string | undefined, s: number) => (v == null || v === '' ? v : String(Math.round(Number(v) * s * 100) / 100));

/** The share as a fraction in (0, 1), or null for a loan that's all yours. */
export function jointShare(loan: Pick<LoanPayload, 'tax_share' | 'joint_split' | 'loan_type'>): number | null {
  const s = Number(loan.tax_share);
  return loan.joint_split && loan.loan_type !== 'credit_card' && s > 0 && s < 1 ? s : null;
}

/** The loan as the engine runs it: your share of the balance and EMI, all of it yours for tax. */
export function jointForEngine<T extends LoanPayload>(loan: T): T {
  const s = jointShare(loan);
  if (s == null) return loan;
  return { ...loan, outstanding: scale(loan.outstanding, s)!, scheduled_emi: scale(loan.scheduled_emi, s)!, tax_share: '1' };
}

/** Setup's "Your share, %" field ↔ the loan. Blank or 100 = all yours. */
export function shareText(loan: Pick<LoanPayload, 'tax_share' | 'joint_split'>): string {
  return loan.joint_split && Number(loan.tax_share) < 1 ? String(Math.round(Number(loan.tax_share) * 10000) / 100) : '';
}
export function sharePatch(text: string): Partial<LoanPayload> {
  const n = Number(text.trim());
  if (text.trim() === '' || !Number.isFinite(n) || n >= 100 || n <= 0) return { tax_share: undefined, joint_split: undefined };
  return { tax_share: String(n / 100), joint_split: true };
}
