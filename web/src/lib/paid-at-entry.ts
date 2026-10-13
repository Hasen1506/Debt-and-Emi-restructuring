/**
 * A balance entered after this month's EMI went out (`balance_after_emi`):
 * that EMI is recorded as paid in Activity, so Home's "Pay this month"
 * shows it paid instead of asking for it again. Save the profile and its
 * implied payment together, with stable loan IDs and rollback on failure.
 */
import { addActivityEntry, readActivityClient, type ActivityEntry } from './activity';
import { alignToLoans, withLoanIds } from './loan-ids';
import { loadProfileClient, saveProfileClient, SAVE_FAILED_EVENT } from './user-store';
import { regularPaid } from './payment-state';
import Decimal from 'decimal.js';

export const PAID_AT_ENTRY_NOTE = 'Paid before the balance was entered';

/** Stage the implied paid EMI with its profile; publish neither until both
 * local records and the projection cookie have been verified. */
export function saveProfileWithPaidEmis(profile: Parameters<typeof saveProfileClient>[0], today: string): boolean {
  if (typeof window === 'undefined') return false;
  profile = { ...profile, user: { ...profile.user, loans: withLoanIds(profile.user.loans) } };
  const { user } = profile;
  const month = today.slice(0, 7);
  let entries = alignToLoans(readActivityClient(), user.loans);
  let changed = false;
  user.loans.forEach((loan, i) => {
    if (loan.loan_type === 'credit_card' || loan.balance_after_emi !== true) return;
    const asOf = loan.balance_as_of?.slice(0, 10);
    if (!asOf || asOf.slice(0, 7) !== month) return;
    const mine = entries.filter(e => e.loanIndex === i && e.date.slice(0, 7) === month);
    // A bonus-only prepayment does not cover the EMI. Retain real history,
    // recording just the regular payment not already accounted for.
    const remaining = Decimal.max(0, new Decimal(loan.scheduled_emi || '0').sub(regularPaid(mine)));
    if (!remaining.gt(0)) return;
    entries = addActivityEntry(
      entries,
      {
        loanIndex: i,
        kind: 'paid_full',
        date: asOf,
        amount: remaining.toFixed(2),
        scheduledEmi: remaining.toFixed(2),
        note: PAID_AT_ENTRY_NOTE,
      },
      user.loans,
    );
    changed = true;
  });
  const key = 'rightdue_activity';
  let before: string | null;
  try { before = localStorage.getItem(key); } catch { return false; }
  try {
    if (changed) {
      const serialized = JSON.stringify(entries);
      localStorage.setItem(key, serialized);
      if (localStorage.getItem(key) !== serialized) throw new Error('The paid EMI could not be saved.');
    }
    if (!saveProfileClient(profile, changed ? { activity: entries } : {})) throw new Error('The profile could not be saved.');
    return true;
  } catch {
    try { if (before === null) localStorage.removeItem(key); else localStorage.setItem(key, before); } catch { /* Restore other state even when this key is blocked. */ }
    window.dispatchEvent(new Event(SAVE_FAILED_EVENT));
    return false;
  }
}

/** Kept for callers completing an older profile-save flow. */
export function recordEmisPaidAtEntry(today: string): void {
  if (!saveProfileWithPaidEmis(loadProfileClient(), today)) throw new Error('The paid EMI could not be saved.');
}
