/**
 * Single source of truth for the user's profile across the app.
 *
 * Persistence is a single cookie (`finoptima_user`, JSON-encoded) so both
 * server components (via next/headers) and client components (via
 * document.cookie) can read the same payload. Falls back to DEMO_USER when
 * no cookie is present — that keeps the app usable for first-time visitors.
 */
import type { UserPayload } from './api';
import { DEMO_USER, DEMO_MARGINAL_RATE } from './demo-user';

const COOKIE_NAME = 'finoptima_user';
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
  return [COOKIE_NAME, MARGINAL_COOKIE, SCORE_COOKIE].map((c) => readClientCookie(c) ?? '').join('\u0000');
}

export function loadProfileClient(): StoredProfile {
  const raw = readClientCookie(COOKIE_NAME);
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

export function saveProfileClient(profile: {
  user: UserPayload;
  marginalRate?: string;
  creditScore?: number | null;
}) {
  writeClientCookie(COOKIE_NAME, JSON.stringify(profile.user));
  if (profile.marginalRate !== undefined) {
    writeClientCookie(MARGINAL_COOKIE, profile.marginalRate);
  }
  if (profile.creditScore != null) {
    writeClientCookie(SCORE_COOKIE, String(profile.creditScore));
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
  });
}

async function syncProfileToServer(profile: StoredProfile): Promise<void> {
  // Lazy import to avoid a client→client circular: api.ts imports types
  // from this file is not a concern (only types), but we still defer to
  // keep the module graph clean.
  const { api } = await import('./api');
  try {
    // Read current server blob so we don't blow away keys this writer
    // doesn't own (lifecycle/activity/etc come in later phases).
    const current = await api.getUserState().catch(() => null);
    const data = (current?.data ?? {}) as Record<string, unknown>;
    const merged = { ...data, ...serializeProfileForServer(profile) };
    await api.putUserState(merged);
  } catch {
    // Signed-out (401) or transient — cookie still has the data, retry
    // on next save. Phase 2 deliberately uses last-write-wins.
  }
}

export function clearProfileClient() {
  if (typeof document === 'undefined') return;
  for (const c of [COOKIE_NAME, MARGINAL_COOKIE, SCORE_COOKIE, FX_COOKIE]) {
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

export function saveFxCacheClient(rates: Record<string, string>) {
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
  const session = cookies().get(SESSION_COOKIE)?.value;
  if (!session) return null;
  const base =
    process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:8000';
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
  const raw = store.get(COOKIE_NAME)?.value;
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
  const store = cookies();

  // Signed-in path: try server-stored profile first.
  if (store.get(SESSION_COOKIE)?.value) {
    const serverData = await fetchUserStateServer();
    const fromServer = profileFromServerData(serverData);
    if (fromServer) return fromServer;
    // Server is empty for this user — fall through to cookie (which
    // /login will push up on next migration tick).
  }

  return _profileFromCookieStore(store);
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
  const raw = cookies().get(FX_COOKIE)?.value;
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
