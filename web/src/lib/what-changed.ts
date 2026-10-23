/**
 * The month's "What changed" card. Every sentence comes from the change
 * log (lib/change-log.ts). It does not re-run the plan, so it cannot
 * drift from what was recorded.
 */
import { wholeMoney, type ChangeEntry, type ChangeKind } from './change-log';

export interface WhatChanged {
  month: string;
  paid: number;
  paymentCount: number;
  lines: string[];
}

const inMonth = (e: ChangeEntry, month: string) => e.month === month || e.at.slice(0, 7) === month;

function num(v: string | undefined): number {
  const n = Number(v ?? '');
  return Number.isFinite(n) ? n : 0;
}

/** Sentences for `month` ('YYYY-MM'), in the order a person would read them. */
export function whatChanged(
  entries: ChangeEntry[],
  month: string,
  spendAverage: number | null,
  currency: 'INR' | 'USD' = 'INR',
): WhatChanged {
  const money = (n: number) => wholeMoney(n, currency);
  const rows = entries.filter((e) => inMonth(e, month));
  const lines: string[] = [];
  const payments = rows.filter((e) => e.kind === 'payment' || e.kind === 'prepayment');
  const paid = payments.reduce((s, e) => s + (e.after === 'removed' ? 0 : num(e.after)), 0);
  if (payments.length) {
    lines.push(
      payments.length === 1
        ? `One payment recorded, ${money(paid)} in all.`
        : `${payments.length} payments recorded, ${money(paid)} in all.`,
    );
  }
  const loans = rows.filter((e) => e.kind === 'loan' || e.kind === 'import');
  // The log keeps the full loan line as "before"; an edit's "after" already
  // reads "old → new", and a removal's is just "removed".
  for (const e of loans) {
    if (e.after === 'removed') lines.push(e.before ? `${e.what} (${e.before}).` : `${e.what}.`);
    else lines.push(e.after ? `${e.what}: ${e.after}.` : `${e.what}.`);
  }
  const spends = rows.filter((e) => e.kind === 'spend' && e.what.startsWith('Logged spending'));
  if (spends.length) {
    const latest = spends[0];
    const spent = num(latest.after);
    const avg = spendAverage == null ? '' : ` The recent average is ${money(spendAverage)}.`;
    lines.push(`Spending logged at ${money(spent)}.${avg}`);
  }
  const free = rows.find((e) => e.what === 'Debt-free date');
  // A date that didn't move isn't a change; Where you stand shows it.
  if (free?.before) lines.push(`Debt-free date moved from ${free.before} to ${free.after}.`);
  const interest = rows.find((e) => e.what === 'Interest on the plan');
  if (interest?.before && interest.before !== interest.after) lines.push(`Interest on the plan: ${interest.before} → ${interest.after}.`);
  const restKinds: ChangeKind[] = ['goal', 'asset', 'income', 'tax', 'letter', 'settings'];
  for (const e of rows) {
    if (!restKinds.includes(e.kind)) continue;
    if (e.what === 'Debt-free date' || e.what === 'Interest on the plan') continue;
    if (e.kind === 'spend') continue;
    lines.push(e.before ? `${e.what}: ${e.before} → ${e.after ?? ''}`.trim() : `${e.what}${e.after ? `: ${e.after}` : ''}`);
  }
  if (lines.length === 0) lines.push('Nothing recorded this month yet.');
  return { month, paid: Math.round(paid), paymentCount: payments.length, lines };
}
