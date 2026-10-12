/**
 * Single source of truth for the user's profile across the app.
 *
 * Persistence is cookies (`finoptima_user`, compressed and split into
 * parts when large; see profile-cookie.ts) so both server components (via
 * next/headers) and client components (via document.cookie) can read the
 * same payload. Falls back to DEMO_USER when no cookie is present — that
 * keeps the app usable for first-time visitors.
 */
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

const MARGINAL_COOKIE = 'finoptima_marginal';
const SCORE_COOKIE = 'finoptima_score';
const FX_COOKIE = 'finoptima_fx';
const COOKIE_MAX_AGE = 60 * 60 * 24 * 365;  // 1 year
// FX rates from the spot endpoint are refreshed daily — anything older is
// re-fetched on next read. 24h is a sensible balance: the engine treats FX
// as a slow-moving variable, and refetching every page load was the bug
// this cache fixes.
export const FX_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

export interface FxCacheEntry {
  rates: Record<string, string>;  // loan_ccy → user_ccy_per_loan_ccy
  ts: number;                     // ms since epoch when last refreshed
}

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

function writeClientCookie(name: string, value: string) {
  if (typeof document === 'undefined') return;
  document.cookie = `${name}=${encodeURIComponent(value)}; path=/; max-age=${COOKIE_MAX_AGE}; SameSite=Lax`;
}

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
        : `${profileChunkName(i)}=${v}; path=/; max-age=${COOKIE_MAX_AGE}; SameSite=Lax`;
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
    const user = JSON.parse(raw) as UserPayload;
    const marginalRate = readClientCookie(MARGINAL_COOKIE) ?? DEMO_MARGINAL_RATE;
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
  const previousActivity = readRawClientCookie('finoptima_activity_deltas');
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
    document.cookie = previousActivity === null ? 'finoptima_activity_deltas=; path=/; max-age=0' : `finoptima_activity_deltas=${previousActivity}; path=/; SameSite=Lax`;
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
  if (typeof window !== 'undefined') window.dispatchEvent(new Event('rightdue:profile-changed'));
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

// ─── FX rate cache ──────────────────────────────────────────────────────────

export function loadFxCacheClient(): FxCacheEntry | null {
  const raw = readClientCookie(FX_COOKIE);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as FxCacheEntry;
    if (typeof parsed.ts !== 'number' || !parsed.rates) return null;
    return parsed;
  } catch {
    return null;
  }
}

/** A signed-in account owns the cache again (see `profileCleared`). */
export function resumeProfileClient() {
  profileCleared = false;
}

export function saveFxCacheClient(rates: Record<string, string>) {
  if (profileCleared) return;
  const entry: FxCacheEntry = { rates, ts: Date.now() };
  writeClientCookie(FX_COOKIE, JSON.stringify(entry));
}

export function isFxCacheFresh(entry: FxCacheEntry | null): entry is FxCacheEntry {
  return entry != null && Date.now() - entry.ts < FX_CACHE_TTL_MS;
}

// ─── Server-side ────────────────────────────────────────────────────────────

const SESSION_COOKIE = 'finoptima_session';

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
  const session = (await cookies()).get(SESSION_COOKIE)?.value;
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
    const user = JSON.parse(raw) as UserPayload;
    const marginalRate = store.get(MARGINAL_COOKIE)?.value ?? DEMO_MARGINAL_RATE;
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
  if (store.get(SESSION_COOKIE)?.value) {
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

/**
 * Read the FX-rate cache cookie server-side. Returns the entry only when it
 * exists and is younger than the TTL — callers don't need to repeat the
 * staleness check. Returns null on a missing or expired cache so the caller
 * can decide whether to refetch.
 */
export async function loadFxCacheServer(): Promise<FxCacheEntry | null> {
  const { cookies } = await import('next/headers');
  const raw = (await cookies()).get(FX_COOKIE)?.value;
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as FxCacheEntry;
    if (typeof parsed.ts !== 'number' || !parsed.rates) return null;
    if (Date.now() - parsed.ts >= FX_CACHE_TTL_MS) return null;
    return parsed;
  } catch {
    return null;
  }
}
