/**
 * Reducing-balance loan math, one copy of engine/formulas.py (`emi`,
 * `remaining_balance`) and engine/simulation.py (`_months_to_clear`).
 *
 * Setup, Plan, the rate panel and the tools call these instead of inlining
 * P·r·(1+r)^n / ((1+r)^n − 1). A rupee EMI quote rounds up to the rupee and
 * a dollar quote up to the cent, the same way Setup prices an unknown EMI.
 */
import Decimal from 'decimal.js';

const D = (v: Decimal.Value) => new Decimal(v);

/** Standard EMI. `annualRate` is a decimal (0.085 = 8.5%). A non-positive
 *  tenure returns the principal, matching engine/formulas.emi. */
export function emi(principal: Decimal.Value, annualRate: Decimal.Value, months: number): Decimal {
  const P = D(principal);
  if (!(months > 0)) return P;
  const r = D(annualRate).div(12);
  if (r.isZero()) return P.div(months);
  const factor = r.add(1).pow(months);
  if (factor.sub(1).isZero()) return P.div(months);
  return P.mul(r).mul(factor).div(factor.sub(1));
}

/** EMI as a JS number. A blank offer (no principal, no months, a negative
 *  rate) is 0, not the principal. */
export function emiNumber(principal: number, annualRate: number, months: number): number {
  if (!(months > 0) || !(principal > 0) || !Number.isFinite(annualRate) || annualRate < 0) return 0;
  return emi(principal, annualRate, months).toNumber();
}

/** Bank-style quote. INR rounds up to the rupee, USD up to the cent, anything
 *  else half-up to 2 decimals. Null when there is no loan to price. */
export function roundEmi(
  principal: Decimal.Value,
  annualRate: Decimal.Value,
  months: number,
  currency: string,
): string | null {
  const P = D(principal);
  if (P.lte(0) || !(months > 0) || !D(annualRate).isFinite() || D(annualRate).isNeg()) return null;
  const raw = emi(P, annualRate, months);
  const ccy = currency.toUpperCase();
  if (ccy === 'INR') return raw.toDecimalPlaces(0, Decimal.ROUND_CEIL).toString();
  if (ccy === 'USD') return raw.toDecimalPlaces(2, Decimal.ROUND_CEIL).toString();
  return raw.toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toString();
}

/** Balance after `monthsPaid` instalments of a fixed `payment` (not necessarily
 *  the original schedule EMI). Negative means the loan cleared during that month. */
function balanceAfterFixed(
  principal: Decimal,
  annualRate: Decimal.Value,
  payment: Decimal,
  monthsPaid: number,
): Decimal {
  if (monthsPaid <= 0) return principal;
  const r = D(annualRate).div(12);
  if (r.lte(0)) return principal.sub(payment.mul(monthsPaid));
  const factor = r.add(1).pow(monthsPaid);
  return principal.mul(factor).sub(payment.mul(factor.sub(1)).div(r));
}

/** Months a fixed payment takes to clear `principal`. Null when the payment
 *  does not cover the interest. The closed form (the plan's `_months_to_clear`)
 *  is checked against the balance, because a float logarithm can ceil a
 *  360-month loan to 361. */
export function monthsToClear(
  principal: Decimal.Value,
  annualRate: Decimal.Value,
  payment: Decimal.Value,
): number | null {
  const P = D(principal);
  const E = D(payment);
  if (P.lte(0)) return 0;
  if (E.lte(0)) return null;
  const r = D(annualRate).div(12);
  if (r.lte(0)) return Math.max(1, Math.ceil(P.div(E).toNumber()));
  if (E.lte(P.mul(r))) return null;
  const ratio = D(1).sub(r.mul(P).div(E));
  const n = -Math.log(ratio.toNumber()) / Math.log(D(1).add(r).toNumber());
  if (!Number.isFinite(n) || n <= 0) return null;
  const dust = D('0.005');
  let months = Math.max(1, Math.ceil(n));
  if (months > 1 && balanceAfterFixed(P, annualRate, E, months - 1).lte(dust)) months -= 1;
  while (months < 1200 && balanceAfterFixed(P, annualRate, E, months).gt(dust)) months += 1;
  return months;
}

/** Outstanding after `monthsPaid` of the original schedule. */
export function remainingBalance(
  principal: Decimal.Value,
  annualRate: Decimal.Value,
  tenureMonths: number,
  monthsPaid: number,
): Decimal {
  const P = D(principal);
  if (monthsPaid >= tenureMonths || tenureMonths <= 0) return D(0);
  const r = D(annualRate).div(12);
  if (r.lte(0)) return P.mul(D(tenureMonths - monthsPaid).div(tenureMonths));
  const payment = emi(P, annualRate, tenureMonths);
  const factor = r.add(1).pow(monthsPaid);
  return P.mul(factor).sub(payment.mul(factor.sub(1)).div(r));
}

export interface ScheduleWalk {
  interest: Decimal;
  principal: Decimal;
  endBalance: Decimal;
}

/**
 * Interest and principal over `months` of a fixed payment.
 * The last month pays only what is left, so the balance never goes negative.
 * A payment below that month's interest lets the balance grow by the unpaid
 * interest (the loan is not flat-lined).
 */
export function walkSchedule(
  balance0: Decimal.Value,
  annualRate: Decimal.Value,
  payment: Decimal.Value,
  months: number,
): ScheduleWalk {
  let balance = D(balance0);
  const r = D(annualRate).div(12);
  const pay = D(payment);
  let interest = D(0);
  let principal = D(0);
  for (let m = 0; m < Math.max(0, months); m++) {
    if (balance.lte(0)) break;
    const monthInterest = balance.mul(r);
    const due = balance.add(monthInterest);
    const payThis = Decimal.min(Decimal.max(pay, 0), due);
    interest = interest.add(monthInterest);
    const principalPaid = payThis.sub(monthInterest);
    principal = principal.add(principalPaid);
    balance = Decimal.max(balance.sub(principalPaid), 0);
  }
  return { interest, principal, endBalance: balance };
}

/** Year-by-year interest. A card revolves: balance × annual rate, flat.
 *  A term loan walks the EMI, and a cleared loan stays at zero. */
export function yearlyInterest(
  loan: { loan_type?: string; outstanding?: string; nominal_rate?: string; scheduled_emi?: string },
  years: number,
): Decimal[] {
  const balance0 = D(loan.outstanding || 0);
  const rate = D(loan.nominal_rate || 0);
  const payment = D(loan.scheduled_emi || 0);
  if (loan.loan_type === 'credit_card') {
    const yearly = balance0.mul(rate);
    return Array.from({ length: years }, () => yearly);
  }
  if (balance0.lte(0) || rate.lte(0) || payment.lte(0) || years <= 0) {
    return Array.from({ length: Math.max(0, years) }, () => D(0));
  }
  const out: Decimal[] = [];
  let balance = balance0;
  for (let y = 0; y < years; y++) {
    const walked = walkSchedule(balance, rate, payment, 12);
    out.push(walked.interest);
    balance = walked.endBalance;
    if (balance.lte(0)) {
      while (out.length < years) out.push(D(0));
      break;
    }
  }
  return out;
}

/**
 * Interest implied by what was paid against each loan's own opening balance
 * (anything paid beyond that loan's principal is interest). Doing this on
 * the currency bucket instead — min(all paid, all principal) — lets an
 * overpayment on one loan cancel an underpayment on another, so the
 * interest comes out as zero.
 */
export function interestFromPayments(
  loans: { outstanding?: string }[],
  paidByIndex: Map<number, number> | Record<number, number>,
): number {
  let interest = 0;
  loans.forEach((loan, idx) => {
    const paid = paidByIndex instanceof Map ? (paidByIndex.get(idx) ?? 0) : (paidByIndex[idx] ?? 0);
    if (paid <= 0) return;
    const opening = Math.max(0, Number(loan.outstanding) || 0);
    interest += Math.max(0, paid - Math.min(paid, opening));
  });
  return interest;
}
