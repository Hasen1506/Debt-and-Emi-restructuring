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
 * cookie/localStorage and dispatches a 'rightdue:hydrated' event so
 * components with stale state can re-read.
 *
 * Slices intentionally namespaced via a flat top-level key so the
 * server blob stays grep-able and unambiguous.
 */

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { onSignInPage, SESSION_CHANGED_EVENT } from './session-events';
import { writeProfileCookieClient, profileCookieHolds, clearProfileClient, resumeProfileClient, serializeProfileForServer, type StoredProfile } from './user-store';
import { writeLifecycleClient, readLifecycleClient, type LifecycleEvent } from './lifecycle-events';
import { migrateLegacyClientStorage } from './storage-migration';
import { readableCookieMaxAge } from './readable-cookie-age';

// finoptima_* → rightdue_* (critique #58): move this browser's keys before
// any store reads them. The root layout loads this module on every page.
migrateLegacyClientStorage();

// D16: cookie lifetimes come from readableCookieMaxAge() (readable-cookie-age.ts).

/** Map of slice key (top-level in server blob) → its client storage location. */
type StorageKind = 'cookie' | 'localStorage';
interface SliceTarget {
  kind: StorageKind;
  name: string;
}
const SLICE_TARGETS: Record<string, SliceTarget> = {
  lifecycle:          { kind: 'cookie',       name: 'rightdue_lifecycle' },
  advance_tax:        { kind: 'cookie',       name: 'rightdue_advance_tax' },
  activity:           { kind: 'localStorage', name: 'rightdue_activity' },
  strategy:           { kind: 'cookie',       name: 'rightdue_strategy' },
  payoff_rules:       { kind: 'cookie',       name: 'rightdue_payoff_rules' },
  inflation_modeling: { kind: 'cookie',       name: 'rightdue_inflation_modeling' },
  inflation_rate:     { kind: 'cookie',       name: 'rightdue_inflation_rate' },
  hike_modeling:      { kind: 'cookie',       name: 'rightdue_hike_modeling' },
  tax_reinvest:       { kind: 'cookie',       name: 'rightdue_tax_reinvest' },
  fx_drift:           { kind: 'cookie',       name: 'rightdue_fx_drift' },
  commitments:        { kind: 'localStorage', name: 'rightdue_commitments' },
  decision_log:       { kind: 'localStorage', name: 'rightdue_decision_log' },
  cash_events:        { kind: 'localStorage', name: 'rightdue_cash_events' },
  tax_sleeve:         { kind: 'localStorage', name: 'rightdue_tax_sleeve' },
  goals:             { kind: 'localStorage', name: 'rightdue_goals' },
  goal_contributions:{ kind: 'localStorage', name: 'rightdue_goal_contributions' },
  monthly_spend:     { kind: 'localStorage', name: 'rightdue_monthly_spend' },
  decisions:         { kind: 'localStorage', name: 'rightdue_decisions' },
  ef_split:          { kind: 'cookie',       name: 'rightdue_ef_split' },
  debt_budget:       { kind: 'cookie',       name: 'rightdue_debt_budget' },
  low_rate_share:    { kind: 'cookie',       name: 'rightdue_low_rate_share' },  // audit 80+ A4
  // Profile slice is handled separately by user-store.ts (it spans 3
  // cookies and predates this file).
};

export const HYDRATED_EVENT = 'rightdue:hydrated';
const ACCOUNT_KEY = 'rightdue_account_id';
let accountGeneration = 0;
let localRevision = 0;
let preparedAccount: string | null = null;
export const SYNC_CHANGED_EVENT = 'rightdue:sync-changed';
const pendingMemory = new Map<string, Record<string, unknown>>();

/**
 * What the account copy is doing (live-test #2/#3/#27/#33).
 *
 * The old notice had one failure state for every cause, and a 401 (the
 * sign-in ended or was revoked while the session cookie stayed in the
 * browser, so pages still opened) was retried with the same dead cookie
 * forever: "Changes have not reached your account… Retry save" never
 * cleared, although each save had been kept on this device. Each cause now
 * has its own state, message and next step.
 */
export type SyncProblem =
  | 'signed_out'      // 401: sign in again; saved on this device meanwhile
  | 'offline'         // network down, or the free server waking up: retried automatically
  | 'server'          // 5xx from the API: retried automatically
  | 'too_large'       // 413
  | 'refused'         // 403/400/422: the request itself was rejected
  | 'account_changed' // 409: another tab signed in as someone else
  | 'conflict';       // 412: another device changed the same part since this one read it
export interface SyncState {
  status: 'saved' | 'pending' | 'failed';
  problem?: SyncProblem;
  /** ms since epoch of the last attempt to reach the account. */
  lastAttemptAt?: number;
  /** When the next automatic retry runs (offline/server only). */
  nextRetryAt?: number;
  /** Parts refused because another device changed them (conflict only). */
  conflictSlices?: string[];
}
let syncState: SyncState = { status: 'saved' };
/** Fired after account data from another device was written into this browser. */
export const REMOTE_APPLIED_EVENT = 'rightdue:remote-applied';
const VERSION_KEY = (account: string) => `rightdue_state_version_${account}`;
const CONFLICT_KEY = (account: string) => `rightdue_sync_conflict_${account}`;
/** Automatic retry delays for offline/server problems. */
export const RETRY_DELAYS_MS = [5_000, 15_000, 30_000, 60_000, 120_000, 300_000];
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let retryCount = 0;

function activeAccount(): string | null {
  try { return localStorage.getItem(ACCOUNT_KEY); } catch { return null; }
}

/** The signed-in account this browser is caching for, or null for a guest. */
export function signedInAccount(): string | null {
  return preparedAccount ?? activeAccount();
}

function pendingState(account: string): Record<string, unknown> {
  if (pendingMemory.has(account)) return pendingMemory.get(account)!;
  try {
    const saved = JSON.parse(localStorage.getItem(`rightdue_pending_sync_${account}`) ?? '{}');
    return saved && typeof saved === 'object' && !Array.isArray(saved) ? saved : {};
  } catch { return {}; }
}

function storePending(account: string, data: Record<string, unknown>): void {
  pendingMemory.set(account, data);
  try {
    const key = `rightdue_pending_sync_${account}`;
    if (Object.keys(data).length) localStorage.setItem(key, JSON.stringify(data));
    else localStorage.removeItem(key);
    pendingMemory.delete(account);
  } catch { /* Keep the in-memory retry even if browser storage is full. */ }
}

const DEVICE_KEY = 'rightdue_device_id';
let memoryDeviceId: string | null = null;
/**
 * A random id for this browser (not tied to the person; holds no data). The
 * server records which browser last wrote each part, so a write this browser
 * made itself is never refused as "changed on another device", even when its
 * answer was lost: a full page navigation (onboarding → Plan) cancels the
 * fetch after the server has committed it, so the version it returned never
 * arrives and the change is sent again from the queue on an old version.
 */
export function deviceId(): string {
  try {
    let id = localStorage.getItem(DEVICE_KEY);
    if (!id) {
      id = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID()
        : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
      localStorage.setItem(DEVICE_KEY, id);
    }
    return id;
  } catch {
    memoryDeviceId ??= `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
    return memoryDeviceId;
  }
}

/** The account version this browser last read or wrote, or null if unknown. */
export function knownVersion(account: string): number | null {
  try {
    const v = Number(localStorage.getItem(VERSION_KEY(account)));
    return localStorage.getItem(VERSION_KEY(account)) !== null && Number.isInteger(v) && v >= 0 ? v : null;
  } catch { return null; }
}

function storeVersion(account: string, version: unknown): void {
  if (typeof version !== 'number' || !Number.isInteger(version)) return;
  // Never step back: the server's counter only rises, so a lower number is
  // an answer that was overtaken (a GET sent before a PATCH that finished
  // first). Storing it made this device's next save look stale to itself.
  const known = knownVersion(account);
  if (known !== null && version < known) return;
  try { localStorage.setItem(VERSION_KEY(account), String(version)); } catch { /* next GET sets it */ }
}

/** JSON with object keys sorted, so two copies of a slice compare equal
 *  whatever order the database returned their keys in. */
function canonical(value: unknown): string {
  return JSON.stringify(value, (_k, v) =>
    v && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, (v as Record<string, unknown>)[k]]))
      : v);
}

/** This device's copy of parts another device changed first. */
export function conflictCopy(account: string | null = activeAccount()): Record<string, unknown> | null {
  if (!account) return null;
  try {
    const raw = localStorage.getItem(CONFLICT_KEY(account));
    const parsed = raw ? JSON.parse(raw) : null;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) && Object.keys(parsed).length ? parsed : null;
  } catch { return null; }
}

function storeConflict(account: string, data: Record<string, unknown> | null): void {
  try {
    if (data && Object.keys(data).length) localStorage.setItem(CONFLICT_KEY(account), JSON.stringify(data));
    else localStorage.removeItem(CONFLICT_KEY(account));
  } catch { /* in-memory notice still shows */ }
}

function setSyncState(next: SyncState): void {
  syncState = next;
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(SYNC_CHANGED_EVENT));
}

function reportSync(status: SyncState['status']): void {
  setSyncState({ status, lastAttemptAt: syncState.lastAttemptAt });
}

/** Which problem an error from the state endpoint is. */
export function classifySyncError(error: unknown): SyncProblem {
  const status = (error as { status?: unknown })?.status;
  if (typeof status !== 'number') return 'offline';
  if (status === 401) return 'signed_out';
  if (status === 409) return 'account_changed';
  if (status === 412) return 'conflict';
  if (status === 413) return 'too_large';
  if (status >= 500) return status === 502 || status === 503 || status === 504 ? 'offline' : 'server';
  return 'refused';
}

function clearRetry(): void {
  if (retryTimer !== null) clearTimeout(retryTimer);
  retryTimer = null;
}

function scheduleRetry(): number | undefined {
  clearRetry();
  if (typeof window === 'undefined') return undefined;
  const delay = RETRY_DELAYS_MS[Math.min(retryCount, RETRY_DELAYS_MS.length - 1)];
  retryCount++;
  retryTimer = setTimeout(() => { retryTimer = null; void flushPendingState(); }, delay);
  return Date.now() + delay;
}

/** Status in three words, for older callers. getSyncState() has the detail. */
export function getSyncStatus(): SyncState['status'] { return syncState.status; }
export function getSyncState(): SyncState { return syncState; }

/** A different signed-in account must not inherit this browser's old profile. */
export function prepareAccountCache(userId: string): void {
  const previous = localStorage.getItem(ACCOUNT_KEY);
  if (previous && previous !== userId) clearAccountCache();
  localStorage.setItem(ACCOUNT_KEY, userId);
  preparedAccount = userId;
  resumeProfileClient();
  const conflict = conflictCopy(userId);
  if (conflict) setSyncState({ status: 'failed', problem: 'conflict', conflictSlices: Object.keys(conflict) });
  else reportSync(Object.keys(pendingState(userId)).length ? 'pending' : 'saved');
}

export function clearAccountCache(): void {
  accountGeneration++;
  localRevision++;
  localStorage.removeItem(ACCOUNT_KEY);
  preparedAccount = null;
  clearRetry();
  retryCount = 0;
  reportSync('saved');
  clearProfileClient();
  for (const target of Object.values(SLICE_TARGETS)) {
    if (target.kind === 'localStorage') localStorage.removeItem(target.name);
    else document.cookie = `${target.name}=; path=/; max-age=0`;
  }
  for (const name of ['rightdue_activity_deltas', 'rightdue_goals_digest', 'rightdue_goal_contributions_digest', 'rightdue_monthly_spend_digest', 'rightdue_ledger_tone']) {
    document.cookie = `${name}=; path=/; max-age=0`;
  }
  // Per-user keys outside the synced slices (PASS2 P2-18): on a shared
  // computer the next person must not read them after a sign-out.
  for (const key of LOCAL_PER_USER_KEYS) localStorage.removeItem(key);
  if (typeof sessionStorage !== 'undefined') {
    for (const key of SESSION_PER_USER_KEYS) sessionStorage.removeItem(key);
  }
}

/**
 * After a successful sign-out (pending writes already flushed), drop every
 * leftover unsynced-change queue so the next person on this computer cannot
 * read them (P2-18). Not called on an account switch: there the old
 * account's queue is kept so it can still be retried when they come back.
 */
export function clearPendingSync(): void {
  pendingMemory.clear();
  // A signed-out browser keeps nothing: the next sign-in starts with no
  // version either, so a new device id loses nothing.
  memoryDeviceId = null;
  try { localStorage.removeItem(DEVICE_KEY); } catch { /* storage blocked */ }
  for (const key of storageKeys(localStorage)) {
    if (key.startsWith('rightdue_pending_sync_') || key.startsWith('rightdue_state_version_') || key.startsWith('rightdue_sync_conflict_')) localStorage.removeItem(key);
  }
}

/** localStorage keys that hold one person's data but are not synced slices. */
export const LOCAL_PER_USER_KEYS = [
  'rightdue_set_aside',
  'rightdue_balances_entered',
  'rightdue_stale_snooze_until',
  // A guest's last visit (guest-return LAST_SEEN_KEY): sign-out leaves this
  // browser empty, and the next person must not inherit "you were here".
  'rightdue_guest_last_seen',
  // R8: Home's debt-free month marks (months-shaved) are this person's; the
  // decision-log migration flag goes with the log it guards. Found when the
  // US golden journey visited Home before signing out.
  'rightdue_debt_free_marks',
  'rightdue_decision_log_migrated_v1',
] as const;
/** sessionStorage keys with one person's navigation or prompts. */
export const SESSION_PER_USER_KEYS = ['rightdue_trail', 'rightdue_debtfree_prompt_dismissed'] as const;

function storageKeys(store: Storage): string[] {
  const keys: string[] = [];
  const n = typeof store.length === 'number' ? store.length : 0;
  for (let i = 0; i < n; i++) {
    const k = store.key(i);
    if (k !== null) keys.push(k);
  }
  return keys;
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
  // D16: account copies live as long as the sign-in, not a year.
  if (typeof document === 'undefined') return;
  document.cookie = `${name}=${encodeURIComponent(value)}; path=/; max-age=${readableCookieMaxAge()}; SameSite=Lax`;
}

/**
 * Push a single slice to the server, preserving every other key in the
 * blob across devices. Pending values are durable and bound to the account.
 */
let syncQueue: Promise<void> = Promise.resolve();
export function syncSliceToServer(slice: string, value: unknown): Promise<void> {
  return syncSlicesToServer({ [slice]: value });
}

/** Related local changes reach the account in one atomic state patch. */
export function syncSlicesToServer(slices: Record<string, unknown>): Promise<void> {
  if (process.env.NEXT_PUBLIC_DISABLE_AUTH === 'true') return Promise.resolve();
  const captured = JSON.parse(JSON.stringify(slices));
  const generation = accountGeneration;
  const account = preparedAccount ?? activeAccount();
  localRevision++;
  // Anonymous trial changes migrate after sign-in, never to a stale session.
  if (!account) return Promise.resolve();
  storePending(account, { ...pendingState(account), ...captured });
  reportSync('pending');
  syncQueue = syncQueue.catch(() => {}).then(async () => {
    await sendPending(account, generation);
  });
  return syncQueue;
}

async function sendPending(account: string, generation: number, force = false): Promise<boolean> {
  if (generation !== accountGeneration || activeAccount() !== account) return false;
  const snapshot = { ...pendingState(account) };
  if (!Object.keys(snapshot).length) return true;
  const { api } = await import('./api');
  if (generation !== accountGeneration || activeAccount() !== account) return false;
  const base = knownVersion(account);
  const attemptAt = Date.now();
  try {
    const res = await api.patchUserState(snapshot, base, force, deviceId());
    clearRetry();
    retryCount = 0;
    const remaining = { ...pendingState(account) };
    for (const [slice, value] of Object.entries(snapshot)) {
      if (JSON.stringify(remaining[slice]) === JSON.stringify(value)) delete remaining[slice];
    }
    storePending(account, remaining);
    // Another device wrote in between (the version moved by more than this
    // write): bring its other parts into this browser, or a later edit here
    // would be based on an old copy (critique #63).
    const version = res?.version;
    if (typeof version === 'number' && res.data && (base === null || version > base + 1)) {
      await applyRemote(account, generation, res.data, new Set([...Object.keys(snapshot), ...Object.keys(remaining)]));
    }
    storeVersion(account, version);
    if (activeAccount() === account) {
      setSyncState({ status: Object.keys(remaining).length ? 'pending' : 'saved', lastAttemptAt: attemptAt });
    }
    return !Object.keys(remaining).length;
  } catch (error) {
    if (activeAccount() !== account) return false;
    const problem = classifySyncError(error);
    if (problem === 'conflict') return handleConflict(account, generation, snapshot, error, attemptAt);
    const retry = problem === 'offline' || problem === 'server';
    const nextRetryAt = retry ? scheduleRetry() : undefined;
    if (!retry) clearRetry();
    setSyncState({ status: 'failed', problem, lastAttemptAt: attemptAt, nextRetryAt });
    return false;
  }
}

/**
 * 412: another device changed some of these parts after this one read
 * them. The account copy wins in this browser (the server is the source of
 * truth when signed in); this device's version is kept aside so the person
 * can choose it instead (keepThisDevice). Parts that did not conflict are
 * sent again on top of the newer version.
 */
async function handleConflict(account: string, generation: number, snapshot: Record<string, unknown>, error: unknown, attemptAt: number): Promise<boolean> {
  const detail = (error as { detail?: () => unknown }).detail?.() as
    { slices?: string[]; data?: Record<string, unknown>; version?: number } | null;
  const slices = Array.isArray(detail?.slices) ? detail!.slices.filter((s) => s in snapshot) : Object.keys(snapshot);
  const pending = { ...pendingState(account) };
  const mine: Record<string, unknown> = { ...(conflictCopy(account) ?? {}) };
  for (const slice of slices) {
    // The account already holds exactly this device's value (its own
    // earlier write, whose answer was lost): nothing to choose between.
    if (detail?.data && slice in detail.data && canonical(detail.data[slice]) === canonical(pending[slice])) {
      delete pending[slice];
      continue;
    }
    mine[slice] = pending[slice];
    delete pending[slice];
  }
  if (!Object.keys(mine).length) {
    storePending(account, pending);
    storeVersion(account, detail?.version);
    if (detail?.data) await applyRemote(account, generation, detail.data, new Set(Object.keys(pending)));
    if (Object.keys(pending).length) return sendPending(account, generation);
    setSyncState({ status: 'saved', lastAttemptAt: attemptAt });
    return true;
  }
  storePending(account, pending);
  storeConflict(account, mine);
  if (detail?.data) await applyRemote(account, generation, detail.data, new Set(Object.keys(pending)));
  storeVersion(account, detail?.version);
  setSyncState({ status: 'failed', problem: 'conflict', lastAttemptAt: attemptAt, conflictSlices: Object.keys(mine) });
  // Send what did not conflict, now based on the newer version.
  if (Object.keys(pending).length) {
    const ok = await sendPending(account, generation);
    if (ok) setSyncState({ status: 'failed', problem: 'conflict', lastAttemptAt: Date.now(), conflictSlices: Object.keys(mine) });
  }
  return false;
}

/** Write account data from elsewhere into this browser, except the parts
 *  this browser still has to send (`keep`), then tell the page. */
async function applyRemote(account: string, generation: number, data: Record<string, unknown>, keep: Set<string>): Promise<void> {
  const subset: Record<string, unknown> = {};
  for (const [slice, value] of Object.entries(data)) if (!keep.has(slice)) subset[slice] = value;
  if (!Object.keys(subset).length) return;
  await hydrateLocalStores(subset, () => generation === accountGeneration && activeAccount() === account);
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(REMOTE_APPLIED_EVENT));
}

/** The person chose this device's copy of the conflicting parts: write it
 *  back here and send it, overriding the other device's. */
export async function keepThisDevice(): Promise<boolean> {
  const account = activeAccount(), generation = accountGeneration;
  const mine = account ? conflictCopy(account) : null;
  if (!account || !mine) return true;
  await hydrateLocalStores(mine, () => generation === accountGeneration && activeAccount() === account);
  storeConflict(account, null);
  storePending(account, { ...pendingState(account), ...mine });
  let ok = false;
  syncQueue = syncQueue.catch(() => {}).then(async () => { ok = await sendPending(account, generation, true); });
  await syncQueue;
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(REMOTE_APPLIED_EVENT));
  return ok;
}

/** The person kept the other device's copy: drop this device's. */
export function keepOtherDevice(): void {
  const account = activeAccount();
  if (account) storeConflict(account, null);
  setSyncState({ status: account && Object.keys(pendingState(account)).length ? 'pending' : 'saved', lastAttemptAt: syncState.lastAttemptAt });
}

/** Retry before hydration or sign-out so stale server state cannot replace edits. */
export async function flushPendingState(): Promise<boolean> {
  const account = activeAccount(), generation = accountGeneration;
  if (!account) return true;
  let success = false;
  syncQueue = syncQueue.catch(() => {}).then(async () => {
    success = await sendPending(account, generation);
  });
  await syncQueue;
  return success;
}

/**
 * The sign-in ended (GET /auth/me answered 401) but this browser still has
 * changes queued for that account: say so after a reload too, instead of
 * showing nothing until the next save fails.
 */
/**
 * audit80 D21: the session ended without a sign-out (it expired, or another
 * device signed this one out). The readable profile copies must not outlive
 * it on a shared phone, so clear them, unless changes are still waiting to
 * reach the account (then they stay, and the notice asks to sign in again).
 * Returns true when it cleared. Guests (no account cached) are untouched.
 */
export function forgetExpiredAccount(): boolean {
  const account = activeAccount();
  if (!account || Object.keys(pendingState(account)).length) return false;
  clearAccountCache();
  return true;
}

export function noteSignedOut(): void {
  const account = activeAccount();
  if (account && Object.keys(pendingState(account)).length) {
    clearRetry();
    setSyncState({ status: 'failed', problem: 'signed_out', lastAttemptAt: syncState.lastAttemptAt });
  }
}

/** How many parts are saved here but not yet in the account. */
export function pendingCount(): number {
  const account = activeAccount();
  return account ? Object.keys(pendingState(account)).length : 0;
}

/**
 * Mirror server-side state back into local stores. Called once after
 * boot when /api/user/state returns a populated blob.
 *
 * Also handles the profile slice, which spans 3 separate cookies
 * (rightdue_user, rightdue_marginal, rightdue_score) and so isn't
 * in SLICE_TARGETS. Without this, returning users on a new device hit
 * a window where the session cookie exists but the profile cookie
 * doesn't — long enough for the middleware to redirect them to
 * /onboarding.
 */
export async function hydrateLocalStores(data: Record<string, unknown>, isCurrent: () => boolean = () => true): Promise<void> {
  if (!isCurrent()) return;
  const profile = (data as { profile?: { user?: unknown; marginalRate?: string; creditScore?: number | null } }).profile;
  if (profile && typeof profile === 'object') {
    if (profile.user && !profileCookieHolds(profile.user)) writeProfileCookieClient(JSON.stringify(profile.user));
    if (profile.marginalRate) writeCookie('rightdue_marginal', profile.marginalRate);
    if (profile.creditScore != null) writeCookie('rightdue_score', String(profile.creditScore));
    else if (profile.creditScore === null) document.cookie = 'rightdue_score=; path=/; max-age=0';
  }
  for (const [slice, target] of Object.entries(SLICE_TARGETS)) {
    if (!(slice in data)) continue;
    let value = data[slice];
    if (value == null) continue;
    // Hybrid was retired for "Your rules" (roadmap PR E): an account saved
    // with 'hybrid' comes back as 'rules', whose default rule is Hybrid's.
    if (slice === 'strategy' && value === 'hybrid') {
      value = 'rules';
      syncSliceToServer('strategy', 'rules');
    }
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
  await regenerateActivityDeltas(data, isCurrent);
  if (!isCurrent()) return;
  // Rebuild the server-rendered digests without pushing the hydrated values
  // back to the server (which would turn a read into a stale write).
  if (Array.isArray(data.goals)) {
    const { goalSliceWrite } = await import('./goals');
    if (!isCurrent()) return;
    const write = goalSliceWrite(data.goals);
    localStorage.setItem(write.key, JSON.stringify(write.value));
    document.cookie = `${write.cookie}=${write.digest}; path=/; max-age=${readableCookieMaxAge()}; SameSite=Lax`;
  }
  if (Array.isArray(data.goal_contributions)) {
    const { contributionSliceWrite } = await import('./goal-contributions');
    if (!isCurrent()) return;
    const write = contributionSliceWrite(data.goal_contributions);
    document.cookie = `${write.cookie}=${write.digest}; path=/; max-age=${readableCookieMaxAge()}; SameSite=Lax`;
  }
  if (Array.isArray(data.monthly_spend)) {
    const { latestByMonth } = await import('./monthly-spend');
    if (!isCurrent()) return;
    document.cookie = `rightdue_monthly_spend_digest=${btoa(JSON.stringify(latestByMonth(data.monthly_spend)))}; path=/; max-age=${readableCookieMaxAge()}; SameSite=Lax`;
  }
}

async function regenerateActivityDeltas(data: Record<string, unknown>, isCurrent: () => boolean): Promise<void> {
  const activity = data.activity;
  const profile = (data as { profile?: { user?: { loans?: unknown; country?: unknown } } }).profile;
  if (!Array.isArray(activity) || !profile?.user) return;
  const { loans, country } = profile.user as { loans?: unknown; country?: unknown };
  if (!Array.isArray(loans) || (country !== 'IN' && country !== 'US')) return;
  try {
    const { syncActivityCookieClient } = await import('./activity-cookie');
    if (!isCurrent()) return;
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
    if (!await flushPendingState()) return false;
    const revision = localRevision, generation = accountGeneration;
    const account = activeAccount();
    const res = await api.getUserState();
    if (account) storeVersion(account, res.version);
    // A different tab can change shared storage before its storage event
    // reaches this tab. Check the identity itself, including after imports.
    const isCurrent = () => revision === localRevision && generation === accountGeneration && account === activeAccount();
    if (!res.data || !isCurrent()) return false;
    await hydrateLocalStores(res.data, isCurrent);
    return isCurrent();
  } catch {
    return false;
  }
}

/** This browser's cookies as one comparable string, in name order. */
function cookieSnapshot(): string {
  return document.cookie.split(/;\s*/).filter(Boolean).sort().join('; ');
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
    let attempt = 0;
    async function hydrate() {
      const currentAttempt = ++attempt;
      const { api } = await import('./api');
      try {
        const user = await api.me();
        if (cancelled || currentAttempt !== attempt) return;
        prepareAccountCache(user.id);
        const before = cookieSnapshot();
        if (!await hydrateFromServer() || cancelled) return;
        window.dispatchEvent(new Event(HYDRATED_EVENT));
        // Render the page again only when the account copy changed a cookie
        // the server reads. Refreshing every time drew each page twice
        // (Plan's simulation too), and in WebKit the refresh cancelled a
        // link followed in the meantime.
        if (cookieSnapshot() !== before && !onSignInPage()) router.refresh();
      } catch (err) {
        // 401 (signed out): nothing to hydrate, but changes still queued for
        // the account that was signed in here are shown as such.
        if (cancelled) return;
        noteSignedOut();
        // D21: a definite "signed out" (not a network error) for a browser
        // that was caching an account: drop that account's copies.
        if ((err as { status?: number } | null)?.status === 401 && forgetExpiredAccount() && !onSignInPage()) router.refresh();
      }
    }
    void hydrate();
    const accountChanged = (event: StorageEvent) => {
      if (event.key === ACCOUNT_KEY) {
        if (!onSignInPage()) router.refresh();
        void hydrate();
      }
    };
    window.addEventListener(SESSION_CHANGED_EVENT, hydrate);
    window.addEventListener('online', hydrate);
    window.addEventListener('storage', accountChanged);
    return () => {
      cancelled = true;
      window.removeEventListener(SESSION_CHANGED_EVENT, hydrate);
      window.removeEventListener('online', hydrate);
      window.removeEventListener('storage', accountChanged);
    };
  }, [router]);
  return null;
}
