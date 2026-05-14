import { ThemeSwitcher } from '@/components/ThemeSwitcher';
import type { ThemeName } from '@/lib/theme';

/**
 * Ledger header — replaces the standard TopBar when theme=ledger.
 * Mono wordmark + section nav rendered as [BRACKETED] tokens, ASCII rules
 * above and below. Mirrors DHeader in direction-d.jsx.
 */

const NAV = [
  { token: 'LEDGER', href: '/' },
  { token: 'PLAN', href: '/plan' },
  { token: 'DEBTS', href: '/debts' },
  { token: 'TOOLS', href: '/tools' },
  { token: 'INSIGHTS', href: '/insights' },
  { token: 'SETUP', href: '/onboarding' },
] as const;

function statementLine(): string {
  const d = new Date();
  const day = d
    .toLocaleDateString('en-GB', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' })
    .toUpperCase();
  const time = d.toLocaleTimeString('en-IN', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  return `${day} · ${time} IST · STMT #1138`;
}

function Rule() {
  return (
    <div
      aria-hidden
      style={{
        whiteSpace: 'pre',
        overflow: 'hidden',
        color: 'var(--ink)',
        fontWeight: 700,
        lineHeight: 1,
        fontFamily: 'var(--font-mono)',
      }}
    >
      {'─'.repeat(200)}
    </div>
  );
}

export function LedgerHeader({ theme }: { theme: ThemeName }) {
  return (
    <header style={{ background: 'var(--canvas)', padding: '14px 0 0' }}>
      <div
        className="app-shell"
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'baseline',
          flexWrap: 'wrap',
          gap: 12,
        }}
      >
        <div
          style={{
            fontSize: 14,
            fontWeight: 700,
            letterSpacing: '0.18em',
            fontFamily: 'var(--font-mono)',
          }}
        >
          FINOPTIMA
          <span style={{ color: 'var(--muted)', fontWeight: 400 }}> / LEDGER</span>
        </div>
        <div
          style={{
            fontSize: 11,
            color: 'var(--muted)',
            letterSpacing: '0.1em',
            fontFamily: 'var(--font-mono)',
          }}
        >
          {statementLine()}
        </div>
      </div>
      <div className="app-shell" style={{ margin: '8px 0 0' }}>
        <Rule />
      </div>
      <div
        className="app-shell"
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: 16,
          flexWrap: 'wrap',
          padding: '8px 24px',
        }}
      >
        <nav
          style={{
            display: 'flex',
            gap: 24,
            fontSize: 11,
            letterSpacing: '0.1em',
            fontFamily: 'var(--font-mono)',
          }}
        >
          {NAV.map((n) => (
            <a
              key={n.token}
              href={n.href}
              style={{ color: 'var(--ink)', textDecoration: 'none' }}
            >
              [{n.token}]
            </a>
          ))}
        </nav>
        <ThemeSwitcher initial={theme} />
      </div>
      <div className="app-shell">
        <Rule />
      </div>
    </header>
  );
}
