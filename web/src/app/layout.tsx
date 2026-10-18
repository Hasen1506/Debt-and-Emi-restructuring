import type { Metadata, Viewport } from 'next';
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
import { ConsentNotice } from '@/components/auth/ConsentNotice';
import { FxAutoRefresh } from '@/components/fx/FxAutoRefresh';
import { SiteFooter } from '@/components/site/SiteFooter';
import { BrowserErrorReporter } from '@/components/site/BrowserErrorReporter';
import { UsefulMark } from '@/components/site/UsefulMark';
import { EARLY_LEAVE_SCRIPT } from '@/lib/page-abort';
import { INTRO_HIDE_SCRIPT } from '@/lib/intro-seen';
import { THEME_SCRIPT } from '@/lib/theme';
import { OfflineSupport } from '@/components/site/OfflineSupport';
import { OtherTabSavedNotice } from '@/lib/tab-guard';

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

// The browser bar matches the page, which is light unless Profile >
// Appearance chose Dark (UI revert 18 Oct 2026: the system setting is not followed).
export const viewport: Viewport = {
  themeColor: '#fbfaf3',
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const [profile, strategy, rules] = await Promise.all([loadProfileServer(), loadStrategyServer(), loadRulesServer()]);
  // The strategy orders debts, so it shows only when there are some.
  const hasDebt = profile.user.loans.some((l) => Number(l.outstanding) > 0);
  // When every strategy pays the debts in the same order, the switch says so.
  const sameOrder = hasDebt ? sharedPayoffOrder({ ...profile.user, payoff_rules: rulesOrDefault(rules, profile.user.country) }, profile.marginalRate) : null;
  return (
    // suppressHydrationWarning: THEME_SCRIPT may set data-theme before React loads.
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* UX2 #23: a chosen light/dark theme applies before the first paint. */}
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
        {/* One family: the ledger look is IBM Plex Mono throughout, self-hosted
            (UX50 A-12; @font-face in styles/globals.css). */}
        <link rel="preload" href="/fonts/ibm-plex-mono-400-latin.woff2" as="font" type="font/woff2" crossOrigin="" />
        <link rel="preload" href="/fonts/ibm-plex-mono-700-latin.woff2" as="font" type="font/woff2" crossOrigin="" />
        {/* R12-1: note a leave that starts before the app's scripts have
            loaded (lib/page-abort.ts reads it), so the half-hydrated page
            doesn't start requests the navigation then cuts off. */}
        <script dangerouslySetInnerHTML={{ __html: EARLY_LEAVE_SCRIPT }} />
        {/* B22 × E10: hide the page intros this browser has seen before the
            first paint (lib/intro-seen), so they never move the page. */}
        <script dangerouslySetInnerHTML={{ __html: INTRO_HIDE_SCRIPT }} />
      </head>
      <body>
        <a href="#main" className="skip-link">
          Skip to content
        </a>
        <SecureCookies />
        <SessionHydrator />
        <FxAutoRefresh />
        <LMasthead
          country={profile.user.country}
          // UX fix 22: no payoff switch on the demo profile (signed out, or Setup before any loan is saved).
          strategy={hasDebt && profile.isLive ? strategy : null}
          signedIn={profile.isLive}
          sameOrder={sameOrder}
          navUser={{ country: profile.user.country, is_nri_us: profile.user.is_nri_us === true }}
        />
        <SaveFailedNotice />
        <AccountSyncNotice />
        {/* UX2 #23: offline page, last-seen plan "as of", offline notice. */}
        <OfflineSupport register={process.env.NODE_ENV === 'production'} />
        {/* UX2 #23: the profile was saved in another tab after this one loaded. */}
        <OtherTabSavedNotice />
        {/* audit80 D2: one-tap agreement when the notice or terms changed. */}
        <ConsentNotice />
        <main id="main" tabIndex={-1} className="app-shell" style={{ paddingTop: 18, paddingBottom: 32 }}>
          <ProfileProvider profile={profile}>{children}</ProfileProvider>
        </main>
        <LFooter />
        {/* UX50 E-06/E-07: disclaimer, privacy, terms, report a problem. */}
        <SiteFooter version={process.env.RENDER_GIT_COMMIT ?? process.env.GIT_COMMIT ?? null} />
        {/* UX50 E-03: browser errors to Sentry only when a DSN is set. */}
        <BrowserErrorReporter enabled={Boolean(process.env.SENTRY_DSN)} />
        {/* Audit 80+ E11: performance.mark('rd-useful') at first actionable content. */}
        <UsefulMark />
      </body>
    </html>
  );
}
