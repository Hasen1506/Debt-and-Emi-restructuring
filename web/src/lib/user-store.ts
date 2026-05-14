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
const COOKIE_MAX_AGE = 60 * 60 * 24 * 365;  // 1 year

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
}

export function clearProfileClient() {
  if (typeof document === 'undefined') return;
  for (const c of [COOKIE_NAME, MARGINAL_COOKIE, SCORE_COOKIE]) {
    document.cookie = `${c}=; path=/; max-age=0`;
  }
}

// ─── Server-side ────────────────────────────────────────────────────────────

export async function loadProfileServer(): Promise<StoredProfile> {
  // Imported here so client bundles don't pull in next/headers.
  const { cookies } = await import('next/headers');
  const store = cookies();
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
