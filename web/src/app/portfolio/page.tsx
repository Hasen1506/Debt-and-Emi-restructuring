import { loadCurrentProfileServer } from '@/lib/user-store';
import { summarisePortfolio } from '@/components/portfolio/portfolioSummary';
import { LedgerPortfolio } from '@/components/portfolio/LedgerPortfolio';
import { CashManagementSection } from '@/components/debts/CashManagementSection';
import { LBracket, L_T } from '@/components/ledger/primitives';
import { PORTFOLIO_INTRO } from '@/lib/portfolio-tab';

/**
 * /portfolio: its own tab since sprint G10 (founder's cut-list decision 2:
 * "keep, as a new tab"). It used to be Profile's "What you own" page.
 *
 * What the user holds and what it's worth (FDs, funds, gold, property,
 * retirement, crypto), shares and funds tracked by ticker, the cash they
 * keep, and a link to the Sell to repay calculator. Nothing here ranks
 * holdings or says what to sell (grill #50).
 *
 * Empty state when no assets are on file: it points to the add form
 * (/profile/assets) rather than showing a wall of zeroes.
 */
export default async function PortfolioPage() {
  const profile = await loadCurrentProfileServer();
  const summary = summarisePortfolio(profile.user.assets, profile.user.country);
  return (
    <>
      <header style={{ marginBottom: 22, maxWidth: 820 }}>
        <div style={{ fontSize: 11, letterSpacing: '0.18em', color: L_T.muted, marginBottom: 10 }}>PORTFOLIO · WHAT YOU OWN</div>
        <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0, textTransform: 'uppercase', lineHeight: 1.25 }}>Portfolio</h1>
        <p style={{ color: L_T.inkSoft, fontSize: 13, margin: '8px 0 0', lineHeight: 1.6 }}>
          {PORTFOLIO_INTRO}{' '}
          <LBracket href="/profile/assets">+ ADD OR EDIT</LBracket>
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
