import type { Metadata } from 'next';
import '@/styles/globals.css';
import { loadThemeServer, type ThemeName } from '@/lib/theme';
import { StandardTopBar } from '@/components/chrome/StandardTopBar';
import { EditorialMasthead } from '@/components/chrome/EditorialMasthead';
import { LedgerHeader } from '@/components/chrome/LedgerHeader';

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
        <Chrome theme={theme} />
        <main className="app-shell" style={{ paddingTop: 24, paddingBottom: 80 }}>
          {children}
        </main>
      </body>
    </html>
  );
}

function Chrome({ theme }: { theme: ThemeName }) {
  if (theme === 'editorial') return <EditorialMasthead theme={theme} />;
  if (theme === 'ledger') return <LedgerHeader theme={theme} />;
  return <StandardTopBar theme={theme} />;
}
