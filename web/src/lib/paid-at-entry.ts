/**
 * A balance entered after this month's EMI went out (`balance_after_emi`):
 * that EMI is recorded as paid in Activity, so Home's "Pay this month"
 * shows it paid instead of asking for it again. Call after the profile is
 * saved, so the entries name the saved loans.
 */
import { addActivityEntry, readActivityClient, writeActivityClient } from './activity';
import { syncActivityCookieClient } from './activity-cookie';
import { alignToLoans } from './loan-ids';
import { loadProfileClient } from './user-store';

export const PAID_AT_ENTRY_NOTE = 'Paid before the balance was entered';

export function recordEmisPaidAtEntry(today: string): void {
  if (typeof window === 'undefined') return;
  const { user } = loadProfileClient();
  const month = today.slice(0, 7);
  let entries = alignToLoans(readActivityClient(), user.loans);
  let changed = false;
  user.loans.forEach((loan, i) => {
    if (loan.loan_type === 'credit_card' || loan.balance_after_emi !== true) return;
    const asOf = loan.balance_as_of?.slice(0, 10);
    if (!asOf || asOf.slice(0, 7) !== month) return;
    // Already recorded this month (paid, part-paid or missed): leave it.
    if (entries.some((e) => e.loanIndex === i && e.date.slice(0, 7) === month)) return;
    entries = addActivityEntry(
      entries,
      {
        loanIndex: i,
        kind: 'paid_full',
        date: asOf,
        amount: loan.scheduled_emi,
        scheduledEmi: loan.scheduled_emi,
        note: PAID_AT_ENTRY_NOTE,
      },
      user.loans,
    );
    changed = true;
  });
  if (!changed) return;
  writeActivityClient(entries);
  syncActivityCookieClient(entries, user.loans, user.country);
}
