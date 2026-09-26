import { loadThemeServer } from '@/lib/theme';
import { loadProfileServer } from '@/lib/user-store';
import { loadStrategyServer } from '@/lib/strategy';
import { ExistingInsights } from '@/components/insights/ExistingInsights';
import { EditorialInsights } from '@/components/insights/EditorialInsights';
import { LedgerInsights } from '@/components/insights/LedgerInsights';

export const dynamic = 'force-dynamic';

export default async function InsightsPage() {
  const [theme, profile, strategy] = await Promise.all([
    loadThemeServer(),
    loadProfileServer(),
    loadStrategyServer(),
  ]);
  if (theme === 'editorial')
    return <EditorialInsights profile={profile} strategy={strategy} />;
  if (theme === 'ledger')
    return (
      <>
        <h1 className="sr-only">Insights</h1>
        <LedgerInsights profile={profile} strategy={strategy} />
      </>
    );
  return <ExistingInsights profile={profile} strategy={strategy} />;
}
