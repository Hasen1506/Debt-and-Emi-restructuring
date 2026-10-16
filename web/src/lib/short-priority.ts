/**
 * UX walkthrough fix 8: short of cash, the plan said "Pay every EMI and card
 * minimum", which is the one thing a short month can't do. This says which
 * payment to protect first, in the order /cant-pay uses (lib/distress-triage
 * protectOrder: secured loans, then card minimums, then other loans), and
 * which one the money runs out on, so the person knows whom to call.
 */
import type { LoanPayload } from './api';
import { protectOrder } from './distress-triage';
import type { PayThisMonth } from './pay-this-month';
import { localTerms } from './terms';

export interface PriorityLine {
  name: string;
  /** The EMI or card minimum, in the user's currency. */
  required: number;
  /** What the month's money covers of it, in protect order. */
  pay: number;
  short: number;
}

/** This month's required payments in protect order, filled from what the
 *  month can cover (the total due less the shortfall). */
export function shortPriority(data: PayThisMonth | null, loans: LoanPayload[], shortfall: number): PriorityLine[] {
  if (!data) return [];
  const rows = data.rows
    .filter((r) => r.loanIndex !== null && r.minimum > 0 && loans[r.loanIndex])
    .map((r) => {
      const loan = loans[r.loanIndex as number];
      // The minimum in the user's currency (an NRI's rupee EMI in dollars).
      const required = r.amount > 0 ? Math.round((r.minimum / r.amount) * r.amountUser) : r.minimum;
      return { key: r.key, label: r.card ? `${r.name} minimum` : r.name, loan_type: loan.loan_type, required, ratePct: Number(loan.nominal_rate || 0) * 100 };
    });
  const due = rows.reduce((s, r) => s + r.required, 0);
  return protectOrder(rows, Math.max(0, due - Math.max(0, shortfall))).map((l) => ({
    name: l.label,
    required: l.required,
    pay: Math.round(l.pay),
    short: Math.round(l.short),
  }));
}

/** "Pay them in this order: 1. Home loan ₹42,000, …. That leaves the card
 *  2 minimum ₹2,000 short: call that bank before the due date and ask for
 *  time." (No head: for a line that already says how short the month is.) */
export function shortPriorityOrder(lines: PriorityLine[], money: (v: number) => string, country?: string | null): string {
  const who = country === 'US' ? 'lender' : 'bank';
  if (lines.length === 0) return `Call the ${who} before the due date.`;
  const order = lines.map((l, i) => `${i + 1}. ${l.name} ${money(l.required)}`).join(', ');
  const left = lines.filter((l) => l.short > 0);
  const tail = left.length
    ? ` That leaves ${left.map((l) => `the ${l.name.replace(/^[A-Z](?=[a-z])/, (c) => c.toLowerCase())} ${money(l.short)} short`).join(' and ')}: call that ${who} before the due date and ask for time.`
    : '';
  return localTerms(`Pay them in this order: ${order}.${tail}`, country);
}

/** "You're ₹3,000 short of this month's payments. Pay them in this order: …" */
export function shortPriorityText(
  lines: PriorityLine[],
  shortfall: number,
  money: (v: number) => string,
  country?: string | null,
): string {
  return localTerms(`You’re ${money(shortfall)} short of this month’s payments. ${shortPriorityOrder(lines, money, country)}`, country);
}
