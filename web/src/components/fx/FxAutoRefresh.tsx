'use client';

/**
 * Refreshes the profile's exchange rates when the app opens and any is
 * older than 24 h, then re-checks every hour while the app stays open
 * (lib/fx-refresh). Renders nothing; a failed refresh keeps the last rate,
 * and the rate line on Home says so.
 */
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { loadProfileClient, saveProfileClient } from '@/lib/user-store';
import { ensureFxRates, fxDueForRefresh, refreshFxRates } from '@/lib/fx-refresh';

export const FX_REFRESHED_EVENT = 'rightdue:fx-refreshed';

export async function refreshProfileFx(force: string[] | null = null): Promise<{ refreshed: string[]; failed: string[] }> {
  const stored = loadProfileClient();
  if (!stored.isLive) return { refreshed: [], failed: [] };
  const now = Date.now();
  const lookup = (b: string, q: string) => api.fxRate(b, q);
  const res = force ? await refreshFxRates(stored.user, lookup, now, force) : await ensureFxRates(stored.user, lookup, now);
  if (res.refreshed.length > 0) {
    saveProfileClient({ user: res.user, marginalRate: stored.marginalRate, creditScore: stored.creditScore });
    window.dispatchEvent(new Event('rightdue:profile-changed'));
  }
  window.dispatchEvent(new CustomEvent(FX_REFRESHED_EVENT, { detail: res }));
  return res;
}

export function FxAutoRefresh() {
  const router = useRouter();
  useEffect(() => {
    let alive = true;
    const check = async () => {
      const stored = loadProfileClient();
      if (!stored.isLive || fxDueForRefresh(stored.user, Date.now()).length === 0) return;
      const res = await refreshProfileFx();
      if (alive && res.refreshed.length > 0) router.refresh();
    };
    void check();
    const id = window.setInterval(() => void check(), 60 * 60 * 1000);
    return () => {
      alive = false;
      window.clearInterval(id);
    };
  }, [router]);
  return null;
}
