/**
 * Balances move with the months (REDESIGN R4.5). The plan starts at the
 * beginning of this month, before this month's EMI, and pays it. A balance
 * entered earlier is rolled forward by the EMIs due since, so the plan
 * starts from what's owed now.
 *
 * Which EMIs are "since" depends on whether the month's EMI had gone out
 * when the balance was entered (`balance_after_emi`, asked in Setup and
 * Profile):
 *   • after: the entry month's EMI is already off. One fewer EMI to take
 *     off; entered this month, one EMI is added back so the plan's first
 *     month (which pays it) lands on the balance as typed.
 *   • before: every EMI from the entry month on is still to come off.
 *   • not asked (balances saved before the question): the old reading,
 *     after for earlier months and before for this one. It counted an EMI
 *     twice, or skipped one, at the turn of the month.
 * A loan taken this month (`first_emi_month` next month) pays nothing this
 * month: its EMIs come off from that month on.
 * A missed or part-paid EMI in a rolled month is added back by its
 * Activity entry (lib/activity-cookie), as before.
 *
 * Cards aren't rolled (what's paid on them varies; "balance now" in
 * Activity re-anchors them), nor flat-rate or pre-EMI loans, whose
 * principal doesn't fall by the reducing-balance formula.
 */
import Decimal from 'decimal.js';
import type { LoanPayload } from './api';

export interface RolledLoan {
  index: number;
  /** EMIs taken off. */
  months: number;
  /** 'YYYY-MM' the balance was entered. */
  from: string;
  entered: string;
  now: string;
}

export function monthsBetween(from: string, to: string): number {
  const [fy, fm] = from.split('-').map(Number);
  const [ty, tm] = to.split('-').map(Number);
  return (ty - fy) * 12 + (tm - fm);
}

/** The month after 'YYYY-MM'. */
export function nextMonth(month: string): string {
  const [y, m] = month.split('-').map(Number);
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
}

/** Resolve calendar first-EMI dates for each fresh simulation and its preview. */
export function prepareLoanPaymentTiming(loans: LoanPayload[], currentMonth: string): LoanPayload[] {
  return loans.map(loan => loan.first_emi_month && /^\d{4}-(0[1-9]|1[0-2])$/.test(loan.first_emi_month)
    ? { ...loan, first_payment_month: Math.max(1, monthsBetween(currentMonth, loan.first_emi_month) + 1) }
    : loan);
}

/** The answer to "has this month's EMI gone out?": paid, still to pay, or
 *  none yet (a new loan whose first EMI is next month). */
export type EmiAnswer = 'paid' | 'due' | 'first';

export function emiAnswer(loan: Pick<LoanPayload, 'balance_after_emi' | 'first_emi_month'>, currentMonth: string): EmiAnswer | undefined {
  if (loan.first_emi_month && loan.first_emi_month > currentMonth) return 'first';
  return loan.balance_after_emi === true ? 'paid' : loan.balance_after_emi === false ? 'due' : undefined;
}

export function emiAnswerPatch(answer: EmiAnswer, currentMonth: string): Pick<LoanPayload, 'balance_after_emi' | 'first_emi_month'> {
  return answer === 'first'
    ? { balance_after_emi: undefined, first_emi_month: nextMonth(currentMonth) }
    : { balance_after_emi: answer === 'paid', first_emi_month: undefined };
}

/** Loans whose balance follows the reducing-balance formula month by month. */
function rolls(loan: LoanPayload): boolean {
  return (
    loan.loan_type !== 'credit_card' &&
    loan.rate_basis !== 'flat' &&
    (loan.pre_emi_months_remaining ?? 0) <= 0 &&
    (loan.planned_effective_month ?? 0) <= 1 &&
    Number(loan.scheduled_emi) > 0 &&
    Number(loan.outstanding) > 0
  );
}

/** The balance after one more EMI: a month's interest on, the EMI off. */
export function afterOneEmi(loan: Pick<LoanPayload, 'outstanding' | 'nominal_rate' | 'scheduled_emi'>): Decimal {
  const balance = new Decimal(Number(loan.outstanding) || 0);
  const r = new Decimal(Number(loan.nominal_rate) || 0).div(12);
  return Decimal.max(0, balance.add(balance.mul(r)).sub(Number(loan.scheduled_emi) || 0));
}

/** `currentMonth` is 'YYYY-MM' in the user's country. */
export function rollBalancesForward(
  loans: LoanPayload[],
  currentMonth: string,
): { loans: LoanPayload[]; rolled: RolledLoan[] } {
  const rolled: RolledLoan[] = [];
  const out = loans.map((loan, index) => {
    const asOf = loan.balance_as_of?.slice(0, 7);
    if (!asOf || !/^\d{4}-\d{2}$/.test(asOf) || !rolls(loan)) return loan;
    const since = monthsBetween(asOf, currentMonth);
    if (since < 0) return loan;
    const emi = new Decimal(Number(loan.scheduled_emi));
    const start = new Decimal(Number(loan.outstanding));
    const r = new Decimal(Number(loan.nominal_rate) || 0).div(12);
    if (since === 0) {
      // Entered this month after its EMI went out: the plan's first month
      // pays that EMI again from this balance unless it's added back.
      if (loan.balance_after_emi !== true) return loan;
      return {
        ...loan,
        outstanding: start.add(emi).div(r.add(1)).toFixed(2),
        tenure_months_remaining: (loan.tenure_months_remaining || 0) + 1,
      };
    }
    // A new loan: EMIs from its first EMI month to last month.
    const first = loan.first_emi_month && loan.first_emi_month > asOf ? loan.first_emi_month : null;
    const due = Math.min(
      first ? Math.max(0, monthsBetween(first, currentMonth)) : loan.balance_after_emi === false ? since : since - 1,
      loan.tenure_months_remaining || Infinity,
    );
    if (!(due > 0)) return loan;
    let balance = start;
    let paid = 0;
    while (paid < due && balance.gt(0)) {
      balance = Decimal.max(0, balance.add(balance.mul(r)).sub(emi));
      paid += 1;
    }
    rolled.push({ index, months: paid, from: asOf, entered: start.toFixed(0), now: balance.toFixed(0) });
    return {
      ...loan,
      outstanding: balance.toFixed(2),
      tenure_months_remaining: Math.max(0, (loan.tenure_months_remaining || 0) - paid),
    };
  });
  return { loans: out, rolled };
}

/** Date each loan's balance: today for a new loan or a changed balance,
 *  else the date it already had. `prev` is the saved list (matched by id,
 *  else position). Whether the month's EMI had gone out goes with the
 *  balance it was asked about. */
export function stampBalanceDates(next: LoanPayload[], prev: LoanPayload[], today: string, recordedAt: string = new Date().toISOString()): LoanPayload[] {
  return next.map((loan, i) => {
    const before = loan.id ? prev.find((p) => p.id === loan.id) : prev[i];
    const same = before && Number(before.outstanding) === Number(loan.outstanding);
    const out: LoanPayload = {
      ...loan,
      balance_as_of: same ? before.balance_as_of ?? loan.balance_as_of : today,
      balance_recorded_at: same ? before.balance_recorded_at ?? loan.balance_recorded_at : recordedAt,
    };
    const afterEmi = same ? before.balance_after_emi : loan.balance_after_emi;
    if (afterEmi === undefined) delete out.balance_after_emi;
    else out.balance_after_emi = afterEmi;
    return out;
  });
}

/** True when this loan's balance, as being edited, needs the "has this
 *  month's EMI gone out?" answer: an EMI loan whose balance is new or
 *  changed from the saved one. */
export function asksEmiPaid(loan: LoanPayload, saved: LoanPayload | undefined): boolean {
  if (loan.loan_type === 'credit_card' || loan.rate_basis === 'flat') return false;
  if ((loan.pre_emi_months_remaining ?? 0) > 0) return false;
  if (!(Number(loan.outstanding) > 0)) return false;
  return !saved || Number(saved.outstanding) !== Number(loan.outstanding);
}
