/**
 * Goals & Tools (REDESIGN R5): the goal ledger, then the tools.
 *
 * Goals live in localStorage on the client; the server pre-fetches the
 * indicative new-loan rate for the user's country, quoted when a goal
 * would need a loan to make its date.
 */

import { FirstVisitIntro } from '@/components/FirstVisitIntro';
import { loadCurrentProfileServer } from '@/lib/user-store';
import { api } from '@/lib/api';
import { GoalsPage as GoalLedger } from '@/components/goals/GoalsPage';
import { ToolsList } from '@/components/goals/ToolsList';
import { LShell, L_T } from '@/components/ledger/primitives';

/** Its own tab title (UX50 C-26 / E-15). */
export const metadata = { title: 'Goals · RightDue' };

export const dynamic = 'force-dynamic';

export default async function GoalsPage() {
  const profile = await loadCurrentProfileServer();
  const country = profile.user.country;

  // Pre-fetch indicative lowest rates by loan type — used to populate
  // the T3 tier copy ("you'd take ~₹X at ~Y% from {bank}"). Failure
  // here is non-fatal; the UI falls back to a 12% IN / 8% US default.
  const loanTypes = ['personal', 'home', 'education', 'auto'] as const;
  const rates: Record<string, { bank: string | null; low: string | null }> = {};
  await Promise.all(
    loanTypes.map(async (lt) => {
      try {
        const r = await api.marketLowest(country, lt);
        rates[lt] = { bank: r.bank, low: r.low };
      } catch {
        rates[lt] = { bank: null, low: null };
      }
    }),
  );

  return (
    <LShell>
      <h1 className="sr-only">Goals and tools</h1>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 30 }}>
        {/* What this page is for, in one line (each tab opens with one) */}
        <FirstVisitIntro id="goals" style={{ margin: 0, fontSize: 'var(--fs-body)', lineHeight: 1.6, color: L_T.inkSoft }}>
          What you&apos;re saving for, and a tool for each one-off decision: a bonus,
          a new loan, selling something, or investing instead of prepaying.
        </FirstVisitIntro>
        <GoalLedger user={profile.user} lowestRates={rates} />
        <ToolsList user={profile.user} />
      </div>
    </LShell>
  );
}
