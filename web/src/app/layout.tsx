import type { Metadata } from 'next';
import '@/styles/globals.css';
import { loadThemeServer } from '@/lib/theme';
import { ThemeSwitcher } from '@/components/ThemeSwitcher';

export const metadata: Metadata = {
  title: 'FinOptima — Debt & EMI Optimiser',
  description:
    'Personal debt restructuring & payoff optimiser for India and USA. Layer 1 restructure, Layer 2 avalanche/hybrid/snowball, Layer 3 invest-vs-prepay.',
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const theme = await loadThemeServer();
  return (
    <html lang="en" data-theme={theme}>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600&family=Spectral:ital,wght@0,300;0,400;0,500;0,600;0,700;1,400&family=IBM+Plex+Mono:wght@400;500;600;700&display=swap"
        />
      </head>
      <body>
        <AppShell theme={theme}>{children}</AppShell>
      </body>
    </html>
  );
}

function AppShell({ theme, children }: { theme: 'existing' | 'editorial' | 'ledger'; children: React.ReactNode }) {
  return (
    <>
      <TopBar theme={theme} />
      <main className="app-shell" style={{ paddingTop: 24, paddingBottom: 80 }}>
        {children}
      </main>
    </>
  );
}

function TopBar({ theme }: { theme: 'existing' | 'editorial' | 'ledger' }) {
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
