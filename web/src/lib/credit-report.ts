/**
 * Credit-report import (grill #17 / #56): types for POST /api/credit-report/read
 * and the step from a reviewed account to a Profile loan.
 *
 * The user downloads their own report from a bureau (TransUnion CIBIL,
 * Experian, CRIF High Mark or Equifax: each gives one free report a year) and
 * uploads it here with the PDF's password. It is read on RightDue's server by
 * fixed rules, never stored; the password is used once and never kept. Every
 * account comes back with the line it was read from, and nothing goes into the
 * user's loans until they tick it and check its figures.
 */
import type { LoanPayload, LoanType } from './api';

export interface CrField {
  value: string;
  source: string;
  note: string;
}

export interface CrProposedLoan {
  loan_type: LoanType;
  lender: string;
  outstanding: string | null;
  emi: string | null;
  nominal_rate: string | null;
  tenure_months: string | null;
  sanctioned_amount: string | null;
  credit_limit: string | null;
  opened: string | null;
  account_last4: string | null;
  /** What the report didn't carry, so the form still asks for it. */
  missing: string[];
}

export interface CrAccount {
  fields: Record<string, CrField>;
  loan_type: LoanType | null;
  is_open: boolean;
  is_guarantor: boolean;
  flags: string[];
  loan: CrProposedLoan | null;
}

export interface CreditReportReadResponse {
  bureau: 'cibil' | 'experian' | 'crif' | 'equifax' | null;
  bureau_name: string | null;
  score: CrField | null;
  report_date: CrField | null;
  accounts: CrAccount[];
  open_loans: number;
  warnings: string[];
  source: string;
  source_url: string;
}

/** Where to get each bureau's free report (the user downloads it themselves). */
export const BUREAU_LINKS: { name: string; url: string }[] = [
  { name: 'TransUnion CIBIL', url: 'https://www.cibil.com/freecibilscore' },
  { name: 'Experian', url: 'https://www.experian.in/' },
  { name: 'CRIF High Mark', url: 'https://www.crifhighmark.com/' },
  { name: 'Equifax', url: 'https://www.equifax.co.in/support/free-credit-report/' },
];

/** Plain words for what the user still has to fill in after the import. */
export const MISSING_LABEL: Record<string, string> = {
  emi: 'the EMI',
  nominal_rate: 'the interest rate',
  tenure_months: 'the months left',
  rate_type: 'fixed or floating',
  prepayment_fee: 'the prepayment fee (your KFS has it)',
};

export function missingSentence(loan: CrProposedLoan): string {
  const parts = loan.missing.map((k) => MISSING_LABEL[k] ?? k);
  if (!parts.length) return '';
  return `The report doesn't show ${parts.join(', ')}. Fill ${parts.length === 1 ? 'it' : 'them'} in before you save.`;
}

/** The Profile loan a ticked account becomes. Only what the report states is
 *  filled; everything else keeps the blank loan's value for the user to type.
 *  A credit card's balance is what's owed today, not a loan to amortise. */
export function loanFromAccount(acc: CrProposedLoan, base: LoanPayload, todayIso: string): LoanPayload {
  const loan: LoanPayload = { ...base, loan_type: acc.loan_type };
  loan.bank = acc.lender;
  if (acc.outstanding) loan.outstanding = acc.outstanding;
  if (acc.nominal_rate) loan.nominal_rate = acc.nominal_rate;
  if (acc.emi && acc.loan_type !== 'credit_card') loan.scheduled_emi = acc.emi;
  if (acc.tenure_months && acc.loan_type !== 'credit_card') {
    const n = Number(acc.tenure_months);
    // The report's tenure is the full term; the months left are fewer.
    if (Number.isFinite(n) && n > 0 && acc.opened) {
      const [y, m] = acc.opened.split('-').map(Number);
      const [ty, tm] = todayIso.split('-').map(Number);
      const gone = (ty - y) * 12 + (tm - m);
      if (gone >= 0 && gone < n) loan.tenure_months_remaining = n - gone;
    }
  }
  loan.balance_as_of = todayIso;
  return loan;
}
