'use client';
/**
 * Header sign-in/out control, next to the country pin in the masthead.
 *
 * States:
 *   - loading → renders nothing (avoids a flash of "Sign in")
 *   (Brackets are drawn aria-hidden: audit 80+ E13.)
 *   - anon    → "[SIGN IN]" link to /login?next=<current path>
 *   - authed  → "USER@EXAMPLE.COM · [YOUR DATA] · [SIGN OUT]" ("Your data"
 *               is /account: download or delete, grill #51; sign-out calls
 *               /api/auth/logout, then a full load of /login so server
 *               components re-render)
 */
import { usePathname } from 'next/navigation';
import { useSession } from '@/lib/auth';
import { useState } from 'react';

const TEXT: React.CSSProperties = {
  fontFamily: 'var(--font-mono)',
  fontSize: 'var(--fs-label)',
  letterSpacing: '0.1em',
};

export function SessionIndicator() {
  const session = useSession();
  const pathname = usePathname();
  const [error, setError] = useState<string | null>(null);
  const [signingOut, setSigningOut] = useState(false);

  // Hold the space while the session loads, so the header doesn't look
  // like it lost its sign-in controls (live QA on a 404 page).
  if (session.status === 'loading') {
    return <span aria-hidden style={{ ...TEXT, color: 'var(--muted)', minWidth: 60, display: 'inline-block' }}>…</span>;
  }

  if (session.status === 'anon') {
    const next = pathname && pathname !== '/login' ? `?next=${encodeURIComponent(pathname)}` : '';
    return (
      <a href={`/login${next}`} className="l-hit" style={{ ...TEXT, color: 'var(--accent)', textDecoration: 'none' }}>
        <span aria-hidden="true">[</span>SIGN IN<span aria-hidden="true">]</span>
      </a>
    );
  }

  async function onSignOut() {
    setSigningOut(true);
    setError(null);
    try {
      await session.logout();
      // A full load, so no signed-in page flashes around the login card.
      window.location.assign('/login');
      return;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign-out failed. Please try again.');
    } finally { setSigningOut(false); }
  }

  const label = session.user.display_name || session.user.email;
  const shortLabel = label.length > 28 ? label.slice(0, 25) + '…' : label;
  return (
    <span className="rd-session" style={{ ...TEXT, display: 'inline-flex', flexWrap: 'wrap', maxWidth: '100%', alignItems: 'center', gap: 6, color: 'var(--muted)' }}>
      {/* UX50 C-10: the email as typed (not upper-cased), so "which account
          am I in?" has an answer; in the phone menu it gets its own line. */}
      <span
        title={label}
        className="rd-session-who"
        style={{ color: 'var(--ink)', maxWidth: 'min(220px, 45vw)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textTransform: 'none', letterSpacing: '0.02em' }}
      >
        {shortLabel}
      </span>
      <span aria-hidden style={{ opacity: 0.6 }}>·</span>
      <a href="/account" className="l-hit" style={{ ...TEXT, color: 'var(--accent)', textDecoration: 'none', whiteSpace: 'nowrap' }}>
        <span aria-hidden="true">[</span>YOUR DATA<span aria-hidden="true">]</span>
      </a>
      <span aria-hidden style={{ opacity: 0.6 }}>·</span>
      <button
        type="button"
        onClick={onSignOut}
        disabled={signingOut}
        className="l-hit"
        style={{ ...TEXT, background: 'transparent', border: 'none', padding: 0, cursor: 'pointer', color: 'var(--accent)', whiteSpace: 'nowrap' }}
      >
        <span aria-hidden="true">[</span>
        {signingOut ? 'SIGNING OUT…' : 'SIGN OUT'}
        <span aria-hidden="true">]</span>
      </button>
      {error && <span role="alert" style={{ letterSpacing: 0, color: 'var(--negative)' }}>{error}</span>}
    </span>
  );
}
