/**
 * Goals page — server shell that loads user/profile + indicative
 * lowest-rate data, then delegates rendering to the client component.
 *
 * Pre-auth, the goals list itself comes from localStorage on the
 * client; the server pre-fetches the indicative new-loan rates for
 * the user's country (one per loan_type the achievability check might
 * suggest) so the T3 tier renders without a round-trip.
 */

import { loadProfileServer } from '@/lib/user-store';
import { api } from '@/lib/api';
import { loadThemeServer } from '@/lib/theme';
import { GoalsClient } from './GoalsClient';

export const dynamic = 'force-dynamic';

export default async function GoalsPage() {
  const profile = await loadProfileServer();
  const country = profile.user.country;
  const theme = await loadThemeServer();

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
    <GoalsClient
      user={profile.user}
      lowestRates={rates}
      themeName={theme}
    />
  );
}
