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

/** "Home loan paid (₹)", "HDFC Bank credit card paid (₹)", numbered when two
 *  read the same, then one "… owed at start (₹)" column per loan (Audit 80+
 *  C19): each loan's paid column holds only payments, so a SUM down it is
 *  what was paid; the opening balances sit in their own columns, filled on
 *  the start row only. */
export function scheduleCsvHeader(loans: LoanPayload[], country: 'IN' | 'US', displayCcy: string): string[] {
  const base = loans.map((l) => {
    const type = LOAN_TYPE_NAME[l.loan_type] ?? 'loan';
    const bank = (l.bank ?? '').trim();
    const name = bank ? `${bank} ${type}` : type.charAt(0).toUpperCase() + type.slice(1);
    return { name, ccy: loanCurrency(l, country) };
  });
  const names = base.map((b, i) => {
    const same = base.filter((x) => x.name === b.name).length;
    const nth = base.slice(0, i + 1).filter((x) => x.name === b.name).length;
    return { label: `${b.name}${same > 1 ? ` ${nth}` : ''}`, sym: SYM[b.ccy] ?? b.ccy };
  });
  const paid = names.map((n) => `${n.label} paid (${n.sym})`);
  const owed = names.map((n) => `${n.label} owed at start (${n.sym})`);
  const s = SYM[displayCcy.toUpperCase()] ?? displayCcy.toUpperCase();
  return ['Month', 'Date', ...paid, ...owed, `Extra (${s})`, `Interest (${s})`, `Principal (${s})`, `Owed after (${s})`, 'Event'];
}

export type ScheduleCsvRow = {
  mo: number;
  date: string;
  perLoan: Record<number, string>;
  extra: number;
  interest: number;
  principal: number;
  balance: number;
  event: string;
};

/** One CSV line's cells, in scheduleCsvHeader's order. On the start row
 *  `perLoan` is each loan's balance (it goes in the "owed at start"
 *  columns, the paid columns stay blank); on every other row it is that
 *  month's payment (paid columns filled, "owed at start" blank). */
export function scheduleCsvCells(r: ScheduleCsvRow, isStart: boolean, loanCount: number): (string | number)[] {
  const amounts = Array.from({ length: loanCount }, (_, i) => Math.round(Number(r.perLoan[i] ?? 0)));
  const blank = Array.from({ length: loanCount }, () => '');
  return [
    isStart ? 0 : r.mo,
    isStart ? CSV_START_LABEL : r.date,
    ...(isStart ? blank : amounts),
    ...(isStart ? amounts : blank),
    Math.round(r.extra),
    Math.round(r.interest),
    Math.round(r.principal),
    Math.round(r.balance),
    r.event,
  ];
}

/** The first row is what's owed at the start, not a payment month. */
export const CSV_START_LABEL = 'Start (owed)';
