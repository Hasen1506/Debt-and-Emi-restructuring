'use client';

/**
 * The saved profile, the same on the server render and the first browser
 * render.
 *
 * Tools used to read the profile cookie while rendering. On the server
 * there is no document, so the server drew the demo profile and the
 * browser drew the saved one; React then threw hydration errors and threw
 * the server HTML away (8 on Windfall). The root layout already loads the
 * profile on the server: it hands it down here, hydration uses that copy,
 * and later renders (and client-side navigations) read the cookie, so a
 * profile saved a moment ago is never stale.
 */
import { createContext, useContext, useSyncExternalStore, type ReactNode } from 'react';
import { DEMO_MARGINAL_RATE, DEMO_USER } from '@/lib/demo-user';
import { loadProfileClient, profileCookieKey, type StoredProfile } from '@/lib/user-store';
import { applyActivityDeltas, parseActivityDeltas } from './activity-cookie';
import { migrateLoanIdsClient } from '@/lib/loan-id-migration';

// Before the first client render reads the profile: give a profile saved
// before loan ids its ids, and its activity entries theirs.
migrateLoanIdsClient();

const ProfileContext = createContext<StoredProfile | null>(null);

export function ProfileProvider({ profile, children }: { profile: StoredProfile; children: ReactNode }) {
  return <ProfileContext.Provider value={profile}>{children}</ProfileContext.Provider>;
}

let cache: { key: string; profile: StoredProfile } | null = null;

function clientSnapshot(): StoredProfile {
  const key = profileCookieKey();
  if (!cache || cache.key !== key) cache = { key, profile: loadProfileClient() };
  return cache.profile;
}

function subscribe(callback: () => void) {
  const events = ['finoptima:profile-changed', 'finoptima:hydrated', 'storage', 'focus'];
  events.forEach(e => window.addEventListener(e, callback));
  return () => events.forEach(e => window.removeEventListener(e, callback));
}

const DEMO: StoredProfile = { user: DEMO_USER, marginalRate: DEMO_MARGINAL_RATE, creditScore: null, isLive: false };

export function useStoredProfile(): StoredProfile {
  const fromServer = useContext(ProfileContext);
  return useSyncExternalStore(subscribe, clientSnapshot, () => fromServer ?? DEMO);
}

let currentCache: {key: string; profile: StoredProfile} | null = null;
function currentSnapshot(): StoredProfile {
  const profile = clientSnapshot();
  const raw = document.cookie.match(/(?:^|; )finoptima_activity_deltas=([^;]*)/)?.[1] ?? '';
  const key = profileCookieKey() + raw;
  if (!currentCache || currentCache.key !== key) currentCache = {key, profile: {...profile, user: {...profile.user, loans: applyActivityDeltas(profile.user.loans,parseActivityDeltas(raw)).loans}}};
  return currentCache.profile;
}
/** Use current balances for advice. Profile mutations always load the stored baseline. */
export function useCurrentProfile(): StoredProfile {
  const fromServer = useContext(ProfileContext);
  return useSyncExternalStore(subscribe, currentSnapshot, () => fromServer ?? DEMO);
}
