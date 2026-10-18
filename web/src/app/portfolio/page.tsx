import { loadCurrentProfileServer } from '@/lib/user-store';
import { summarisePortfolio } from '@/components/portfolio/portfolioSummary';
import { LedgerPortfolio } from '@/components/portfolio/LedgerPortfolio';
import { CashManagementSection } from '@/components/debts/CashManagementSection';
import { LBracket, L_T } from '@/components/ledger/primitives';
import { PORTFOLIO_INTRO } from '@/lib/portfolio-tab';
import { AssetsTaxNav } from '@/components/chrome/AssetsTaxNav';

/** Its own tab title (UX50 C-26 / E-15). */
export const metadata = { title: 'Assets & tax: what you own · RightDue' };

/**
 * /portfolio: "What you own", the first half of the Assets & tax section
 * behind More (audit 80+ A20; it was its own tab since sprint G10 (founder's cut-list decision 2:
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
      <AssetsTaxNav current="/portfolio" />
      <header style={{ marginBottom: 22, maxWidth: 820 }}>
        <h1 style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--fs-h1)', fontWeight: 700, margin: 0, lineHeight: 1.25 }}>What you own</h1>
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
