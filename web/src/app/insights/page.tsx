import { loadProfileServer } from '@/lib/user-store';
import { loadStrategyServer } from '@/lib/strategy';
import { LedgerInsights } from '@/components/insights/LedgerInsights';

export const dynamic = 'force-dynamic';

export default async function InsightsPage() {
  const [profile, strategy] = await Promise.all([loadProfileServer(), loadStrategyServer()]);
  return (
    <>
      <h1 className="sr-only">Insights</h1>
      <LedgerInsights profile={profile} strategy={strategy} />
    </>
  );
}
