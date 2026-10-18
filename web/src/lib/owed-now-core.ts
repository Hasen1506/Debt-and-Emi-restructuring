/**
 * Owed-fix (18 Oct 2026): the one "owed now" figure.
 *
 *   owed now = the balance the plan starts from (statement / entered balance,
 *              rolled forward, Activity's missed/partial/extra deltas applied)
 *              less what has already gone out this month and isn't in that
 *              balance yet:
 *                - an EMI loan whose EMI for this month is paid: the balance
 *                  after one EMI (lib/roll-forward afterOneEmi), less the
 *                  plan's own extra marked paid (it waits for next month in
 *                  the plan);
 *                - a card: every payment logged this month after its balance
 *                  was entered, less any part Activity already took off the
 *                  balance (an extra beyond the plan's own).
 *
 * Home, Plan (start row, footer, chart), What If, Profile, the tools and the
 * engine's owed_today all read it from here (or from the cookie written from
 * here), so a card at ₹2,00,000 with ₹79,919 logged paid this month is
 * ₹1,20,081 everywhere. Pure: no browser APIs, safe on the server.
 */
import Decimal from 'decimal.js';
import type { ActivityEntry } from './activity';
import { extraPrincipal } from './activity';
import type { LoanPayload } from './api';
import { paymentState } from './payment-state';
import { afterOneEmi } from './roll-forward';

/** Money already gone out this month on one loan that the plan's opening
 *  balance still holds. `amount` comes off that balance; `paid` is the cash
 *  logged this month (for "₹79,919 paid 9 Oct"), `date` the latest payment. */
export interface PaidOff {
  index: number;
  amount: number;
  paid: number;
  date: string;
}

export interface PaidThisMonth {
  /** EMI loans whose EMI for this month is paid (positions). */
  emis: number[];
  /** Amounts off the opening balance, by loan. */
  off: PaidOff[];
}

/** Before the balance was entered (that balance already has it): skip. A
 *  payment logged in the same instant counts (a frozen test clock). */
function beforeBalance(loan: LoanPayload, e: ActivityEntry, sameInstantCounts: boolean): boolean {
  const asOf = loan.balance_as_of?.slice(0, 10);
  if (!asOf) return false;
  if (e.date < asOf) return true;
  if (e.date !== asOf || !loan.balance_recorded_at) return false;
  const logged = Date.parse(e.loggedAt);
  const recorded = Date.parse(loan.balance_recorded_at);
  return sameInstantCounts ? logged < recorded : logged <= recorded;
}

function isEmiLoan(loan: LoanPayload, month: string): boolean {
  const emi = Number(loan.scheduled_emi) || 0;
  const owed = Number(loan.outstanding) || 0;
  return loan.loan_type !== 'credit_card' && emi > 0 && owed > 0 && !(loan.first_emi_month && loan.first_emi_month > month);
}

/** This month's EMI state on an EMI loan, as Home reads it. */
export function emiStateThisMonth(loan: LoanPayload, mine: ActivityEntry[]) {
  const emi = Number(loan.scheduled_emi) || 0;
  const owed = new Decimal(Number(loan.outstanding) || 0);
  return paymentState(mine, Math.min(emi, owed.mul(new Decimal(loan.nominal_rate || '0').div(12).add(1)).toNumber()), emi);
}

/**
 * What has gone out this month on each loan (entries aligned to `loans`, the
 * loans the plan starts from). `month` is 'YYYY-MM' in the user's country.
 */
export function paidThisMonth(loans: LoanPayload[], entries: ActivityEntry[], month: string): PaidThisMonth {
  const emis: number[] = [];
  const off: PaidOff[] = [];
  loans.forEach((loan, i) => {
    const mine = entries.filter((e) => e.loanIndex === i && e.date.slice(0, 7) === month);
    if (mine.length === 0 || !(Number(loan.outstanding) > 0)) return;
    if (loan.loan_type === 'credit_card') {
      // A balance reported after a payment already has that payment and
      // every older one; only payments logged after it count.
      const newest = [...mine]
        .filter((e) => e.newOutstanding !== undefined && e.newOutstanding.trim() !== '' && !beforeBalance(loan, e, false))
        .sort((a, b) => b.date.localeCompare(a.date) || b.loggedAt.localeCompare(a.loggedAt))[0];
      const counted = mine.filter((e) => e.kind.startsWith('paid') && !beforeBalance(loan, e, true) &&
        (!newest || e.date > newest.date || (e.date === newest.date && e.loggedAt > newest.loggedAt)));
      let paid = new Decimal(0);
      let amount = new Decimal(0);
      for (const e of counted) {
        const cash = new Decimal(Number(e.amount) || 0);
        paid = paid.add(cash);
        // Activity takes an extra beyond the plan's own off the balance at
        // once (lib/activity-cookie); that part is in the opening balance.
        let already = new Decimal(0);
        if (e.kind === 'paid_extra') {
          const extra = Decimal.max(0, new Decimal(extraPrincipal(e)));
          const planned = Decimal.min(extra, Decimal.max(0, new Decimal(e.plannedExtra || 0)));
          already = extra.sub(planned);
        }
        amount = amount.add(Decimal.max(0, cash.sub(already)));
      }
      if (paid.gt(0)) {
        off.push({
          index: i,
          amount: Decimal.min(amount, new Decimal(Number(loan.outstanding) || 0)).toDecimalPlaces(2).toNumber(),
          paid: paid.toDecimalPlaces(2).toNumber(),
          date: counted.map((e) => e.date).sort().slice(-1)[0],
        });
      }
      return;
    }
    if (!isEmiLoan(loan, month)) return;
    const state = emiStateThisMonth(loan, mine);
    if (state === 'due' || state === 'missed' || state === 'part') return;
    emis.push(i);
    // The plan's own extra marked paid comes off once the month is over
    // (lib/activity-cookie); any other extra is off the balance already.
    const planned = mine.reduce((s, e) => (beforeBalance(loan, e, false) ? s : s + Number(e.plannedExtra || 0)), 0);
    if (planned > 0) {
      off.push({
        index: i,
        amount: planned,
        paid: mine.reduce((s, e) => s + (Number(e.amount) || 0), 0),
        date: mine.map((e) => e.date).sort().slice(-1)[0],
      });
    }
  });
  return { emis, off };
}

/** EMI loans whose principal falls by the reducing-balance formula. */
export function rollsDown(loan: LoanPayload): boolean {
  return (
    loan.loan_type !== 'credit_card' &&
    loan.rate_basis !== 'flat' &&
    loan.repayment !== 'bullet' &&
    (loan.pre_emi_months_remaining ?? 0) <= 0 &&
    (loan.planned_effective_month ?? 0) <= 1 &&
    Number(loan.scheduled_emi) > 0 &&
    Number(loan.outstanding) > 0
  );
}

/** Each loan's owed-now balance: `current` (the plan's opening balances)
 *  less what `paid` says has gone out this month. */
export function owedNowLoans(
  current: LoanPayload[],
  paid: { emis?: Iterable<number>; off?: Pick<PaidOff, 'index' | 'amount'>[] },
): LoanPayload[] {
  const emis = new Set(paid.emis ?? []);
  const off = new Map<number, number>();
  for (const o of paid.off ?? []) off.set(o.index, (off.get(o.index) ?? 0) + (Number(o.amount) || 0));
  return current.map((l, i) => {
    let next = l;
    if (emis.has(i) && rollsDown(l)) {
      next = { ...l, outstanding: afterOneEmi(l).toFixed(2), tenure_months_remaining: Math.max(0, (l.tenure_months_remaining || 0) - 1) };
    }
    const take = off.get(i) ?? 0;
    if (take > 0) next = { ...next, outstanding: Decimal.max(0, new Decimal(Number(next.outstanding) || 0).sub(take)).toFixed(2) };
    return next;
  });
}

/** Sum of owed-now balances in one currency (no conversion). */
export function owedNowTotal(loans: LoanPayload[]): number {
  return loans.reduce((s, l) => s + Math.max(0, Number(l.outstanding) || 0), 0);
}
