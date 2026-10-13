/**
 * The finoptima_* → rightdue_* rename of everything this app stores in the
 * browser (critique #58/#69, founder: "remove finoptima wording, migrate").
 *
 * For one release both names are read: whatever is still stored under the
 * old name is moved to the new one, and the old one is deleted.
 *   - Page requests: middleware.ts renames the cookies on the request (so the
 *     server render sees the new names) and in the browser (Set-Cookie),
 *     including the HttpOnly session cookie, which page scripts cannot touch.
 *   - In the browser: `migrateLegacyClientStorage()` moves localStorage,
 *     sessionStorage and readable cookies once, before the app reads them
 *     (server-sync.ts calls it when it loads, which the root layout does).
 *   - The API accepts the old session cookie name too (api/auth/session.py).
 *
 * After one release (when no 30-day session or year-long cookie can still
 * carry the old name unseen, i.e. from mid-November 2026), delete this file,
 * the middleware step and the API's legacy name.
 */
export const LEGACY_PREFIX = 'finoptima_';
export const PREFIX = 'rightdue_';
export const SESSION_COOKIE = 'rightdue_session';
export const LEGACY_SESSION_COOKIE = 'finoptima_session';
const COOKIE_MAX_AGE = 60 * 60 * 24 * 365;
/** The session lives 30 days on the server (api/auth/session.py SESSION_TTL). */
const SESSION_MAX_AGE = 60 * 60 * 24 * 30;

export function renamed(name: string): string {
  return name.startsWith(LEGACY_PREFIX) ? PREFIX + name.slice(LEGACY_PREFIX.length) : name;
}

/** Cookie name → value, from a Cookie header or document.cookie. */
export function parseCookies(header: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const part of header.split(/;\s*/)) {
    const i = part.indexOf('=');
    if (i <= 0) continue;
    const name = part.slice(0, i).trim();
    if (!out.has(name)) out.set(name, part.slice(i + 1));
  }
  return out;
}

export interface CookieRename {
  /** Cookie header to hand the server render, with only new names. */
  header: string;
  /** Set-Cookie values to send the browser: each new name, and each old one expired. */
  setCookies: string[];
}

/**
 * Rename legacy cookies in a request's Cookie header. A value already under
 * the new name wins (it was written after the rename). Null when there is
 * nothing to rename.
 */
export function renameRequestCookies(header: string | null, secure: boolean): CookieRename | null {
  const cookies = parseCookies(header ?? '');
  const legacy = [...cookies.keys()].filter((n) => n.startsWith(LEGACY_PREFIX));
  if (!legacy.length) return null;
  const next = new Map<string, string>();
  const setCookies: string[] = [];
  const flag = secure ? '; Secure' : '';
  for (const [name, value] of cookies) {
    if (name.startsWith(LEGACY_PREFIX)) continue;
    next.set(name, value);
  }
  for (const name of legacy) {
    const target = renamed(name);
    const value = cookies.get(name)!;
    if (!next.has(target)) {
      next.set(target, value);
      setCookies.push(
        name === LEGACY_SESSION_COOKIE
          ? `${target}=${value}; Path=/; Max-Age=${SESSION_MAX_AGE}; HttpOnly; SameSite=Lax${flag}`
          : `${target}=${value}; Path=/; Max-Age=${COOKIE_MAX_AGE}; SameSite=Lax${flag}`,
      );
    }
    setCookies.push(`${name}=; Path=/; Max-Age=0${name === LEGACY_SESSION_COOKIE ? '; HttpOnly' : ''}; SameSite=Lax${flag}`);
  }
  return { header: [...next].map(([n, v]) => `${n}=${v}`).join('; '), setCookies };
}

interface KeyStore {
  readonly length: number;
  key(i: number): string | null;
  getItem(k: string): string | null;
  setItem(k: string, v: string): void;
  removeItem(k: string): void;
}

function migrateStore(store: KeyStore | undefined): void {
  if (!store) return;
  const keys: string[] = [];
  for (let i = 0; i < store.length; i++) {
    const k = store.key(i);
    if (k && k.startsWith(LEGACY_PREFIX)) keys.push(k);
  }
  for (const k of keys) {
    const target = renamed(k);
    const value = store.getItem(k);
    if (value !== null && store.getItem(target) === null) store.setItem(target, value);
    store.removeItem(k);
  }
}

let migrated = false;

/** Move this browser's finoptima_* keys to rightdue_* once. Safe anywhere. */
export function migrateLegacyClientStorage(): void {
  if (migrated || typeof window === 'undefined') return;
  migrated = true;
  try { migrateStore(window.localStorage); } catch { /* storage blocked */ }
  try { migrateStore(window.sessionStorage); } catch { /* storage blocked */ }
  if (typeof document === 'undefined') return;
  try {
    const cookies = parseCookies(document.cookie);
    for (const [name, value] of cookies) {
      if (!name.startsWith(LEGACY_PREFIX)) continue;
      const target = renamed(name);
      if (!cookies.has(target)) document.cookie = `${target}=${value}; path=/; max-age=${COOKIE_MAX_AGE}; SameSite=Lax`;
      document.cookie = `${name}=; path=/; max-age=0`;
    }
  } catch { /* cookies blocked */ }
}

/** The session token from a cookie store, under either name. */
export function sessionToken(store: { get(name: string): { value: string } | undefined }): string | undefined {
  return store.get(SESSION_COOKIE)?.value ?? store.get(LEGACY_SESSION_COOKIE)?.value;
}
