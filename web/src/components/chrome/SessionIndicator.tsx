'use client';
/**
 * Header sign-in/out control, next to the country pin in the masthead.
 *
 * States:
 *   - loading → renders nothing (avoids a flash of "Sign in")
 *   - anon    → "[SIGN IN]" link to /login?next=<current path>
 *   - authed  → "USER@EXAMPLE.COM · [SIGN OUT]" (sign-out calls
 *               /api/auth/logout, then router.refresh() so server
 *               components re-render)
 */
import { useRouter, usePathname } from 'next/navigation';
import { useSession } from '@/lib/auth';
import { useState } from 'react';

const TEXT: React.CSSProperties = {
  fontFamily: 'var(--font-mono)',
  fontSize: 10,
  letterSpacing: '0.14em',
};

export function SessionIndicator() {
  const session = useSession();
  const router = useRouter();
  const pathname = usePathname();
  const [error, setError] = useState<string | null>(null);
  const [signingOut, setSigningOut] = useState(false);

  if (session.status === 'loading') return null;

  if (session.status === 'anon') {
    const next = pathname && pathname !== '/login' ? `?next=${encodeURIComponent(pathname)}` : '';
    return (
      <a href={`/login${next}`} className="l-hit" style={{ ...TEXT, color: 'var(--accent)', textDecoration: 'none' }}>
        [SIGN IN]
      </a>
    );
  }

  async function onSignOut() {
    setSigningOut(true);
    setError(null);
    try {
      await session.logout();
      router.push('/login');
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign-out failed. Please try again.');
    } finally { setSigningOut(false); }
  }

  const label = session.user.display_name || session.user.email;
  const shortLabel = label.length > 28 ? label.slice(0, 25) + '…' : label;
  return (
    <span style={{ ...TEXT, display: 'inline-flex', maxWidth: '100%', alignItems: 'center', gap: 6, color: 'var(--muted)' }}>
      <span
        title={label}
        style={{ color: 'var(--ink)', maxWidth: 'min(220px, 45vw)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
      >
        {shortLabel.toUpperCase()}
      </span>
      <span aria-hidden style={{ opacity: 0.6 }}>·</span>
      <button
        type="button"
        onClick={onSignOut}
        disabled={signingOut}
        className="l-hit"
        style={{ ...TEXT, background: 'transparent', border: 'none', padding: 0, cursor: 'pointer', color: 'var(--accent)' }}
      >
        {signingOut ? '[SAVING…]' : '[SIGN OUT]'}
      </button>
      {error && <span role="alert" style={{ letterSpacing: 0, color: 'var(--negative)' }}>{error}</span>}
    </span>
  );
}
