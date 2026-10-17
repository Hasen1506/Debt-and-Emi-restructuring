/**
 * "Copy my plan for an assistant" (grill #9, founder note): the
 * bring-your-own-assistant step that needs no API key, no connector and no
 * cost. The user pastes this into ChatGPT, Claude or any other assistant.
 * It carries the numbers an assistant needs and nothing that identifies the
 * user: no names, no lenders' account numbers, no email.
 * The full connector design (an MCP server) is docs/retention/LLM-CONNECTOR.md.
 */
import type { PayThisMonth } from './pay-this-month';

export interface PlanContextInput {
  country: 'IN' | 'US';
  monthLabel: string;
  debtFreeLabel: string | null;
  pay: PayThisMonth;
  loans: { type: string; outstanding: number; ratePct: number | null; emi: number | null; currency: string }[];
  strategy: string;
  fmt: (v: number, ccy?: string) => string;
  /** A8: where to paste the assistant's answer back (Home's advice check). */
  checkUrl?: string;
}

export function planContext(i: PlanContextInput): string {
  const lines = [
    'I use RightDue, a debt payoff planner. Here is my plan. Please check its reasoning,',
    'point out anything that looks wrong or risky, and answer my questions about it.',
    'The numbers come from what I entered; the order is RightDue\'s engine output.',
    '',
    `Country: ${i.country === 'IN' ? 'India' : 'United States'}`,
    `Payoff order: ${i.strategy}`,
    `Debt-free: ${i.debtFreeLabel ?? 'no date on this plan'}`,
    '',
    'Loans:',
    ...i.loans.map((l, k) =>
      `${k + 1}. ${l.type}: ${i.fmt(l.outstanding, l.currency)} owed` +
      `${l.ratePct != null ? `, ${l.ratePct}% a year` : ''}${l.emi ? `, ${i.fmt(l.emi, l.currency)} a month` : ''}`),
    '',
    `This month (${i.monthLabel}), in this order:`,
    ...i.pay.rows.map((r, k) => {
      const what = r.loanIndex == null ? r.name : `loan ${r.loanIndex + 1} (${i.loans[r.loanIndex]?.type ?? 'loan'})`;
      return `${k + 1}. ${what}: ${i.fmt(r.amount, r.currency)} (${r.kind})`;
    }),
    `Total: ${i.fmt(i.pay.total)}`,
    ...(i.checkUrl
      ? ['', `When you answer, I'll paste your reply into RightDue to check its numbers against my loans and RBI rules: ${i.checkUrl}`]
      : []),
  ];
  return lines.join('\n');
}
