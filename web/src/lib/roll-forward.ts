/**
 * Balances move with the months (REDESIGN R4.5). A balance entered in
 * August is August's: by October one EMI (September's) has come off it,
 * and the plan, which starts with October's EMI, should start from what's
 * owed now. Each EMI loan with a `balance_as_of` date is rolled forward by
 * the EMIs due in the months between that month and this one.
 *
 * The month the balance was entered isn't counted: a balance read off a
 * statement or the bank's app usually already has that month's EMI taken
 * off. A missed or part-paid EMI in a rolled month is added back by its
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

function monthsBetween(from: string, to: string): number {
  const [fy, fm] = from.split('-').map(Number);
  const [ty, tm] = to.split('-').map(Number);
  return (ty - fy) * 12 + (tm - fm);
}

/** `currentMonth` is 'YYYY-MM' in the user's country. */
export function rollBalancesForward(
  loans: LoanPayload[],
  currentMonth: string,
): { loans: LoanPayload[]; rolled: RolledLoan[] } {
  const rolled: RolledLoan[] = [];
  const out = loans.map((loan, index) => {
    const asOf = loan.balance_as_of?.slice(0, 7);
    const emi = new Decimal(Number(loan.scheduled_emi) || 0);
    const start = new Decimal(Number(loan.outstanding) || 0);
    if (
      !asOf ||
      !/^\d{4}-\d{2}$/.test(asOf) ||
      loan.loan_type === 'credit_card' ||
      loan.rate_basis === 'flat' ||
      (loan.pre_emi_months_remaining ?? 0) > 0 ||
      (loan.planned_effective_month ?? 0) > 1 ||
      !emi.gt(0) ||
      !start.gt(0)
    ) {
      return loan;
    }
    const due = Math.min(monthsBetween(asOf, currentMonth) - 1, loan.tenure_months_remaining || Infinity);
    if (!(due > 0)) return loan;
    const r = new Decimal(Number(loan.nominal_rate) || 0).div(12);
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
 *  else position). */
export function stampBalanceDates(next: LoanPayload[], prev: LoanPayload[], today: string, recordedAt: string = new Date().toISOString()): LoanPayload[] {
  return next.map((loan, i) => {
    const before = loan.id ? prev.find((p) => p.id === loan.id) : prev[i];
    const same = before && Number(before.outstanding) === Number(loan.outstanding);
    return { ...loan, balance_as_of: same ? before.balance_as_of ?? loan.balance_as_of : today,
      balance_recorded_at: same ? before.balance_recorded_at ?? loan.balance_recorded_at : recordedAt };
  });
}
