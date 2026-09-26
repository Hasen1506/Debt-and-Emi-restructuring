import { loadProfileServer } from '@/lib/user-store';
import { loadThemeServer } from '@/lib/theme';
import { summarisePortfolio } from '@/components/portfolio/portfolioSummary';
import { LedgerPortfolio } from '@/components/portfolio/LedgerPortfolio';
import { EditorialPortfolio } from '@/components/portfolio/EditorialPortfolio';
import { ExistingPortfolio } from '@/components/portfolio/ExistingPortfolio';

/**
 * /portfolio — top-level "what you own" tab.
 *
 * Summary of the user's assets (FDs, MFs, gold, real estate, retirement)
 * with a list ranked by current value and CTAs into the asset mini-wizard
 * (/onboarding/assets) and the liquidation advisor (/tools/liquidate).
 *
 * Empty state when no assets are on file — pushes the user into the
 * mini-wizard rather than showing a wall of zeroes.
 */
export default async function PortfolioPage() {
  const [profile, theme] = await Promise.all([
    loadProfileServer(),
    loadThemeServer(),
  ]);
  const summary = summarisePortfolio(profile.user.assets, profile.user.country);

  if (theme === 'ledger') {
    return (
      <>
        <h1 className="sr-only">Portfolio</h1>
        <LedgerPortfolio
          summary={summary}
          country={profile.user.country}
          user={profile.user}
          marginalRate={profile.marginalRate}
        />
      </>
    );
  }
  if (theme === 'editorial') {
    return (
      <EditorialPortfolio
        summary={summary}
        country={profile.user.country}
        user={profile.user}
        marginalRate={profile.marginalRate}
      />
    );
  }
  return (
    <ExistingPortfolio
      summary={summary}
      country={profile.user.country}
      user={profile.user}
      marginalRate={profile.marginalRate}
    />
  );
}
