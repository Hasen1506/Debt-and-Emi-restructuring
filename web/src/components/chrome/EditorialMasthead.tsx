import { ThemeSwitcher } from '@/components/ThemeSwitcher';
import type { ThemeName } from '@/lib/theme';

/**
 * Editorial masthead — replaces the standard TopBar when theme=editorial.
 * Mirrors the "FinOptima · Vol. III · Thursday, 14 May 2026" header from
 * direction-a.jsx — serif wordmark on the left, small uppercase nav on the
 * right, single hairline rule below.
 */

const NAV = [
  { label: 'The letter', href: '/' },
  { label: 'The path', href: '/plan' },
  { label: 'Your debts', href: '/debts' },
  { label: 'Decisions', href: '/tools' },
  { label: 'Archive', href: '/insights' },
] as const;

function todayLine(): string {
  const d = new Date();
  const day = d.toLocaleDateString('en-GB', { weekday: 'long' });
  const date = d.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
  return `Vol. III · ${day}, ${date}`;
}

export function EditorialMasthead({ theme }: { theme: ThemeName }) {
  return (
    <header
      style={{
        borderBottom: '1px solid var(--border)',
        background: 'var(--canvas)',
      }}
    >
      <div
        className="app-shell"
        style={{
          padding: '20px 24px 16px',
          display: 'flex',
          alignItems: 'baseline',
          justifyContent: 'space-between',
          gap: 24,
          flexWrap: 'wrap',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 16 }}>
          <a
            href="/"
            style={{
              fontFamily: 'var(--font-display)',
              fontWeight: 600,
              fontSize: 22,
              letterSpacing: '-0.01em',
              color: 'var(--ink)',
              textDecoration: 'none',
            }}
          >
            FinOptima
          </a>
          <span
            style={{
              fontFamily: 'var(--font-sans)',
              fontSize: 11,
              color: 'var(--muted)',
              textTransform: 'uppercase',
              letterSpacing: '0.15em',
            }}
          >
            {todayLine()}
          </span>
        </div>
        <nav
          style={{
            display: 'flex',
            gap: 26,
            fontFamily: 'var(--font-sans)',
            fontSize: 12,
            color: 'var(--muted)',
            textTransform: 'uppercase',
            letterSpacing: '0.1em',
          }}
        >
          {NAV.map((n) => (
            <a
              key={n.href}
              href={n.href}
              style={{ color: 'var(--muted)', textDecoration: 'none' }}
            >
              {n.label}
            </a>
          ))}
        </nav>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <ThemeSwitcher initial={theme} />
        </div>
      </div>
    </header>
  );
}
