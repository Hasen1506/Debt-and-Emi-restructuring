/**
 * Home's one-line "this month" instruction (UX50 B-11): the sentence Setup
 * ends on, at the top of Home, from the same Pay-this-month rows the list
 * below shows (no extra engine run).
 */
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
  const dues = Math.max(0, Math.round(data.total - extra - setAside));
  const total = Math.round(data.total);
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
