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
  /** The date the lender reported this balance (YYYY-MM-DD), when the report shows it (UX50 D-06). */
  reported?: string | null;
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

/** Where to get each bureau's free report (the user downloads it themselves).
 *  Experian first: its consumer portal gives a free report any time (DPIIT B-Ready
 *  FAQ), CIBIL one free a year (UX50 D-13). Links go to the consumer pages, not
 *  the corporate home pages. */
/** Usual PDF passwords, as each bureau publishes them. The download page wins when it disagrees. */
export const PASSWORD_HINTS: { bureau: string; hint: string }[] = [
  { bureau: 'CIBIL', hint: 'Often the first 4 letters of your name in capitals, then the day and month of your date of birth (DDMM). The download email also states it.' },
  { bureau: 'Experian', hint: 'Shown on the download page or in the email. Often your date of birth as DDMMYYYY.' },
  { bureau: 'Equifax', hint: 'Shown when you download the report. Often your date of birth as DDMMYYYY.' },
  { bureau: 'CRIF High Mark', hint: 'Often the first 4 letters of your first name in capitals, then your date of birth as DDMMYYYY.' },
];

export const BUREAU_LINKS: { name: string; url: string; note: string }[] = [
  { name: 'Experian', url: 'https://consumer.experian.in/ECV-OLN/view/angular/', note: 'free any time, about 3 minutes, OTP on your mobile' },
  { name: 'TransUnion CIBIL', url: 'https://www.cibil.com/freecibilscore', note: 'free once a year' },
  { name: 'Equifax', url: 'https://www.equifax.co.in/support/free-credit-report/', note: 'free once a year' },
  { name: 'CRIF High Mark', url: 'https://www.crifhighmark.com/', note: 'free once a year' },
];

/** Steps to get the free Experian report (the guide shown before upload). */
export const EXPERIAN_STEPS: string[] = [
  'Open Experian’s free report page and enter your name, mobile number and PAN.',
  'Type the OTP sent to your mobile.',
  'Download the report as a PDF. Its password is in the email or on the download page.',
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
  if (loan.loan_type === 'credit_card') {
    // A card has no EMI, tenure, rate type or KFS prepayment fee (UX50 D-07).
    return loan.missing.length
      ? "The report doesn't show the card's APR or minimum due. Your monthly card statement has both."
      : '';
  }
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
  // The balance is as of the lender's last report, not today (UX50 D-06); the paid-EMI
  // roll-forward then moves it on. A date in the future or unreadable falls back to today.
  loan.balance_as_of = acc.reported && /^\d{4}-\d{2}-\d{2}$/.test(acc.reported) && acc.reported <= todayIso
    ? acc.reported
    : todayIso;
  if (acc.account_last4) loan.account_last4 = acc.account_last4;
  loan.imported_from = 'credit_report';
  return loan;
}

/** A lender name reduced for matching: lower case, no "bank / ltd / limited /
 *  finance / hfc" words, no punctuation. "HDFC Bank Ltd." and "hdfc" match. */
export function lenderKey(name: string | null | undefined): string {
  return (name ?? '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\b(bank|ltd|limited|pvt|private|finance|financial|services|co|company|corporation|nbfc|hfc|india|the|of)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Which of the user's existing loans an imported account is (UX50 D-03): the same
 *  last four digits when both have them; otherwise the same type at the same lender
 *  (fuzzy name match), when exactly one loan fits. -1 = no match (a new loan). */
export function matchExistingLoan(
  acc: { loan_type: LoanType; lender: string | null; account_last4?: string | null },
  loans: { loan_type: LoanType; bank?: string | null; account_last4?: string | null }[],
): number {
  if (acc.account_last4) {
    const hit = loans.map((l, i) => ({ l, i })).filter(({ l }) => l.account_last4 && l.account_last4 === acc.account_last4);
    if (hit.length === 1) return hit[0].i;
    if (hit.length > 1) return -1;
  }
  const key = lenderKey(acc.lender);
  const same = loans
    .map((l, i) => ({ l, i }))
    .filter(({ l }) => {
      if (l.loan_type !== acc.loan_type) return false;
      if (l.account_last4 && acc.account_last4 && l.account_last4 !== acc.account_last4) return false;
      const k = lenderKey(l.bank);
      return !!key && !!k && (k === key || k.startsWith(key + ' ') || key.startsWith(k + ' ') || k.split(' ')[0] === key.split(' ')[0]);
    });
  return same.length === 1 ? same[0].i : -1;
}

/** What an import would change on a loan already in the list: only the figures the
 *  document states and that differ; the user ticks "Update" to apply them. */
export function mergePatch(loan: LoanPayload, incoming: LoanPayload): { field: keyof LoanPayload; from: string; to: string }[] {
  const keys: (keyof LoanPayload)[] = ['outstanding', 'scheduled_emi', 'nominal_rate', 'tenure_months_remaining', 'account_last4', 'balance_as_of'];
  const out: { field: keyof LoanPayload; from: string; to: string }[] = [];
  for (const k of keys) {
    const to = incoming[k];
    if (to === undefined || to === null || String(to) === '') continue;
    const from = loan[k];
    if (String(from ?? '') === String(to)) continue;
    if (k === 'balance_as_of' && !incoming.outstanding) continue;
    out.push({ field: k, from: String(from ?? ''), to: String(to) });
  }
  return out;
}

function last4Of(account: CrAccount): string {
  const raw = account.loan?.account_last4 || account.fields.account_number?.value || '';
  const digits = raw.replace(/\D/g, '');
  return digits.length >= 4 ? digits.slice(-4) : '';
}

/** Same loan across bureau reports: type plus the last four digits when the
 *  report has them, otherwise type, lender and open date. */
export function reportAccountKey(account: CrAccount): string {
  const type = account.loan_type || '';
  const last4 = last4Of(account);
  if (last4) return `${type}|${last4}`;
  const lender = lenderKey(account.loan?.lender || account.fields.lender?.value);
  const opened = account.loan?.opened || account.fields.opened?.value || '';
  return `${type}|${lender}|${opened}`;
}

function filled(account: CrAccount): number {
  const loan = account.loan;
  if (!loan) return 0;
  return [loan.outstanding, loan.emi, loan.nominal_rate, loan.tenure_months, loan.sanctioned_amount, loan.account_last4].filter((v) => v != null && v !== '').length;
}

/** One list from several bureau reports. The same account (same key) is kept
 *  once. A later report's balance replaces the earlier one. */
export function mergeCreditReports(reports: CreditReportReadResponse[]): CreditReportReadResponse {
  if (reports.length === 0) {
    return { bureau: null, bureau_name: null, score: null, report_date: null, accounts: [], open_loans: 0, warnings: [], source: '', source_url: '' };
  }
  if (reports.length === 1) return reports[0];
  const chosen = new Map<string, CrAccount>();
  const order: string[] = [];
  const names: string[] = [];
  for (const report of reports) {
    if (report.bureau_name && !names.includes(report.bureau_name)) names.push(report.bureau_name);
    const seen = new Set<string>();
    report.accounts.forEach((account, index) => {
      let key = reportAccountKey(account);
      if (seen.has(key)) key = `${key}#${index}`;
      seen.add(key);
      const prev = chosen.get(key);
      if (!prev) {
        order.push(key);
        chosen.set(key, account);
        return;
      }
      const newerBalance = account.loan?.outstanding ?? prev.loan?.outstanding ?? null;
      const base = filled(account) >= filled(prev) ? account : prev;
      const loan = base.loan ? { ...base.loan, outstanding: newerBalance } : base.loan;
      chosen.set(key, { ...base, loan });
    });
  }
  const accounts = order.map((key) => chosen.get(key)!);
  const first = reports[0];
  return {
    ...first,
    bureau_name: names.join(', ') || first.bureau_name,
    accounts,
    open_loans: accounts.filter((a) => a.is_open && a.loan).length,
    warnings: [...new Set(reports.flatMap((r) => r.warnings))],
  };
}
