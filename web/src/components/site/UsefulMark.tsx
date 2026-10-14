'use client';

/**
 * Audit 80+ E11: "time to useful content". Lab LCP said Setup was fast
 * because the largest paint was the footer disclaimer, while the first
 * field came 3 s later. This marks performance.mark('rd-useful') the first
 * time the page holds something to act on: a form field in <main>, or an
 * element the page flags with data-rd-useful (Plan's debt-free headline).
 * The Playwright perf check reads it; analytics can too.
 */
import { useEffect } from 'react';
import { usePathname } from 'next/navigation';

const USEFUL = 'main input:not([type=hidden]), main select, [data-rd-useful]';

export function UsefulMark() {
  const path = usePathname();
  useEffect(() => {
    if (typeof performance === 'undefined' || typeof performance.mark !== 'function') return;
    const done = () => performance.getEntriesByName('rd-useful').length > 0;
    if (done()) return;
    const check = () => {
      if (!done() && document.querySelector(USEFUL)) {
        performance.mark('rd-useful', { detail: { path } });
        return true;
      }
      return false;
    };
    if (check()) return;
    const mo = new MutationObserver(() => {
      if (check()) mo.disconnect();
    });
    mo.observe(document.body, { childList: true, subtree: true });
    return () => mo.disconnect();
  }, [path]);
  return null;
}
