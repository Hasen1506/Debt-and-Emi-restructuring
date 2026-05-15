import { ThemeSwitcher } from '@/components/ThemeSwitcher';
import type { ThemeName } from '@/lib/theme';
import type { Country } from '@/lib/api';
import { getCountryToday } from '@/lib/today';
import { NAV_ITEMS } from '@/lib/nav';

/**
 * Editorial masthead — replaces the standard TopBar when theme=editorial.
 * Mirrors the "FinOptima · Vol. III · Thursday, 14 May 2026" header from
 * direction-a.jsx — serif wordmark on the left, small uppercase nav on the
 * right, single hairline rule below. Nav structure comes from lib/nav so all
 * themes stay in the same order with the same item count.
 */

function todayLine(country: Country): string {
  const d = getCountryToday(country);
  const day = d.toLocaleDateString('en-GB', { weekday: 'long' });
  const date = d.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
  return `Vol. III · ${day}, ${date}`;
}

export function EditorialMasthead({
  theme,
  country,
}: {
  theme: ThemeName;
  country: Country;
}) {
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
            {todayLine(country)}
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
          {NAV_ITEMS.map((n) => (
            <a
              key={n.route}
              href={n.route}
              style={{ color: 'var(--muted)', textDecoration: 'none' }}
            >
              {n.labels.editorial}
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
