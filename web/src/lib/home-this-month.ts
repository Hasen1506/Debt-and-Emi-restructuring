/**
 * Home's one-line "this month" instruction (UX50 B-11): the sentence Setup
 * ends on, at the top of Home, from the same Pay-this-month rows the list
 * below shows (no extra engine run).
 */
import { localTerms } from './terms';
import type { PayThisMonth } from './pay-this-month';

export interface ThisMonthLine {
  tone: 'ok' | 'short';
  /** The sentence, in plain words. */
  text: string;
  /** The link under it. */
  link: string;
}

/** "Credit card" → "credit card"; "HDFC Bank credit card" stays. */
export function lowerName(name: string): string {
  return /^[A-Z][a-z]/.test(name) ? name.charAt(0).toLowerCase() + name.slice(1) : name;
}

export function homeThisMonthLine(
  data: PayThisMonth | null,
  shortfall: number,
  money: (v: number) => string,
  country?: string,
): ThisMonthLine | null {
  const line = homeThisMonthLineIn(data, shortfall, money);
  // R8-2: a US borrower reads "monthly payment", not "EMI".
  return line ? { ...line, text: localTerms(line.text, country) } : null;
}

function homeThisMonthLineIn(
  data: PayThisMonth | null,
  shortfall: number,
  money: (v: number) => string,
): ThisMonthLine | null {
  if (!data || data.rows.length === 0) return null;
  const loanRows = data.rows.filter((r) => r.loanIndex !== null);
  if (shortfall > 0.5) {
    const protect = loanRows.filter((r) => r.minimum > 0).map((r) => r.name);
    const names = protect.length <= 2 ? protect.join(' and ') : `${protect.slice(0, -1).join(', ')} and ${protect.at(-1)}`;
    return {
      tone: 'short',
      text: `This month you’re ${money(shortfall)} short. Pay every EMI and card minimum first${names ? ` (${names})` : ''}: a missed one is reported to the credit bureaus. Then find the gap from spending, or call the bank before the due date.`,
      link: 'WHAT TO DO ↓',
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
