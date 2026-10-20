/**
 * Single source of truth for the user's profile across the app.
 *
 * Persistence is cookies (`rightdue_user`, compressed and split into
 * parts when large; see profile-cookie.ts) so both server components (via
 * next/headers) and client components (via document.cookie) can read the
 * same payload. Falls back to DEMO_USER when no cookie is present — that
 * keeps the app usable for first-time visitors.
 */
import { clampAssumptions, clampTaxRate } from './r8-inputs';
import type { UserPayload } from './api';
import { DEMO_USER, DEMO_MARGINAL_RATE } from './demo-user';
import { serverApiBase } from './api-base';
import { readActivityClient } from './activity';
import { syncActivityCookieClient } from './activity-cookie';
import { withLoanIds } from './loan-ids';
import {
  decodeProfileCookies,
  encodeProfileCookies,
  MAX_PROFILE_CHUNKS,
  profileChunkName,
} from './profile-cookie';
import { sessionToken } from './storage-migration';
import { readableCookieMaxAge } from './readable-cookie-age';

const MARGINAL_COOKIE = 'rightdue_marginal';
const SCORE_COOKIE = 'rightdue_score';
// No longer written (its reader went long ago); still cleared on sign-out.
const FX_COOKIE = 'rightdue_fx';

export interface StoredProfile {
  user: UserPayload;
  marginalRate: string;
  creditScore: number | null;
  isLive: boolean;          // true if loaded from cookie, false = demo fallback
}

// ─── Client-side ────────────────────────────────────────────────────────────

function readClientCookie(name: string): string | null {
  if (typeof document === 'undefined') return null;
  const match = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : null;
}

// D16: a year for guests, the sign-in's 30 days for accounts (readable-cookie-age.ts).
function writeClientCookie(name: string, value: string) {
  if (typeof document === 'undefined') return;
  document.cookie = `${name}=${encodeURIComponent(value)}; path=/; max-age=${readableCookieMaxAge()}; SameSite=Lax`;
}

/** UX2 #23: when this browser last saved the profile (any tab); lib/tab-guard. */
export const PROFILE_SAVED_KEY = 'rightdue_profile_saved_at';

/** The raw profile cookies, to tell when the saved profile has changed. */
export function profileCookieKey(): string {
  const parts: string[] = [];
  for (let i = 0; i < MAX_PROFILE_CHUNKS; i++) {
    const v = readClientCookie(profileChunkName(i));
    if (v == null) break;
    parts.push(v);
  }
  return [...parts, readClientCookie(MARGINAL_COOKIE) ?? '', readClientCookie(SCORE_COOKIE) ?? ''].join('\u0000');
}

/**
 * Store the profile's JSON in the profile cookies and read it back. False
 * when the browser didn't keep it (too large, cookies blocked); the cookies
 * that were there before are put back, so a failed save loses nothing.
 */
export function writeProfileCookieClient(json: string): boolean {
  if (typeof document === 'undefined') return false;
  const parts = encodeProfileCookies(json);
  if (parts.length > MAX_PROFILE_CHUNKS) return false;
  const before: (string | null)[] = [];
  for (let i = 0; i < MAX_PROFILE_CHUNKS; i++) before.push(readRawClientCookie(profileChunkName(i)));
  const put = (i: number, v: string | null) => {
    document.cookie =
      v == null
        ? `${profileChunkName(i)}=; path=/; max-age=0`
        : `${profileChunkName(i)}=${v}; path=/; max-age=${readableCookieMaxAge()}; SameSite=Lax`;
  };
  // The parts are URL-safe as they are; no further encoding.
  parts.forEach((v, i) => put(i, v));
  for (let i = parts.length; i < MAX_PROFILE_CHUNKS; i++) if (before[i] != null) put(i, null);
  if (decodeProfileCookies(readClientCookie) === json) return true;
  before.forEach((v, i) => put(i, v));
  return false;
}

/** JSON with object keys in name order, so two copies of the same profile
 *  compare equal whichever order their keys were written in. */
function canonicalJson(value: unknown): string {
  return JSON.stringify(value, (_k, v) =>
    v && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, (v as Record<string, unknown>)[k]]))
      : v,
  );
}

/** Whether this browser's profile cookie already holds `user` (the
 *  account copy often comes back with its keys in another order). */
export function profileCookieHolds(user: unknown): boolean {
  const raw = decodeProfileCookies(readClientCookie);
  if (!raw) return false;
  try {
    return canonicalJson(JSON.parse(raw)) === canonicalJson(user);
  } catch {
    return false;
  }
}

/** A cookie's value as stored (not URI-decoded), to put it back unchanged. */
function readRawClientCookie(name: string): string | null {
  if (typeof document === 'undefined') return null;
  const match = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
  return match ? match[1] : null;
}

/** The profile a summary should paint. The server uses the one it already
 *  read. The browser uses the saved cookie when this browser has one. A
 *  request that carried the cookie only as a header leaves document.cookie
 *  empty; keep the server profile so the painted figures are not replaced
 *  by an empty form once the scripts run. */
export function summaryProfile(initial: StoredProfile): StoredProfile {
  if (typeof document === 'undefined') return initial;
  const client = loadProfileClient();
  if (client.isLive || !initial.isLive) return client;
  return initial;
}

export function loadProfileClient(): StoredProfile {
  const raw = decodeProfileCookies(readClientCookie);
  if (!raw) {
    return {
      user: DEMO_USER,
      marginalRate: DEMO_MARGINAL_RATE,
      creditScore: null,
      isLive: false,
    };
  }
  try {
    // R8-6: a profile saved before the assumption bounds still plans.
    const user = clampAssumptions(JSON.parse(raw) as UserPayload & Record<string, unknown>) as UserPayload;
    const marginalRate = clampTaxRate(readClientCookie(MARGINAL_COOKIE) ?? DEMO_MARGINAL_RATE);
    const scoreRaw = readClientCookie(SCORE_COOKIE);
    return {
      user,
      marginalRate,
      creditScore: scoreRaw ? Number(scoreRaw) : null,
      isLive: true,
    };
  } catch {
    return {
      user: DEMO_USER,
      marginalRate: DEMO_MARGINAL_RATE,
      creditScore: null,
      isLive: false,
    };
  }
}

/** Fired on window when a profile save didn't stick (SaveFailedNotice). */
export const SAVE_FAILED_EVENT = 'rightdue:profile-save-failed';

/**
 * Save the profile. Returns false when the browser didn't keep it, and
 * fires SAVE_FAILED_EVENT so the page says so.
 */
export function saveProfileClient(profile: {
  user: UserPayload;
  marginalRate?: string;
  creditScore?: number | null;
}, additionalSlices: Record<string, unknown> = {}): boolean {
  // Every loan leaves with a stable id (a new one for a loan just added).
  const loans = withLoanIds(profile.user.loans ?? []);
  if (loans !== profile.user.loans) profile = { ...profile, user: { ...profile.user, loans } };
  const previousProfile = decodeProfileCookies(readClientCookie);
  const previousActivity = readRawClientCookie('rightdue_activity_deltas');
  if (!writeProfileCookieClient(JSON.stringify(profile.user))) {
    if (typeof window !== 'undefined') window.dispatchEvent(new Event(SAVE_FAILED_EVENT));
    return false;
  }
  try {
    if (!syncActivityCookieClient(readActivityClient(),profile.user.loans,profile.user.country,false))
      throw new Error('The payment projection could not be saved.');
  } catch {
    if (previousProfile !== null) writeProfileCookieClient(previousProfile);
    else for (let i=0;i<MAX_PROFILE_CHUNKS;i++) document.cookie = `${profileChunkName(i)}=; path=/; max-age=0`;
    document.cookie = previousActivity === null ? 'rightdue_activity_deltas=; path=/; max-age=0' : `rightdue_activity_deltas=${previousActivity}; path=/; max-age=${readableCookieMaxAge()}; SameSite=Lax`;
    if (typeof window !== 'undefined') window.dispatchEvent(new Event(SAVE_FAILED_EVENT));
    return false;
  }
  if (profile.marginalRate !== undefined) {
    writeClientCookie(MARGINAL_COOKIE, profile.marginalRate);
  }
  if (profile.creditScore != null) {
    writeClientCookie(SCORE_COOKIE, String(profile.creditScore));
  } else if (profile.creditScore === null) {
    document.cookie = `${SCORE_COOKIE}=; path=/; max-age=0`;
  }
  // Mirror to server if signed in. Fire-and-forget — cookie is the
  // first-paint cache so a slow/failed sync doesn't block the UI.
  void syncProfileToServer({
    user: profile.user,
    marginalRate: profile.marginalRate ?? readClientCookie(MARGINAL_COOKIE) ?? DEMO_MARGINAL_RATE,
    creditScore:
      profile.creditScore !== undefined
        ? profile.creditScore
        : (() => {
            const raw = readClientCookie(SCORE_COOKIE);
            return raw ? Number(raw) : null;
          })(),
    isLive: true,
  }, additionalSlices);
  if (typeof window !== 'undefined') {
    try {
      const prevUser = previousProfile ? (JSON.parse(previousProfile) as UserPayload) : null;
      void import('./change-log').then(({ profileChanges, recordChanges }) => recordChanges(profileChanges(prevUser, profile.user)));
    } catch { /* a bad cookie still saves */ }
    // UX2 #23: other open tabs see the stamp change and say they may be out of date.
    // The time plus a per-save tag: two saves in the same millisecond (or under a stopped
    // clock) would write the same value, which fires no storage event in the other tab.
    try { window.localStorage.setItem(PROFILE_SAVED_KEY, `${new Date().toISOString()}#${Math.random().toString(36).slice(2, 8)}`); } catch { /* private mode */ }
    window.dispatchEvent(new Event('rightdue:profile-changed'));
  }
  return true;
}

async function syncProfileToServer(profile: StoredProfile, additionalSlices: Record<string, unknown>): Promise<void> {
  const {syncSlicesToServer} = await import('./server-sync');
  await syncSlicesToServer({ ...additionalSlices, ...serializeProfileForServer(profile) });
}

// Set once this page has cleared the profile (sign-out, account switch).
// A plan render still in flight can land after that and would re-write the
// FX cache, leaving the last user's rates in the browser (E2E golden journey,
// "sign out clears this browser"). Sign-out reloads the page, which resets it.
let profileCleared = false;

export function clearProfileClient() {
  if (typeof document === 'undefined') return;
  profileCleared = true;
  const names = [MARGINAL_COOKIE, SCORE_COOKIE, FX_COOKIE];
  for (let i = 0; i < MAX_PROFILE_CHUNKS; i++) names.push(profileChunkName(i));
  for (const c of names) {
    document.cookie = `${c}=; path=/; max-age=0`;
  }
}

/** A signed-in account owns the cache again (see `profileCleared`). */
export function resumeProfileClient() {
  profileCleared = false;
}

// ─── Server-side ────────────────────────────────────────────────────────────

const SESSION_COOKIE = 'rightdue_session';

/**
 * Server-side fetch of the user's persisted state. Returns null when:
 *   - no session cookie, or
 *   - API returns 401/500, or
 *   - server has no data yet for this user.
 *
 * RSC fetches don't auto-forward browser cookies — we read the session
 * cookie via next/headers and attach it as a Cookie header manually.
 */
async function fetchUserStateServer(): Promise<Record<string, unknown> | null> {
  const { cookies } = await import('next/headers');
  const session = sessionToken(await cookies());
  if (!session) return null;
  // Server side: the API's internal address (lib/api-base), never the
  // browser's relative one.
  const base = serverApiBase();
  try {
    const res = await fetch(`${base}/api/user/state`, {
      headers: { Cookie: `${SESSION_COOKIE}=${session}` },
      cache: 'no-store',
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { data: Record<string, unknown> | null };
    return json.data;
  } catch {
    return null;
  }
}

function _profileFromCookieStore(store: {
  get(name: string): { value: string } | undefined;
}): StoredProfile {
  const raw = decodeProfileCookies((name) => store.get(name)?.value);
  if (!raw) {
    return {
      user: DEMO_USER,
      marginalRate: DEMO_MARGINAL_RATE,
      creditScore: null,
      isLive: false,
    };
  }
  try {
    // R8-6: a profile saved before the assumption bounds still plans.
    const user = clampAssumptions(JSON.parse(raw) as UserPayload & Record<string, unknown>) as UserPayload;
    const marginalRate = clampTaxRate(store.get(MARGINAL_COOKIE)?.value ?? DEMO_MARGINAL_RATE);
    const scoreRaw = store.get(SCORE_COOKIE)?.value;
    return {
      user,
      marginalRate,
      creditScore: scoreRaw ? Number(scoreRaw) : null,
      isLive: true,
    };
  } catch {
    return {
      user: DEMO_USER,
      marginalRate: DEMO_MARGINAL_RATE,
      creditScore: null,
      isLive: false,
    };
  }
}

export async function loadProfileServer(): Promise<StoredProfile> {
  const { cookies } = await import('next/headers');
  const store = (await cookies());

  // Cookies reflect a local save immediately; background server sync may
  // still be in flight. Login hydration supplies remote data on a new device.
  const local = _profileFromCookieStore(store);
  if (local.isLive) return local;
  if (sessionToken(store)) {
    const serverData = await fetchUserStateServer();
    const fromServer = profileFromServerData(serverData);
    if (fromServer) return fromServer;
    // Server is empty for this user — fall through to cookie (which
    // /login will push up on next migration tick).
  }

  return local;
}

/** Display/advice snapshot. Setup, Activity and mutations use the stored
 * baseline; applying the ledger here once keeps current balances consistent. */
export async function loadCurrentProfileServer(): Promise<StoredProfile> {
  const [profile,activity] = await Promise.all([
    loadProfileServer(), import('./activity-cookie').then(m=>m.loadActivityDeltasServer()),
  ]);
  const {applyActivityDeltas} = await import('./activity-cookie');
  const {countryMonthKey} = await import('./today');
  const {rollBalancesForward} = await import('./roll-forward');
  // Balances move on by the EMIs due since they were entered, then by what was logged.
  const month = countryMonthKey(profile.user.country);
  const rolled = rollBalancesForward(profile.user.loans, month).loans;
  return {...profile,user:{...profile.user,loans:applyActivityDeltas(rolled,activity,month).loans}};
}

/** Pull a StoredProfile out of the server's JSON blob, or null if absent. */
function profileFromServerData(
  data: Record<string, unknown> | null,
): StoredProfile | null {
  if (!data) return null;
  const profile = (data as { profile?: Record<string, unknown> }).profile;
  if (!profile || typeof profile !== 'object') return null;
  const user = (profile as { user?: UserPayload }).user;
  if (!user) return null;
  const marginalRate =
    (profile as { marginalRate?: string }).marginalRate ?? DEMO_MARGINAL_RATE;
  const creditScoreRaw = (profile as { creditScore?: number | null }).creditScore;
  return {
    user,
    marginalRate,
    creditScore: typeof creditScoreRaw === 'number' ? creditScoreRaw : null,
    isLive: true,
  };
}

/**
 * Snapshot the entire frontend client-state (currently just profile;
 * other stores plug in here in phase 2c) into a single JSON blob shape
 * that maps onto the server's user_state.data column.
 *
 * Lives here so both the dual-write client save and the post-login
 * migration step build the same shape.
 */
export function serializeProfileForServer(profile: StoredProfile): Record<string, unknown> {
  return {
    profile: {
      user: profile.user,
      marginalRate: profile.marginalRate,
      creditScore: profile.creditScore,
    },
  };
}
