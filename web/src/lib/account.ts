/**
 * "Your data" actions (grill #51): download everything the server holds,
 * delete the account, and wipe what this browser keeps.
 *
 * Calls go through the same-origin session proxy
 * (app/api/session/[...path]) like every other account call, so the
 * session cookie stays HttpOnly and the CSRF origin check applies.
 */

const EXPORT_PATH = '/api/session/auth/account/export';
const DELETE_PATH = '/api/session/auth/account/delete';

/** Prefixes of everything RightDue keeps in this browser: cookies,
 *  localStorage keys and IndexedDB databases. Both the old and the new
 *  name, since the finoptima_* names are being migrated (sprint L1). */
export const LOCAL_PREFIXES = ['finoptima_', 'finoptima:', 'rightdue_', 'rightdue:'];

function matches(name: string): boolean {
  return LOCAL_PREFIXES.some((p) => name.startsWith(p));
}

async function errorMessage(res: Response, fallback: string): Promise<string> {
  try {
    const detail = (await res.json())?.detail;
    const message = typeof detail === 'string' ? detail : detail?.message;
    if (typeof message === 'string' && message.trim()) return message.slice(0, 300);
  } catch { /* not JSON */ }
  if (res.status === 401) return 'Your session has expired. Sign in again first.';
  if (res.status === 429) return 'Too many requests. Wait a minute and try again.';
  return fallback;
}

/** The server's copy of your data, as a JSON file. */
export async function fetchMyData(fetcher: typeof fetch = fetch): Promise<{ filename: string; blob: Blob }> {
  const res = await fetcher(EXPORT_PATH, { method: 'GET', credentials: 'include', cache: 'no-store' });
  if (!res.ok) throw new Error(await errorMessage(res, 'Your data could not be downloaded. Try again in a minute.'));
  const disposition = res.headers.get('content-disposition') ?? '';
  const filename = /filename="([^"]+)"/.exec(disposition)?.[1] ?? 'rightdue-my-data.json';
  return { filename, blob: await res.blob() };
}

export async function downloadMyData(): Promise<void> {
  const { filename, blob } = await fetchMyData();
  const url = URL.createObjectURL(blob);
  try {
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}

export interface DeleteResult { deleted: true; deleted_at: string; removed: Record<string, number> }

/** Erase the account on the server. `confirmEmail` must be the account's own address. */
export async function deleteMyAccount(confirmEmail: string, fetcher: typeof fetch = fetch): Promise<DeleteResult> {
  const res = await fetcher(DELETE_PATH, {
    method: 'POST',
    credentials: 'include',
    cache: 'no-store',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ confirm_email: confirmEmail.trim().toLowerCase() }),
  });
  if (!res.ok) throw new Error(await errorMessage(res, 'Your account could not be deleted. Nothing was removed. Try again in a minute.'));
  return res.json();
}

/** Remove every RightDue cookie, localStorage key and IndexedDB database
 *  in this browser. Returns how many items were removed. */
export async function clearLocalData(doc: Document = document, storage: Storage | null = typeof localStorage === 'undefined' ? null : localStorage): Promise<number> {
  let removed = 0;
  for (const part of doc.cookie.split(';')) {
    const name = part.split('=')[0]?.trim();
    if (name && matches(name)) {
      doc.cookie = `${name}=; Max-Age=0; path=/`;
      removed++;
    }
  }
  if (storage) {
    const keys: string[] = [];
    for (let i = 0; i < storage.length; i++) {
      const k = storage.key(i);
      if (k && matches(k)) keys.push(k);
    }
    for (const k of keys) storage.removeItem(k);
    removed += keys.length;
  }
  const idb = (globalThis as { indexedDB?: IDBFactory }).indexedDB;
  if (idb && typeof idb.databases === 'function') {
    try {
      for (const db of await idb.databases()) {
        if (db.name && matches(db.name)) { idb.deleteDatabase(db.name); removed++; }
      }
    } catch { /* some browsers refuse to list databases */ }
  }
  try { sessionStorage.clear(); } catch { /* not available */ }
  return removed;
}
