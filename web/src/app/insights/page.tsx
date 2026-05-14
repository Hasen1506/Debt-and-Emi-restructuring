import { loadThemeServer } from '@/lib/theme';
import { ExistingInsights } from '@/components/insights/ExistingInsights';
import { EditorialInsights } from '@/components/insights/EditorialInsights';

export default async function InsightsPage() {
  const theme = await loadThemeServer();
  if (theme === 'editorial') return <EditorialInsights />;
  return <ExistingInsights />;
}
