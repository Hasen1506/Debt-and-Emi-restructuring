'use client';

/**
 * Cross-device sync glue: dual-write helper + hydration on app boot.
 *
 * Architecture: each client store (lifecycle, activity, advance-tax,
 * ...) keeps writing to cookies/localStorage as before — that path is
 * the first-paint cache. After each write, it ALSO calls
 * `syncSliceToServer(slice, value)`. The helper PATCHes the slice;
 * PostgreSQL merges it under a per-user lock. Failures retain local data.
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
import { useRouter } from 'next/navigation';
import { writeProfileCookieClient, clearProfileClient, serializeProfileForServer, type StoredProfile } from './user-store';
import { writeLifecycleClient, readLifecycleClient, type LifecycleEvent } from './lifecycle-events';

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
  decision_log:       { kind: 'localStorage', name: 'finoptima_decision_log' },
  cash_events:        { kind: 'localStorage', name: 'finoptima_cash_events' },
  tax_sleeve:         { kind: 'localStorage', name: 'finoptima_tax_sleeve' },
  goals:             { kind: 'localStorage', name: 'finoptima_goals' },
  goal_contributions:{ kind: 'localStorage', name: 'finoptima_goal_contributions' },
  monthly_spend:     { kind: 'localStorage', name: 'finoptima_monthly_spend' },
  decisions:         { kind: 'localStorage', name: 'finoptima_decisions' },
  ef_split:          { kind: 'cookie',       name: 'finoptima_ef_split' },
  // Profile slice is handled separately by user-store.ts (it spans 3
  // cookies and predates this file).
};

export const HYDRATED_EVENT = 'finoptima:hydrated';
const ACCOUNT_KEY = 'finoptima_account_id';
let accountGeneration = 0;
let localRevision = 0;

/** A different signed-in account must not inherit this browser's old profile. */
export function prepareAccountCache(userId: string): void {
  const previous = localStorage.getItem(ACCOUNT_KEY);
  if (previous && previous !== userId) clearAccountCache();
  localStorage.setItem(ACCOUNT_KEY, userId);
}

export function clearAccountCache(): void {
  accountGeneration++;
  localRevision++;
  clearProfileClient();
  for (const target of Object.values(SLICE_TARGETS)) {
    if (target.kind === 'localStorage') localStorage.removeItem(target.name);
    else document.cookie = `${target.name}=; path=/; max-age=0`;
  }
  for (const name of ['finoptima_activity_deltas', 'finoptima_goals_digest', 'finoptima_goal_contributions_digest', 'finoptima_monthly_spend_digest']) {
    document.cookie = `${name}=; path=/; max-age=0`;
  }
}

/** Preserve all trial-mode data when a user first signs in. */
export function serializeClientState(profile: StoredProfile): Record<string, unknown> {
  const result = serializeProfileForServer(profile);
  for (const [slice, target] of Object.entries(SLICE_TARGETS)) {
    if (slice === 'lifecycle') { result[slice] = readLifecycleClient(); continue; }
    const raw = target.kind === 'localStorage' ? localStorage.getItem(target.name)
      : document.cookie.match(new RegExp(`(?:^|; )${target.name}=([^;]*)`))?.[1];
    if (raw == null) continue;
    const value = target.kind === 'cookie' ? decodeURIComponent(raw) : raw;
    try { result[slice] = JSON.parse(value); } catch { result[slice] = value; }
  }
  return result;
}

function writeCookie(name: string, value: string): void {
  if (typeof document === 'undefined') return;
  document.cookie = `${name}=${encodeURIComponent(value)}; path=/; max-age=${COOKIE_MAX_AGE}; SameSite=Lax`;
}

/**
 * Push a single slice to the server, preserving every other key in the
 * blob across devices. Best-effort: failures retain the browser copy.
 */
let syncQueue: Promise<void> = Promise.resolve();
export function syncSliceToServer(slice: string, value: unknown): Promise<void> {
  if (process.env.NEXT_PUBLIC_DISABLE_AUTH === 'true') return Promise.resolve();
  const captured = JSON.parse(JSON.stringify(value));
  const generation = accountGeneration;
  const account = typeof localStorage === 'undefined' ? null : localStorage.getItem(ACCOUNT_KEY);
  localRevision++;
  syncQueue = syncQueue.catch(() => {}).then(async () => {
    if (generation !== accountGeneration || (typeof localStorage !== 'undefined' && localStorage.getItem(ACCOUNT_KEY) !== account)) return;
    const {api} = await import('./api');
    if (generation !== accountGeneration || (typeof localStorage !== 'undefined' && localStorage.getItem(ACCOUNT_KEY) !== account)) return;
    try {
      await api.patchUserState({[slice]:captured});
    } catch { /* Local stores remain available; next action retries. */ }
  });
  return syncQueue;
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
export async function hydrateLocalStores(data: Record<string, unknown>): Promise<void> {
  const profile = (data as { profile?: { user?: unknown; marginalRate?: string; creditScore?: number | null } }).profile;
  if (profile && typeof profile === 'object') {
    if (profile.user) writeProfileCookieClient(JSON.stringify(profile.user));
    if (profile.marginalRate) writeCookie('finoptima_marginal', profile.marginalRate);
    if (profile.creditScore != null) writeCookie('finoptima_score', String(profile.creditScore));
    else if (profile.creditScore === null) document.cookie = 'finoptima_score=; path=/; max-age=0';
  }
  for (const [slice, target] of Object.entries(SLICE_TARGETS)) {
    if (!(slice in data)) continue;
    const value = data[slice];
    if (value == null) continue;
    if (slice === 'lifecycle') {
      try {writeLifecycleClient((typeof value === 'string' ? JSON.parse(value) : value) as LifecycleEvent[],false);} catch { /* Retain local history if storage is full. */ }
      continue;
    }
    const serialized = typeof value === 'string' ? value : JSON.stringify(value);
    if (target.kind === 'cookie') {
      writeCookie(target.name, serialized);
    } else {
      if (typeof localStorage === 'undefined') continue;
      localStorage.setItem(target.name, serialized);
    }
  }
  // activity_deltas is a derived cache (activity entries × loans → cookie)
  // — not synced as its own slice. Regenerate it now that both inputs
  // are present, so the next /plan render sees the user's activity in
  // the simulation on a fresh device.
  await regenerateActivityDeltas(data);
  // Rebuild the server-rendered digests without pushing the hydrated values
  // back to the server (which would turn a read into a stale write).
  if (Array.isArray(data.goals)) {
    const { goalSliceWrite } = await import('./goals');
    const write = goalSliceWrite(data.goals);
    localStorage.setItem(write.key, JSON.stringify(write.value));
    document.cookie = `${write.cookie}=${write.digest}; path=/; max-age=${COOKIE_MAX_AGE}; SameSite=Lax`;
  }
  if (Array.isArray(data.goal_contributions)) {
    const { contributionSliceWrite } = await import('./goal-contributions');
    const write = contributionSliceWrite(data.goal_contributions);
    document.cookie = `${write.cookie}=${write.digest}; path=/; max-age=${COOKIE_MAX_AGE}; SameSite=Lax`;
  }
  if (Array.isArray(data.monthly_spend)) {
    const { latestByMonth } = await import('./monthly-spend');
    document.cookie = `finoptima_monthly_spend_digest=${btoa(JSON.stringify(latestByMonth(data.monthly_spend)))}; path=/; max-age=${COOKIE_MAX_AGE}; SameSite=Lax`;
  }
}

async function regenerateActivityDeltas(data: Record<string, unknown>): Promise<void> {
  const activity = data.activity;
  const profile = (data as { profile?: { user?: { loans?: unknown; country?: unknown } } }).profile;
  if (!Array.isArray(activity) || !profile?.user) return;
  const { loans, country } = profile.user as { loans?: unknown; country?: unknown };
  if (!Array.isArray(loans) || (country !== 'IN' && country !== 'US')) return;
  try {
    const { syncActivityCookieClient } = await import('./activity-cookie');
    syncActivityCookieClient(
      activity as Parameters<typeof syncActivityCookieClient>[0],
      loans as Parameters<typeof syncActivityCookieClient>[1],
      country,
    );
  } catch {
    // Non-fatal — first /plan render will be slightly stale until next write.
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
    await hydrateLocalStores(res.data);
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
  const router = useRouter();
  useEffect(() => {
    // Trial mode has no sign-in (and no /api/user/state): nothing to fetch,
    // and asking anyway cost a 404 on every page.
    if (process.env.NEXT_PUBLIC_DISABLE_AUTH === 'true') return;
    let cancelled = false;
    async function hydrate() {
      const revision = localRevision;
      const generation = accountGeneration;
      const { api } = await import('./api');
      try {
        const res = await api.getUserState();
        if (cancelled || !res.data || revision !== localRevision || generation !== accountGeneration) return;
        await hydrateLocalStores(res.data);
        if (cancelled) return;
        window.dispatchEvent(new Event(HYDRATED_EVENT));
        router.refresh();
      } catch {
        // 401 (signed out) — nothing to hydrate.
      }
    }
    void hydrate();
    return () => {
      cancelled = true;
    };
  }, [router]);
  return null;
}
