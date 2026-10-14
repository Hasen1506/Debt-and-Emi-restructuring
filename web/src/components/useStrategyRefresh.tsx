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

/** A tiny static file: can the site be reached right now? (navigator.onLine
 *  isn't reliable in every browser.) */
const PROBE = '/icon-192.png';
async function reachable(): Promise<boolean> {
  if (isOfflineNow()) return false;
  try {
    const r = await fetch(PROBE, { method: 'HEAD', cache: 'no-store' });
    return r.ok || r.status < 500;
  } catch {
    return false;
  }
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

  const redraw = useCallback(() => {
    waiting.current = false;
    setOffline(false);
    startTransition(() => router.refresh());
  }, [router]);

  // Waiting for the connection: on the 'online' event, and every few
  // seconds in case a browser doesn't send it.
  useEffect(() => {
    if (!offline) return;
    let stop = false;
    const check = async () => {
      if (!stop && waiting.current && (await reachable()) && !stop) redraw();
    };
    const back = () => void check();
    window.addEventListener('online', back);
    const t = setInterval(back, 4000);
    return () => {
      stop = true;
      window.removeEventListener('online', back);
      clearInterval(t);
    };
  }, [offline, redraw]);

  const refresh = useCallback(() => {
    void (async () => {
      if (!(await reachable())) {
        waiting.current = true;
        setOffline(true);
        return;
      }
      redraw();
    })();
  }, [redraw]);

  return { pending, offline, refresh };
}

export function OfflineStrategyNote({ show, style }: { show: boolean; style?: CSSProperties }) {
  if (!show) return null;
  return (
    <p role="status" data-testid="strategy-offline-note" style={{ margin: 0, fontSize: 'var(--fs-dense)', lineHeight: 1.5, color: 'var(--negative)', ...style }}>
      {OFFLINE_STRATEGY_NOTE}
    </p>
  );
}
