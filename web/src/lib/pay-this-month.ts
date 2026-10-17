/**
 * Home's "Pay this month": every payment the plan makes in its first month,
 * one row each — each loan's EMI or card minimum with any extra on top, then
 * the emergency-fund and goal shares. Read off the same engine run /plan
 * shows, so the two can't disagree.
 */
import type { PlanData } from '@/components/plan/PlanData';
import { loanCurrency, loanToUser, userDefaultCurrency, type CurrencyCode } from '@/lib/currency';
import { LOAN_TYPE_NAME, disambiguateLoans, loanNickname } from '@/lib/loan-types';
import { GST_RATE_IN } from '@/lib/gst';
import { homeTaxReserve } from '@/lib/salaried-advance-tax';
import { getCountryToday, localIsoDate } from '@/lib/today';
import { debtStatus, isSettled } from '@/lib/loan-status-core';

/** emi / minimum: only what the bank requires. extra: more on top.
 *  clears: the payment pays the loan off. ef / goals: money set aside. */
export type PayKind = 'emi' | 'minimum' | 'extra' | 'clears' | 'ef' | 'goals' | 'tax' | 'pot';

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
  /** What the loan still owes after this month's interest and payment
   *  (its currency), when the engine reports it. */
  owedAfter?: number;
  /** A payoff: the balance, the month's interest and (India, cards) GST
   *  that make up `amount`, in `currency`. */
  payoff?: { owed: number; interest: number; gst: number };
  /** Round 3 (#21): the EMI comes out of pay before it reaches the bank, so
   *  only the plan's extra on top is listed (minimum 0). */
  fromSalary?: boolean;
  /** Round 3 (#13): with collectors. Shown, never ticked: Home points to the
   *  steps on /cant-pay instead of "mark paid". (Behind loans were held too
   *  until the founder's 17 Oct 2026 catch-up decision.) */
  held?: 'collections';
  /** Behind on payments: ticked as usual, with the catch-up line. */
  behind?: true;
  /** Founder 17 Oct 2026 (engine/debt_status.py): a behind loan's overdue the
   *  plan pays this month, inside `amount` (its currency), and whether that
   *  overdue figure is the one-EMI estimate. */
  catchUp?: number;
  estimated?: boolean;
  /** A 'pot' row: the collections loan's position its settlement pot is for. */
  potFor?: number;
}

export interface PayThisMonth {
  rows: PayRow[];
  /** Every row, in the user's currency. */
  total: number;
  /** Surplus the plan leaves unplaced this month (no loan costs more than
   *  a safe return, or the user's own total for debts), in their currency. */
  leftOver: number;
  /** The extra on top of EMIs and minimums, in the user's currency. */
  extraUser: number;
  /** R9-3: every EMI and card minimum this month, in the user's currency,
   *  rounded once (as Home's cash flow rounds them). total = duesUser +
   *  extraUser + the set-aside rows, and never more than take-home less
   *  spending. */
  duesUser: number;
  /** The user's own monthly total for debts; 0 = all spare cash. */
  budget: number;
  /** Loans whose whole payment this month comes out of salary (not listed). */
  fromSalary: string[];
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Null when the plan didn't come from the engine (offline sample). */
export function payThisMonth(plan: PlanData, todayIso: string = localIsoDate(getCountryToday(plan.user.country))): PayThisMonth | null {
  if (!plan.live) return null;
  const first = plan.monthlyPayments.find((p) => p.month === 1);
  if (!first) return null;
  // What each loan still owes once this month's interest and payment are in.
  const after = plan.trajectory.find((p) => p.month === 1)?.balancesByLoanIndex;
  const { loans, country } = plan.user;
  const named = disambiguateLoans(loans);
  const userCcy = userDefaultCurrency(country);
  const loanRows: PayRow[] = [];
  const salaryOnly: string[] = [];
  for (const [k, v] of Object.entries(first.perLoan)) {
    const index = Number(k);
    const loan = loans[index];
    const paid = Number(v);
    const amount = Math.round(paid);
    if (!loan || !(amount >= 1)) continue;
    const fromSalary = !!loan.salary_deducted && !isSettled(loan);
    const fullMin = Math.min(amount, Math.round(Number(plan.firstMonthMinimums[index] ?? 0)));
    // #21: a salary-deducted EMI is already gone from take-home; only an
    // extra on top is the user's to send.
    const minimum = fromSalary ? 0 : fullMin;
    const extra = amount - fullMin;
    // Paid off only when the engine leaves nothing owing after this month's
    // interest. Against the opening balance, ₹80,500 on an ₹80,000 card
    // looked like a payoff while the interest kept ₹2,300 owing.
    const owedAfter = after?.[index];
    const clears = owedAfter != null
      ? Number(owedAfter) <= 0.5
      : paid >= Number(loan.outstanding || 0) - 0.5;
    const isCard = loan.loan_type === 'credit_card';
    // A payoff is more than the balance: this month's interest, and GST on a
    // card's interest in India, go on first (audit 2026-10-07 §1).
    const owedNow = Number(loan.outstanding || 0);
    const charge = Math.max(0, amount - owedNow);
    const gstShare = isCard && country === 'IN' ? GST_RATE_IN.toNumber() : 0;
    const gst = Math.round((charge * gstShare) / (1 + gstShare));
    const status = debtStatus(loan);
    // Founder 17 Oct 2026: a behind loan is paid (the plan clears its overdue
    // first), so it is ticked like any other; only a collections loan is held.
    const held = status === 'collections' ? status : undefined;
    const catchUp = status === 'behind' ? Math.round(Number(plan.debtStatusMonth1?.catchUp[k] ?? 0)) : 0;
    const label = loanNickname(named[index]) || (loan.bank ? `${loan.bank} ${LOAN_TYPE_NAME[loan.loan_type]}` : cap(LOAN_TYPE_NAME[loan.loan_type]));
    if (fromSalary && !(extra >= 1)) {
      salaryOnly.push(label);
      continue;
    }
    const payoff = clears && !fromSalary ? { owed: Math.round(Math.min(owedNow, amount)), interest: Math.round(charge) - gst, gst } : undefined;
    loanRows.push({
      key: loan.id ?? `loan-${index}`,
      loanIndex: index,
      // UX walkthrough fix 7: "Card 1" / "Card 2", the names the loan list uses.
      name: label,
      kind: clears ? 'clears' : extra >= 1 ? 'extra' : isCard ? 'minimum' : 'emi',
      card: isCard,
      amount: amount - (fromSalary ? fullMin : 0),
      currency: loanCurrency(loan, country),
      amountUser: Math.round(loanToUser(amount - (fromSalary ? fullMin : 0), loan, country, plan.fxRatesUsed) ?? amount),
      minimum,
      extra: extra >= 1 ? extra : 0,
      ...(isCard && loan.due_day ? { dueDay: loan.due_day } : {}),
      ...(owedAfter != null ? { owedAfter: Math.max(0, Math.round(Number(owedAfter))) } : {}),
      ...(payoff ? { payoff } : {}),
      ...(fromSalary ? { fromSalary } : {}),
      ...(held ? { held } : {}),
      ...(status === 'behind' ? { behind: true, ...(catchUp >= 1 ? { catchUp, estimated: !loan.overdue_amount } : {}) } : {}),
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
  // A collections loan's share is kept back for a settlement, not paid to it.
  for (const [k, v] of Object.entries(plan.debtStatusMonth1?.pot ?? {})) {
    const add = Math.round(Number(v));     // month 1: the pot starts empty, so all of it is this month's
    const held = loanRows.find((r) => r.loanIndex === Number(k));
    if (held && add >= 1) setAside.push({ key: `pot-${held.key}`, loanIndex: null, name: `Settlement pot · ${held.name}`, kind: 'pot', card: false, amount: add, currency: userCcy, amountUser: add, minimum: 0, extra: add, potFor: Number(k) });
  }
  const pots = setAside.reduce((s, r) => s + (r.kind === 'pot' ? r.amount : 0), 0);
  const surplus = Math.round(a?.surplus ?? plan.surplus);
  // Round 3 (ux-walkthrough fix 10): a salaried user's next advance-tax
  // instalment is set aside before any extra goes to a loan.
  const reserve = plan.user.income_type === 'salaried' && !(plan.shortfall > 0) ? homeTaxReserve(plan.advanceTaxSchedule, todayIso) : null;
  const tax = reserve ? Math.min(reserve.amount, Math.max(0, surplus - ef - goals - pots)) : 0;
  if (reserve && tax >= 1) {
    setAside.push({ key: 'tax', loanIndex: null, name: `Advance tax due ${reserve.due}`, kind: 'tax', card: false, amount: tax, currency: userCcy, amountUser: tax, minimum: 0, extra: tax });
  }
  const rows = [...loanRows, ...setAside];
  const { duesUser, extraUser } = reconcileMonth(plan, first.perLoan, loanRows, ef + goals + tax + pots);
  const total = duesUser + extraUser + ef + goals + tax + pots;
  const unplaced = surplus - extraUser - ef - goals - tax - pots;
  // Rounding leaves a few rupees either way; only a real remainder is shown.
  const leftOver = unplaced >= Math.max(1, surplus * 0.01) ? unplaced : 0;
  return { rows, total, leftOver, extraUser, duesUser, budget: Number(plan.debtBudget || 0), fromSalary: salaryOnly };
}

/**
 * R9-3: this month's whole-rupee (or dollar) parts. Each loan's payment is
 * rounded on its own row, and with many loans those roundings added up to
 * ₹1 more than take-home less spending (Home said "pay ₹24,00,001" beside
 * a cash flow that left ₹16,25,849). The EMIs and minimums are rounded
 * once, as the cash flow rounds them, and the extra is capped at what's
 * left after them and the set-aside; any rupee taken off comes off the
 * largest extra row so the list adds up to the same total.
 */
function reconcileMonth(
  plan: PlanData,
  perLoan: Record<string, string | number>,
  loanRows: PayRow[],
  setAsideUser: number,
): { duesUser: number; extraUser: number } {
  const { loans, country } = plan.user;
  const minimumsUser = loanRows.reduce((s, r) => {
    const loan = loans[r.loanIndex as number];
    if (r.fromSalary) return s; // #21: already out of take-home
    // Unrounded, as the cash flow adds them (a ₹5,200.40 EMI is not ₹5,200).
    const raw = Math.min(Number(perLoan[String(r.loanIndex)] ?? r.amount), Number(plan.firstMonthMinimums[r.loanIndex as number] ?? 0));
    return s + (loanToUser(raw, loan, country, plan.fxRatesUsed) ?? raw);
  }, 0);
  const duesUser = Math.round(minimumsUser);
  const rowExtras = loanRows.reduce(
    (s, r) => s + (r.amount > 0 ? Math.round((r.extra / r.amount) * r.amountUser) : 0),
    0,
  );
  const income = Number(plan.user.monthly_income || 0);
  const spend = Number(plan.user.fixed_expenses || 0) + Number(plan.user.variable_expenses || 0);
  const available = Math.round(income - spend);
  // No take-home on file (or short): nothing to cap against here; the
  // shortfall path says what to do instead.
  if (!(income > 0) || plan.shortfall > 0) return { duesUser, extraUser: rowExtras };
  const room = Math.max(0, available - duesUser - setAsideUser);
  const extraUser = Math.min(rowExtras, room);
  let over = rowExtras - extraUser;
  if (over > 0) {
    const userCcy = userDefaultCurrency(country);
    const extraRows = loanRows
      // A payoff row stays whole: a rupee less would leave it owing.
      .filter((r) => r.kind === 'extra' && r.extra >= 1 && r.currency === userCcy)
      .sort((x, y) => y.extra - x.extra);
    for (const r of extraRows) {
      if (over <= 0) break;
      const cut = Math.min(over, r.extra);
      r.extra -= cut;
      r.amount -= cut;
      r.amountUser -= cut;
      if (r.extra < 1) {
        r.extra = 0;
        r.kind = r.card ? 'minimum' : 'emi';
      }
      over -= cut;
    }
  }
  return { duesUser, extraUser };
}

/** R6-5: one "owed after" for a card on Home. Once a payment on the card is
 *  marked this month, Home's loans list shows the entered balance less it
 *  ("≈ …, before interest", UX50 B-12); Pay this month now shows that same
 *  figure in the same words instead of the plan's own month-end balance.
 *  Before that, the plan's figure is labelled as including the interest. */
export function owedAfterLabel(
  row: Pick<PayRow, 'card' | 'owedAfter'>,
  now: { owed: number; cardBefore?: number } | undefined,
  fmt: (v: number) => string,
): string {
  if (row.card && now?.cardBefore != null) return `≈ ${fmt(Math.round(now.owed))} OWED NOW, BEFORE INTEREST`;
  if (!row.owedAfter) return '';
  return row.card
    ? `${fmt(row.owedAfter)} STILL OWED AFTER, WITH THIS MONTH'S INTEREST`
    : `${fmt(row.owedAfter)} STILL OWED AFTER`;
}
