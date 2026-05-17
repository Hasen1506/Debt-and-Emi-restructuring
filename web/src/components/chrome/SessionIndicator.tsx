'use client';

/**
 * Header sign-in/out affordance, themed per chrome variant. Lives next
 * to the ThemeSwitcher in each header so the auth state is always one
 * glance away.
 *
 * States:
 *   - loading → renders nothing (avoids a flash of "Sign in")
 *   - anon    → "Sign in" link to /login?next=<current path>
 *   - authed  → "user@example.com · Sign out" (sign-out calls /api/auth/logout,
 *               then router.refresh() so server components re-render)
 */

import { useRouter, usePathname } from 'next/navigation';
import { useSession } from '@/lib/auth';

type Variant = 'ledger' | 'editorial' | 'existing';

export function SessionIndicator({ variant }: { variant: Variant }) {
  const session = useSession();
  const router = useRouter();
  const pathname = usePathname();

  if (session.status === 'loading') return null;

  if (session.status === 'anon') {
    const next = pathname && pathname !== '/login' ? `?next=${encodeURIComponent(pathname)}` : '';
    return (
      <a href={`/login${next}`} style={linkStyle(variant)}>
        {variant === 'ledger' ? '[ SIGN IN ]' : 'Sign in'}
      </a>
    );
  }

  async function onSignOut() {
    await session.logout();
    router.push('/login');
    router.refresh();
  }

  const label = session.user.display_name || session.user.email;
  const shortLabel = label.length > 28 ? label.slice(0, 25) + '…' : label;

  return (
    <div style={containerStyle(variant)}>
      <span style={emailStyle(variant)} title={label}>
        {variant === 'ledger' ? shortLabel.toUpperCase() : shortLabel}
      </span>
      <span style={separatorStyle(variant)}>·</span>
      <button type="button" onClick={onSignOut} style={signOutStyle(variant)}>
        {variant === 'ledger' ? '[ SIGN OUT ]' : 'Sign out'}
      </button>
    </div>
  );
}

// ─── styles ─────────────────────────────────────────────────────────────────

function containerStyle(variant: Variant): React.CSSProperties {
  return {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    fontSize: variant === 'ledger' ? 11 : 12,
    fontFamily: variant === 'ledger' ? 'var(--font-mono)' : 'inherit',
    color: 'var(--muted)',
    letterSpacing: variant === 'ledger' ? '0.1em' : 'normal',
  };
}

function emailStyle(variant: Variant): React.CSSProperties {
  return {
    color: variant === 'ledger' ? 'var(--ink)' : 'var(--muted)',
    maxWidth: 220,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  };
}

function separatorStyle(variant: Variant): React.CSSProperties {
  return { color: 'var(--muted)', opacity: variant === 'ledger' ? 0.6 : 1 };
}

function signOutStyle(variant: Variant): React.CSSProperties {
  return {
    background: 'transparent',
    border: 'none',
    padding: 0,
    cursor: 'pointer',
    fontFamily: variant === 'ledger' ? 'var(--font-mono)' : 'inherit',
    fontSize: 'inherit',
    color: 'var(--accent)',
    letterSpacing: variant === 'ledger' ? '0.1em' : 'normal',
  };
}

function linkStyle(variant: Variant): React.CSSProperties {
  return {
    fontSize: variant === 'ledger' ? 11 : 12,
    fontFamily: variant === 'ledger' ? 'var(--font-mono)' : 'inherit',
    color: 'var(--accent)',
    textDecoration: 'none',
    letterSpacing: variant === 'ledger' ? '0.1em' : 'normal',
  };
}
