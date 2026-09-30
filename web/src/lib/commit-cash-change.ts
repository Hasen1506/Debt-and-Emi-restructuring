import type { UserPayload } from './api';
import type { ActivityEntry } from './activity';
import type { CashEventsSlice } from './cash-events';
import { syncActivityCookieClient } from './activity-cookie';
import { saveProfileClient, type StoredProfile } from './user-store';
import { syncSliceToServer } from './server-sync';

/** Prepare/validate all calculations first. Storage failure restores the local
 * ledger and prevents a success confirmation. No writes occur in React updaters. */
export function commitCashChange(stored: StoredProfile, user: UserPayload, entries: ActivityEntry[], cash: CashEventsSlice): void {
  const keys = ['finoptima_activity','finoptima_cash_events'];
  const previous = keys.map(k => localStorage.getItem(k));
  try {
    localStorage.setItem(keys[0],JSON.stringify(entries));
    localStorage.setItem(keys[1],JSON.stringify(cash));
    if (!saveProfileClient({...stored,user})) throw new Error('Your profile did not save. No cash action was logged.');
  } catch(e) {
    keys.forEach((k,i) => { if(previous[i] === null) localStorage.removeItem(k); else localStorage.setItem(k,previous[i]!); });
    throw e;
  }
  syncActivityCookieClient(entries,user.loans,user.country);
  void syncSliceToServer('activity',entries);
  void syncSliceToServer('cash_events',cash);
}
