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
  return {
    tone: 'ok',
    text: `This month: pay every EMI and card minimum, ${money(dues)}${setAside >= 1 ? `, and set aside ${money(setAside)}` : ''}. Nothing is left over for extra payments.`,
    link: 'GO TO PAYMENTS ↓',
  };
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
    return { value: `${money(a.planInterest)}/MO`, caption: `CHARGED IN ${a.monthLabel.toUpperCase()} · AS ON PLAN` };
  }
  return { value: `${money(a.fallback)}/MO`, caption: "AT TODAY'S BALANCES AND RATES" };
}
