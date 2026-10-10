import { loadCurrentProfileServer } from '@/lib/user-store';
import { summarisePortfolio } from '@/components/portfolio/portfolioSummary';
import { LedgerPortfolio } from '@/components/portfolio/LedgerPortfolio';
import { CashManagementSection } from '@/components/debts/CashManagementSection';
import { LBracket, L_T } from '@/components/ledger/primitives';

/**
 * /portfolio: Profile's "What you own" (REDESIGN V5). Reached from the
 * Profile summary; the masthead keeps PROFILE lit and the header says so.
 *
 * Summary of the user's assets (FDs, MFs, gold, real estate, retirement)
 * with a list ranked by current value and CTAs into the asset mini-wizard
 * (/profile/assets) and the liquidation advisor (/tools/liquidate).
 *
 * Empty state when no assets are on file — pushes the user into the
 * mini-wizard rather than showing a wall of zeroes.
 */
export default async function PortfolioPage() {
  const profile = await loadCurrentProfileServer();
  const summary = summarisePortfolio(profile.user.assets, profile.user.country);
  return (
    <>
      {/* Headed like the rest of Profile, with the way back to it. */}
      <header style={{ marginBottom: 22, maxWidth: 820 }}>
        <div style={{ fontSize: 11, letterSpacing: '0.18em', color: L_T.muted, marginBottom: 10 }}>PROFILE · WHAT YOU OWN</div>
        <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0, textTransform: 'uppercase', lineHeight: 1.25 }}>What you own</h1>
        <p style={{ color: L_T.inkSoft, fontSize: 13, margin: '8px 0 0', lineHeight: 1.6 }}>
          What you hold and what it&apos;s worth, the cash you keep, and whether selling something beats keeping a loan.{' '}
          <LBracket href="/profile">← WHOLE PROFILE</LBracket>
        </p>
      </header>
      <LedgerPortfolio
        summary={summary}
        country={profile.user.country}
        user={profile.user}
        marginalRate={profile.marginalRate}
      />
      {/* Idle cash, the tax sleeve and the monthly check-in (moved here from
          the Debts page in R2: they're about the cash you hold). */}
      <CashManagementSection profile={profile} />
    </>
  );
}
