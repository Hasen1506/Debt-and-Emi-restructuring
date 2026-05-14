import { ThemeSwitcher } from '@/components/ThemeSwitcher';
import type { ThemeName } from '@/lib/theme';

/**
 * Default chrome — the warm-card TopBar used by theme=existing. Extracted
 * from layout.tsx so the layout can dispatch to per-theme chrome.
 */
export function StandardTopBar({ theme }: { theme: ThemeName }) {
  return (
    <header
      style={{
        borderBottom: '1px solid var(--border)',
        background: 'var(--card)',
      }}
    >
      <div
        className="app-shell"
        style={{
          height: 56,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 16,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <strong style={{ fontWeight: 700, letterSpacing: '-0.01em' }}>
            FinOptima
          </strong>
          <span className="muted" style={{ fontSize: 13 }}>
            Debt &amp; EMI
          </span>
        </div>
        <nav style={{ display: 'flex', gap: 18, fontSize: 14 }}>
          <a href="/">Home</a>
          <a href="/onboarding">Setup</a>
          <a href="/debts">Debts</a>
          <a href="/plan">Plan</a>
          <a href="/tools">Tools</a>
          <a href="/insights">Insights</a>
        </nav>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <ThemeSwitcher initial={theme} />
          <span className="chip">IN · ₹</span>
        </div>
      </div>
    </header>
  );
}
