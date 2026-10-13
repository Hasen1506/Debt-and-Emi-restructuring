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

export const metadata: Metadata = {
  title: 'RightDue — Debt & EMI Optimiser',
  description:
    'A payoff plan for every loan you have, for India and the USA: what each loan really costs, what to pay this month, cheaper rates worth asking for, and the date you’ll be debt-free.',
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
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        {/* One family: the ledger look is IBM Plex Mono throughout. */}
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600;700&display=swap"
        />
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
      </body>
    </html>
  );
}
