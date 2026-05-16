/**
 * Helper for tools that want to write their result into the Activity ledger
 * with one click. Both the localStorage entries and the projection-cookie
 * stay in sync — so /plan re-prices using the new outstanding on the next
 * render.
 */
import {
  addActivityEntry,
  readActivityClient,
  writeActivityClient,
  type ActivityKind,
} from './activity';
import { syncActivityCookieClient } from './activity-cookie';
import type { Country, LoanPayload } from './api';

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
  const current = readActivityClient();
  const next = addActivityEntry(current, {
    loanIndex: input.loanIndex,
    kind: input.kind,
    date: input.date ?? todayISO(),
    amount: input.amount,
    scheduledEmi: input.scheduledEmi,
    note: input.note,
  });
  writeActivityClient(next);
  syncActivityCookieClient(next, input.loans, input.country);
  return next.length;
}
