import { ThemeSwitcher } from '@/components/ThemeSwitcher';
import { SessionIndicator } from '@/components/chrome/SessionIndicator';
import type { ThemeName } from '@/lib/theme';
import type { Country } from '@/lib/api';
import { getCountryToday } from '@/lib/today';
import { NAV_ITEMS } from '@/lib/nav';

/**
 * Ledger header — replaces the standard TopBar when theme=ledger.
 * Mono wordmark + section nav rendered as [BRACKETED] tokens, ASCII rules
 * above and below. Mirrors DHeader in direction-d.jsx. Nav structure comes
 * from lib/nav so all themes stay in the same order with the same item count.
 */

function statementLine(country: Country): string {
  const d = getCountryToday(country);
  const day = d
    .toLocaleDateString('en-GB', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' })
    .toUpperCase();
  // Render local wall-clock time in the user's tz so it lines up with the
  // date above (which is already shifted to country-local).
  const tz = country === 'IN' ? 'Asia/Kolkata' : 'America/New_York';
  const time = new Date().toLocaleTimeString('en-GB', {
    timeZone: tz,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  const tzLabel = country === 'IN' ? 'IST' : 'ET';
  return `${day} · ${time} ${tzLabel} · STMT #1138`;
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

export function LedgerHeader({ theme, country }: { theme: ThemeName; country: Country }) {
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
          {statementLine(country)}
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
          {NAV_ITEMS.map((n) => (
            <a
              key={n.route}
              href={n.route}
              style={{ color: 'var(--ink)', textDecoration: 'none' }}
            >
              [{n.labels.ledger}]
            </a>
          ))}
        </nav>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <SessionIndicator variant="ledger" />
          <ThemeSwitcher initial={theme} />
        </div>
      </div>
      <div className="app-shell">
        <Rule />
      </div>
    </header>
  );
}
