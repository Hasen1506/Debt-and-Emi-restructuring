/**
 * The plan's CSV export in words (UX50 B-33): a dated filename, headers a
 * person can read in a phone spreadsheet, and the opening row named.
 */
import type { LoanPayload } from './api';
import { loanCurrency } from './currency';
import { LOAN_TYPE_NAME } from './loan-types';

const SYM: Record<string, string> = { INR: '₹', USD: '$' };

export function scheduleCsvFilename(isoDate: string): string {
  return `rightdue-plan-${isoDate}.csv`;
}

/** "Home loan (₹)", "HDFC Bank credit card (₹)", numbered when two read the same. */
export function scheduleCsvHeader(loans: LoanPayload[], country: 'IN' | 'US', displayCcy: string): string[] {
  const base = loans.map((l) => {
    const type = LOAN_TYPE_NAME[l.loan_type] ?? 'loan';
    const bank = (l.bank ?? '').trim();
    const name = bank ? `${bank} ${type}` : type.charAt(0).toUpperCase() + type.slice(1);
    return { name, ccy: loanCurrency(l, country) };
  });
  const cols = base.map((b, i) => {
    const same = base.filter((x) => x.name === b.name).length;
    const nth = base.slice(0, i + 1).filter((x) => x.name === b.name).length;
    return `${b.name}${same > 1 ? ` ${nth}` : ''} (${SYM[b.ccy] ?? b.ccy})`;
  });
  const s = SYM[displayCcy.toUpperCase()] ?? displayCcy.toUpperCase();
  return ['Month', 'Date', ...cols, `Extra (${s})`, `Interest (${s})`, `Principal (${s})`, `Owed after (${s})`, 'Event'];
}

/** The first row is what's owed at the start, not a payment month. */
export const CSV_START_LABEL = 'Start (owed)';
