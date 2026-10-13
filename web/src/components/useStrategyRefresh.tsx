'use client';

/**
 * Live re-test 6B R6B-9: picking a payoff order offline used to call
 * router.refresh(), whose failed fetch made Next fall back to a full
 * browser navigation: the browser's "no internet" page. Now the choice is
 * saved (the cookie is local), a note says the plan will redraw when the
 * connection is back, and the refresh runs on the 'online' event.
 */
import { useCallback, useEffect, useRef, useState, useTransition, type CSSProperties } from 'react';
import { useRouter } from 'next/navigation';

export const OFFLINE_STRATEGY_NOTE =
  'You’re offline. Your choice is saved; the plan redraws with it when you’re back online.';

/** True when a refresh now would fail and send the browser to its error page. */
export function isOfflineNow(nav: { onLine?: boolean } | undefined = typeof navigator === 'undefined' ? undefined : navigator): boolean {
  return !!nav && nav.onLine === false;
}

export function useStrategyRefresh(): {
  pending: boolean;
  offline: boolean;
  refresh: () => void;
} {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [offline, setOffline] = useState(false);
  const waiting = useRef(false);

  useEffect(() => {
    const back = () => {
      setOffline(false);
      if (!waiting.current) return;
      waiting.current = false;
      startTransition(() => router.refresh());
    };
    window.addEventListener('online', back);
    return () => window.removeEventListener('online', back);
  }, [router]);

  const refresh = useCallback(() => {
    if (isOfflineNow()) {
      waiting.current = true;
      setOffline(true);
      return;
    }
    startTransition(() => router.refresh());
  }, [router]);

  return { pending, offline, refresh };
}

export function OfflineStrategyNote({ show, style }: { show: boolean; style?: CSSProperties }) {
  if (!show) return null;
  return (
    <p role="status" data-testid="strategy-offline-note" style={{ margin: 0, fontSize: 12, lineHeight: 1.5, color: 'var(--negative)', ...style }}>
      {OFFLINE_STRATEGY_NOTE}
    </p>
  );
}
