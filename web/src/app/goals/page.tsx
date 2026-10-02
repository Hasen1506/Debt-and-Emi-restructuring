/**
 * Goals & Tools (REDESIGN R5): the goal ledger, then the tools.
 *
 * Goals live in localStorage on the client; the server pre-fetches the
 * indicative new-loan rate for the user's country, quoted when a goal
 * would need a loan to make its date.
 */

import { loadCurrentProfileServer } from '@/lib/user-store';
import { api } from '@/lib/api';
import { GoalsPage as GoalLedger } from '@/components/goals/GoalsPage';
import { ToolsList } from '@/components/goals/ToolsList';
import { LShell } from '@/components/ledger/primitives';

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
        <GoalLedger user={profile.user} lowestRates={rates} />
        <ToolsList user={profile.user} />
      </div>
    </LShell>
  );
}
