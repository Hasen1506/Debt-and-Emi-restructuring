/**
 * Helper for tools that want to write their result into the Activity ledger
 * with one click. Both the localStorage entries and the projection-cookie
 * stay in sync — so /plan re-prices using the new outstanding on the next
 * render.
 */
import {
  addActivityEntry,
  readActivityClient,
  type ActivityEntry,
  type ActivityKind,
} from './activity';
import type { Country, LoanPayload } from './api';
import { loadProfileClient } from './user-store';
import { resolveLoanIndex } from './loan-ids';
import { isOpenCurrentLoan } from './plan-controls';
import { commitActivity } from './commit-activity';

export interface ApplyToolResultInput {
  loanIndex: number;
  kind: ActivityKind;
  /** Total amount the user is recording (scheduledEmi + extra principal, or
   *  the full payoff for `closed`). Decimal string. */
  amount: string;
  scheduledEmi: string;
  /** Optional ISO date — defaults to today. */
  date?: string;
  /** Optional note attached to the entry. */
  note?: string;
  loans: LoanPayload[];
  country: Country;
  /** UX2 #20: the answer to "lower your EMI or finish sooner?". */
  prepay?: Pick<ActivityEntry, 'prepayMode' | 'emiBefore' | 'emiAfter'>;
}

function todayISO(): string {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

/**
 * Adds an entry to the activity ledger and syncs the projection cookie.
 * Returns the new entry count so callers can render confirmation messaging.
 */
export function applyToolResult(input: ApplyToolResultInput): number {
  const profile = loadProfileClient();
  const target = input.loans[input.loanIndex];
  const index = resolveLoanIndex({ loanIndex: input.loanIndex, loanId: target?.id }, profile.user.loans);
  if (profile.user.country !== input.country || !isOpenCurrentLoan(profile.user.loans[index]))
    throw new Error('That loan is no longer open. Reload and check again.');
  const current = readActivityClient();
  const next = addActivityEntry(current, {
    loanIndex: index,
    loanId: profile.user.loans[index].id,
    kind: input.kind,
    date: input.date ?? todayISO(),
    amount: input.amount,
    scheduledEmi: input.scheduledEmi,
    note: input.note,
    ...(input.prepay ?? {}),
  }, profile.user.loans);
  commitActivity(next, profile.user);
  return next.length;
}
