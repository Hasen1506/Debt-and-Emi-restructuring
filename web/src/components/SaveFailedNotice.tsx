'use client';
/**
 * Says so when a profile change wasn't saved. saveProfileClient reports a
 * failure (the browser didn't keep the cookies) with a window event, so
 * every screen that saves (tools, what-if, lifecycle events) gets the same
 * notice without handling it itself.
 */
import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { SAVE_FAILED_EVENT } from '@/lib/user-store';

export function SaveFailedNotice() {
  const [failed, setFailed] = useState(false);
  // Setup says it next to its Save button.
  const path = usePathname();
  const onSetup = path === '/onboarding' || path === '/profile';
  useEffect(() => {
    const on = () => setFailed(true);
    window.addEventListener(SAVE_FAILED_EVENT, on);
    return () => window.removeEventListener(SAVE_FAILED_EVENT, on);
  }, []);
  if (!failed || onSetup) return null;
  return (
    <div
      role="alert"
      className="app-shell"
      style={{
        margin: '12px auto 0',
        padding: '10px 14px',
        border: '1px solid var(--negative)',
        color: 'var(--negative)',
        fontSize: 'var(--fs-body)',
        lineHeight: 1.55,
        display: 'flex',
        gap: 12,
        justifyContent: 'space-between',
        alignItems: 'flex-start',
      }}
    >
      <span>
        That change wasn&apos;t saved: this browser didn&apos;t keep your profile.
        Check that cookies are allowed for this site, then try again.
      </span>
      <button
        type="button"
        onClick={() => setFailed(false)}
        aria-label="Dismiss"
        className="l-hit"
        style={{ background: 'transparent', border: 0, color: 'inherit', cursor: 'pointer', fontSize: 'var(--fs-body)', padding: '0 6px' }}
      >
        ×
      </button>
    </div>
  );
}
