import { loadProfileServer } from '@/lib/user-store';
import { loadPlanInputsFromCookies } from '@/components/plan/load-plan';
import { LedgerInsights } from '@/components/insights/LedgerInsights';

export const dynamic = 'force-dynamic';

export default async function ActivityRoute() {
  // The plan's inputs (not a run of it): the log dialog previews each
  // entry against them.
  const [profile, inputs] = await Promise.all([
    loadProfileServer(),
    loadPlanInputsFromCookies().catch(() => null),
  ]);
  return (
    <>
      <h1 className="sr-only">Activity</h1>
      <LedgerInsights
        user={profile.user}
        runArgs={inputs?.simBaseArgs ?? null}
        strategy={inputs?.strategy ?? 'avalanche'}
        rolled={inputs?.rolled ?? []}
      />
    </>
  );
}
