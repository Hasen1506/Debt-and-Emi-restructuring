import { loadThemeServer } from '@/lib/theme';
import { loadProfileServer } from '@/lib/user-store';
import { ExistingInsights } from '@/components/insights/ExistingInsights';
import { EditorialInsights } from '@/components/insights/EditorialInsights';
import { LedgerInsights } from '@/components/insights/LedgerInsights';

export const dynamic = 'force-dynamic';

export default async function InsightsPage() {
  const [theme, profile] = await Promise.all([
    loadThemeServer(),
    loadProfileServer(),
  ]);
  if (theme === 'editorial') return <EditorialInsights profile={profile} />;
  if (theme === 'ledger') return <LedgerInsights profile={profile} />;
  return <ExistingInsights profile={profile} />;
}
