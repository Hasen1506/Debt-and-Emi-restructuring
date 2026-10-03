import type { ActivityEntry } from './activity';
import type { UserPayload } from './api';
import { syncActivityCookieClient, parseActivityDeltas, activityDeltas } from './activity-cookie';
import { syncSliceToServer } from './server-sync';

/** Persist the ledger and its projection together before displaying success. */
export function commitActivity(entries: ActivityEntry[], user: UserPayload): void {
  const key = 'finoptima_activity';
  const before = localStorage.getItem(key);
  const raw = document.cookie.match(/(?:^|; )finoptima_activity_deltas=([^;]*)/)?.[1];
  try {
    const serialized = JSON.stringify(entries);
    localStorage.setItem(key, serialized);
    if (localStorage.getItem(key) !== serialized || !syncActivityCookieClient(entries, user.loans, user.country))
      throw new Error('The payment could not be saved for the plan. No entry was logged.');
    const after = document.cookie.match(/(?:^|; )finoptima_activity_deltas=([^;]*)/)?.[1] ?? '';
    if (JSON.stringify(parseActivityDeltas(after)) !== JSON.stringify(activityDeltas(entries, user.loans, user.country)))
      throw new Error('The payment could not be saved for the plan. No entry was logged.');
  } catch (e) {
    try { if (before === null) localStorage.removeItem(key); else localStorage.setItem(key, before); } catch { /* Cookie rollback must still run when storage is unavailable. */ }
    document.cookie = raw === undefined ? 'finoptima_activity_deltas=; path=/; max-age=0' : `finoptima_activity_deltas=${raw}; path=/; SameSite=Lax`;
    throw e;
  }
  void syncSliceToServer('activity', entries);
}
