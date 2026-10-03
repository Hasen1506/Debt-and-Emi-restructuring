/**
 * What actually reached the debts (AUDIT §10 M4). The plan assumes the
 * same spending every month, so the same total to debts; real months
 * vary. What moves the date is what was paid, so the last three months
 * logged in Activity are set beside what the plan puts in, and the date
 * is worked out again at that pace.
 *
 * A month counts towards the average only when every EMI loan running
 * then has an entry for it (paid, part-paid or missed): a month with one
 * loan logged and one not would read as paying less. Card payments count
 * when they're logged. One-off sums (from a bonus, a sale, a gift, a
 * refund, a loan closed) are kept apart: they're already off the
 * balances, and they aren't a pace that can be kept up.
 *
 * The browser works out the months (Activity lives in localStorage) and
 * carries them in the activity cookie; the server adds them up in the
 * user's currency and runs the plan once more at the average.
 */
import Decimal from 'decimal.js';
import type { ActivityEntry } from './activity';
import type { Country, LoanPayload } from './api';
import { loanToUser } from './currency';
import { alignToLoans, resolveLoanIndex } from './loan-ids';

/** Months looked back over, before this one. */
export const PACE_MONTHS = 3;
/** Fully logged months needed before an average is offered. */
export const PACE_MIN_MONTHS = 2;

export interface PaceLoanPaid {
  loanIndex: number;
  loanId?: string;
  /** Regular payments that month, in the loan's currency. */
  regular: string;
  /** One-off sums that month, in the loan's currency. */
  oneOff: string;
}

export interface PaceMonth {
  /** "2026-09". */
  month: string;
  paid: PaceLoanPaid[];
  /** Every EMI loan running that month has an entry for it. */
  complete: boolean;
}

/** A lump sum rather than a month's payment: tagged with where the money
 *  came from, paying months ahead, or clearing the loan. */
export function isOneOff(e: ActivityEntry): boolean {
  return e.kind === 'closed' || !!e.source || (e.coversForwardMonths ?? 0) > 0;
}

export function monthsBefore(month: string, n: number): string[] {
  const [y, m] = month.split('-').map(Number);
  const out: string[] = [];
  for (let k = n; k >= 1; k--) {
    const d = new Date(Date.UTC(y, m - 1 - k, 1));
    out.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`);
  }
  return out;
}

const isEmiLoan = (l: LoanPayload) => l.loan_type !== 'credit_card' && Number(l.scheduled_emi) > 0;

/**
 * The last `PACE_MONTHS` months before `thisMonth`, oldest first, with
 * what was logged on each loan. A loan is expected in a month from its
 * first entry or the month its balance was entered, whichever is earlier,
 * until the month it was cleared.
 */
export function paceMonths(entries: ActivityEntry[], loans: LoanPayload[], thisMonth: string): PaceMonth[] {
  const aligned = alignToLoans(entries, loans).filter((e) => e.loanIndex >= 0 && loans[e.loanIndex]);
  const months = monthsBefore(thisMonth, PACE_MONTHS);
  const span = loans.map((loan, i) => {
    const mine = aligned.filter((e) => e.loanIndex === i);
    const firstEntry = mine.reduce<string | null>((min, e) => (min === null || e.date < min ? e.date : min), null);
    const asOf = loan.balance_as_of?.slice(0, 7) ?? null;
    const from = [firstEntry?.slice(0, 7), asOf].filter(Boolean).sort()[0] ?? null;
    // Cleared: by a "closed" entry, or (nothing owed now) by its last entry.
    const lastEntry = mine.reduce<string>((max, e) => (e.date > max ? e.date : max), '0000-00');
    const closedOn =
      mine.filter((e) => e.kind === 'closed').map((e) => e.date.slice(0, 7)).sort()[0] ??
      (Number(loan.outstanding) > 0 ? null : lastEntry.slice(0, 7));
    return { from, closedOn };
  });
  return months.map((month) => {
    const inMonth = aligned.filter((e) => e.date.slice(0, 7) === month);
    const byLoan = new Map<number, { regular: Decimal; oneOff: Decimal }>();
    for (const e of inMonth) {
      const cur = byLoan.get(e.loanIndex) ?? { regular: new Decimal(0), oneOff: new Decimal(0) };
      const amount = new Decimal(Number(e.amount) > 0 ? e.amount : 0);
      if (isOneOff(e)) cur.oneOff = cur.oneOff.add(amount);
      else cur.regular = cur.regular.add(amount);
      byLoan.set(e.loanIndex, cur);
    }
    const complete =
      inMonth.length > 0 &&
      loans.every((loan, i) => {
        if (!isEmiLoan(loan) || byLoan.has(i)) return true;
        const { from, closedOn } = span[i];
        const running = from !== null && from <= month && (closedOn === null || month <= closedOn);
        return !running;
      });
    return {
      month,
      complete,
      paid: [...byLoan.entries()].map(([i, t]) => ({
        loanIndex: i,
        ...(loans[i]?.id ? { loanId: loans[i].id } : {}),
        regular: t.regular.toFixed(2),
        oneOff: t.oneOff.toFixed(2),
      })),
    };
  });
}

export interface PaceSummaryMonth {
  month: string;
  /** Regular payments, in the user's currency. */
  paid: number;
  oneOff: number;
  complete: boolean;
}

export interface PaceSummary {
  months: PaceSummaryMonth[];
  /** Average of the fully logged months, rounded; null with fewer than
   *  `PACE_MIN_MONTHS` of them. */
  average: number | null;
  /** How many months the average is over. */
  counted: number;
}

/** The months in the user's currency, and their average. Null when there's
 *  nothing logged, or a payment's currency can't be converted. */
export function paceSummary(
  months: PaceMonth[],
  loans: LoanPayload[],
  country: Country,
  fx: Record<string, string> | undefined,
): PaceSummary | null {
  if (!months.some((m) => m.paid.length > 0)) return null;
  const out: PaceSummaryMonth[] = [];
  for (const m of months) {
    let paid = 0;
    let oneOff = 0;
    for (const p of m.paid) {
      const i = resolveLoanIndex(p, loans);
      if (i < 0) continue;
      const reg = loanToUser(Number(p.regular), loans[i], country, fx);
      const one = loanToUser(Number(p.oneOff), loans[i], country, fx);
      if (reg === null || one === null) return null;
      paid += reg;
      oneOff += one;
    }
    out.push({ month: m.month, paid: Math.round(paid), oneOff: Math.round(oneOff), complete: m.complete });
  }
  const full = out.filter((m) => m.complete);
  const average = full.length >= PACE_MIN_MONTHS ? Math.round(full.reduce((s, m) => s + m.paid, 0) / full.length) : null;
  return { months: out, average, counted: full.length };
}

/** Whether the pace is far enough from the plan's total to say so: more
 *  than 5% (and a rupee or dollar) either way. */
export function paceDiffers(average: number, planTotal: number): boolean {
  return planTotal > 0 && Math.abs(average - planTotal) > Math.max(1, planTotal * 0.05);
}
