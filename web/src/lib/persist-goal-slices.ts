import { syncSliceToServer } from './server-sync';

export interface GoalSliceWrite {
  key: string;
  cookie: string;
  digest: string;
  value: unknown;
  slice: 'goals' | 'goal_contributions';
}

/** Keep local records and the server-rendered plan's cookie in agreement. */
export function persistGoalSlices(writes: GoalSliceWrite[]): void {
  const before = writes.map(w => ({
    local: localStorage.getItem(w.key),
    cookie: document.cookie.match(new RegExp(`(?:^|; )${w.cookie}=([^;]*)`))?.[1],
  }));
  try {
    for (const w of writes) {
      localStorage.setItem(w.key, JSON.stringify(w.value));
      document.cookie = `${w.cookie}=${w.digest}; path=/; max-age=31536000; SameSite=Lax`;
      if (document.cookie.match(new RegExp(`(?:^|; )${w.cookie}=([^;]*)`))?.[1] !== w.digest)
        throw new Error('The goal could not be saved for the plan. No change was recorded.');
    }
  } catch (e) {
    writes.forEach((w,i) => {
      try {
        if (before[i].local === null) localStorage.removeItem(w.key); else localStorage.setItem(w.key,before[i].local!);
      } catch { /* An unchanged blocked key must not prevent the other restores. */ }
      document.cookie = before[i].cookie === undefined ? `${w.cookie}=; path=/; max-age=0` : `${w.cookie}=${before[i].cookie}; path=/; SameSite=Lax`;
    });
    throw e;
  }
  for (const w of writes) void syncSliceToServer(w.slice,w.value);
}
