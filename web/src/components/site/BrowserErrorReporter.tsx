'use client';
/**
 * UX50 E-03: browser errors (window.onerror, unhandled promise rejections)
 * go to Sentry when SENTRY_DSN is set on the server, and nowhere otherwise.
 * The browser posts a tiny report to our own /api/client-error, which scrubs
 * it (digits masked, 300 characters) and forwards it with the server-side
 * client (lib/error-report). So no Sentry host is added to the CSP and no
 * build-time variable is needed. Never figures, inputs, cookies or storage.
 *
 * R10-3: a script chunk that fails to load (an open tab after a deploy)
 * reloads the page once, whether or not reporting is on.
 */
import { useEffect } from 'react';
import { isChunkLoadError, reloadOnceForChunkError, shouldReport } from '@/lib/client-error';

export function BrowserErrorReporter({ enabled }: { enabled: boolean }) {
  useEffect(() => {
    let sent = 0;
    let leaving = false;
    const onLeave = () => { leaving = true; };
    const onShow = () => { leaving = false; };
    const send = (name: string, message: string) => {
      if (isChunkLoadError(name, message) && reloadOnceForChunkError(window, leaving)) return;
      if (!enabled || leaving) return;
      if (sent >= 5 || !shouldReport(name, message)) return; // at most 5 a page view
      sent += 1;
      const body = JSON.stringify({ name: name.slice(0, 80), message: message.slice(0, 300), path: window.location.pathname.slice(0, 120) });
      try {
        if (navigator.sendBeacon) navigator.sendBeacon('/api/client-error', new Blob([body], { type: 'application/json' }));
        else void fetch('/api/client-error', { method: 'POST', body, headers: { 'Content-Type': 'application/json' }, keepalive: true });
      } catch { /* never let reporting break the page */ }
    };
    const onError = (e: ErrorEvent) => send(e.error?.name ?? 'Error', e.message ?? '');
    const onRejection = (e: PromiseRejectionEvent) => {
      const r = e.reason;
      send(r instanceof Error ? r.name : 'UnhandledRejection', r instanceof Error ? r.message : String(r ?? ''));
    };
    window.addEventListener('error', onError);
    window.addEventListener('unhandledrejection', onRejection);
    window.addEventListener('pagehide', onLeave);
    window.addEventListener('pageshow', onShow);
    return () => {
      window.removeEventListener('error', onError);
      window.removeEventListener('unhandledrejection', onRejection);
      window.removeEventListener('pagehide', onLeave);
      window.removeEventListener('pageshow', onShow);
    };
  }, [enabled]);
  return null;
}
