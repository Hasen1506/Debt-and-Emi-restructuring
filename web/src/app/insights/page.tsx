import { loadThemeServer } from '@/lib/theme';
import { ExistingInsights } from '@/components/insights/ExistingInsights';
import { EditorialInsights } from '@/components/insights/EditorialInsights';
import { LedgerInsights } from '@/components/insights/LedgerInsights';

export default async function InsightsPage() {
  const theme = await loadThemeServer();
  if (theme === 'editorial') return <EditorialInsights />;
  if (theme === 'ledger') return <LedgerInsights />;
  return <ExistingInsights />;
}
