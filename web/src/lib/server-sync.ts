'use client';

/**
 * Cross-device sync glue: dual-write helper + hydration on app boot.
 *
 * Architecture: each client store (lifecycle, activity, advance-tax,
 * ...) keeps writing to cookies/localStorage as before — that path is
 * the first-paint cache. After each write, it ALSO calls
 * `syncSliceToServer(slice, value)`. The helper fetches the current
 * server blob, merges the slice, and PUTs it back. Failures are
 * swallowed (last-write-wins on next save).
 *
 * On app boot, <SessionHydrator/> fetches /api/user/state once. If
 * non-empty, it mirrors each known slice back into the matching
 * cookie/localStorage and dispatches a 'finoptima:hydrated' event so
 * components with stale state can re-read.
 *
 * Slices intentionally namespaced via a flat top-level key so the
 * server blob stays grep-able and unambiguous.
 */

import { useEffect } from 'react';

const COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

/** Map of slice key (top-level in server blob) → its client storage location. */
type StorageKind = 'cookie' | 'localStorage';
interface SliceTarget {
  kind: StorageKind;
  name: string;
}
const SLICE_TARGETS: Record<string, SliceTarget> = {
  lifecycle:          { kind: 'cookie',       name: 'finoptima_lifecycle' },
  advance_tax:        { kind: 'cookie',       name: 'finoptima_advance_tax' },
  activity:           { kind: 'localStorage', name: 'finoptima_activity' },
  strategy:           { kind: 'cookie',       name: 'finoptima_strategy' },
  inflation_modeling: { kind: 'cookie',       name: 'finoptima_inflation_modeling' },
  hike_modeling:      { kind: 'cookie',       name: 'finoptima_hike_modeling' },
  tax_reinvest:       { kind: 'cookie',       name: 'finoptima_tax_reinvest' },
  fx_drift:           { kind: 'cookie',       name: 'finoptima_fx_drift' },
  commitments:        { kind: 'localStorage', name: 'finoptima_commitments' },
  // Profile slice is handled separately by user-store.ts (it spans 3
  // cookies and predates this file).
};

export const HYDRATED_EVENT = 'finoptima:hydrated';

function writeCookie(name: string, value: string): void {
  if (typeof document === 'undefined') return;
  document.cookie = `${name}=${encodeURIComponent(value)}; path=/; max-age=${COOKIE_MAX_AGE}; SameSite=Lax`;
}

/**
 * Push a single slice to the server, preserving every other key in the
 * blob. Best-effort: 401 (signed out) and network failures are silent.
 */
export async function syncSliceToServer(slice: string, value: unknown): Promise<void> {
  const { api } = await import('./api');
  try {
    const current = await api.getUserState().catch(() => null);
    const data = (current?.data ?? {}) as Record<string, unknown>;
    const merged = { ...data, [slice]: value };
    await api.putUserState(merged);
  } catch {
    // Swallow — cookie/localStorage still holds the truth locally.
  }
}

/**
 * Mirror server-side state back into local stores. Called once after
 * boot when /api/user/state returns a populated blob.
 *
 * Also handles the profile slice, which spans 3 separate cookies
 * (finoptima_user, finoptima_marginal, finoptima_score) and so isn't
 * in SLICE_TARGETS. Without this, returning users on a new device hit
 * a window where the session cookie exists but the profile cookie
 * doesn't — long enough for the middleware to redirect them to
 * /onboarding.
 */
function hydrateLocalStores(data: Record<string, unknown>): void {
  const profile = (data as { profile?: { user?: unknown; marginalRate?: string; creditScore?: number | null } }).profile;
  if (profile && typeof profile === 'object') {
    if (profile.user) writeCookie('finoptima_user', JSON.stringify(profile.user));
    if (profile.marginalRate) writeCookie('finoptima_marginal', profile.marginalRate);
    if (profile.creditScore != null) writeCookie('finoptima_score', String(profile.creditScore));
  }
  for (const [slice, target] of Object.entries(SLICE_TARGETS)) {
    if (!(slice in data)) continue;
    const value = data[slice];
    if (value == null) continue;
    const serialized = typeof value === 'string' ? value : JSON.stringify(value);
    if (target.kind === 'cookie') {
      writeCookie(target.name, serialized);
    } else {
      if (typeof localStorage === 'undefined') continue;
      localStorage.setItem(target.name, serialized);
    }
  }
}

/**
 * Synchronous hydration triggered from /login right after verify. Avoids
 * the first-render race where the middleware would see session+no-profile
 * and bounce returning users to /onboarding before <SessionHydrator/>
 * fires on mount. No-op for new users (server blob is empty).
 */
export async function hydrateFromServer(): Promise<boolean> {
  const { api } = await import('./api');
  try {
    const res = await api.getUserState();
    if (!res.data) return false;
    hydrateLocalStores(res.data);
    return true;
  } catch {
    return false;
  }
}

/**
 * Mount once at the root layout. On first paint after sign-in this
 * fetches the server blob and rehydrates local stores so components
 * (LifecycleArrivalPrompts, AdvanceTaxPanel, ActivityLedger) see the
 * user's data across devices without bespoke per-component plumbing.
 *
 * Renders nothing.
 */
export function SessionHydrator(): null {
  useEffect(() => {
    let cancelled = false;
    async function hydrate() {
      const { api } = await import('./api');
      try {
        const res = await api.getUserState();
        if (cancelled || !res.data) return;
        hydrateLocalStores(res.data);
        window.dispatchEvent(new Event(HYDRATED_EVENT));
      } catch {
        // 401 (signed out) — nothing to hydrate.
      }
    }
    void hydrate();
    return () => {
      cancelled = true;
    };
  }, []);
  return null;
}
