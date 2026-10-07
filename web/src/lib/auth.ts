'use client';

/**
 * Tiny client-side session hook.
 *
 * Calls GET /api/auth/me once on mount. Returns one of three states:
 *   - { status: 'loading', user: null }
 *   - { status: 'authed',  user: AuthUser }
 *   - { status: 'anon',    user: null }
 *
 * No global context — each consumer fetches independently. Acceptable
 * for phase 1; if we end up with >3 callers we'll lift this to a
 * provider.
 */

import { useEffect, useState, useRef } from 'react';
import { api, type AuthUser } from '@/lib/api';
import { notifySessionChanged, SESSION_CHANGED_EVENT } from './session-events';

export type SessionState =
  | { status: 'loading'; user: null }
  | { status: 'authed'; user: AuthUser }
  | { status: 'anon'; user: null };

export function useSession(): SessionState & { refresh: () => Promise<void>; logout: () => Promise<void> } {
  const [state, setState] = useState<SessionState>({ status: 'loading', user: null });
  const requestVersion = useRef(0);

  async function refresh() {
    const version = ++requestVersion.current;
    try {
      const user = await api.me();
      if (version === requestVersion.current) setState({ status: 'authed', user });
    } catch {
      if (version === requestVersion.current) setState({ status: 'anon', user: null });
    }
  }

  async function logout() {
    const { clearAccountCache, clearPendingSync, flushPendingState } = await import('./server-sync');
    if (!await flushPendingState()) throw new Error('Your changes have not reached your account. Retry saving before signing out.');
    await api.logout();
    clearAccountCache();
    clearPendingSync();
    setState({ status: 'anon', user: null });
    notifySessionChanged();
  }

  useEffect(() => {
    void refresh();
    const accountChanged = (event: StorageEvent) => {
      if (event.key === 'finoptima_account_id') void refresh();
    };
    window.addEventListener(SESSION_CHANGED_EVENT, refresh);
    window.addEventListener('storage', accountChanged);
    return () => {
      window.removeEventListener(SESSION_CHANGED_EVENT, refresh);
      window.removeEventListener('storage', accountChanged);
    };
  }, []);

  return { ...state, refresh, logout };
}
