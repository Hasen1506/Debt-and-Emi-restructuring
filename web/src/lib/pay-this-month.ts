/**
 * Home's "Pay this month": every payment the plan makes in its first month,
 * one row each — each loan's EMI or card minimum with any extra on top, then
 * the emergency-fund and goal shares. Read off the same engine run /plan
 * shows, so the two can't disagree.
 */
import type { PlanData } from '@/components/plan/PlanData';
import { loanCurrency, loanToUser, userDefaultCurrency, type CurrencyCode } from '@/lib/currency';
import { LOAN_TYPE_NAME } from '@/lib/loan-types';

/** emi / minimum: only what the bank requires. extra: more on top.
 *  clears: the payment pays the loan off. ef / goals: money set aside. */
export type PayKind = 'emi' | 'minimum' | 'extra' | 'clears' | 'ef' | 'goals';

export interface PayRow {
  /** The loan's id (its position when it has none), or 'ef' / 'goals'. */
  key: string;
  /** Position in user.loans; null for the emergency fund and goals. */
  loanIndex: number | null;
  /** "HDFC credit card", "Personal loan", "Emergency fund". */
  name: string;
  kind: PayKind;
  /** A credit card (its required payment is a minimum, not an EMI). */
  card: boolean;
  /** This month's payment, in `currency`, to the rupee or dollar. */
  amount: number;
  currency: CurrencyCode;
  /** The same in the user's currency. */
  amountUser: number;
  /** The EMI or card minimum inside `amount`, and the extra on top of it
   *  (both in `currency`). For the fund and goals, minimum is 0. */
  minimum: number;
  extra: number;
  /** Cards: the day of the month the bill is due, when it's on file. */
  dueDay?: number;
}

export interface PayThisMonth {
  rows: PayRow[];
  /** Every row, in the user's currency. */
  total: number;
  /** Surplus the plan leaves unplaced this month (no loan costs more than
   *  a safe return), in the user's currency. */
  leftOver: number;
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Null when the plan didn't come from the engine (offline sample). */
export function payThisMonth(plan: PlanData): PayThisMonth | null {
  if (!plan.live) return null;
  const first = plan.monthlyPayments.find((p) => p.month === 1);
  if (!first) return null;
  const { loans, country } = plan.user;
  const userCcy = userDefaultCurrency(country);
  const loanRows: PayRow[] = [];
  for (const [k, v] of Object.entries(first.perLoan)) {
    const index = Number(k);
    const loan = loans[index];
    const paid = Number(v);
    const amount = Math.round(paid);
    if (!loan || !(amount >= 1)) continue;
    const minimum = Math.min(amount, Math.round(Number(plan.firstMonthMinimums[index] ?? 0)));
    const extra = amount - minimum;
    // The balance the plan started from (after logged activity): a payment
    // at least that big pays the loan off this month.
    const clears = paid >= Number(loan.outstanding || 0) - 0.5;
    const isCard = loan.loan_type === 'credit_card';
    loanRows.push({
      key: loan.id ?? `loan-${index}`,
      loanIndex: index,
      name: loan.bank ? `${loan.bank} ${LOAN_TYPE_NAME[loan.loan_type]}` : cap(LOAN_TYPE_NAME[loan.loan_type]),
      kind: clears ? 'clears' : extra >= 1 ? 'extra' : isCard ? 'minimum' : 'emi',
      card: isCard,
      amount,
      currency: loanCurrency(loan, country),
      amountUser: Math.round(loanToUser(amount, loan, country, plan.fxRatesUsed) ?? amount),
      minimum,
      extra: extra >= 1 ? extra : 0,
      ...(isCard && loan.due_day ? { dueDay: loan.due_day } : {}),
    });
  }
  // Extra payments first (largest first, in one currency: ₹4.8 lakh is not
  // more than $6,000), then the EMIs and minimums.
  const extraFirst = (r: PayRow) => (r.kind === 'extra' || r.kind === 'clears' ? 0 : 1);
  loanRows.sort((a, b) => extraFirst(a) - extraFirst(b) || b.amountUser - a.amountUser);

  const a = plan.surplusAllocation;
  const ef = Math.round(a?.efSlice ?? 0);
  const goals = Math.round(a?.goalSlice ?? 0);
  const setAside: PayRow[] = [];
  if (ef >= 1) {
    setAside.push({ key: 'ef', loanIndex: null, name: 'Emergency fund', kind: 'ef', card: false, amount: ef, currency: userCcy, amountUser: ef, minimum: 0, extra: ef });
  }
  if (goals >= 1) {
    setAside.push({ key: 'goals', loanIndex: null, name: 'Goals', kind: 'goals', card: false, amount: goals, currency: userCcy, amountUser: goals, minimum: 0, extra: goals });
  }
  const rows = [...loanRows, ...setAside];
  const total = rows.reduce((s, r) => s + r.amountUser, 0);
  const extrasUser = loanRows.reduce(
    (s, r) => s + (r.amount > 0 ? Math.round((r.extra / r.amount) * r.amountUser) : 0),
    0,
  );
  const surplus = Math.round(a?.surplus ?? plan.surplus);
  const unplaced = surplus - extrasUser - ef - goals;
  // Rounding leaves a few rupees either way; only a real remainder is shown.
  const leftOver = unplaced >= Math.max(1, surplus * 0.01) ? unplaced : 0;
  return { rows, total, leftOver };
}
