import type { UserPayload } from './api';
import type { ActivityEntry } from './activity';
import type { CashEventsSlice } from './cash-events';
import { syncActivityCookieClient, parseActivityDeltas, activityDeltas } from './activity-cookie';
import { saveProfileClient, type StoredProfile } from './user-store';
import { syncSliceToServer } from './server-sync';
import { totalsByGoal, type GoalContributionEntry } from './goal-contributions';
import { readableCookieMaxAge } from './readable-cookie-age';

/** Prepare/validate all calculations first. Storage failure restores the local
 * ledger and prevents a success confirmation. No writes occur in React updaters. */
export function commitCashChange(stored: StoredProfile, user: UserPayload, entries: ActivityEntry[], cash: CashEventsSlice, contributions?: GoalContributionEntry[]): void {
  const keys = ['rightdue_activity','rightdue_cash_events', ...(contributions ? ['rightdue_goal_contributions'] : [])];
  const previous = keys.map(k => localStorage.getItem(k));
  const beforeActivity = document.cookie.match(/(?:^|; )rightdue_activity_deltas=([^;]*)/)?.[1];
  const beforeDigest = document.cookie.match(/(?:^|; )rightdue_goal_contributions_digest=([^;]*)/)?.[1];
  try {
    localStorage.setItem(keys[0],JSON.stringify(entries));
    localStorage.setItem(keys[1],JSON.stringify(cash));
    if (contributions) {
      localStorage.setItem(keys[2], JSON.stringify(contributions));
      const digest = btoa(JSON.stringify(totalsByGoal(contributions)));
      document.cookie = `rightdue_goal_contributions_digest=${digest}; path=/; max-age=${readableCookieMaxAge()}; SameSite=Lax`;
      if (document.cookie.match(/(?:^|; )rightdue_goal_contributions_digest=([^;]*)/)?.[1] !== digest)
        throw new Error('Goal contributions could not be saved. No cash action was logged.');
    }
    syncActivityCookieClient(entries,user.loans,user.country);
    const afterActivity = document.cookie.match(/(?:^|; )rightdue_activity_deltas=([^;]*)/)?.[1] ?? '';
    if (JSON.stringify(parseActivityDeltas(afterActivity)) !== JSON.stringify(activityDeltas(entries,user.loans,user.country)))
      throw new Error('The payment could not be saved for the plan. No cash action was logged.');
    if (!saveProfileClient({...stored,user})) throw new Error('Your profile did not save. No cash action was logged.');
  } catch(e) {
    keys.forEach((k,i) => { try { if(previous[i] === null) localStorage.removeItem(k); else localStorage.setItem(k,previous[i]!); } catch { /* Continue restoring the other slices. */ } });
    document.cookie = beforeActivity === undefined ? 'rightdue_activity_deltas=; path=/; max-age=0' : `rightdue_activity_deltas=${beforeActivity}; path=/; max-age=${readableCookieMaxAge()}; SameSite=Lax`;
    if (contributions) document.cookie = beforeDigest === undefined ? 'rightdue_goal_contributions_digest=; path=/; max-age=0' : `rightdue_goal_contributions_digest=${beforeDigest}; path=/; max-age=${readableCookieMaxAge()}; SameSite=Lax`;
    throw e;
  }
  void syncSliceToServer('activity',entries);
  void syncSliceToServer('cash_events',cash);
  if (contributions) void syncSliceToServer('goal_contributions', contributions);
}
