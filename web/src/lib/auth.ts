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

import { useEffect, useState } from 'react';
import { api, type AuthUser } from '@/lib/api';

export type SessionState =
  | { status: 'loading'; user: null }
  | { status: 'authed'; user: AuthUser }
  | { status: 'anon'; user: null };

export function useSession(): SessionState & { refresh: () => Promise<void>; logout: () => Promise<void> } {
  const [state, setState] = useState<SessionState>({ status: 'loading', user: null });

  async function refresh() {
    try {
      const user = await api.me();
      setState({ status: 'authed', user });
    } catch {
      setState({ status: 'anon', user: null });
    }
  }

  async function logout() {
    try {
      await api.logout();
      const { clearAccountCache } = await import('./server-sync');
      clearAccountCache();
    } finally {
      setState({ status: 'anon', user: null });
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  return { ...state, refresh, logout };
}
