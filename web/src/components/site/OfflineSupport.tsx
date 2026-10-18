'use client';
/**
 * UX2 #23 offline and slow networks.
 *  • Registers public/sw.js (production builds): a page opened with no
 *    network gets public/offline.html instead of the browser's error page.
 *  • Keeps the last Home and Plan this browser showed (text only, with the
 *    time) for that page, labelled "as of", never as current figures.
 *  • Says so while offline: saves stay in this browser and go to the
 *    account when the connection is back (lib/server-sync queues them).
 */
import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { snapshotMain } from '@/lib/offline-snapshot';
import { ACCOUNT_KEY } from '@/lib/readable-cookie-age';

export function OfflineSupport({ register }: { register: boolean }) {
  const path = usePathname();
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    if (!register || !('serviceWorker' in navigator)) return;
    const go = () => { navigator.serviceWorker.register('/sw.js').catch(() => { /* offline page unavailable */ }); };
    if (document.readyState === 'complete') go();
    else window.addEventListener('load', go, { once: true });
  }, [register]);

  useEffect(() => {
    const sync = () => setOffline(!navigator.onLine);
    sync();
    window.addEventListener('online', sync);
    window.addEventListener('offline', sync);
    return () => { window.removeEventListener('online', sync); window.removeEventListener('offline', sync); };
  }, []);

  useEffect(() => {
    if (path !== '/' && path !== '/plan') return;
    // Only for the person this page loaded for: after a sign-out (or a switch) has cleared
    // this browser, a late timer or the page hiding must not write their plan back.
    const owner = localStorage.getItem(ACCOUNT_KEY);
    const take = () => { if (navigator.onLine && localStorage.getItem(ACCOUNT_KEY) === owner) snapshotMain(path, document, localStorage); };
    const t = window.setTimeout(take, 4000);
    const hide = () => { if (document.visibilityState === 'hidden') take(); };
    document.addEventListener('visibilitychange', hide);
    return () => { window.clearTimeout(t); document.removeEventListener('visibilitychange', hide); };
  }, [path]);

  if (!offline) return null;
  return (
    <div role="status" data-testid="offline-notice" className="app-shell"
      style={{ background: 'var(--highlight-soft)', borderLeft: '3px solid var(--accent)', padding: '8px 12px', margin: '8px auto 0', fontSize: 'var(--fs-dense)', lineHeight: 1.5 }}>
      <strong>You&apos;re offline.</strong> What you save is kept in this browser and sent to your account when you&apos;re back online.
      The figures on screen are from when this page loaded; the plan can&apos;t recalculate until then.
    </div>
  );
}
