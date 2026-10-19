/**
 * Home's one-line "this month" instruction (UX50 B-11): the sentence Setup
 * ends on, at the top of Home, from the same Pay-this-month rows the list
 * below shows (no extra engine run).
 */
import { localTerms } from './terms';
import type { PayThisMonth } from './pay-this-month';
import type { LoanPayload } from './api';
import { shortPriority } from './short-priority';
import { lowerName } from './loan-types';

export interface ThisMonthLine {
  tone: 'ok' | 'short';
  /** The sentence, in plain words. */
  text: string;
  /** The link under it. */
  link: string;
}

export { lowerName } from './loan-types';

export function homeThisMonthLine(
  data: PayThisMonth | null,
  shortfall: number,
  money: (v: number) => string,
  country?: string,
  loans: LoanPayload[] = [],
): ThisMonthLine | null {
  const line = homeThisMonthLineIn(data, shortfall, money, loans, country);
  // R8-2: a US borrower reads "monthly payment", not "EMI".
  return line ? { ...line, text: localTerms(line.text, country) } : null;
}

function homeThisMonthLineIn(
  data: PayThisMonth | null,
  shortfall: number,
  money: (v: number) => string,
  loans: LoanPayload[],
  country?: string,
): ThisMonthLine | null {
  if (!data || data.rows.length === 0) return null;
  const loanRows = data.rows.filter((r) => r.loanIndex !== null);
  if (shortfall > 0.5) {
    // UX walkthrough fix 8: which payment to protect first (lib/short-priority),
    // not "pay every EMI and card minimum", which a short month can't do.
    const order = shortPriority(data, loans, shortfall);
    const first = order.filter((l) => l.short <= 0).map((l) => l.name);
    const left = order.filter((l) => l.short > 0).map((l) => lowerName(l.name));
    const list = (xs: string[]) => (xs.length <= 2 ? xs.join(' and ') : `${xs.slice(0, -1).join(', ')} and ${xs.at(-1)}`);
    const who = country === 'US' ? 'lender' : 'bank';
    return {
      tone: 'short',
      text: order.length
        ? `This month you’re ${money(shortfall)} short. Pay ${list(first.length ? first : [order[0].name])} first${left.length ? `, then call the ${who} for the ${list(left)} before the due date` : ''}. A missed payment is reported to the credit bureaus.`
        : `This month you’re ${money(shortfall)} short. Call the ${who} before the due date: a missed payment is reported to the credit bureaus.`,
      link: 'WHAT TO PAY FIRST ↓',
    };
  }
  const extra = Math.round(data.extraUser);
  const top = loanRows.find((r) => r.kind === 'extra' || r.kind === 'clears');
  const setAside = data.rows.filter((r) => r.loanIndex === null).reduce((s, r) => s + r.amountUser, 0);
  // R9-3: the parts are whole rupees already; the total is their sum.
  const dues = data.duesUser ?? Math.max(0, Math.round(data.total - extra - setAside));
  const total = dues + extra + setAside;
  if (extra >= 1 && top) {
    const several = loanRows.filter((r) => r.kind === 'extra' || r.kind === 'clears').length > 1;
    return {
      tone: 'ok',
      text: `This month: pay ${money(total)}. Every EMI and card minimum (${money(dues)}), plus ${money(extra)} extra${several ? ', most of it' : ''} on your ${lowerName(top.name)}${setAside >= 1 ? `, and ${money(setAside)} set aside` : ''}.`,
      link: 'GO TO PAYMENTS ↓',
    };
  }
  const aside = setAside >= 1 ? `, and set aside ${money(setAside)}` : '';
  // Spare cash can sit unused when the monthly total is still "EMIs and
  // minimums only". That is not the same as having nothing left.
  const spare = Math.round(data.leftOver || 0);
  if (spare >= 1) {
    const why = data.budgetChoice === 'all'
      ? `${money(spare)} stays with you: no open loan costs more than a safe return.`
      : `${money(spare)} is spare after the amount due and is not added on top.`;
    return {
      tone: 'ok',
      text: `This month: pay every EMI and card minimum, ${money(dues)}${aside}. ${why}`,
      link: 'GO TO PAYMENTS ↓',
    };
  }
  return {
    tone: 'ok',
    text: `This month: pay every EMI and card minimum, ${money(dues)}${aside}. Nothing is spare above the EMIs and minimums.`,
    link: 'GO TO PAYMENTS ↓',
  };
}

/** Cash flow's LEFT caption. The arithmetic is always take-home − spending
 *  − due. Whether Pay this month adds that spare on top depends on the
 *  monthly total for debts, so the sentence must not claim it does when
 *  the plan is still paying EMIs and minimums only. */
export function cashFlowLeftNote(a: {
  income: number;
  spend: number;
  due: number;
  left: number;
  addsSpare: boolean;
  money: (n: number) => string;
}): string {
  const sum = `Take-home ${a.money(a.income)} − spending ${a.money(a.spend)} − due ${a.money(a.due)}`;
  if (a.left < 0) return 'Spending and the amount due are more than take-home';
  if (a.left === 0) return 'Nothing spare this month';
  if (a.addsSpare) {
    return `${sum}. Pay this month adds this ${a.money(a.left)} (extra and set-aside) on top of the ${a.money(a.due)} due. It is not cash left after that payment.`;
  }
  return `${sum}. This ${a.money(a.left)} is spare after the amount due. Pay this month does not add it on top while the monthly total for debts is only the EMIs and minimums.`;
}

/**
 * Re-test 10 observation: Home's INTEREST tile. With a live plan it is the
 * plan's month-1 interest (what Plan's table and CSV show for this month);
 * without one, today's balance × rate ÷ 12, labelled as such.
 */
export function homeInterestLine(a: {
  planInterest: number | null;
  monthLabel: string;
  fallback: number;
  money: (v: number) => string;
}): { value: string; caption: string } {
  const money = (v: number) => a.money(Math.round(v));
  if (a.planInterest != null) {
    return { value: `${money(a.planInterest)}/MO`, caption: `CHARGED IN ${a.monthLabel} · AS ON PLAN` };
  }
  return { value: `${money(a.fallback)}/MO`, caption: "AT TODAY'S BALANCES AND RATES" };
}
