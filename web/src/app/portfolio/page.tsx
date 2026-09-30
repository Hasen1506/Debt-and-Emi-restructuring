import { loadCurrentProfileServer } from '@/lib/user-store';
import { summarisePortfolio } from '@/components/portfolio/portfolioSummary';
import { LedgerPortfolio } from '@/components/portfolio/LedgerPortfolio';

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
  const profile = await loadCurrentProfileServer();
  const summary = summarisePortfolio(profile.user.assets, profile.user.country);
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
