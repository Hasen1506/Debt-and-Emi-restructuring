import { LedgerPlan } from '@/components/plan/LedgerPlan';
import { loadPlanFromCookies } from '@/components/plan/load-plan';

export const dynamic = 'force-dynamic';

export default async function PlanPage() {
  const plan = await loadPlanFromCookies();
  return (
    <>
      <h1 className="sr-only">Your plan</h1>
      <LedgerPlan plan={plan} />
    </>
  );
}
