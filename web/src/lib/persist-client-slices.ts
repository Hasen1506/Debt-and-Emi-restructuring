import { syncSliceToServer } from './server-sync';

export interface ClientSliceWrite {
  key?: string;
  cookie?: string;
  digest?: string;
  value: unknown;
  slice: string;
}

/** Validate every local record and cookie before syncing or confirming success. */
export function persistClientSlices(writes: ClientSliceWrite[]): void {
  const readCookie = (name: string) => document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`))?.[1];
  const before = writes.map(w => ({local:w.key ? localStorage.getItem(w.key) : null,cookie:w.cookie ? readCookie(w.cookie) : undefined}));
  try {
    for (const w of writes) {
      if (w.key) {
        const serialized = JSON.stringify(w.value);
        localStorage.setItem(w.key,serialized);
        if (localStorage.getItem(w.key) !== serialized) throw new Error('The change could not be saved. No change was recorded.');
      }
      if (w.cookie) {
        document.cookie = `${w.cookie}=${w.digest}; path=/; max-age=31536000; SameSite=Lax`;
        if (readCookie(w.cookie) !== w.digest) throw new Error('The change could not be saved for the plan. No change was recorded.');
      }
    }
  } catch (e) {
    writes.forEach((w,i) => {
      if (w.key) try {
        if (before[i].local === null) localStorage.removeItem(w.key); else localStorage.setItem(w.key,before[i].local!);
      } catch { /* Continue restoring other records when this key is blocked. */ }
      if (w.cookie) document.cookie = before[i].cookie === undefined ? `${w.cookie}=; path=/; max-age=0` : `${w.cookie}=${before[i].cookie}; path=/; SameSite=Lax`;
    });
    throw e;
  }
  for (const w of writes) void syncSliceToServer(w.slice,w.value);
}
