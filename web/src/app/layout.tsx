import type { Metadata } from 'next';
import '@/styles/globals.css';
import { loadProfileServer } from '@/lib/user-store';
import { loadStrategyServer } from '@/lib/strategy';
import { sharedPayoffOrder } from '@/lib/payoff-order';
import { loadRulesServer, rulesOrDefault } from '@/lib/payoff-rules';
import { LMasthead } from '@/components/ledger/LMasthead';
import { LFooter } from '@/components/ledger/primitives';
import { SessionHydrator } from '@/lib/server-sync';
import { SecureCookies } from '@/components/SecureCookies';
import { ProfileProvider } from '@/lib/use-profile';
import { SaveFailedNotice } from '@/components/SaveFailedNotice';
import { AccountSyncNotice } from '@/components/AccountSyncNotice';
import { FxAutoRefresh } from '@/components/fx/FxAutoRefresh';
import { SiteFooter } from '@/components/site/SiteFooter';
import { BrowserErrorReporter } from '@/components/site/BrowserErrorReporter';

export const metadata: Metadata = {
  title: 'RightDue — Debt & EMI Optimiser',
  description:
    'A payoff plan for every loan you have, for India and the USA: what each loan really costs, what to pay this month, cheaper rates worth asking for, and the date you’ll be debt-free.',
  // UX50 E-14: share cards for every page (icons: app/favicon.ico,
  // app/icon.svg and app/apple-icon.png, by file convention).
  metadataBase: new URL('https://rightdue.app'),
  openGraph: { siteName: 'RightDue', type: 'website', locale: 'en_IN', images: [{ url: '/og.png', width: 1200, height: 630 }] },
  twitter: { card: 'summary_large_image', images: ['/og.png'] },
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const [profile, strategy, rules] = await Promise.all([loadProfileServer(), loadStrategyServer(), loadRulesServer()]);
  // The strategy orders debts, so it shows only when there are some.
  const hasDebt = profile.user.loans.some((l) => Number(l.outstanding) > 0);
  // When every strategy pays the debts in the same order, the switch says so.
  const sameOrder = hasDebt ? sharedPayoffOrder({ ...profile.user, payoff_rules: rulesOrDefault(rules, profile.user.country) }, profile.marginalRate) : null;
  return (
    <html lang="en">
      <head>
        {/* One family: the ledger look is IBM Plex Mono throughout, self-hosted
            (UX50 A-12; @font-face in styles/globals.css). */}
        <link rel="preload" href="/fonts/ibm-plex-mono-400-latin.woff2" as="font" type="font/woff2" crossOrigin="" />
        <link rel="preload" href="/fonts/ibm-plex-mono-700-latin.woff2" as="font" type="font/woff2" crossOrigin="" />
      </head>
      <body>
        <a href="#main" className="skip-link">
          Skip to content
        </a>
        <SecureCookies />
        <SessionHydrator />
        <FxAutoRefresh />
        <LMasthead country={profile.user.country} strategy={hasDebt ? strategy : null} sameOrder={sameOrder} />
        <SaveFailedNotice />
        <AccountSyncNotice />
        <main id="main" tabIndex={-1} className="app-shell" style={{ paddingTop: 18, paddingBottom: 32 }}>
          <ProfileProvider profile={profile}>{children}</ProfileProvider>
        </main>
        <LFooter />
        {/* UX50 E-06/E-07: disclaimer, privacy, terms, report a problem. */}
        <SiteFooter version={process.env.RENDER_GIT_COMMIT ?? process.env.GIT_COMMIT ?? null} />
        {/* UX50 E-03: browser errors to Sentry only when a DSN is set. */}
        <BrowserErrorReporter enabled={Boolean(process.env.SENTRY_DSN)} />
      </body>
    </html>
  );
}
