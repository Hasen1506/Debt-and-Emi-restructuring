/**
 * One-off, in the browser: a profile saved before loans had ids gets them,
 * and each activity entry is given the id of the loan at its position,
 * while those positions still mean what they did when it was logged. Runs
 * when the app's profile module loads, before any page can remove a loan.
 */
import { readActivityClient, writeActivityClient } from './activity';
import { syncActivityCookieClient } from './activity-cookie';
import { alignToLoans, withLoanIds } from './loan-ids';
import { loadProfileClient, saveProfileClient } from './user-store';

export function migrateLoanIdsClient(): void {
  if (typeof window === 'undefined') return;
  try {
    const stored = loadProfileClient();
    if (!stored.isLive) return;
    const loans = withLoanIds(stored.user.loans ?? []);
    if (loans === stored.user.loans) return;
    const user = { ...stored.user, loans };
    const entries = readActivityClient();
    const aligned = alignToLoans(entries, loans);
    if (!saveProfileClient({ user })) return;
    if (aligned !== entries) writeActivityClient(aligned);
    syncActivityCookieClient(aligned, loans, user.country);
  } catch {
    // Storage unavailable: nothing to migrate this visit.
  }
}
